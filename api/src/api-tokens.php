<?php
declare(strict_types=1);

// ─── App-Tokens fuer Android-App und Web-Scanner (Konzept v2, A4) ────────────────────────────────
// R5 einer Allianz (oder der Betreiber) legt Tokens fuer genau diese Allianz an und widerruft sie. Gespeichert wird nur der
// SHA-256 des Klartexts; der Klartext steht genau einmal in der Antwort von POST /api-tokens.
// Geprueft werden die Tokens in caller-auth.php (resolveApiToken).

const API_TOKEN_PREFIX = 'lwhub_';
const API_TOKEN_ROLES = ['scanner' => 1, 'r4' => 4, 'r5' => 5];

/**
 * R5 genau dieser Allianz (ohne Ehrenrolle) oder der Betreiber (Site-Admin) – wie bei den
 * Feature-Schaltern (requireFeatureAdmin) darf er Tokens auch in Allianzen ohne eigenen Char verwalten,
 * z. B. den App-Token fuer Thomas. Der Betreiber nur mit von Discord bestaetigter Anmeldung, auch im
 * Modus 'log': ein Token gibt Rechte in der Allianz.
 * Liefert ['discord_id' => geprueft bzw. behauptet, 'rank' => int].
 */
function requireApiTokenAdmin(PDO $pdo, string $alliance, string $discordId): array {
    if ($alliance === '') jsonOut(400, ['error' => 'Allianz fehlt']);
    if (isLocalRequest()) return ['discord_id' => $discordId !== '' ? $discordId : null, 'rank' => 5];

    $caller = resolveCallerId($pdo, $alliance, $discordId);
    if ($caller['verified'] && isSiteAdmin($pdo, $caller['id'])) {
        return ['discord_id' => $caller['id'], 'rank' => 5];
    }

    requireR5($pdo, $discordId, $alliance);
    $id = $caller['id'];
    $member = $id !== '' ? getDiscordMember($pdo, $alliance, $id, true) : null;
    if (!$member || normalizeHonorRole($member['honor_role'] ?? null) !== null || safeRank((int)$member['current_rank_code']) < 5) {
        jsonOut(403, ['error' => "Nur R5 der Allianz {$alliance} oder der Betreiber (mit Discord-Anmeldung) darf API-Tokens verwalten."]);
    }
    return ['discord_id' => $id, 'rank' => safeRank((int)$member['current_rank_code'])];
}

/** Rolle eines Aufrufers mit diesem Rang: R5 -> r5, R4 -> r4, sonst scanner. */
function apiTokenRoleForRank(int $rank): string {
    return $rank >= 5 ? 'r5' : ($rank >= 4 ? 'r4' : 'scanner');
}

function newApiTokenPlaintext(): string {
    return API_TOKEN_PREFIX . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function handleListApiTokens(PDO $pdo, string $alliance): never {
    $dId = '';
    try { $dId = normalizeDiscordId($_GET['discord_id'] ?? ''); } catch (\InvalidArgumentException) {}
    requireApiTokenAdmin($pdo, $alliance, $dId);

    $stmt = $pdo->prepare("
        SELECT t.token_id, t.alliance, t.client_name, t.role, t.created_by, t.created_at,
               t.last_used_at, t.expires_at, t.is_active,
               -- Profil-Cache hat eine Zeile je Allianz: nur die neueste, sonst doppelte Token-Zeilen
               (SELECT dpc.discord_username FROM discord_profile_cache dpc
                 WHERE dpc.discord_user_id = t.created_by ORDER BY dpc.updated_at DESC LIMIT 1) AS created_by_name
        FROM api_tokens t
        WHERE t.alliance = ?
        ORDER BY t.is_active DESC, t.created_at DESC
    ");
    $stmt->execute([$alliance]);
    $tokens = array_map(fn($r) => [
        'token_id'        => $r['token_id'],
        'alliance'        => $r['alliance'],
        'client_name'     => $r['client_name'],
        'role'            => $r['role'],
        'created_by'      => $r['created_by'],
        'created_by_name' => $r['created_by_name'],
        'created_at'      => $r['created_at'],
        'last_used_at'    => $r['last_used_at'],
        'expires_at'      => $r['expires_at'],
        'is_active'       => (bool)$r['is_active'],
        'expired'         => $r['expires_at'] !== null && strtotime($r['expires_at']) <= time(),
    ], $stmt->fetchAll());

    jsonOut(200, ['ok' => true, 'alliance' => $alliance, 'tokens' => $tokens]);
}

function handleCreateApiToken(PDO $pdo, string $alliance, array $body): never {
    try { $dId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    $alliance = trim((string)($body['alliance'] ?? '')) ?: $alliance;
    $caller = requireApiTokenAdmin($pdo, $alliance, $dId);

    $clientName = trim((string)($body['client_name'] ?? ''));
    if ($clientName === '') jsonOut(400, ['error' => 'Name fehlt']);
    if (!preg_match('/^.{1,100}$/us', $clientName)) jsonOut(400, ['error' => 'Name zu lang (max. 100 Zeichen)']);

    $role = strtolower(trim((string)($body['role'] ?? 'scanner')));
    if (!isset(API_TOKEN_ROLES[$role])) jsonOut(400, ['error' => 'Rolle muss scanner, r4 oder r5 sein']);
    // Niemand vergibt mehr Rechte, als er selbst hat
    if (API_TOKEN_ROLES[$role] > API_TOKEN_ROLES[apiTokenRoleForRank($caller['rank'])]) {
        jsonOut(403, ['error' => 'Die Rolle ist hoeher als deine eigene.']);
    }

    $expiresAt = null;
    $rawExpires = trim((string)($body['expires_at'] ?? ''));
    if ($rawExpires !== '') {
        $ts = strtotime(preg_match('/^\d{4}-\d{2}-\d{2}$/', $rawExpires) ? $rawExpires . ' 23:59:59' : $rawExpires);
        if ($ts === false) jsonOut(400, ['error' => 'Ungueltiges Ablaufdatum']);
        if ($ts <= time()) jsonOut(400, ['error' => 'Das Ablaufdatum liegt in der Vergangenheit']);
        $expiresAt = date('Y-m-d H:i:s', $ts);
    }

    $tokenId = uuid4();
    $plain = newApiTokenPlaintext();
    $pdo->prepare("
        INSERT INTO api_tokens (token_id, alliance, token_hash, client_name, role, created_by, expires_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ")->execute([$tokenId, $alliance, hash('sha256', $plain), $clientName, $role, $caller['discord_id'], $expiresAt]);

    jsonOut(200, [
        'ok'          => true,
        'token_id'    => $tokenId,
        'token'       => $plain, // nur hier im Klartext, danach nie wieder
        'alliance'    => $alliance,
        'client_name' => $clientName,
        'role'        => $role,
        'expires_at'  => $expiresAt,
    ]);
}

function handleRevokeApiToken(PDO $pdo, string $alliance, string $tokenId, array $body): never {
    try { $dId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    $alliance = trim((string)($body['alliance'] ?? '')) ?: $alliance;
    requireApiTokenAdmin($pdo, $alliance, $dId);

    // Nur widerrufen, nicht loeschen: created_by/last_used_at bleiben fuer die Nachvollziehbarkeit
    $stmt = $pdo->prepare("UPDATE api_tokens SET is_active = 0 WHERE token_id = ? AND alliance = ?");
    $stmt->execute([$tokenId, $alliance]);
    if ($stmt->rowCount() === 0) {
        $exists = $pdo->prepare("SELECT 1 FROM api_tokens WHERE token_id = ? AND alliance = ?");
        $exists->execute([$tokenId, $alliance]);
        if (!$exists->fetch()) jsonOut(404, ['error' => 'Token nicht gefunden']);
    }
    jsonOut(200, ['ok' => true, 'revoked' => $tokenId]);
}
