<?php
declare(strict_types=1);

// ─── Config ───────────────────────────────────────────────────────────────────
$configFile = __DIR__ . '/../config.php';
if (file_exists($configFile)) {
    require $configFile;
}

$ALLIANCE            = getenv('INY_ALLIANCE')             ?: (defined('INY_ALLIANCE')            ? INY_ALLIANCE            : 'INY');
$PROTECTED_R4_NAMES  = parseProtectedR4Names(getenv('INY_PROTECTED_R4_NAMES') ?: (defined('INY_PROTECTED_R4_NAMES') ? INY_PROTECTED_R4_NAMES : 'Lion Tooth'));

$DB_HOST = getenv('MYSQL_HOST')     ?: (defined('MYSQL_HOST')     ? MYSQL_HOST     : '');
$DB_PORT = (int)(getenv('MYSQL_PORT') ?: (defined('MYSQL_PORT')   ? MYSQL_PORT     : 3306));
$DB_NAME = getenv('MYSQL_DATABASE') ?: (defined('MYSQL_DATABASE') ? MYSQL_DATABASE : '');
$DB_USER = getenv('MYSQL_USER')     ?: (defined('MYSQL_USER')     ? MYSQL_USER     : '');
$DB_PASS = getenv('MYSQL_PASSWORD') ?: (defined('MYSQL_PASSWORD') ? MYSQL_PASSWORD : '');

// ─── CORS ─────────────────────────────────────────────────────────────────────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS');
header('Access-Control-Allow-Headers: content-type,authorization');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonOut(int $status, mixed $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function uuid4(): string {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function safeRank(mixed $value): int {
    $n = (int)$value;
    if ($n < 1 || $n > 5) return 3;
    return $n;
}

function normalizeDiscordId(mixed $value): string {
    $id = trim((string)($value ?? ''));
    if ($id === '') return '';
    if (!preg_match('/^\d+$/', $id)) throw new InvalidArgumentException('Discord-ID muss numerisch sein');
    return $id;
}

function normalizeMemberName(mixed $value): string {
    return strtolower(trim((string)($value ?? '')));
}

function parseProtectedR4Names(string $value): array {
    $names = [];
    foreach (explode(',', $value) as $v) {
        $n = normalizeMemberName($v);
        if ($n !== '') $names[$n] = true;
    }
    return $names;
}

function isProtectedR4Member(string $name, array $protectedNames): bool {
    return isset($protectedNames[normalizeMemberName($name)]);
}

function applyProtectedRankRule(string $name, int $requestedRank, array $protectedNames): array {
    if (!isProtectedR4Member($name, $protectedNames)) {
        return ['effectiveRank' => $requestedRank, 'protectedMember' => false, 'blocked' => false];
    }
    return ['effectiveRank' => 4, 'protectedMember' => true, 'blocked' => $requestedRank !== 4];
}

function roleFromRank(int $rank): string {
    if ($rank === 5) return 'r5';
    if ($rank === 4) return 'r4';
    return 'normal';
}

function isOptionalTableError(\PDOException $e): bool {
    $code = $e->getCode();
    $msg  = $e->getMessage();
    // ER_NO_SUCH_TABLE=1146, ER_TABLEACCESS_DENIED_ERROR=1142, ER_BAD_FIELD_ERROR=1054
    return in_array($code, ['42S02', '42000', '42S22'], true)
        || str_contains($msg, "doesn't exist")
        || str_contains($msg, 'Table') && str_contains($msg, 'exist');
}

function isBadFieldError(\PDOException $e): bool {
    return $e->getCode() === '42S22'
        || str_contains($e->getMessage(), "Unknown column");
}

function openDb(string $host, int $port, string $db, string $user, string $pass): PDO {
    $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT => false,
    ]);
    return $pdo;
}

// ─── Route parsing ────────────────────────────────────────────────────────────
$requestUri  = $_SERVER['REQUEST_URI'] ?? '/';
$scriptDir   = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/');
$path        = parse_url($requestUri, PHP_URL_PATH) ?? '/';
if ($scriptDir !== '' && str_starts_with($path, $scriptDir)) {
    $path = substr($path, strlen($scriptDir));
}
$path     = '/' . ltrim($path, '/');
$segments = array_values(array_filter(explode('/', $path)));
$method   = $_SERVER['REQUEST_METHOD'];

$rawBody = file_get_contents('php://input');
$body    = [];
if ($rawBody !== '' && $rawBody !== false) {
    $body = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR) ?? [];
}

// ─── DB functions ─────────────────────────────────────────────────────────────
function ensureRankChangeLogTable(PDO $pdo, string $alliance): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rank_change_log (
            alliance VARCHAR(50) NOT NULL,
            log_id CHAR(36) NOT NULL,
            player_id CHAR(36) NULL,
            player_name VARCHAR(150) NOT NULL,
            old_rank_code INT NULL,
            requested_rank_code INT NULL,
            applied_rank_code INT NOT NULL,
            source VARCHAR(60) NOT NULL,
            is_blocked TINYINT(1) NOT NULL DEFAULT 0,
            reason VARCHAR(255) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, log_id),
            KEY ix_rank_change_log_player (alliance, player_name, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function ensureAccessRequestsTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS access_requests (
            alliance VARCHAR(50) NOT NULL,
            request_id CHAR(36) NOT NULL,
            discord_user_id VARCHAR(50) NOT NULL,
            discord_username VARCHAR(100) NULL,
            discord_avatar VARCHAR(255) NULL,
            requested_alliance VARCHAR(50) NOT NULL,
            requested_player_name VARCHAR(150) NOT NULL,
            note VARCHAR(255) NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reviewed_at DATETIME NULL,
            PRIMARY KEY (alliance, request_id),
            UNIQUE KEY uq_access_requests_pending (alliance, discord_user_id, status),
            KEY ix_access_requests_status (alliance, status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function ensureDiscordProfileCacheTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS discord_profile_cache (
            alliance VARCHAR(50) NOT NULL,
            discord_user_id VARCHAR(50) NOT NULL,
            discord_username VARCHAR(100) NULL,
            discord_avatar VARCHAR(255) NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, discord_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function logRankChange(PDO $pdo, string $alliance, array $payload): void {
    ensureRankChangeLogTable($pdo, $alliance);
    $stmt = $pdo->prepare("
        INSERT INTO rank_change_log
            (alliance, log_id, player_id, player_name, old_rank_code, requested_rank_code,
             applied_rank_code, source, is_blocked, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $alliance,
        uuid4(),
        $payload['playerId'] ?? null,
        $payload['playerName'],
        isset($payload['oldRank']) && $payload['oldRank'] !== null ? (int)$payload['oldRank'] : null,
        isset($payload['requestedRank']) && $payload['requestedRank'] !== null ? (int)$payload['requestedRank'] : null,
        (int)$payload['appliedRank'],
        $payload['source'],
        ($payload['blocked'] ?? false) ? 1 : 0,
        $payload['reason'] ?? null,
    ]);
}

function enforceProtectedRanks(PDO $pdo, string $alliance, array $protectedNames): void {
    if (empty($protectedNames)) return;
    $names = array_keys($protectedNames);
    $placeholders = implode(',', array_fill(0, count($names), '?'));
    $stmt = $pdo->prepare("
        SELECT player_id, current_name, current_rank_code
        FROM players
        WHERE alliance = ?
          AND LOWER(TRIM(current_name)) IN ({$placeholders})
          AND current_rank_code <> 4
    ");
    $stmt->execute([$alliance, ...$names]);
    $rows = $stmt->fetchAll();

    foreach ($rows as $row) {
        $upd = $pdo->prepare("
            UPDATE players SET current_rank_code = 4, is_active = 1, retired_at = NULL
            WHERE alliance = ? AND player_id = ?
        ");
        $upd->execute([$alliance, $row['player_id']]);
        logRankChange($pdo, $alliance, [
            'playerId'      => $row['player_id'],
            'playerName'    => $row['current_name'],
            'oldRank'       => (int)$row['current_rank_code'],
            'requestedRank' => 4,
            'appliedRank'   => 4,
            'source'        => 'system:protected-r4-enforce',
            'blocked'       => true,
            'reason'        => 'protected-r4-member-auto-fix',
        ]);
    }
}

function getDiscordMemberSql(bool $withCache, bool $leadershipOnly): string {
    $rankFilter = $leadershipOnly ? 'AND p.current_rank_code IN (4, 5)' : '';
    if ($withCache) {
        return "
            SELECT p.player_id, p.current_name, p.current_rank_code,
                   COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
                   COALESCE(puld.discord_username, dpc.discord_username) AS discord_username,
                   COALESCE(puld.discord_avatar, dpc.discord_avatar) AS discord_avatar
            FROM players p
            LEFT JOIN (
                SELECT alliance, player_id, MIN(discord_user_id) AS discord_user_id
                FROM player_identities WHERE discord_user_id IS NOT NULL
                GROUP BY alliance, player_id
            ) pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
            LEFT JOIN (
                SELECT pul.alliance, pul.player_id,
                       MIN(uda.discord_user_id) AS discord_user_id,
                       MIN(uda.discord_username) AS discord_username,
                       MIN(uda.discord_avatar) AS discord_avatar
                FROM player_user_links pul
                JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
                GROUP BY pul.alliance, pul.player_id
            ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
            LEFT JOIN discord_profile_cache dpc
                ON dpc.alliance = p.alliance
               AND dpc.discord_user_id = COALESCE(pid.discord_user_id, puld.discord_user_id)
            WHERE p.alliance = ? AND p.is_active = 1 {$rankFilter}
              AND COALESCE(pid.discord_user_id, puld.discord_user_id) = ?
            LIMIT 1
        ";
    }
    return "
        SELECT p.player_id, p.current_name, p.current_rank_code,
               COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
               puld.discord_username, puld.discord_avatar
        FROM players p
        LEFT JOIN (
            SELECT alliance, player_id, MIN(discord_user_id) AS discord_user_id
            FROM player_identities WHERE discord_user_id IS NOT NULL
            GROUP BY alliance, player_id
        ) pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        LEFT JOIN (
            SELECT pul.alliance, pul.player_id,
                   MIN(uda.discord_user_id) AS discord_user_id,
                   MIN(uda.discord_username) AS discord_username,
                   MIN(uda.discord_avatar) AS discord_avatar
            FROM player_user_links pul
            JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            GROUP BY pul.alliance, pul.player_id
        ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        WHERE p.alliance = ? AND p.is_active = 1 {$rankFilter}
          AND COALESCE(pid.discord_user_id, puld.discord_user_id) = ?
        LIMIT 1
    ";
}

function getDiscordMember(PDO $pdo, string $alliance, string $discordId, bool $leadershipOnly = false): ?array {
    try {
        $stmt = $pdo->prepare(getDiscordMemberSql(true, $leadershipOnly));
        $stmt->execute([$alliance, $discordId]);
        return $stmt->fetch() ?: null;
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        $stmt = $pdo->prepare(getDiscordMemberSql(false, $leadershipOnly));
        $stmt->execute([$alliance, $discordId]);
        return $stmt->fetch() ?: null;
    }
}

function getMemberByNameSql(bool $withCache): string {
    if ($withCache) {
        return "
            SELECT p.player_id, p.current_name, p.current_rank_code,
                   COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
                   COALESCE(puld.discord_username, dpc.discord_username) AS discord_username,
                   COALESCE(puld.discord_avatar, dpc.discord_avatar) AS discord_avatar
            FROM players p
            LEFT JOIN (
                SELECT alliance, player_id, MIN(discord_user_id) AS discord_user_id
                FROM player_identities WHERE discord_user_id IS NOT NULL
                GROUP BY alliance, player_id
            ) pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
            LEFT JOIN (
                SELECT pul.alliance, pul.player_id,
                       MIN(uda.discord_user_id) AS discord_user_id,
                       MIN(uda.discord_username) AS discord_username,
                       MIN(uda.discord_avatar) AS discord_avatar
                FROM player_user_links pul
                JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
                GROUP BY pul.alliance, pul.player_id
            ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
            LEFT JOIN discord_profile_cache dpc
                ON dpc.alliance = p.alliance
               AND dpc.discord_user_id = COALESCE(pid.discord_user_id, puld.discord_user_id)
            WHERE p.alliance = ? AND p.is_active = 1
              AND LOWER(TRIM(p.current_name)) = LOWER(TRIM(?))
            LIMIT 1
        ";
    }
    return "
        SELECT p.player_id, p.current_name, p.current_rank_code,
               COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
               puld.discord_username, puld.discord_avatar
        FROM players p
        LEFT JOIN (
            SELECT alliance, player_id, MIN(discord_user_id) AS discord_user_id
            FROM player_identities WHERE discord_user_id IS NOT NULL
            GROUP BY alliance, player_id
        ) pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        LEFT JOIN (
            SELECT pul.alliance, pul.player_id,
                   MIN(uda.discord_user_id) AS discord_user_id,
                   MIN(uda.discord_username) AS discord_username,
                   MIN(uda.discord_avatar) AS discord_avatar
            FROM player_user_links pul
            JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            GROUP BY pul.alliance, pul.player_id
        ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        WHERE p.alliance = ? AND p.is_active = 1
          AND LOWER(TRIM(p.current_name)) = LOWER(TRIM(?))
        LIMIT 1
    ";
}

function getMemberByName(PDO $pdo, string $alliance, string $nameRaw): ?array {
    $name = trim($nameRaw);
    if ($name === '') return null;
    try {
        $stmt = $pdo->prepare(getMemberByNameSql(true));
        $stmt->execute([$alliance, $name]);
        return $stmt->fetch() ?: null;
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        $stmt = $pdo->prepare(getMemberByNameSql(false));
        $stmt->execute([$alliance, $name]);
        return $stmt->fetch() ?: null;
    }
}

function memberToDiscordAvatarUrl(?string $discordUserId, ?string $discordAvatar, int $size = 64): ?string {
    if (!$discordUserId || !$discordAvatar) return null;
    return "https://cdn.discordapp.com/avatars/{$discordUserId}/{$discordAvatar}.png?size={$size}";
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function handleHealth(PDO $pdo, string $alliance): never {
    $stmt = $pdo->query('SELECT 1 AS ok');
    $row  = $stmt->fetch();
    jsonOut(200, [
        'ok'       => (bool)($row['ok'] ?? false),
        'backend'  => 'php-mysql',
        'alliance' => $alliance,
    ]);
}

function handleVerifyDiscord(PDO $pdo, string $alliance): never {
    $discordIdRaw = $_GET['discord_id'] ?? '';
    try {
        $discordId = normalizeDiscordId($discordIdRaw);
    } catch (\InvalidArgumentException) {
        jsonOut(200, ['ok' => false, 'error' => 'Discord-ID fehlt oder ungueltig']);
    }
    if ($discordId === '') jsonOut(200, ['ok' => false, 'error' => 'Discord-ID fehlt']);

    $member = getDiscordMember($pdo, $alliance, $discordId);
    if (!$member) jsonOut(200, ['ok' => false, 'error' => 'Kein Zugriff']);

    $rank = safeRank((int)$member['current_rank_code']);
    jsonOut(200, [
        'ok'                => true,
        'member_id'         => $member['player_id'],
        'member_name'       => $member['current_name'],
        'rank'              => $rank,
        'role'              => roleFromRank($rank),
        'can_manage'        => $rank >= 4,
        'discord_id'        => $member['discord_user_id'] ?? null,
        'discord_username'  => $member['discord_username'] ?? null,
        'discord_avatar'    => $member['discord_avatar'] ?? null,
        'discord_avatar_url'=> memberToDiscordAvatarUrl($member['discord_user_id'] ?? null, $member['discord_avatar'] ?? null, 128),
    ]);
}

function handleMemberHistory(PDO $pdo, string $alliance): never {
    $discordIdRaw = $_GET['discord_id'] ?? '';
    $nameRaw      = $_GET['name'] ?? '';
    $rawLimit     = isset($_GET['limit']) ? (int)$_GET['limit'] : 16;
    $limit        = max(1, min(52, $rawLimit));

    $discordId = '';
    if ($discordIdRaw !== '') {
        try {
            $discordId = normalizeDiscordId($discordIdRaw);
        } catch (\InvalidArgumentException $e) {
            jsonOut(400, ['error' => $e->getMessage()]);
        }
    }

    if ($discordId === '' && trim($nameRaw) === '') {
        jsonOut(400, ['error' => 'Discord-ID oder Name fehlt']);
    }

    $member = $discordId !== ''
        ? getDiscordMember($pdo, $alliance, $discordId)
        : getMemberByName($pdo, $alliance, $nameRaw);

    if (!$member) jsonOut(404, ['error' => 'Mitglied nicht gefunden']);

    // Weekly entries
    $entryRows = [];
    try {
        $stmt = $pdo->prepare("
            SELECT entry_id, year_week, base_rank_code, final_rank_code, afk, updated_at
            FROM weekly_entries
            WHERE alliance = ? AND player_id = ?
            ORDER BY year_week DESC
            LIMIT {$limit}
        ");
        $stmt->execute([$alliance, $member['player_id']]);
        $entryRows = $stmt->fetchAll();
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        if (isBadFieldError($e)) {
            try {
                $stmt = $pdo->prepare("
                    SELECT entry_id, year_week, final_rank_code, NULL AS updated_at
                    FROM weekly_entries
                    WHERE alliance = ? AND player_id = ?
                    ORDER BY year_week DESC
                    LIMIT {$limit}
                ");
                $stmt->execute([$alliance, $member['player_id']]);
                foreach ($stmt->fetchAll() as $row) {
                    $entryRows[] = array_merge($row, ['base_rank_code' => $row['final_rank_code'], 'afk' => 0]);
                }
            } catch (\PDOException $e2) {
                if (!isOptionalTableError($e2)) throw $e2;
            }
        }
    }

    $weeks = [];
    foreach ($entryRows as $row) {
        $flagRows = [];
        try {
            $stmt = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
            $stmt->execute([$alliance, $row['entry_id']]);
            $flagRows = $stmt->fetchAll();
        } catch (\PDOException $e) {
            if (!isOptionalTableError($e)) throw $e;
        }
        $flags = [];
        foreach ($flagRows as $f) $flags[$f['flag_key']] = true;
        $weeks[] = [
            'year_week'  => $row['year_week'],
            'base_rank'  => safeRank((int)$row['base_rank_code']),
            'final_rank' => safeRank((int)$row['final_rank_code']),
            'afk'        => (bool)$row['afk'],
            'updated_at' => $row['updated_at'],
            'flags'      => $flags,
        ];
    }

    // Rank change log
    $changeRows = [];
    try {
        ensureRankChangeLogTable($pdo, $alliance);
        $stmt = $pdo->prepare("
            SELECT old_rank_code, requested_rank_code, applied_rank_code,
                   source, is_blocked, reason, created_at
            FROM rank_change_log
            WHERE alliance = ? AND player_id = ?
            ORDER BY created_at DESC
            LIMIT 25
        ");
        $stmt->execute([$alliance, $member['player_id']]);
        $changeRows = $stmt->fetchAll();
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        if (isBadFieldError($e)) {
            try {
                $stmt = $pdo->prepare("
                    SELECT old_rank_code, requested_rank_code, applied_rank_code,
                           source, is_blocked, reason, created_at
                    FROM rank_change_log
                    WHERE alliance = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))
                    ORDER BY created_at DESC
                    LIMIT 25
                ");
                $stmt->execute([$alliance, $member['current_name']]);
                $changeRows = $stmt->fetchAll();
            } catch (\PDOException $e2) {
                if (!isOptionalTableError($e2)) throw $e2;
            }
        }
    }

    $rank = safeRank((int)$member['current_rank_code']);
    jsonOut(200, [
        'ok'     => true,
        'member' => [
            'id'               => $member['player_id'],
            'name'             => $member['current_name'],
            'rank'             => $rank,
            'role'             => roleFromRank($rank),
            'can_manage'       => $rank >= 4,
            'discord_id'       => $member['discord_user_id'] ?? null,
            'discord_username' => $member['discord_username'] ?? null,
            'discord_avatar'   => $member['discord_avatar'] ?? null,
            'discord_avatar_url' => memberToDiscordAvatarUrl($member['discord_user_id'] ?? null, $member['discord_avatar'] ?? null, 128),
        ],
        'weeks'        => $weeks,
        'rank_changes' => array_map(fn($row) => [
            'old_rank'       => is_numeric($row['old_rank_code']) ? (int)$row['old_rank_code'] : null,
            'requested_rank' => is_numeric($row['requested_rank_code']) ? (int)$row['requested_rank_code'] : null,
            'applied_rank'   => safeRank((int)$row['applied_rank_code']),
            'source'         => $row['source'],
            'is_blocked'     => (bool)$row['is_blocked'],
            'reason'         => $row['reason'] ?? null,
            'created_at'     => $row['created_at'],
        ], $changeRows),
    ]);
}

function handleCacheDiscordProfile(PDO $pdo, string $alliance, array $body): never {
    $discordIdRaw = $body['discord_id'] ?? '';
    try {
        $discordId = normalizeDiscordId($discordIdRaw);
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }
    if ($discordId === '') jsonOut(400, ['error' => 'Discord-ID fehlt']);

    $username = trim((string)($body['discord_username'] ?? '')) ?: null;
    $avatar   = trim((string)($body['discord_avatar'] ?? '')) ?: null;

    ensureDiscordProfileCacheTable($pdo);
    $stmt = $pdo->prepare("
        INSERT INTO discord_profile_cache (alliance, discord_user_id, discord_username, discord_avatar)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            discord_username = VALUES(discord_username),
            discord_avatar   = VALUES(discord_avatar),
            updated_at       = CURRENT_TIMESTAMP
    ");
    $stmt->execute([$alliance, $discordId, $username, $avatar]);
    jsonOut(200, ['ok' => true]);
}

function handleListRankChangeLog(PDO $pdo, string $alliance): never {
    ensureRankChangeLogTable($pdo, $alliance);
    $rawLimit  = isset($_GET['limit']) ? (int)$_GET['limit'] : 100;
    $limit     = max(1, min(200, $rawLimit));
    $nameFilter = trim($_GET['name'] ?? '');

    if ($nameFilter !== '') {
        $stmt = $pdo->prepare("
            SELECT player_name, old_rank_code, requested_rank_code, applied_rank_code,
                   source, is_blocked, reason, created_at
            FROM rank_change_log
            WHERE alliance = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))
            ORDER BY created_at DESC
            LIMIT {$limit}
        ");
        $stmt->execute([$alliance, $nameFilter]);
    } else {
        $stmt = $pdo->prepare("
            SELECT player_name, old_rank_code, requested_rank_code, applied_rank_code,
                   source, is_blocked, reason, created_at
            FROM rank_change_log
            WHERE alliance = ?
            ORDER BY created_at DESC
            LIMIT {$limit}
        ");
        $stmt->execute([$alliance]);
    }
    jsonOut(200, $stmt->fetchAll());
}

function handleGetMembers(PDO $pdo, string $alliance): never {
    ensureDiscordProfileCacheTable($pdo);
    $stmt = $pdo->prepare("
        SELECT p.player_id, p.alliance, p.current_name, p.current_rank_code,
               COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
               COALESCE(puld.discord_username, dpc.discord_username) AS discord_username,
               COALESCE(puld.discord_avatar, dpc.discord_avatar) AS discord_avatar
        FROM players p
        LEFT JOIN (
            SELECT alliance, player_id, MIN(discord_user_id) AS discord_user_id
            FROM player_identities WHERE discord_user_id IS NOT NULL
            GROUP BY alliance, player_id
        ) pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        LEFT JOIN (
            SELECT pul.alliance, pul.player_id,
                   MIN(uda.discord_user_id) AS discord_user_id,
                   MIN(uda.discord_username) AS discord_username,
                   MIN(uda.discord_avatar) AS discord_avatar
            FROM player_user_links pul
            JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            GROUP BY pul.alliance, pul.player_id
        ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        LEFT JOIN discord_profile_cache dpc
            ON dpc.alliance = p.alliance
           AND dpc.discord_user_id = COALESCE(pid.discord_user_id, puld.discord_user_id)
        WHERE p.alliance = ? AND p.is_active = 1
        ORDER BY p.current_name
    ");
    $stmt->execute([$alliance]);
    $rows = $stmt->fetchAll();

    $result = array_map(fn($r) => [
        'id'                 => $r['player_id'],
        'alliance'           => $r['alliance'],
        'name'               => $r['current_name'],
        'default_rank'       => (int)$r['current_rank_code'],
        'role'               => roleFromRank((int)$r['current_rank_code']),
        'discord_id'         => $r['discord_user_id'] ?? null,
        'discord_username'   => $r['discord_username'] ?? null,
        'discord_avatar'     => $r['discord_avatar'] ?? null,
        'discord_connected'  => !empty($r['discord_user_id']),
        'discord_avatar_url' => memberToDiscordAvatarUrl($r['discord_user_id'] ?? null, $r['discord_avatar'] ?? null, 64),
    ], $rows);

    jsonOut(200, $result);
}

function handleAddMember(PDO $pdo, string $alliance, array $body, array $protectedNames): never {
    $name = trim($body['name'] ?? '');
    if ($name === '') jsonOut(400, ['error' => 'Name fehlt']);

    $requestedRank = safeRank((int)($body['default_rank'] ?? $body['rank'] ?? 3));
    $protection    = applyProtectedRankRule($name, $requestedRank, $protectedNames);
    $rank          = $protection['effectiveRank'];
    $playerId      = uuid4();
    $nameEventId   = uuid4();

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("INSERT INTO players (alliance, player_id, current_name, current_rank_code, is_active) VALUES (?, ?, ?, ?, 1)");
        $stmt->execute([$alliance, $playerId, $name, $rank]);

        if ($requestedRank !== $rank || isProtectedR4Member($name, $protectedNames)) {
            logRankChange($pdo, $alliance, [
                'playerId'      => $playerId,
                'playerName'    => $name,
                'oldRank'       => null,
                'requestedRank' => $requestedRank,
                'appliedRank'   => $rank,
                'source'        => 'members:add',
                'blocked'       => $protection['blocked'],
                'reason'        => $protection['blocked'] ? 'protected-r4-member' : 'protected-r4-enforced',
            ]);
        }

        $stmt = $pdo->prepare("INSERT INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, 0)");
        $stmt->execute([$alliance, $nameEventId, $playerId, $name]);

        $pdo->commit();
        jsonOut(201, ['ok' => true]);
    } catch (\PDOException $e) {
        $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate') || str_contains($e->getCode(), '23000')) {
            jsonOut(409, ['error' => 'Mitglied existiert bereits']);
        }
        throw $e;
    }
}

function handleUpdateMember(PDO $pdo, string $alliance, string $oldNameEncoded, array $body, array $protectedNames): never {
    $oldName = rawurldecode($oldNameEncoded);
    $newName = trim($body['name'] ?? $oldName);
    if ($newName === '') jsonOut(400, ['error' => 'Name fehlt']);

    $requestedRank = safeRank((int)($body['default_rank'] ?? $body['rank'] ?? 3));

    $discordId = null;
    $discordIdSet = array_key_exists('discord_id', $body);
    if ($discordIdSet) {
        try {
            $discordId = normalizeDiscordId($body['discord_id'] ?? '');
        } catch (\InvalidArgumentException $e) {
            jsonOut(400, ['error' => $e->getMessage()]);
        }
    }

    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $oldName]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(404, ['error' => 'Mitglied nicht gefunden']);

    $playerId = $row['player_id'];
    $oldRank  = (int)$row['current_rank_code'];
    $pA       = applyProtectedRankRule($row['current_name'], $requestedRank, $protectedNames);
    $pB       = applyProtectedRankRule($newName, $requestedRank, $protectedNames);
    $protected = $pA['protectedMember'] || $pB['protectedMember'];
    $rank      = $protected ? 4 : $requestedRank;
    $blocked   = $protected && $requestedRank !== 4;

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("UPDATE players SET current_name = ?, current_rank_code = ?, is_active = 1, retired_at = NULL WHERE alliance = ? AND player_id = ?");
        $stmt->execute([$newName, $rank, $alliance, $playerId]);

        if ($oldRank !== $rank || $blocked || $protected) {
            logRankChange($pdo, $alliance, [
                'playerId'      => $playerId,
                'playerName'    => $newName,
                'oldRank'       => $oldRank,
                'requestedRank' => $requestedRank,
                'appliedRank'   => $rank,
                'source'        => 'members:update',
                'blocked'       => $blocked,
                'reason'        => $protected ? 'protected-r4-member' : null,
            ]);
        }

        if ($newName !== $row['current_name']) {
            $stmt = $pdo->prepare("INSERT INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, 0)");
            $stmt->execute([$alliance, uuid4(), $playerId, $newName]);
        }

        if ($discordIdSet) {
            if ($discordId === '') {
                $pdo->prepare("UPDATE player_identities SET discord_user_id = NULL WHERE alliance = ? AND player_id = ?")
                    ->execute([$alliance, $playerId]);
            } else {
                $conflict = $pdo->prepare("SELECT 1 FROM player_identities WHERE alliance = ? AND discord_user_id = ? AND player_id <> ? LIMIT 1");
                $conflict->execute([$alliance, $discordId, $playerId]);
                if ($conflict->fetch()) {
                    $pdo->rollBack();
                    jsonOut(409, ['error' => 'Discord-ID ist bereits einem anderen Spieler zugeordnet']);
                }

                $existing = $pdo->prepare("SELECT identity_id FROM player_identities WHERE alliance = ? AND player_id = ? ORDER BY created_at, identity_id LIMIT 1");
                $existing->execute([$alliance, $playerId]);
                $identityRow = $existing->fetch();

                if ($identityRow) {
                    $pdo->prepare("UPDATE player_identities SET discord_user_id = NULL WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
                    $pdo->prepare("UPDATE player_identities SET discord_user_id = ? WHERE alliance = ? AND identity_id = ?")->execute([$discordId, $alliance, $identityRow['identity_id']]);
                } else {
                    $pdo->prepare("INSERT INTO player_identities (alliance, identity_id, player_id, discord_user_id) VALUES (?, ?, ?, ?)")
                        ->execute([$alliance, uuid4(), $playerId, $discordId]);
                }
            }
        }

        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate') || $e->getCode() === '23000') {
            jsonOut(409, ['error' => 'Name existiert bereits']);
        }
        throw $e;
    }
}

function handleDeleteMember(PDO $pdo, string $alliance, string $nameEncoded): never {
    $name = rawurldecode($nameEncoded);
    $stmt = $pdo->prepare("SELECT player_id FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $name]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(200, ['ok' => true]);

    $playerId = $row['player_id'];
    $pdo->beginTransaction();
    try {
        $pdo->prepare("DELETE wef FROM weekly_entry_flags wef JOIN weekly_entries we ON wef.alliance = we.alliance AND wef.entry_id = we.entry_id WHERE wef.alliance = ? AND we.player_id = ?")->execute([$alliance, $playerId]);
        $pdo->prepare("DELETE FROM weekly_entries WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        $pdo->prepare("DELETE FROM player_name_history WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        $pdo->prepare("DELETE FROM player_user_links WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        $pdo->prepare("DELETE FROM player_identities WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        $pdo->prepare("DELETE FROM players WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function handleSwapIdToDiscord(PDO $pdo, string $alliance, string $nameEncoded): never {
    $name = rawurldecode($nameEncoded);
    $stmt = $pdo->prepare("
        SELECT p.player_id, p.current_name, p.current_rank_code, p.is_active, p.created_at, p.retired_at,
               COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id
        FROM players p
        LEFT JOIN (SELECT alliance, player_id, MIN(discord_user_id) AS discord_user_id FROM player_identities WHERE discord_user_id IS NOT NULL GROUP BY alliance, player_id) pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        LEFT JOIN (SELECT pul.alliance, pul.player_id, MIN(uda.discord_user_id) AS discord_user_id FROM player_user_links pul JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id GROUP BY pul.alliance, pul.player_id) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        WHERE p.alliance = ? AND p.current_name = ?
    ");
    $stmt->execute([$alliance, $name]);
    $rows = $stmt->fetchAll();
    if (!$rows) jsonOut(404, ['error' => 'Mitglied nicht gefunden']);

    $oldPlayerId   = $rows[0]['player_id'];
    $discordUserId = $rows[0]['discord_user_id'] ?? null;
    if (!$discordUserId) jsonOut(400, ['error' => 'Kein verknuepfter Discord-Account vorhanden']);
    if (strlen($discordUserId) > 36) jsonOut(400, ['error' => 'Discord-ID ist zu lang fuer player_id']);
    if ($oldPlayerId === $discordUserId) jsonOut(200, ['ok' => true, 'swapped' => false, 'player_id' => $oldPlayerId]);

    $taken = $pdo->prepare("SELECT 1 FROM players WHERE alliance = ? AND player_id = ? AND player_id <> ? LIMIT 1");
    $taken->execute([$alliance, $discordUserId, $oldPlayerId]);
    if ($taken->fetch()) jsonOut(409, ['error' => 'Discord-ID wird bereits von einem anderen Spieler genutzt']);

    $pdo->beginTransaction();
    try {
        $tempName = '__swap__' . substr(str_replace('-', '', uuid4()), 0, 12);
        $pdo->prepare("UPDATE players SET current_name = ? WHERE alliance = ? AND player_id = ?")->execute([$tempName, $alliance, $oldPlayerId]);
        $pdo->prepare("INSERT INTO players (alliance, player_id, current_name, current_rank_code, is_active, created_at, retired_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            ->execute([$alliance, $discordUserId, $rows[0]['current_name'], $rows[0]['current_rank_code'], $rows[0]['is_active'], $rows[0]['created_at'], $rows[0]['retired_at']]);
        foreach (['weekly_entries', 'player_name_history', 'player_identities', 'player_user_links'] as $tbl) {
            $pdo->prepare("UPDATE {$tbl} SET player_id = ? WHERE alliance = ? AND player_id = ?")->execute([$discordUserId, $alliance, $oldPlayerId]);
        }
        $pdo->prepare("DELETE FROM players WHERE alliance = ? AND player_id = ?")->execute([$alliance, $oldPlayerId]);
        $pdo->commit();
        jsonOut(200, ['ok' => true, 'swapped' => true, 'old_player_id' => $oldPlayerId, 'player_id' => $discordUserId]);
    } catch (\PDOException $e) {
        $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate') || $e->getCode() === '23000') {
            jsonOut(409, ['error' => 'ID-Tausch nicht moeglich (Konflikt)']);
        }
        throw $e;
    }
}

function handleGetEntries(PDO $pdo, string $alliance, int $kw): never {
    $stmt = $pdo->prepare("
        SELECT we.entry_id, we.final_rank_code, p.current_name
        FROM weekly_entries we
        JOIN players p ON p.alliance = we.alliance AND p.player_id = we.player_id
        WHERE we.alliance = ? AND we.year_week = ?
        ORDER BY p.current_name
    ");
    $stmt->execute([$alliance, $kw]);
    $rows = $stmt->fetchAll();

    $result = [];
    foreach ($rows as $row) {
        $fs = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
        $fs->execute([$alliance, $row['entry_id']]);
        $flags = [];
        foreach ($fs->fetchAll() as $f) $flags[$f['flag_key']] = true;
        $result[] = ['name' => $row['current_name'], 'rank' => (int)$row['final_rank_code'], 'flags' => $flags];
    }
    jsonOut(200, $result);
}

function handleSaveEntry(PDO $pdo, string $alliance, int $kw, array $body, array $protectedNames): never {
    $name = trim($body['name'] ?? '');
    if ($name === '') jsonOut(400, ['error' => 'Name fehlt']);

    $requestedRank = safeRank((int)($body['rank'] ?? 3));
    $flags         = (array)($body['flags'] ?? []);
    $protection    = applyProtectedRankRule($name, $requestedRank, $protectedNames);
    $rank          = $protection['effectiveRank'];

    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO week_periods (alliance, year_week) VALUES (?, ?) ON DUPLICATE KEY UPDATE year_week = VALUES(year_week)")->execute([$alliance, $kw]);

        $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM players WHERE alliance = ? AND current_name = ?");
        $stmt->execute([$alliance, $name]);
        $playerRow = $stmt->fetch();

        if ($playerRow) {
            $playerId = $playerRow['player_id'];
            $oldRank  = (int)$playerRow['current_rank_code'];
            $p        = applyProtectedRankRule($playerRow['current_name'], $requestedRank, $protectedNames);
            $rank     = $p['effectiveRank'];
            $pdo->prepare("UPDATE players SET current_rank_code = ?, is_active = 1, retired_at = NULL WHERE alliance = ? AND player_id = ?")->execute([$rank, $alliance, $playerId]);
            if ($oldRank !== $rank || $p['blocked'] || $p['protectedMember']) {
                logRankChange($pdo, $alliance, [
                    'playerId' => $playerId, 'playerName' => $playerRow['current_name'] ?: $name,
                    'oldRank' => $oldRank, 'requestedRank' => $requestedRank, 'appliedRank' => $rank,
                    'source' => "entries:{$kw}", 'blocked' => $p['blocked'],
                    'reason' => $p['protectedMember'] ? 'protected-r4-member' : null,
                ]);
            }
        } else {
            $playerId = uuid4();
            $p        = applyProtectedRankRule($name, $requestedRank, $protectedNames);
            $rank     = $p['effectiveRank'];
            $pdo->prepare("INSERT INTO players (alliance, player_id, current_name, current_rank_code, is_active) VALUES (?, ?, ?, ?, 1)")->execute([$alliance, $playerId, $name, $rank]);
            if ($p['protectedMember']) {
                logRankChange($pdo, $alliance, [
                    'playerId' => $playerId, 'playerName' => $name,
                    'oldRank' => null, 'requestedRank' => $requestedRank, 'appliedRank' => $rank,
                    'source' => "entries:{$kw}", 'blocked' => $p['blocked'], 'reason' => 'protected-r4-member',
                ]);
            }
            $pdo->prepare("INSERT INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, ?)")->execute([$alliance, uuid4(), $playerId, $name, $kw]);
        }

        $stmt = $pdo->prepare("SELECT entry_id FROM weekly_entries WHERE alliance = ? AND year_week = ? AND player_id = ?");
        $stmt->execute([$alliance, $kw, $playerId]);
        $entryRow = $stmt->fetch();

        if ($entryRow) {
            $entryId = $entryRow['entry_id'];
            $pdo->prepare("UPDATE weekly_entries SET base_rank_code = ?, final_rank_code = ?, afk = ?, updated_at = CURRENT_TIMESTAMP WHERE alliance = ? AND entry_id = ?")
                ->execute([$rank, $rank, (!empty($flags['afk'])) ? 1 : 0, $alliance, $entryId]);
        } else {
            $entryId = uuid4();
            $pdo->prepare("INSERT INTO weekly_entries (alliance, entry_id, year_week, player_id, base_rank_code, final_rank_code, afk) VALUES (?, ?, ?, ?, ?, ?, ?)")
                ->execute([$alliance, $entryId, $kw, $playerId, $rank, $rank, (!empty($flags['afk'])) ? 1 : 0]);
        }

        $pdo->prepare("DELETE FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?")->execute([$alliance, $entryId]);
        foreach ($flags as $flagKey => $active) {
            if (!$active) continue;
            $pdo->prepare("INSERT INTO weekly_entry_flags (alliance, entry_id, flag_key) VALUES (?, ?, ?)")->execute([$alliance, $entryId, $flagKey]);
        }

        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function handleDeleteEntry(PDO $pdo, string $alliance, int $kw, string $nameEncoded): never {
    $name = rawurldecode($nameEncoded);
    $stmt = $pdo->prepare("SELECT we.entry_id FROM weekly_entries we JOIN players p ON p.alliance = we.alliance AND p.player_id = we.player_id WHERE we.alliance = ? AND we.year_week = ? AND p.current_name = ?");
    $stmt->execute([$alliance, $kw, $name]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(200, ['ok' => true]);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("DELETE FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?")->execute([$alliance, $row['entry_id']]);
        $pdo->prepare("DELETE FROM weekly_entries WHERE alliance = ? AND entry_id = ?")->execute([$alliance, $row['entry_id']]);
        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function handleListAccessRequests(PDO $pdo, string $alliance): never {
    ensureAccessRequestsTable($pdo);
    $status = strtolower(trim($_GET['status'] ?? 'pending')) ?: 'pending';
    $stmt = $pdo->prepare("
        SELECT request_id, discord_user_id, discord_username, discord_avatar,
               requested_alliance, requested_player_name, note, status, created_at
        FROM access_requests
        WHERE alliance = ? AND status = ?
        ORDER BY created_at DESC
        LIMIT 200
    ");
    $stmt->execute([$alliance, $status]);
    jsonOut(200, $stmt->fetchAll());
}

function handleSubmitAccessRequest(PDO $pdo, string $alliance, array $body): never {
    try {
        $discordId = normalizeDiscordId($body['discord_id'] ?? '');
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }
    if ($discordId === '') jsonOut(400, ['error' => 'Discord-ID fehlt']);

    $playerName  = trim($body['player_name'] ?? '');
    if ($playerName === '') jsonOut(400, ['error' => 'Spielername fehlt']);

    $reqAlliance = strtoupper(trim($body['alliance'] ?? $alliance));
    $username    = trim($body['discord_username'] ?? '') ?: null;
    $avatar      = trim($body['discord_avatar'] ?? '') ?: null;
    $note        = trim($body['note'] ?? '') ?: null;

    ensureAccessRequestsTable($pdo);
    $pdo->prepare("
        INSERT INTO access_requests (alliance, request_id, discord_user_id, discord_username, discord_avatar,
                                     requested_alliance, requested_player_name, note, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        ON DUPLICATE KEY UPDATE
            discord_username = VALUES(discord_username),
            discord_avatar   = VALUES(discord_avatar),
            requested_alliance = VALUES(requested_alliance),
            requested_player_name = VALUES(requested_player_name),
            note             = VALUES(note),
            created_at       = CURRENT_TIMESTAMP,
            reviewed_at      = NULL
    ")->execute([$alliance, uuid4(), $discordId, $username, $avatar, $reqAlliance, $playerName, $note]);
    jsonOut(200, ['ok' => true]);
}

function handleResolveAccessRequest(PDO $pdo, string $alliance, string $requestIdEncoded, array $body): never {
    $requestId = rawurldecode($requestIdEncoded);
    $status    = strtolower(trim($body['status'] ?? 'accepted'));
    if (!in_array($status, ['accepted', 'mapped', 'rejected'], true)) {
        jsonOut(400, ['error' => 'Ungueltiger Status']);
    }
    ensureAccessRequestsTable($pdo);
    $stmt = $pdo->prepare("UPDATE access_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP WHERE alliance = ? AND request_id = ? AND status = 'pending'");
    $stmt->execute([$status, $alliance, $requestId]);
    jsonOut(200, ['ok' => true, 'updated' => $stmt->rowCount() > 0]);
}

// ─── Main dispatch ────────────────────────────────────────────────────────────
try {
    if (empty($DB_HOST) || empty($DB_NAME) || empty($DB_USER)) {
        jsonOut(500, ['error' => 'Datenbank nicht konfiguriert. Bitte config.php anlegen.']);
    }

    $pdo = openDb($DB_HOST, $DB_PORT, $DB_NAME, $DB_USER, $DB_PASS);
    enforceProtectedRanks($pdo, $ALLIANCE, $PROTECTED_R4_NAMES);

    // GET /health
    if ($method === 'GET' && $path === '/health') {
        handleHealth($pdo, $ALLIANCE);
    }

    // GET /verify-discord
    if ($method === 'GET' && $path === '/verify-discord') {
        handleVerifyDiscord($pdo, $ALLIANCE);
    }

    // GET /member-history
    if ($method === 'GET' && $path === '/member-history') {
        handleMemberHistory($pdo, $ALLIANCE);
    }

    // POST /discord-profile-cache
    if ($method === 'POST' && $path === '/discord-profile-cache') {
        handleCacheDiscordProfile($pdo, $ALLIANCE, $body);
    }

    // GET /rank-change-log
    if ($method === 'GET' && $path === '/rank-change-log') {
        handleListRankChangeLog($pdo, $ALLIANCE);
    }

    // GET /members
    if ($method === 'GET' && count($segments) === 1 && $segments[0] === 'members') {
        handleGetMembers($pdo, $ALLIANCE);
    }

    // POST /members
    if ($method === 'POST' && count($segments) === 1 && $segments[0] === 'members') {
        handleAddMember($pdo, $ALLIANCE, $body, $PROTECTED_R4_NAMES);
    }

    // POST /members/{name}/swap-id-to-discord
    if ($method === 'POST' && count($segments) === 3 && $segments[0] === 'members' && $segments[2] === 'swap-id-to-discord') {
        handleSwapIdToDiscord($pdo, $ALLIANCE, $segments[1]);
    }

    // PUT /members/{name}
    if ($method === 'PUT' && count($segments) === 2 && $segments[0] === 'members') {
        handleUpdateMember($pdo, $ALLIANCE, $segments[1], $body, $PROTECTED_R4_NAMES);
    }

    // DELETE /members/{name}
    if ($method === 'DELETE' && count($segments) === 2 && $segments[0] === 'members') {
        handleDeleteMember($pdo, $ALLIANCE, $segments[1]);
    }

    // access-requests
    if ($segments[0] === 'access-requests') {
        if ($method === 'GET' && count($segments) === 1) handleListAccessRequests($pdo, $ALLIANCE);
        if ($method === 'POST' && count($segments) === 1) handleSubmitAccessRequest($pdo, $ALLIANCE, $body);
        if ($method === 'POST' && count($segments) === 3 && $segments[2] === 'resolve') {
            handleResolveAccessRequest($pdo, $ALLIANCE, $segments[1], $body);
        }
    }

    // entries
    if ($segments[0] === 'entries') {
        $kw = (int)($segments[1] ?? 0);
        if (!$kw) jsonOut(400, ['error' => 'Ungueltige KW']);
        if ($method === 'GET'    && count($segments) === 2) handleGetEntries($pdo, $ALLIANCE, $kw);
        if ($method === 'POST'   && count($segments) === 2) handleSaveEntry($pdo, $ALLIANCE, $kw, $body, $PROTECTED_R4_NAMES);
        if ($method === 'DELETE' && count($segments) === 3) handleDeleteEntry($pdo, $ALLIANCE, $kw, $segments[2]);
    }

    jsonOut(404, ['error' => "Route not found: {$method} {$path}"]);

} catch (\Throwable $e) {
    jsonOut(500, ['error' => $e->getMessage()]);
}
