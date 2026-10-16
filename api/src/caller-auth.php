<?php
declare(strict_types=1);

// ─── Gepruefte Aufrufer-Identitaet (Konzept v2, A10 – vorerst nur fuer den Scanner) ──────────────
// Der Client schickt sein Discord-Access-Token als "Authorization: Bearer <token>". Der Server fragt
// Discord (/users/@me), wem das Token gehoert, und cached das Ergebnis 15 Minuten in api_auth_cache.
// Anders als bei den uebrigen Routen zaehlt hier also nicht die vom Client behauptete discord_id.
//
// Schalter LWHUB_SCANNER_AUTH_MODE (config.php oder Umgebung):
//   'enforce' (Standard) = blockieren, 'log' = nur in api_auth_log protokollieren, 'off' = keine Pruefung.

const DISCORD_AUTH_CACHE_SECONDS = 900;

function scannerAuthMode(): string {
    $mode = strtolower(trim((string)(getenv('LWHUB_SCANNER_AUTH_MODE')
        ?: (defined('LWHUB_SCANNER_AUTH_MODE') ? LWHUB_SCANNER_AUTH_MODE : 'enforce'))));
    return in_array($mode, ['off', 'log', 'enforce'], true) ? $mode : 'enforce';
}

/** Bearer-Token aus dem Request; Apache/FastCGI reicht den Header je nach Setup unterschiedlich weiter. */
function requestBearerToken(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp((string)$name, 'Authorization') === 0) $header = (string)$value;
        }
    }
    return preg_match('/^Bearer\s+(\S+)$/i', trim($header), $m) ? $m[1] : '';
}

/** Discord-User-ID zum Access-Token, oder null wenn Discord es nicht (mehr) akzeptiert. */
function verifyDiscordToken(PDO $pdo, string $token): ?string {
    if ($token === '' || str_starts_with($token, 'lwhub_')) return null; // App-Tokens (A4) noch nicht unterstuetzt
    $hash = hash('sha256', $token);

    $stmt = $pdo->prepare('SELECT discord_user_id FROM api_auth_cache WHERE token_hash = ? AND expires_at > NOW()');
    $stmt->execute([$hash]);
    $cached = $stmt->fetchColumn();
    if ($cached !== false) return (string)$cached;

    $status = 0;
    $raw = false;
    if (function_exists('curl_init')) {
        $ch = curl_init('https://discord.com/api/users/@me');
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 3,
        ]);
        $raw = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => [
            'header' => 'Authorization: Bearer ' . $token,
            'timeout' => 3,
            'ignore_errors' => true,
        ]]);
        $raw = @file_get_contents('https://discord.com/api/users/@me', false, $ctx);
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $status = (int)$m[1];
        }
    }
    if ($status !== 200 || !is_string($raw)) return null;
    $user = json_decode($raw, true);
    $id = normalizeDiscordId($user['id'] ?? '');
    if ($id === '') return null;

    $pdo->prepare('
        INSERT INTO api_auth_cache (token_hash, discord_user_id, expires_at)
        VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ' . DISCORD_AUTH_CACHE_SECONDS . ' SECOND))
        ON DUPLICATE KEY UPDATE discord_user_id = VALUES(discord_user_id), expires_at = VALUES(expires_at)
    ')->execute([$hash, $id]);
    $pdo->exec('DELETE FROM api_auth_cache WHERE expires_at < NOW()');
    return $id;
}

function logAuthDecision(PDO $pdo, string $verdict, string $alliance, ?string $claimedId, ?string $verifiedId): void {
    try {
        $pdo->prepare('
            INSERT INTO api_auth_log (method, path, alliance, claimed_discord_id, verified_discord_id, verdict, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ')->execute([
            substr($_SERVER['REQUEST_METHOD'] ?? '', 0, 8),
            substr((string)parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), 0, 190),
            $alliance,
            $claimedId,
            $verifiedId,
            $verdict,
            substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 45),
        ]);
    } catch (\PDOException) { /* Protokoll darf den Request nie scheitern lassen */ }
}

/**
 * Scanner-Zugriff: geprueftes Discord-Token von R4/R5 der Allianz (ohne Ehrenrolle) oder Site-Admin.
 * Lokale Requests (PHP-Dev-Server auf 127.0.0.1) sind wie ueberall in der API ausgenommen.
 * Gibt den Aufrufer zurueck; bei fehlender Berechtigung 401/403 (im Modus 'log' nur protokolliert).
 */
function requireScannerAccess(PDO $pdo, string $alliance, ?string $claimedId = null): array {
    $mode = scannerAuthMode();
    if ($mode === 'off' || isLocalRequest()) {
        return ['discord_id' => null, 'name' => 'Lokaler Zugriff', 'rank' => 5, 'site_admin' => false, 'alliance' => $alliance];
    }

    $deny = function (int $status, string $verdict, string $message, ?string $verifiedId) use ($pdo, $alliance, $claimedId, $mode): array {
        logAuthDecision($pdo, $verdict, $alliance, $claimedId, $verifiedId);
        if ($mode === 'enforce') jsonOut($status, ['error' => $message, 'code' => $verdict]);
        return ['discord_id' => $verifiedId, 'name' => null, 'rank' => null, 'site_admin' => false, 'alliance' => $alliance];
    };

    $token = requestBearerToken();
    if ($token === '') {
        return $deny(401, 'no_token', 'Bitte zuerst in lwhub mit Discord anmelden.', null);
    }
    $verifiedId = verifyDiscordToken($pdo, $token);
    if ($verifiedId === null) {
        return $deny(401, 'invalid_token', 'Die Discord-Anmeldung ist abgelaufen – bitte in lwhub neu anmelden.', null);
    }
    if (isSiteAdmin($pdo, $verifiedId)) {
        return ['discord_id' => $verifiedId, 'name' => null, 'rank' => 5, 'site_admin' => true, 'alliance' => $alliance];
    }
    $member = getDiscordMember($pdo, $alliance, $verifiedId, true);
    if (!$member) {
        return $deny(403, 'not_r4', "Der Scanner ist nur fuer R4/R5 der Allianz {$alliance}.", $verifiedId);
    }
    if (normalizeHonorRole($member['honor_role'] ?? null) !== null) {
        return $deny(403, 'honor_role', 'Ehrenrollen haben nur Lesezugriff.', $verifiedId);
    }
    return [
        'discord_id' => $verifiedId,
        'name' => $member['current_name'] ?? $member['name'] ?? null,
        'rank' => (int)($member['current_rank_code'] ?? 4),
        'site_admin' => false,
        'alliance' => $alliance,
    ];
}

/** GET /scans/access?alliance=X – fuer die Scanner-Seite: darf der angemeldete Nutzer scannen? */
function handleScannerAccess(PDO $pdo, string $alliance): never {
    $caller = requireScannerAccess($pdo, $alliance);
    jsonOut(200, ['ok' => true] + $caller);
}
