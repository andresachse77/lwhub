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
$DB_SSL_CA = getenv('MYSQL_SSL_CA') ?: (defined('MYSQL_SSL_CA') ? MYSQL_SSL_CA : '');

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
    if (isLocalRequest() && $id === 'local-preview') return 'local-preview';
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

/** True when the PHP dev-server is serving a local request (127.0.0.1). */
function isLocalRequest(): bool {
    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    return $remote === '127.0.0.1' || $remote === '::1';
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

function openDb(string $host, int $port, string $db, string $user, string $pass, string $sslCa = ''): PDO {
    $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    if ($sslCa !== '' && defined('PDO::MYSQL_ATTR_SSL_CA')) {
        $options[PDO::MYSQL_ATTR_SSL_CA] = $sslCa;
        if (defined('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')) {
            $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = true;
        }
    }
    $pdo = new PDO($dsn, $user, $pass, $options);
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

function ensurePresenceTable(PDO $pdo): void {
    $pdo->exec(" 
        CREATE TABLE IF NOT EXISTS member_presence (
            alliance VARCHAR(50) NOT NULL,
            member_name VARCHAR(150) NOT NULL,
            discord_user_id VARCHAR(50) NULL,
            discord_username VARCHAR(100) NULL,
            last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, member_name),
            KEY ix_member_presence_seen (alliance, last_seen)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function ensureLastVisitColumn(PDO $pdo): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    try {
        $pdo->exec("ALTER TABLE players ADD COLUMN last_visit_at DATETIME NULL DEFAULT NULL");
    } catch (\PDOException) {
        // Spalte existiert bereits – ignorieren
    }
}

function ensureChatTable(PDO $pdo): void {
    $pdo->exec(" 
        CREATE TABLE IF NOT EXISTS member_chat_messages (
            alliance VARCHAR(50) NOT NULL,
            chat_id CHAR(36) NOT NULL,
            member_name VARCHAR(150) NOT NULL,
            message TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, chat_id),
            KEY ix_member_chat_created (alliance, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function getOnlineMembers(PDO $pdo, string $alliance, int $seconds = 180): array {
    ensurePresenceTable($pdo);
    $seconds = max(30, min(600, $seconds));
    $stmt = $pdo->prepare(" 
        SELECT member_name, discord_user_id, discord_username, last_seen
        FROM member_presence
        WHERE alliance = ?
          AND last_seen >= (UTC_TIMESTAMP() - INTERVAL ? SECOND)
        ORDER BY member_name ASC
    ");
    $stmt->execute([$alliance, $seconds]);
    return $stmt->fetchAll();
}

function handlePresenceList(PDO $pdo, string $alliance): never {
    $seconds = (int)($_GET['seconds'] ?? 180);
    $online = getOnlineMembers($pdo, $alliance, $seconds);
    jsonOut(200, [
        'ok' => true,
        'online_count' => count($online),
        'online' => $online,
        'window_seconds' => max(30, min(600, $seconds)),
        'server_time' => gmdate('c'),
    ]);
}

function handlePresencePing(PDO $pdo, string $alliance, array $body): never {
    $memberName = trim((string)($body['member_name'] ?? ''));
    if ($memberName === '') jsonOut(400, ['error' => 'member_name fehlt']);

    try {
        $discordId = normalizeDiscordId($body['discord_id'] ?? '');
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }

    $discordUsername = trim((string)($body['discord_username'] ?? '')) ?: null;

    // Hole den aktuellen Namen aus der Datenbank für Konsistenz
    $member = getDiscordMember($pdo, $alliance, $discordId);
    if ($member) {
        $memberName = trim((string)($member['current_name'] ?? $memberName));
    }

    ensurePresenceTable($pdo);
    $stmt = $pdo->prepare(" 
        INSERT INTO member_presence (alliance, member_name, discord_user_id, discord_username, last_seen)
        VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE
            discord_user_id = VALUES(discord_user_id),
            discord_username = VALUES(discord_username),
            last_seen = UTC_TIMESTAMP()
    ");
    $stmt->execute([$alliance, $memberName, $discordId !== '' ? $discordId : null, $discordUsername]);

    // last_visit_at in players aktualisieren
    ensureLastVisitColumn($pdo);
    $pdo->prepare("UPDATE players SET last_visit_at = UTC_TIMESTAMP() WHERE alliance = ? AND current_name = ? AND is_active = 1")
        ->execute([$alliance, $memberName]);

    $online = getOnlineMembers($pdo, $alliance, 180);
    jsonOut(200, [
        'ok' => true,
        'online_count' => count($online),
        'online' => $online,
        'current_member_name' => $memberName,
        'server_time' => gmdate('c'),
    ]);
}

function handleGetChat(PDO $pdo, string $alliance): never {
    ensureChatTable($pdo);
    $limit = (int)($_GET['limit'] ?? 40);
    $limit = max(5, min(100, $limit));

    $stmt = $pdo->prepare(" 
        SELECT chat_id, member_name, message, created_at
        FROM member_chat_messages
        WHERE alliance = ?
        ORDER BY created_at DESC
        LIMIT ?
    ");
    $stmt->bindValue(1, $alliance, PDO::PARAM_STR);
    $stmt->bindValue(2, $limit, PDO::PARAM_INT);
    $stmt->execute();
    $rows = array_reverse($stmt->fetchAll());

    jsonOut(200, [
        'ok' => true,
        'messages' => $rows,
    ]);
}

function handlePostChat(PDO $pdo, string $alliance, array $body): never {
    ensureChatTable($pdo);
    $message = trim((string)($body['message'] ?? ''));
    if ($message === '') jsonOut(400, ['error' => 'Nachricht ist leer']);
    if (mb_strlen($message) > 500) jsonOut(400, ['error' => 'Nachricht zu lang (max 500 Zeichen)']);

    $discordIdRaw = $body['discord_id'] ?? '';
    try {
        $discordId = normalizeDiscordId($discordIdRaw);
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);

    $member = getDiscordMember($pdo, $alliance, $discordId);
    if (!$member) jsonOut(403, ['error' => 'Discord-ID ist keinem aktiven Mitglied zugeordnet']);
    $memberName = trim((string)($member['current_name'] ?? ''));
    if ($memberName === '') jsonOut(403, ['error' => 'Mitgliedsname konnte nicht aufgeloest werden']);

    $stmt = $pdo->prepare(" 
        INSERT INTO member_chat_messages (alliance, chat_id, member_name, message, created_at)
        VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
    ");
    $stmt->execute([$alliance, uuid4(), $memberName, $message]);

    handleGetChat($pdo, $alliance);
}

function handleDeleteChatMessage(PDO $pdo, string $alliance, string $chatIdEncoded, array $body): never {
    ensureChatTable($pdo);
    $chatId = rawurldecode($chatIdEncoded);
    if ($chatId === '') jsonOut(400, ['error' => 'chat_id fehlt']);

    try {
        $discordId = normalizeDiscordId($body['discord_id'] ?? '');
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);

    $manager = getDiscordMember($pdo, $alliance, $discordId, true);
    if (!$manager) jsonOut(403, ['error' => 'Nur R4/R5 darf Chat-Nachrichten loeschen']);

    $stmt = $pdo->prepare("DELETE FROM member_chat_messages WHERE alliance = ? AND chat_id = ?");
    $stmt->execute([$alliance, $chatId]);

    handleGetChat($pdo, $alliance);
}

function logRankChange(PDO $pdo, string $alliance, array $payload): void {
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
    $title = null;
    try {
        ensureAlliancesTable($pdo);
        upsertAllianceFromConfig($pdo, $alliance);
        $aStmt = $pdo->prepare("SELECT alliance_name FROM alliances WHERE alliance = ?");
        $aStmt->execute([$alliance]);
        $aRow = $aStmt->fetch();
        $title = $aRow ? ($aRow['alliance_name'] ?? null) : null;
    } catch (\PDOException) {}
    jsonOut(200, [
        'ok'             => (bool)($row['ok'] ?? false),
        'backend'        => 'php-mysql',
        'alliance'       => $alliance,
        'alliance_title' => $title,
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
    ensureLastVisitColumn($pdo);
    $stmt = $pdo->prepare("
        SELECT p.player_id, p.alliance, p.current_name, p.current_rank_code, p.last_visit_at,
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
        'last_visit_at'      => $r['last_visit_at'] ?? null,
    ], $rows);

    jsonOut(200, $result);
}

function handleAddMember(PDO $pdo, string $alliance, array $body, array $protectedNames): never {
    $name = trim($body['name'] ?? '');
    if ($name === '') jsonOut(400, ['error' => 'Name fehlt']);

    // Check for conflict before starting transaction
    $existing = $pdo->prepare("SELECT player_id, is_active FROM players WHERE alliance = ? AND current_name = ? LIMIT 1");
    $existing->execute([$alliance, $name]);
    $existingRow = $existing->fetch();
    if ($existingRow) {
        if ((int)$existingRow['is_active'] === 0) {
            jsonOut(409, ['error' => 'Dieser Spieler ist archiviert. Bitte über Archiv wiederherstellen.']);
        }
        jsonOut(409, ['error' => 'Mitglied mit diesem Namen existiert bereits']);
    }

    $discordIdRaw = trim($body['discord_id'] ?? '');
    $discordId = '';
    if ($discordIdRaw !== '') {
        try { $discordId = normalizeDiscordId($discordIdRaw); }
        catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => 'Ungültige Discord-ID: ' . $e->getMessage()]); }
    }

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

        $stmt = $pdo->prepare("INSERT IGNORE INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, 0)");
        $stmt->execute([$alliance, $nameEventId, $playerId, $name]);

        if ($discordId !== '') {
            try {
                $pdo->prepare("INSERT IGNORE INTO player_identities (alliance, identity_id, player_id, discord_user_id) VALUES (?, ?, ?, ?)"
                )->execute([$alliance, uuid4(), $playerId, $discordId]);
            } catch (\PDOException $e) {
                if (!isOptionalTableError($e)) throw $e;
            }
        }

        $pdo->commit();
        jsonOut(201, ['ok' => true, 'player_id' => $playerId]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate') || $e->getCode() === '23000') {
            jsonOut(409, ['error' => 'Mitglied mit diesem Namen existiert bereits']);
        }
        throw $e;
    }
}

function handleTransferPlayer(PDO $pdo, string $fromAlliance, string $nameEncoded, array $body): never {
    $name = rawurldecode($nameEncoded);
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);

    $toAlliance = trim($body['to_alliance'] ?? '');
    if ($toAlliance === '') jsonOut(400, ['error' => 'Ziel-Allianz fehlt']);
    if ($toAlliance === $fromAlliance) jsonOut(400, ['error' => 'Spieler ist bereits in dieser Allianz']);

    // Check target alliance exists
    $aStmt = $pdo->prepare("SELECT 1 FROM alliances WHERE alliance = ? LIMIT 1");
    $aStmt->execute([$toAlliance]);
    if (!$aStmt->fetch()) jsonOut(404, ['error' => 'Ziel-Allianz nicht gefunden']);

    // Find player in source alliance
    $stmt = $pdo->prepare("SELECT player_id, current_rank_code FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1 LIMIT 1");
    $stmt->execute([$fromAlliance, $name]);
    $player = $stmt->fetch();
    if (!$player) jsonOut(404, ['error' => 'Spieler nicht gefunden']);

    // Check name not already taken in target
    $check = $pdo->prepare("SELECT 1 FROM players WHERE alliance = ? AND current_name = ? LIMIT 1");
    $check->execute([$toAlliance, $name]);
    if ($check->fetch()) jsonOut(409, ['error' => 'Name bereits in Ziel-Allianz vergeben']);

    $playerId = $player['player_id'];

    // Ensure ranks exist in target alliance
    for ($r = 1; $r <= 5; $r++) {
        $pdo->prepare("INSERT IGNORE INTO ranks (alliance, rank_code) VALUES (?, ?)")->execute([$toAlliance, $r]);
    }

    $pdo->beginTransaction();
    try {
        $pdo->exec("SET FOREIGN_KEY_CHECKS=0");

        // Migrate all tables (order doesn't matter with FK checks off)
        foreach (['players', 'player_identities', 'player_name_history'] as $tbl) {
            try {
                $pdo->prepare("UPDATE `{$tbl}` SET alliance = ? WHERE alliance = ? AND player_id = ?")
                    ->execute([$toAlliance, $fromAlliance, $playerId]);
            } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        }
        // weekly_entry_flags references alliance+entry_id, must be migrated before weekly_entries
        try {
            $pdo->prepare("UPDATE weekly_entry_flags wef
                JOIN weekly_entries we ON wef.alliance = we.alliance AND wef.entry_id = we.entry_id
                SET wef.alliance = ?
                WHERE wef.alliance = ? AND we.player_id = ?")
                ->execute([$toAlliance, $fromAlliance, $playerId]);
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        try {
            $pdo->prepare("UPDATE weekly_entries SET alliance = ? WHERE alliance = ? AND player_id = ?")
                ->execute([$toAlliance, $fromAlliance, $playerId]);
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }

        $pdo->exec("SET FOREIGN_KEY_CHECKS=1");

        $pdo->commit();
        jsonOut(200, ['ok' => true, 'player_id' => $playerId, 'to_alliance' => $toAlliance]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
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
            $stmt = $pdo->prepare("INSERT IGNORE INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, 0)");
            $stmt->execute([$alliance, uuid4(), $playerId, $newName]);
        }

        if ($discordIdSet) {
            if ($discordId === '') {
                $pdo->prepare("UPDATE player_identities SET discord_user_id = NULL WHERE alliance = ? AND player_id = ?")
                    ->execute([$alliance, $playerId]);
            } else {
                // A Discord account can own multiple chars – no uniqueness check needed.

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
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate entry')) {
            jsonOut(409, ['error' => 'Name existiert bereits']);
        }
        throw $e;
    }
}

function handleDeleteMember(PDO $pdo, string $alliance, string $nameEncoded, array $body = []): never {
    $name = rawurldecode($nameEncoded);
    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code, created_at FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $name]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(200, ['ok' => true]);

    $playerId  = $row['player_id'];
    $archiveId = uuid4();
    $archivedBy = null;
    try { $archivedBy = normalizeDiscordId($body['discord_id'] ?? ''); } catch (\InvalidArgumentException) {}
    if ($archivedBy === '') $archivedBy = null;

    ensureArchiveTables($pdo);

    $pdo->beginTransaction();
    try {
        // Archive player record
        $pdo->prepare("INSERT INTO archived_players (archive_id, archived_by, alliance, player_id, current_name, current_rank_code, player_created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            ->execute([$archiveId, $archivedBy, $alliance, $playerId, $row['current_name'], $row['current_rank_code'], $row['created_at']]);

        // Archive weekly entries + flags
        try {
            $entries = $pdo->prepare("SELECT * FROM weekly_entries WHERE alliance = ? AND player_id = ?");
            $entries->execute([$alliance, $playerId]);
            foreach ($entries->fetchAll() as $entry) {
                $brc = $entry['base_rank_code'] ?? $entry['final_rank_code'];
                $pdo->prepare("INSERT INTO archived_weekly_entries (archive_id, entry_id, year_week, player_id, alliance, base_rank_code, final_rank_code, afk) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                    ->execute([$archiveId, $entry['entry_id'], $entry['year_week'], $entry['player_id'], $alliance, $brc, $entry['final_rank_code'], $entry['afk'] ?? 0]);
                $flags = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
                $flags->execute([$alliance, $entry['entry_id']]);
                foreach ($flags->fetchAll() as $flag) {
                    $pdo->prepare("INSERT INTO archived_entry_flags (archive_id, entry_id, flag_key) VALUES (?, ?, ?)")
                        ->execute([$archiveId, $entry['entry_id'], $flag['flag_key']]);
                }
            }
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }

        // Archive name history
        try {
            $hist = $pdo->prepare("SELECT * FROM player_name_history WHERE alliance = ? AND player_id = ?");
            $hist->execute([$alliance, $playerId]);
            foreach ($hist->fetchAll() as $h) {
                $pdo->prepare("INSERT INTO archived_name_history (archive_id, name_event_id, player_id, alliance, player_name, valid_from_yw) VALUES (?, ?, ?, ?, ?, ?)")
                    ->execute([$archiveId, $h['name_event_id'], $playerId, $alliance, $h['player_name'], $h['valid_from_yw']]);
            }
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }

        // Archive identities
        try {
            $ids = $pdo->prepare("SELECT * FROM player_identities WHERE alliance = ? AND player_id = ?");
            $ids->execute([$alliance, $playerId]);
            foreach ($ids->fetchAll() as $id) {
                $pdo->prepare("INSERT INTO archived_player_identities (archive_id, identity_id, player_id, alliance, discord_user_id) VALUES (?, ?, ?, ?, ?)")
                    ->execute([$archiveId, $id['identity_id'], $playerId, $alliance, $id['discord_user_id']]);
            }
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }

        // Delete live data
        try {
            $pdo->prepare("DELETE wef FROM weekly_entry_flags wef JOIN weekly_entries we ON wef.alliance = we.alliance AND wef.entry_id = we.entry_id WHERE wef.alliance = ? AND we.player_id = ?")->execute([$alliance, $playerId]);
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        $pdo->prepare("DELETE FROM weekly_entries WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        try { $pdo->prepare("DELETE FROM player_name_history WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]); } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        try { $pdo->prepare("DELETE FROM player_user_links WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]); } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        try { $pdo->prepare("DELETE FROM player_identities WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]); } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        $pdo->prepare("DELETE FROM players WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        try {
            ensureUserActiveCharTable($pdo);
            $pdo->prepare("DELETE FROM user_active_char WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        } catch (\PDOException $e) {}

        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
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
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate') || $e->getCode() === '23000') {
            jsonOut(409, ['error' => 'ID-Tausch nicht moeglich (Konflikt)']);
        }
        throw $e;
    }
}

function handleGetSeInactive(PDO $pdo, string $alliance): never {
    $weeks = max(1, min(12, (int)($_GET['weeks'] ?? 4)));

    // Die letzten N erfassten Wochen ermitteln (nach year_week absteigend)
    $stmt = $pdo->prepare("
        SELECT DISTINCT we.year_week
        FROM weekly_entries we
        WHERE we.alliance = ?
        ORDER BY we.year_week DESC
        LIMIT ?
    ");
    $stmt->execute([$alliance, $weeks]);
    $recentWeeks = array_column($stmt->fetchAll(), 'year_week');

    if (empty($recentWeeks)) {
        jsonOut(200, ['weeks' => [], 'inactive' => []]);
    }

    // Alle aktiven Spieler laden
    $stmt = $pdo->prepare("SELECT player_id, current_name FROM players WHERE alliance = ? AND is_active = 1 ORDER BY current_name");
    $stmt->execute([$alliance]);
    $allPlayers = $stmt->fetchAll();

    // Für jeden Spieler: Einträge + Flags für alle Wochen sammeln
    $inactive = [];
    foreach ($allPlayers as $player) {
        $neverSE    = true;
        $alwaysAfk  = true;
        $weekDetails = [];

        foreach ($recentWeeks as $yw) {
            $stmt2 = $pdo->prepare("
                SELECT we.entry_id, we.afk
                FROM weekly_entries we
                WHERE we.alliance = ? AND we.year_week = ? AND we.player_id = ?
            ");
            $stmt2->execute([$alliance, $yw, $player['player_id']]);
            $entry = $stmt2->fetch();

            if (!$entry) {
                $weekDetails[$yw] = ['status' => 'missing', 'flags' => []];
                $alwaysAfk = false;
                continue;
            }

            if ($entry['afk']) {
                $weekDetails[$yw] = ['status' => 'afk', 'flags' => []];
                continue;
            }

            $alwaysAfk = false;

            // Alle Flags für diesen Eintrag laden
            $stmtF = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
            $stmtF->execute([$alliance, $entry['entry_id']]);
            $flags = array_column($stmtF->fetchAll(), 'flag_key');

            $hasSE = in_array('seTeilnahme', $flags, true);
            if ($hasSE) $neverSE = false;

            $weekDetails[$yw] = [
                'status' => $hasSE ? 'se' : 'no_se',
                'flags'  => $flags,
            ];
        }

        // Spieler ist inaktiv wenn: kein AFK in irgendeiner Woche, und nie seTeilnahme gesetzt
        $hasAnyAfk = in_array('afk', array_column($weekDetails, 'status'), true);
        if ($neverSE && !$hasAnyAfk) {
            $inactive[] = [
                'name'  => $player['current_name'],
                'weeks' => $weekDetails,
            ];
        }
    }

    jsonOut(200, ['weeks' => $recentWeeks, 'inactive' => $inactive]);
}

function handleGetRankingHistory(PDO $pdo, string $alliance): never {
    $weeks = max(2, min(8, (int)($_GET['weeks'] ?? 4)));

    // Aktuelle ISO-KW berechnen (Format YYWW, z.B. 2619)
    // date('N') = 1=Mo, 7=So  →  Woche gilt als abgeschlossen ab Sonntag
    $currentKw = (int)(date('y') . date('W'));
    $weekClosed = (int)date('N') === 7; // Sonntag = abgeschlossen

    // Die letzten N erfassten Wochen ermitteln
    // Laufende Woche (Mo–Sa) wird herausgefiltert – erst ab Sonntag nutzbar
    $stmt = $pdo->prepare("
        SELECT DISTINCT year_week FROM weekly_entries
        WHERE alliance = ? ORDER BY year_week DESC LIMIT ?
    ");
    $stmt->execute([$alliance, $weeks + 1]); // +1 für den Fall dass aktuelle KW gefiltert wird
    $allWeeks = array_column($stmt->fetchAll(), 'year_week');

    $recentWeeks = [];
    $currentKwFiltered = false;
    foreach ($allWeeks as $yw) {
        if ((int)$yw === $currentKw && !$weekClosed) {
            $currentKwFiltered = true;
            continue; // laufende Woche überspringen
        }
        $recentWeeks[] = $yw;
        if (count($recentWeeks) >= $weeks) break;
    }

    if (empty($recentWeeks)) {
        jsonOut(200, ['weeks' => [], 'players' => [], 'currentKwFiltered' => $currentKwFiltered]);
    }

    // Alle aktiven Spieler laden
    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM players WHERE alliance = ? AND is_active = 1 ORDER BY current_name");
    $stmt->execute([$alliance]);
    $allPlayers = $stmt->fetchAll();

    $result = [];
    foreach ($allPlayers as $player) {
        $playerWeeks = [];
        foreach ($recentWeeks as $yw) {
            $stmt2 = $pdo->prepare("SELECT we.entry_id, we.afk FROM weekly_entries we WHERE we.alliance = ? AND we.year_week = ? AND we.player_id = ?");
            $stmt2->execute([$alliance, $yw, $player['player_id']]);
            $entry = $stmt2->fetch();
            if (!$entry) {
                $playerWeeks[$yw] = ['flags' => [], 'afk' => false, 'missing' => true];
                continue;
            }
            $stmtF = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
            $stmtF->execute([$alliance, $entry['entry_id']]);
            $flags = [];
            foreach ($stmtF->fetchAll() as $f) $flags[$f['flag_key']] = true;
            $playerWeeks[$yw] = ['flags' => $flags, 'afk' => (bool)$entry['afk'], 'missing' => false];
        }
        $result[] = [
            'name'    => $player['current_name'],
            'rank'    => (int)$player['current_rank_code'],
            'entries' => $playerWeeks,
        ];
    }

    jsonOut(200, ['weeks' => $recentWeeks, 'players' => $result, 'currentKwFiltered' => $currentKwFiltered, 'currentKw' => $currentKw]);
}

function handleApplyRankChange(PDO $pdo, string $alliance, array $body, array $protectedNames): never {
    $name    = trim($body['name'] ?? '');
    $newRank = (int)($body['newRank'] ?? 0);
    $confirm = trim($body['confirmation'] ?? '');

    if ($name === '') jsonOut(400, ['error' => 'Name fehlt']);
    if ($newRank < 1 || $newRank > 5) jsonOut(400, ['error' => 'Ungültiger Rang']);
    if ($confirm === '') jsonOut(400, ['error' => 'Bestätigung fehlt']);

    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $name]);
    $player = $stmt->fetch();
    if (!$player) jsonOut(404, ['error' => 'Spieler nicht gefunden']);

    // R4/R5 sind geschützt, nur R5 kann R4/R5 setzen
    if ($player['current_rank_code'] >= 4 || $newRank >= 4) {
        jsonOut(403, ['error' => 'R4/R5 können nicht über dieses Tool geändert werden']);
    }

    $protection = applyProtectedRankRule($name, $newRank, $protectedNames);
    $effectiveRank = $protection['effectiveRank'];

    $oldRank = (int)$player['current_rank_code'];
    $pdo->prepare("UPDATE players SET current_rank_code = ? WHERE alliance = ? AND player_id = ?")
        ->execute([$effectiveRank, $alliance, $player['player_id']]);

    logRankChange($pdo, $alliance, [
        'playerId'      => $player['player_id'],
        'playerName'    => $player['current_name'],
        'oldRank'       => $oldRank,
        'requestedRank' => $newRank,
        'appliedRank'   => $effectiveRank,
        'source'        => 'manual:ergebnis',
        'blocked'       => $protection['blocked'],
        'reason'        => "confirmation:{$confirm}",
    ]);

    jsonOut(200, ['ok' => true, 'oldRank' => $oldRank, 'newRank' => $effectiveRank]);
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

    $txStarted = false;
    try {
        $txStarted = $pdo->beginTransaction();
    } catch (\PDOException) {
        $txStarted = false;
    }
    
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

        if ($txStarted && $pdo->inTransaction()) {
            $pdo->commit();
        }
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        if ($txStarted && $pdo->inTransaction()) $pdo->rollBack();
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
        if ($pdo->inTransaction()) $pdo->rollBack();
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

// ─── Alliance / Archive / Char tables ─────────────────────────────────────────

function ensureAlliancesTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS alliances (
            alliance     VARCHAR(50)  NOT NULL,
            alliance_name VARCHAR(200) NULL,
            is_active    TINYINT(1)  NOT NULL DEFAULT 1,
            created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function upsertAllianceFromConfig(PDO $pdo, string $alliance): void {
    $pdo->prepare("INSERT IGNORE INTO alliances (alliance) VALUES (?)")->execute([$alliance]);
    // Ensure ranks 1–5 exist for this alliance (required by FK players.fk_players_rank)
    try {
        for ($r = 1; $r <= 5; $r++) {
            $pdo->prepare("INSERT IGNORE INTO ranks (alliance, rank_code) VALUES (?, ?)")->execute([$alliance, $r]);
        }
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
    // Ensure all known flag_keys exist in flags table (required by FK weekly_entry_flags.fk_weekly_entry_flags_flag)
    seedFlagsForAlliance($pdo, $alliance);
}

function seedFlagsForAlliance(PDO $pdo, string $alliance): void {
    $flagKeys = [
        'wache1','wache1dmg','wache2','wache2dmg','wache3','wache3dmg',
        'seTeilnahme','seTop50','seTop20',
        'wuesteAnmeldung','wuesteTeilnahme','wuesteFehlen',
        'spendeUnter35k','spendeTop20',
        'inaktiv','schild','falschparken','nap','mails','verhIntern','verhExtern','afk',
        'umfragen','support','feedback',
    ];
    try {
        $stmt = $pdo->prepare("INSERT IGNORE INTO flags (alliance, flag_key) VALUES (?, ?)");
        foreach ($flagKeys as $key) {
            $stmt->execute([$alliance, $key]);
        }
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
}

function ensureUserActiveCharTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS user_active_char (
            discord_user_id VARCHAR(50) NOT NULL,
            alliance VARCHAR(50) NOT NULL,
            player_id CHAR(36) NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (discord_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function ensureArchiveTables(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS archived_players (
            archive_id CHAR(36) NOT NULL,
            archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            archived_by VARCHAR(50) NULL,
            alliance VARCHAR(50) NOT NULL,
            player_id CHAR(36) NOT NULL,
            current_name VARCHAR(150) NOT NULL,
            current_rank_code INT NOT NULL DEFAULT 3,
            player_created_at DATETIME NULL,
            PRIMARY KEY (archive_id),
            KEY ix_arch_alliance (alliance),
            KEY ix_arch_player_id (player_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS archived_weekly_entries (
            archive_id CHAR(36) NOT NULL,
            entry_id CHAR(36) NOT NULL,
            year_week INT NOT NULL,
            player_id CHAR(36) NOT NULL,
            alliance VARCHAR(50) NOT NULL,
            base_rank_code INT NOT NULL DEFAULT 3,
            final_rank_code INT NOT NULL DEFAULT 3,
            afk TINYINT(1) NOT NULL DEFAULT 0,
            PRIMARY KEY (archive_id, entry_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS archived_entry_flags (
            archive_id CHAR(36) NOT NULL,
            entry_id CHAR(36) NOT NULL,
            flag_key VARCHAR(60) NOT NULL,
            PRIMARY KEY (archive_id, entry_id, flag_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS archived_name_history (
            archive_id CHAR(36) NOT NULL,
            name_event_id CHAR(36) NOT NULL,
            player_id CHAR(36) NOT NULL,
            alliance VARCHAR(50) NOT NULL,
            player_name VARCHAR(150) NOT NULL,
            valid_from_yw INT NOT NULL DEFAULT 0,
            PRIMARY KEY (archive_id, name_event_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS archived_player_identities (
            archive_id CHAR(36) NOT NULL,
            identity_id CHAR(36) NOT NULL,
            player_id CHAR(36) NOT NULL,
            alliance VARCHAR(50) NOT NULL,
            discord_user_id VARCHAR(50) NULL,
            PRIMARY KEY (archive_id, identity_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

// ─── site_admins table ────────────────────────────────────────────────────────

function ensureSiteAdminsTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS site_admins (
            discord_user_id VARCHAR(30)  NOT NULL,
            granted_by      VARCHAR(30)  NOT NULL DEFAULT 'system',
            note            VARCHAR(255) NOT NULL DEFAULT '',
            granted_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (discord_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
}

/** Auto-seed players whose names are in $protectedR4Names as site-admins. */
function seedProtectedAdmins(PDO $pdo, array $protectedNames): void {
    $names = array_keys($protectedNames); // $protectedNames is ['Lion Tooth' => true, ...]
    if (empty($names)) return;
    try {
        $placeholders = implode(',', array_fill(0, count($names), '?'));
        $stmt = $pdo->prepare("
            SELECT COALESCE(pid.discord_user_id, uda.discord_user_id) AS discord_user_id
            FROM players p
            LEFT JOIN player_identities pid
                ON pid.alliance = p.alliance AND pid.player_id = p.player_id
            LEFT JOIN player_user_links pul
                ON pul.alliance = p.alliance AND pul.player_id = p.player_id
            LEFT JOIN user_discord_accounts uda
                ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            WHERE p.current_name IN ($placeholders) AND p.is_active = 1
              AND COALESCE(pid.discord_user_id, uda.discord_user_id) IS NOT NULL
            GROUP BY COALESCE(pid.discord_user_id, uda.discord_user_id)
        ");
        $stmt->execute($names);
        $ins = $pdo->prepare("
            INSERT IGNORE INTO site_admins (discord_user_id, granted_by, note)
            VALUES (?, 'system', 'Auto-seeded from protected R4 names config')
        ");
        foreach ($stmt->fetchAll() as $row) {
            if (!empty($row['discord_user_id'])) {
                $ins->execute([$row['discord_user_id']]);
            }
        }
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
}

// ─── Admin auth helper ────────────────────────────────────────────────────────

function isSiteAdmin(PDO $pdo, string $discordId): bool {
    try {
        $stmt = $pdo->prepare("SELECT 1 FROM site_admins WHERE discord_user_id = ? LIMIT 1");
        $stmt->execute([$discordId]);
        return (bool)$stmt->fetch();
    } catch (\PDOException $e) {
        return false; // table might not exist yet
    }
}

function requireR5(PDO $pdo, string $discordId): array {
    // Local dev-server: bypass auth entirely
    if (isLocalRequest()) {
        return ['player_id' => null, 'current_name' => 'Lokaler Admin', 'current_rank_code' => 5, 'alliance' => null];
    }

    // Site-admins have full access regardless of rank
    if (isSiteAdmin($pdo, $discordId)) {
        // Try to return their player row for context; fall back to stub if not found
        $stmt = $pdo->prepare("
            SELECT p.player_id, p.current_name, p.current_rank_code, p.alliance
            FROM players p
            LEFT JOIN player_identities pid
                ON pid.alliance = p.alliance AND pid.player_id = p.player_id
            LEFT JOIN (
                SELECT pul.alliance, pul.player_id, uda.discord_user_id
                FROM player_user_links pul
                JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
            WHERE p.is_active = 1
              AND COALESCE(pid.discord_user_id, puld.discord_user_id) = ?
            LIMIT 1
        ");
        $stmt->execute([$discordId]);
        $row = $stmt->fetch();
        if ($row) return $row;
        return ['player_id' => null, 'current_name' => null, 'current_rank_code' => 5, 'alliance' => null];
    }

    $stmt = $pdo->prepare("
        SELECT p.player_id, p.current_name, p.current_rank_code, p.alliance
        FROM players p
        LEFT JOIN player_identities pid
            ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        LEFT JOIN (
            SELECT pul.alliance, pul.player_id, uda.discord_user_id
            FROM player_user_links pul
            JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
        ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        WHERE p.is_active = 1 AND p.current_rank_code = 5
          AND COALESCE(pid.discord_user_id, puld.discord_user_id) = ?
        LIMIT 1
    ");
    $stmt->execute([$discordId]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(403, ['error' => 'Kein Zugriff – nur Admins dürfen diesen Bereich nutzen']);
    return $row;
}

// ─── Alliance handlers ────────────────────────────────────────────────────────

function handleGetAlliances(PDO $pdo): never {
    ensureAlliancesTable($pdo);
    $rows = $pdo->query("SELECT alliance AS short_name, alliance_name AS title, created_at FROM alliances ORDER BY alliance")->fetchAll();
    jsonOut(200, ['ok' => true, 'alliances' => $rows]);
}

function handleCreateAlliance(PDO $pdo, array $body): never {
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);

    $shortName = trim($body['short_name'] ?? '');
    if ($shortName === '' || strlen($shortName) > 50) jsonOut(400, ['error' => 'Kürzel fehlt oder zu lang (max 50)']);
    $title = trim($body['title'] ?? '') ?: null;

    ensureAlliancesTable($pdo);
    try {
        $pdo->prepare("INSERT INTO alliances (alliance, alliance_name) VALUES (?, ?)")->execute([$shortName, $title]);
    } catch (\PDOException $e) {
        if ($e->getCode() === '23000') jsonOut(409, ['error' => 'Allianz existiert bereits']);
        throw $e;
    }
    // Seed ranks 1–5 for the new alliance
    try {
        for ($r = 1; $r <= 5; $r++) {
            $pdo->prepare("INSERT IGNORE INTO ranks (alliance, rank_code) VALUES (?, ?)")->execute([$shortName, $r]);
        }
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
    // Seed flag_keys for the new alliance
    seedFlagsForAlliance($pdo, $shortName);
    jsonOut(201, ['ok' => true, 'short_name' => $shortName]);
}

function handleUpdateAlliance(PDO $pdo, string $oldShortEncoded, array $body): never {
    $oldShort = rawurldecode($oldShortEncoded);
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);

    ensureAlliancesTable($pdo);
    $stmt = $pdo->prepare("SELECT alliance AS short_name, alliance_name AS title FROM alliances WHERE alliance = ?");
    $stmt->execute([$oldShort]);
    $existing = $stmt->fetch();
    if (!$existing) jsonOut(404, ['error' => 'Allianz nicht gefunden']);

    $newShort  = trim($body['short_name'] ?? $oldShort);
    $titleSet  = array_key_exists('title', $body);
    $newTitle  = $titleSet ? (trim($body['title'] ?? '') ?: null) : ($existing['title'] ?? null);

    if ($newShort === $oldShort && !$titleSet) jsonOut(400, ['error' => 'Keine Änderungen angegeben']);

    $pdo->beginTransaction();
    try {
        if ($newShort !== $oldShort) {
            // Disable FK checks so we can migrate tables in any order
            $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
            // Create new alliance entry
            try {
                $pdo->prepare("INSERT INTO alliances (alliance, alliance_name) VALUES (?, ?)")->execute([$newShort, $newTitle]);
            } catch (\PDOException $e) {
                $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
                if ($e->getCode() === '23000') {
                    if ($pdo->inTransaction()) $pdo->rollBack();
                    jsonOut(409, ['error' => 'Allianz-Kürzel bereits vergeben']);
                }
                throw $e;
            }
            // Migrate all tables
            $tables = [
                'players', 'weekly_entries', 'weekly_entry_flags', 'player_name_history',
                'player_identities', 'player_user_links', 'user_discord_accounts',
                'rank_change_log', 'access_requests', 'discord_profile_cache',
                'member_presence', 'member_chat_messages', 'week_periods',
                'archived_players', 'user_active_char',
            ];
            foreach ($tables as $tbl) {
                try {
                    $pdo->prepare("UPDATE `{$tbl}` SET alliance = ? WHERE alliance = ?")->execute([$newShort, $oldShort]);
                } catch (\PDOException $e) {
                    if (!isOptionalTableError($e)) throw $e;
                }
            }
            $pdo->prepare("DELETE FROM alliances WHERE alliance = ?")->execute([$oldShort]);
            $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
        } else {
            $pdo->prepare("UPDATE alliances SET alliance_name = ? WHERE alliance = ?")->execute([$newTitle, $oldShort]);
        }
        $pdo->commit();
        jsonOut(200, ['ok' => true, 'short_name' => $newShort, 'title' => $newTitle]);
    } catch (\PDOException $e) {
        try { $pdo->exec('SET FOREIGN_KEY_CHECKS=1'); } catch (\Throwable) {}
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

// ─── Site-admin management handlers ──────────────────────────────────────────

function handleGetAdmins(PDO $pdo, string $discordId): never {
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);
    ensureSiteAdminsTable($pdo);

    $stmt = $pdo->query("
        SELECT sa.discord_user_id, sa.granted_by, sa.note, sa.granted_at,
               dpc.discord_username AS username, dpc.discord_avatar AS avatar
        FROM site_admins sa
        LEFT JOIN discord_profile_cache dpc ON dpc.discord_user_id = sa.discord_user_id
        ORDER BY sa.granted_at
    ");
    $rows = $stmt->fetchAll();

    // Also resolve each admin's player name if possible
    $admins = [];
    foreach ($rows as $r) {
        $pStmt = $pdo->prepare("
            SELECT p.current_name, p.alliance, p.current_rank_code
            FROM players p
            LEFT JOIN player_identities pid
                ON pid.alliance = p.alliance AND pid.player_id = p.player_id
            LEFT JOIN (
                SELECT pul.alliance, pul.player_id, uda.discord_user_id
                FROM player_user_links pul
                JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
            WHERE p.is_active = 1
              AND COALESCE(pid.discord_user_id, puld.discord_user_id) = ?
            LIMIT 1
        ");
        $pStmt->execute([$r['discord_user_id']]);
        $player = $pStmt->fetch() ?: null;
        $admins[] = [
            'discord_user_id' => $r['discord_user_id'],
            'username'        => $r['username'],
            'avatar'          => $r['avatar'],
            'granted_by'      => $r['granted_by'],
            'note'            => $r['note'],
            'granted_at'      => $r['granted_at'],
            'player_name'     => $player['current_name'] ?? null,
            'alliance'        => $player['alliance'] ?? null,
            'rank'            => $player ? (int)$player['current_rank_code'] : null,
        ];
    }

    jsonOut(200, ['ok' => true, 'admins' => $admins]);
}

function handleGrantAdmin(PDO $pdo, array $body): never {
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);
    ensureSiteAdminsTable($pdo);

    $note = trim($body['note'] ?? '');

    // Accept either a direct discord_id or a player name
    $targetDiscordId = '';
    if (!empty($body['target_discord_id'])) {
        try { $targetDiscordId = normalizeDiscordId($body['target_discord_id']); }
        catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => 'Ungültige Ziel-Discord-ID: ' . $e->getMessage()]); }
    } elseif (!empty($body['target_player_name'])) {
        $name = trim($body['target_player_name']);
        $stmt = $pdo->prepare("
            SELECT COALESCE(pid.discord_user_id, uda.discord_user_id) AS discord_user_id
            FROM players p
            LEFT JOIN player_identities pid
                ON pid.alliance = p.alliance AND pid.player_id = p.player_id
            LEFT JOIN player_user_links pul
                ON pul.alliance = p.alliance AND pul.player_id = p.player_id
            LEFT JOIN user_discord_accounts uda
                ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            WHERE p.current_name = ? AND p.is_active = 1
              AND COALESCE(pid.discord_user_id, uda.discord_user_id) IS NOT NULL
            LIMIT 1
        ");
        $stmt->execute([$name]);
        $row = $stmt->fetch();
        if (!$row || empty($row['discord_user_id'])) {
            jsonOut(404, ['error' => "Spieler \"$name\" nicht gefunden oder hat kein Discord-Konto verknüpft"]);
        }
        $targetDiscordId = $row['discord_user_id'];
    } else {
        jsonOut(400, ['error' => 'target_discord_id oder target_player_name erforderlich']);
    }

    $ins = $pdo->prepare("
        INSERT INTO site_admins (discord_user_id, granted_by, note)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE granted_by = VALUES(granted_by), note = VALUES(note), granted_at = CURRENT_TIMESTAMP
    ");
    $ins->execute([$targetDiscordId, $discordId, $note]);

    jsonOut(200, ['ok' => true, 'target_discord_id' => $targetDiscordId]);
}

function handleRevokeAdmin(PDO $pdo, string $targetEncoded, array $body): never {
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);
    ensureSiteAdminsTable($pdo);

    $target = urldecode($targetEncoded);
    try { $target = normalizeDiscordId($target); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => 'Ungültige Ziel-Discord-ID']); }

    if ($target === $discordId) {
        jsonOut(400, ['error' => 'Du kannst dir selbst nicht den Admin-Status entziehen']);
    }

    $stmt = $pdo->prepare("DELETE FROM site_admins WHERE discord_user_id = ?");
    $stmt->execute([$target]);

    jsonOut(200, ['ok' => true, 'revoked' => $target]);
}

// ─── Archive handlers ─────────────────────────────────────────────────────────

function handleGetArchivedPlayers(PDO $pdo, string $discordId): never {
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);
    ensureArchiveTables($pdo);

    $alliance = strtoupper(trim($_GET['alliance'] ?? ''));
    if ($alliance !== '') {
        $stmt = $pdo->prepare("SELECT * FROM archived_players WHERE alliance = ? ORDER BY archived_at DESC");
        $stmt->execute([$alliance]);
    } else {
        $stmt = $pdo->query("SELECT * FROM archived_players ORDER BY archived_at DESC LIMIT 500");
    }
    jsonOut(200, ['ok' => true, 'players' => $stmt->fetchAll()]);
}

function handleRestorePlayer(PDO $pdo, string $archiveIdEncoded, array $body): never {
    $archiveId = rawurldecode($archiveIdEncoded);
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);

    ensureArchiveTables($pdo);
    $stmt = $pdo->prepare("SELECT * FROM archived_players WHERE archive_id = ?");
    $stmt->execute([$archiveId]);
    $archived = $stmt->fetch();
    if (!$archived) jsonOut(404, ['error' => 'Archivierter Spieler nicht gefunden']);

    $check = $pdo->prepare("SELECT 1 FROM players WHERE alliance = ? AND current_name = ? LIMIT 1");
    $check->execute([$archived['alliance'], $archived['current_name']]);
    if ($check->fetch()) jsonOut(409, ['error' => 'Name wird bereits von einem aktiven Spieler verwendet']);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO players (alliance, player_id, current_name, current_rank_code, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)")
            ->execute([$archived['alliance'], $archived['player_id'], $archived['current_name'], $archived['current_rank_code'], $archived['player_created_at']]);

        $entries = $pdo->prepare("SELECT * FROM archived_weekly_entries WHERE archive_id = ?");
        $entries->execute([$archiveId]);
        foreach ($entries->fetchAll() as $entry) {
            try {
                $pdo->prepare("INSERT IGNORE INTO weekly_entries (alliance, entry_id, year_week, player_id, base_rank_code, final_rank_code, afk) VALUES (?, ?, ?, ?, ?, ?, ?)")
                    ->execute([$entry['alliance'], $entry['entry_id'], $entry['year_week'], $entry['player_id'], $entry['base_rank_code'], $entry['final_rank_code'], $entry['afk']]);
                $flags = $pdo->prepare("SELECT flag_key FROM archived_entry_flags WHERE archive_id = ? AND entry_id = ?");
                $flags->execute([$archiveId, $entry['entry_id']]);
                foreach ($flags->fetchAll() as $flag) {
                    $pdo->prepare("INSERT IGNORE INTO weekly_entry_flags (alliance, entry_id, flag_key) VALUES (?, ?, ?)")
                        ->execute([$entry['alliance'], $entry['entry_id'], $flag['flag_key']]);
                }
            } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        }

        $history = $pdo->prepare("SELECT * FROM archived_name_history WHERE archive_id = ?");
        $history->execute([$archiveId]);
        foreach ($history->fetchAll() as $h) {
            try {
                $pdo->prepare("INSERT IGNORE INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, ?)")
                    ->execute([$h['alliance'], $h['name_event_id'], $h['player_id'], $h['player_name'], $h['valid_from_yw']]);
            } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        }

        $ids = $pdo->prepare("SELECT * FROM archived_player_identities WHERE archive_id = ?");
        $ids->execute([$archiveId]);
        foreach ($ids->fetchAll() as $id) {
            try {
                $pdo->prepare("INSERT IGNORE INTO player_identities (alliance, identity_id, player_id, discord_user_id) VALUES (?, ?, ?, ?)")
                    ->execute([$id['alliance'], $id['identity_id'], $id['player_id'], $id['discord_user_id']]);
            } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        }

        $pdo->prepare("DELETE FROM archived_entry_flags WHERE archive_id = ?")->execute([$archiveId]);
        $pdo->prepare("DELETE FROM archived_weekly_entries WHERE archive_id = ?")->execute([$archiveId]);
        $pdo->prepare("DELETE FROM archived_name_history WHERE archive_id = ?")->execute([$archiveId]);
        $pdo->prepare("DELETE FROM archived_player_identities WHERE archive_id = ?")->execute([$archiveId]);
        $pdo->prepare("DELETE FROM archived_players WHERE archive_id = ?")->execute([$archiveId]);

        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

// ─── My-chars handlers ────────────────────────────────────────────────────────

function handleGetMyChars(PDO $pdo, string $discordId): never {
    if ($discordId === '') jsonOut(400, ['error' => 'Discord-ID fehlt']);

    ensureUserActiveCharTable($pdo);
    $activeStmt = $pdo->prepare("SELECT alliance, player_id FROM user_active_char WHERE discord_user_id = ?");
    $activeStmt->execute([$discordId]);
    $activeRow = $activeStmt->fetch() ?: null;

    $chars = [];
    try {
        $stmt = $pdo->prepare("
            SELECT p.player_id, p.alliance, p.current_name, p.current_rank_code,
                   pid.discord_user_id AS via_identity,
                   puld.discord_user_id AS via_account
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
        $stmt->execute([$discordId, $discordId]);
        $rows = $stmt->fetchAll();
        foreach ($rows as $p) {
            $isActive = $activeRow
                && $activeRow['player_id'] === $p['player_id']
                && $activeRow['alliance']   === $p['alliance'];
            $chars[] = [
                'player_id' => $p['player_id'],
                'alliance'  => $p['alliance'],
                'name'      => $p['current_name'],
                'rank'      => safeRank((int)$p['current_rank_code']),
                'role'      => roleFromRank(safeRank((int)$p['current_rank_code'])),
                'is_active' => $isActive,
            ];
        }
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }

    jsonOut(200, ['ok' => true, 'chars' => $chars, 'active' => $activeRow, 'is_site_admin' => isSiteAdmin($pdo, $discordId)]);
}

function handleSetActiveChar(PDO $pdo, array $body): never {
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);

    $alliance = trim($body['alliance'] ?? '');
    $playerId = trim($body['player_id'] ?? '');
    if ($alliance === '' || $playerId === '') jsonOut(400, ['error' => 'alliance und player_id erforderlich']);

    $stmt = $pdo->prepare("
        SELECT p.player_id FROM players p
        LEFT JOIN player_identities pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        LEFT JOIN (
            SELECT pul.alliance, pul.player_id, uda.discord_user_id
            FROM player_user_links pul
            JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
        ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        WHERE p.alliance = ? AND p.player_id = ? AND p.is_active = 1
          AND COALESCE(pid.discord_user_id, puld.discord_user_id) = ?
        LIMIT 1
    ");
    $stmt->execute([$alliance, $playerId, $discordId]);
    if (!$stmt->fetch()) jsonOut(403, ['error' => 'Charakter nicht gefunden oder kein Zugriff']);

    ensureUserActiveCharTable($pdo);
    $pdo->prepare("
        INSERT INTO user_active_char (discord_user_id, alliance, player_id)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE alliance = VALUES(alliance), player_id = VALUES(player_id)
    ")->execute([$discordId, $alliance, $playerId]);

    jsonOut(200, ['ok' => true]);
}

// ─── Self-rename / name-history handlers ─────────────────────────────────────

function handleSelfRename(PDO $pdo, string $alliance, string $oldNameEncoded, array $body): never {
    $oldName = rawurldecode($oldNameEncoded);
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);

    $newName = trim($body['new_name'] ?? '');
    if ($newName === '') jsonOut(400, ['error' => 'Neuer Name fehlt']);

    // Find the player by name and verify the discord_id owns this char
    $stmt = $pdo->prepare("
        SELECT p.player_id, p.current_name, p.current_rank_code
        FROM players p
        JOIN player_identities pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        WHERE p.alliance = ? AND LOWER(TRIM(p.current_name)) = LOWER(TRIM(?))
          AND pid.discord_user_id = ? AND p.is_active = 1
        LIMIT 1
    ");
    $stmt->execute([$alliance, $oldName, $discordId]);
    $member = $stmt->fetch();
    if (!$member) {
        jsonOut(403, ['error' => 'Kein Zugriff auf diesen Charakter']);
    }

    $playerId = $member['player_id'];
    $check = $pdo->prepare("SELECT 1 FROM players WHERE alliance = ? AND LOWER(TRIM(current_name)) = LOWER(TRIM(?)) AND player_id <> ? LIMIT 1");
    $check->execute([$alliance, $newName, $playerId]);
    if ($check->fetch()) jsonOut(409, ['error' => 'Name bereits vergeben']);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("UPDATE players SET current_name = ? WHERE alliance = ? AND player_id = ?")
            ->execute([$newName, $alliance, $playerId]);
        $pdo->prepare("INSERT IGNORE INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, 0)")
            ->execute([$alliance, uuid4(), $playerId, $newName]);
        try {
            $pdo->prepare("UPDATE member_presence SET member_name = ? WHERE alliance = ? AND member_name = ?")
                ->execute([$newName, $alliance, $oldName]);
        } catch (\PDOException $e) {}
        $pdo->commit();
        jsonOut(200, ['ok' => true, 'new_name' => $newName]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function handleGetNameHistory(PDO $pdo, string $alliance, string $nameEncoded): never {
    $name = rawurldecode($nameEncoded);
    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $name]);
    $player = $stmt->fetch();
    if (!$player) jsonOut(404, ['error' => 'Spieler nicht gefunden']);

    $history = [];
    try {
        $hStmt = $pdo->prepare("SELECT player_name, valid_from_yw FROM player_name_history WHERE alliance = ? AND player_id = ? ORDER BY valid_from_yw DESC, player_name");
        $hStmt->execute([$alliance, $player['player_id']]);
        $history = $hStmt->fetchAll();
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
    jsonOut(200, ['ok' => true, 'name' => $player['current_name'], 'rank' => (int)$player['current_rank_code'], 'history' => $history]);
}

// ─── Main dispatch ────────────────────────────────────────────────────────────
try {
    if (empty($DB_HOST) || empty($DB_NAME) || empty($DB_USER)) {
        jsonOut(500, ['error' => 'Datenbank nicht konfiguriert. Bitte config.php anlegen.']);
    }

    $pdo = openDb($DB_HOST, $DB_PORT, $DB_NAME, $DB_USER, $DB_PASS, $DB_SSL_CA);
    ensureRankChangeLogTable($pdo, $ALLIANCE);
    ensureAlliancesTable($pdo);
    upsertAllianceFromConfig($pdo, $ALLIANCE);
    ensureSiteAdminsTable($pdo);
    seedProtectedAdmins($pdo, $PROTECTED_R4_NAMES);
    enforceProtectedRanks($pdo, $ALLIANCE, $PROTECTED_R4_NAMES);
    // One-time migration: drop unique constraint that prevented multiple chars per Discord account
    try {
        $pdo->exec("ALTER TABLE player_identities DROP INDEX uq_player_discord");
    } catch (\PDOException) { /* already dropped or doesn't exist */ }

    // Allow the frontend to request a specific alliance context via ?alliance=
    if (isset($_GET['alliance']) && trim($_GET['alliance']) !== '') {
        $ALLIANCE = trim($_GET['alliance']);
    }

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

    // presence
    if ($method === 'GET' && $path === '/presence') {
        handlePresenceList($pdo, $ALLIANCE);
    }
    if ($method === 'POST' && $path === '/presence') {
        handlePresencePing($pdo, $ALLIANCE, $body);
    }

    // chat
    if ($method === 'GET' && $path === '/chat') {
        handleGetChat($pdo, $ALLIANCE);
    }
    if ($method === 'POST' && $path === '/chat') {
        handlePostChat($pdo, $ALLIANCE, $body);
    }
    if ($method === 'DELETE' && count($segments) === 2 && $segments[0] === 'chat') {
        handleDeleteChatMessage($pdo, $ALLIANCE, $segments[1], $body);
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

    // POST /members/{name}/transfer  – move player to another alliance
    if ($method === 'POST' && count($segments) === 3 && $segments[0] === 'members' && $segments[2] === 'transfer') {
        handleTransferPlayer($pdo, $ALLIANCE, $segments[1], $body);
    }

    // DELETE /members/{name}
    if ($method === 'DELETE' && count($segments) === 2 && $segments[0] === 'members') {
        handleDeleteMember($pdo, $ALLIANCE, $segments[1], $body);
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

    // GET /se-inactive?weeks=4  → Spieler ohne SE-Teilnahme in den letzten N Wochen (und nicht AFK)
    if ($method === 'GET' && count($segments) === 1 && $segments[0] === 'se-inactive') {
        handleGetSeInactive($pdo, $ALLIANCE);
    }

    // GET /ranking-history?weeks=4  → Verlauf der letzten N Wochen je Spieler (für Ergebnis-Sheet)
    if ($method === 'GET' && count($segments) === 1 && $segments[0] === 'ranking-history') {
        handleGetRankingHistory($pdo, $ALLIANCE);
    }

    // POST /apply-rank-change  → Rang manuell anwenden (mit Bestätigung)
    if ($method === 'POST' && count($segments) === 1 && $segments[0] === 'apply-rank-change') {
        handleApplyRankChange($pdo, $ALLIANCE, $body, $PROTECTED_R4_NAMES);
    }

    // GET /alliances
    if ($method === 'GET' && $path === '/alliances') {
        handleGetAlliances($pdo);
    }
    // POST /alliances
    if ($method === 'POST' && $path === '/alliances') {
        handleCreateAlliance($pdo, $body);
    }
    // PUT /alliances/{short_name}
    if ($method === 'PUT' && count($segments) === 2 && $segments[0] === 'alliances') {
        handleUpdateAlliance($pdo, $segments[1], $body);
    }

    // GET /archived-players
    if ($method === 'GET' && $path === '/archived-players') {
        $dId = '';
        try { $dId = normalizeDiscordId($_GET['discord_id'] ?? ''); } catch (\InvalidArgumentException) {}
        handleGetArchivedPlayers($pdo, $dId);
    }
    // POST /archived-players/{archive_id}/restore
    if ($method === 'POST' && count($segments) === 3 && $segments[0] === 'archived-players' && $segments[2] === 'restore') {
        handleRestorePlayer($pdo, $segments[1], $body);
    }

    // GET /admins
    if ($method === 'GET' && $path === '/admins') {
        $dId = '';
        try { $dId = normalizeDiscordId($_GET['discord_id'] ?? ''); } catch (\InvalidArgumentException) {}
        handleGetAdmins($pdo, $dId);
    }
    // POST /admins
    if ($method === 'POST' && $path === '/admins') {
        handleGrantAdmin($pdo, $body);
    }
    // DELETE /admins/{discord_id}
    if ($method === 'DELETE' && count($segments) === 2 && $segments[0] === 'admins') {
        handleRevokeAdmin($pdo, $segments[1], $body);
    }

    // GET /my-chars
    if ($method === 'GET' && $path === '/my-chars') {
        $dId = '';
        try { $dId = normalizeDiscordId($_GET['discord_id'] ?? ''); } catch (\InvalidArgumentException) {}
        handleGetMyChars($pdo, $dId);
    }
    // POST /my-chars/active
    if ($method === 'POST' && $path === '/my-chars/active') {
        handleSetActiveChar($pdo, $body);
    }

    // POST /members/{name}/self-rename
    if ($method === 'POST' && count($segments) === 3 && $segments[0] === 'members' && $segments[2] === 'self-rename') {
        handleSelfRename($pdo, $ALLIANCE, $segments[1], $body);
    }
    // GET /members/{name}/name-history
    if ($method === 'GET' && count($segments) === 3 && $segments[0] === 'members' && $segments[2] === 'name-history') {
        handleGetNameHistory($pdo, $ALLIANCE, $segments[1]);
    }

    jsonOut(404, ['error' => "Route not found: {$method} {$path}"]);

} catch (\Throwable $e) {
    jsonOut(500, ['error' => $e->getMessage()]);
}
