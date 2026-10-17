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

// ─── Schreibrechte fuer die uebrigen Routen (Konzept v2, A9–A11) ─────────────────────────────────
// Schalter LWHUB_AUTH_MODE (config.php oder Umgebung), Standard 'log':
//   'off'     = wie bisher,
//   'log'     = Anmeldung und Rang nur in api_auth_log protokollieren,
//   'enforce' = ohne gueltiges Discord-Token 401, ohne passenden Rang 403.
// Ehrenrollen und Betreiber-Zuschauer (Site-Admin ohne eigenen Char) werden in jedem Modus abgewiesen:
// die Sperre trifft nur Leute, die ohnehin nichts aendern duerfen.

function lwhubAuthMode(): string {
    $mode = strtolower(trim((string)(getenv('LWHUB_AUTH_MODE')
        ?: (defined('LWHUB_AUTH_MODE') ? LWHUB_AUTH_MODE : 'log'))));
    return in_array($mode, ['off', 'log', 'enforce'], true) ? $mode : 'log';
}

/** Vom Client behauptete Discord-ID: Header X-Discord-Id (fetchJson), sonst $fallback (z. B. body.discord_id). */
function claimedCallerId(?string $fallback = null): string {
    $raw = trim((string)($_SERVER['HTTP_X_DISCORD_ID'] ?? ''));
    if ($raw === '' && $fallback !== null) $raw = $fallback;
    try { return normalizeDiscordId($raw); } catch (\InvalidArgumentException) { return ''; }
}

/**
 * Discord-ID des Aufrufers: das gepruefte Token, sonst die behauptete ID. Fehlt das Token, ist es
 * ungueltig oder passt die behauptete ID nicht dazu, gibt es im Modus 'enforce' 401/403, sonst nur
 * einen Eintrag in api_auth_log. Lokale Requests und Modus 'off' pruefen nichts.
 * Liefert ['id' => string ('' = unbekannt), 'verified' => bool].
 */
function resolveCallerId(PDO $pdo, string $alliance, ?string $fallbackClaim = null): array {
    static $cache = [];
    $mode = lwhubAuthMode();
    $claimed = claimedCallerId($fallbackClaim);
    $token = requestBearerToken();
    $key = implode('|', [$alliance, $claimed, hash('sha256', $token), $mode]);
    if (isset($cache[$key])) return $cache[$key];

    $verified = $token !== '' ? verifyDiscordToken($pdo, $token) : null;
    if ($mode !== 'off' && !isLocalRequest()) {
        $problem = null;
        if ($token === '') {
            $problem = [401, 'no_token', 'Bitte zuerst in lwhub mit Discord anmelden.'];
        } elseif ($verified === null) {
            $problem = [401, 'invalid_token', 'Die Discord-Anmeldung ist abgelaufen – bitte in lwhub neu anmelden.'];
        } elseif ($claimed !== '' && $claimed !== $verified) {
            $problem = [403, 'id_mismatch', 'Die Discord-ID passt nicht zur Anmeldung.'];
        }
        if ($problem) {
            logAuthDecision($pdo, $problem[1], $alliance, $claimed !== '' ? $claimed : null, $verified);
            if ($mode === 'enforce') jsonOut($problem[0], ['error' => $problem[2], 'code' => $problem[1]]);
        }
    }
    return $cache[$key] = ['id' => $verified ?? $claimed, 'verified' => $verified !== null];
}

/**
 * Schreibzugriff in $alliance fuer Mitglieder ab $minRank (echter Rang, ohne Ehrenrolle).
 * - Ehrenrollen und Site-Admins ohne eigenen Char in der Allianz: immer 403.
 * - Unbekannter Aufrufer, kein Mitglied, zu niedriger Rang: 401/403 im Modus 'enforce' oder wenn
 *   $required (der Endpunkt hat das schon vor Konzept v2 verlangt), sonst nur protokolliert.
 * $fallbackClaim: vom Client behauptete ID, falls kein X-Discord-Id-Header kommt (alte Clients).
 * Liefert ['discord_id', 'member' (Zeile oder null), 'rank' (int oder null)].
 */
function requireAllianceWriter(PDO $pdo, string $alliance, int $minRank = 1, bool $required = false, ?string $fallbackClaim = null): array {
    if (isLocalRequest()) {
        $id = claimedCallerId($fallbackClaim);
        $member = $id !== '' ? getDiscordMember($pdo, $alliance, $id) : null;
        return ['discord_id' => $id !== '' ? $id : null, 'member' => $member, 'rank' => $member ? safeRank((int)$member['current_rank_code']) : 5];
    }
    $mode = lwhubAuthMode();
    $caller = $mode === 'off'
        ? ['id' => claimedCallerId($fallbackClaim), 'verified' => false]
        : resolveCallerId($pdo, $alliance, $fallbackClaim);
    $id = $caller['id'];
    $soft = !$required && $mode !== 'enforce';

    $deny = function (int $status, string $code, string $message, bool $always = false) use ($pdo, $alliance, $id, $caller, $soft, $mode): array {
        if ($mode !== 'off') logAuthDecision($pdo, $code, $alliance, $id !== '' ? $id : null, $caller['verified'] ? $id : null);
        if ($always || !$soft) jsonOut($status, ['error' => $message, 'code' => $code]);
        return ['discord_id' => $id !== '' ? $id : null, 'member' => null, 'rank' => null];
    };

    if ($id === '') {
        if ($mode === 'off' && !$required) return ['discord_id' => null, 'member' => null, 'rank' => null];
        return $deny(401, 'no_caller', 'Discord-ID fehlt – bitte in lwhub anmelden.');
    }
    $member = getDiscordMember($pdo, $alliance, $id);
    if (!$member) {
        if (isSiteAdmin($pdo, $id)) {
            return $deny(403, 'site_viewer', "Als Betreiber kannst du in {$alliance} nur zuschauen.", true);
        }
        if ($mode === 'off' && !$required) return ['discord_id' => $id, 'member' => null, 'rank' => null];
        return $deny(403, 'not_member', 'Nicht berechtigt');
    }
    if (normalizeHonorRole($member['honor_role'] ?? null) !== null) {
        return $deny(403, 'honor_role', 'Ehrenrollen haben nur Lesezugriff.', true);
    }
    $rank = safeRank((int)$member['current_rank_code']);
    if ($rank < $minRank) {
        if ($mode === 'off' && !$required) return ['discord_id' => $id, 'member' => $member, 'rank' => $rank];
        $deny(403, 'rank', $minRank >= 5 ? 'Nur R5 darf das.' : ($minRank >= 4 ? 'Nur R4/R5 darf das.' : 'Nicht berechtigt'));
    }
    return ['discord_id' => $id, 'member' => $member, 'rank' => $rank];
}

/**
 * Feature-Schalter (alliance_config): R5 der Allianz ohne Ehrenrolle oder Site-Admin – der Betreiber
 * darf das als einzige Aenderung auch in Allianzen, in denen er nur zuschaut.
 */
function requireFeatureAdmin(PDO $pdo, string $alliance, ?string $fallbackClaim = null): array {
    if (isLocalRequest()) return ['discord_id' => null, 'name' => 'Lokaler Admin', 'site_admin' => false];
    $caller = resolveCallerId($pdo, $alliance, $fallbackClaim);
    if ($caller['id'] === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    if (isSiteAdmin($pdo, $caller['id'])) {
        $member = getDiscordMember($pdo, $alliance, $caller['id']);
        return ['discord_id' => $caller['id'], 'name' => $member['current_name'] ?? 'Betreiber', 'site_admin' => true];
    }
    $w = requireAllianceWriter($pdo, $alliance, 5, true, $fallbackClaim);
    return ['discord_id' => $w['discord_id'], 'name' => $w['member']['current_name'] ?? null, 'site_admin' => false];
}

/**
 * Darf $member die R4-Ansichten der Allianz sehen? R4/R5, Ehren-R4 und der Betreiber als Zuschauer.
 * $member kann die Pseudo-Zeile aus siteViewerMember() sein.
 */
function memberCanViewAsR4(?array $member): bool {
    if (!$member) return false;
    if (!empty($member['site_viewer'])) return true;
    return effectiveRankForAccess(safeRank((int)($member['current_rank_code'] ?? 0)), normalizeHonorRole($member['honor_role'] ?? null)) >= 4;
}

/** Pseudo-Mitglied fuer den Betreiber, der eine Allianz ohne eigenen Char ansieht (sieht alles wie R5, aendert nichts). */
function siteViewerMember(string $discordId): array {
    return [
        'player_id' => null, 'current_name' => 'Betreiber', 'current_rank_code' => 5, 'honor_role' => null,
        'discord_user_id' => $discordId, 'site_viewer' => true, 'preferred_language' => 'de',
    ];
}

/**
 * Scanner-Zugriff: geprueftes Discord-Token von R4/R5 der Allianz (ohne Ehrenrolle). Site-Admins nur in
 * Allianzen, in denen sie selbst R4/R5 sind – sonst schauen sie nur zu.
 * $view = true (Kampfkraft-Trend, VS-Wochenwerte, Zugangspruefung der Trend-Seite): lesend, dann auch
 * Ehren-R4 und Site-Admins in jeder Allianz.
 * Lokale Requests (PHP-Dev-Server auf 127.0.0.1) sind wie ueberall in der API ausgenommen.
 * Gibt den Aufrufer zurueck; bei fehlender Berechtigung 401/403 (im Modus 'log' nur protokolliert).
 */
function requireScannerAccess(PDO $pdo, string $alliance, ?string $claimedId = null, bool $view = false): array {
    $mode = scannerAuthMode();
    if ($mode === 'off' || isLocalRequest()) {
        return ['discord_id' => null, 'name' => 'Lokaler Zugriff', 'rank' => 5, 'site_admin' => false, 'alliance' => $alliance, 'can_scan' => true];
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
    $member = getDiscordMember($pdo, $alliance, $verifiedId, true);
    $siteAdmin = isSiteAdmin($pdo, $verifiedId);
    $honorRole = $member ? normalizeHonorRole($member['honor_role'] ?? null) : null;
    if ($member && $honorRole === null) {
        return [
            'discord_id' => $verifiedId,
            'name' => $member['current_name'] ?? $member['name'] ?? null,
            'rank' => (int)($member['current_rank_code'] ?? 4),
            'site_admin' => $siteAdmin,
            'alliance' => $alliance,
            'can_scan' => true,
        ];
    }
    if ($view && ($siteAdmin || ($member && memberCanViewAsR4($member)))) {
        return [
            'discord_id' => $verifiedId,
            'name' => $member['current_name'] ?? null,
            'rank' => $member ? (int)$member['current_rank_code'] : 5,
            'site_admin' => $siteAdmin,
            'honor_role' => $honorRole,
            'alliance' => $alliance,
            'can_scan' => false,
        ];
    }
    if ($honorRole !== null) {
        return $deny(403, 'honor_role', 'Ehrenrollen haben nur Lesezugriff.', $verifiedId);
    }
    if ($siteAdmin) {
        return $deny(403, 'site_viewer', "Als Betreiber kannst du in {$alliance} nur zuschauen.", $verifiedId);
    }
    return $deny(403, 'not_r4', "Der Scanner ist nur fuer R4/R5 der Allianz {$alliance}.", $verifiedId);
}

/**
 * Scannen in der Hauptseite (api/partials/r4-*.php): R4/R5 ohne Ehrenrolle – dieselben Leute, die
 * requireScannerAccess() schreiben laesst. Ob die Allianz den Scanner nutzt, steuert das Feature
 * "scanner" in der Feature-Konfiguration (alliance_config).
 */
function scannerTabAllowed(array $member): bool {
    return empty($member['site_viewer'])
        && (int)($member['current_rank_code'] ?? 0) >= 4
        && normalizeHonorRole($member['honor_role'] ?? null) === null;
}

/** Menuepunkt "Scanner" nur zum Ansehen (Kampfkraft-Trend): Ehren-R4 und Betreiber-Zuschauer. */
function scannerViewAllowed(array $member): bool {
    return scannerTabAllowed($member) || memberCanViewAsR4($member);
}

/**
 * GET /scans/my-alliances – Allianzen, in denen der (per Discord-Token gepruefte) Nutzer aktive Chars
 * hat, mit dem Hinweis, ob er dort scannen darf (R4/R5 ohne Ehrenrolle). Die Scanner-Seiten zeigen nur
 * diese Allianzen. Lokal (PHP-Dev-Server) ohne Token: { all: true } – dann bleibt die volle Liste.
 */
function handleScannerMyAlliances(PDO $pdo): never {
    $token = requestBearerToken();
    if ($token === '' && (isLocalRequest() || scannerAuthMode() === 'off')) {
        jsonOut(200, ['ok' => true, 'all' => true, 'alliances' => []]);
    }
    $discordId = $token !== '' ? verifyDiscordToken($pdo, $token) : null;
    if ($discordId === null) {
        jsonOut(401, ['error' => 'Bitte zuerst in lwhub mit Discord anmelden.', 'code' => $token === '' ? 'no_token' : 'invalid_token']);
    }

    $stmt = $pdo->prepare("
        SELECT p.alliance, p.current_name, p.current_rank_code, p.honor_role
        FROM players p
        LEFT JOIN player_identities pid
            ON pid.alliance = p.alliance AND pid.player_id = p.player_id AND pid.discord_user_id = ?
        LEFT JOIN (
            SELECT pul.alliance, pul.player_id, uda.discord_user_id
            FROM player_user_links pul
            JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            WHERE uda.discord_user_id = ?
        ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        WHERE p.is_active = 1
          AND (pid.discord_user_id IS NOT NULL OR puld.discord_user_id IS NOT NULL)
        ORDER BY p.alliance, p.current_name
    ");
    try {
        $stmt->execute([$discordId, $discordId]);
        $rows = $stmt->fetchAll();
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        $rows = [];
    }

    $byAlliance = [];
    foreach ($rows as $r) {
        $a = $r['alliance'];
        $byAlliance[$a] ??= ['alliance' => $a, 'chars' => [], 'can_scan' => false, 'can_view' => false];
        $byAlliance[$a]['chars'][] = ['name' => $r['current_name'], 'rank' => (int)$r['current_rank_code'], 'honor_role' => normalizeHonorRole($r['honor_role'] ?? null)];
        if (scannerTabAllowed($r)) $byAlliance[$a]['can_scan'] = true;
        if (scannerViewAllowed($r)) $byAlliance[$a]['can_view'] = true;
    }
    // Der Betreiber darf jede Allianz ansehen (Trend), scannen nur dort, wo er selbst R4/R5 ist.
    $siteAdmin = isSiteAdmin($pdo, $discordId);
    if ($siteAdmin) {
        try {
            foreach ($pdo->query("SELECT alliance FROM alliances WHERE is_active = 1 ORDER BY alliance")->fetchAll() as $a) {
                $byAlliance[$a['alliance']] ??= ['alliance' => $a['alliance'], 'chars' => [], 'can_scan' => false, 'can_view' => true];
                $byAlliance[$a['alliance']]['can_view'] = true;
            }
        } catch (\PDOException $e) {
            if (!isOptionalTableError($e)) throw $e;
        }
    }
    jsonOut(200, ['ok' => true, 'all' => false, 'site_admin' => $siteAdmin, 'alliances' => array_values($byAlliance)]);
}

/**
 * GET /scans/access?alliance=X[&mode=view] – fuer die Scanner-Seiten: darf der angemeldete Nutzer
 * scannen (Standard) bzw. ansehen (mode=view, Trend-Seite; auch Ehren-R4 und Betreiber)?
 */
function handleScannerAccess(PDO $pdo, string $alliance): never {
    $caller = requireScannerAccess($pdo, $alliance, null, ($_GET['mode'] ?? '') === 'view');
    jsonOut(200, ['ok' => true] + $caller);
}
