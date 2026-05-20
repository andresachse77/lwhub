<?php
declare(strict_types=1);

// ─── Config ───────────────────────────────────────────────────────────────────
$configFile = __DIR__ . '/../config.php';
if (file_exists($configFile)) {
    require $configFile;
}

$ALLIANCE           = getenv('INY_ALLIANCE') ?: (defined('INY_ALLIANCE') ? INY_ALLIANCE : 'INY');

$DB_HOST   = getenv('MYSQL_HOST')     ?: (defined('MYSQL_HOST')     ? MYSQL_HOST     : '');
$DB_PORT   = (int)(getenv('MYSQL_PORT') ?: (defined('MYSQL_PORT')   ? MYSQL_PORT     : 3306));
$DB_NAME   = getenv('MYSQL_DATABASE') ?: (defined('MYSQL_DATABASE') ? MYSQL_DATABASE : '');
$DB_USER   = getenv('MYSQL_USER')     ?: (defined('MYSQL_USER')     ? MYSQL_USER     : '');
$DB_PASS   = getenv('MYSQL_PASSWORD') ?: (defined('MYSQL_PASSWORD') ? MYSQL_PASSWORD : '');
$DB_SSL_CA = getenv('MYSQL_SSL_CA')   ?: (defined('MYSQL_SSL_CA')   ? MYSQL_SSL_CA   : '');

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

// ─── Modules ──────────────────────────────────────────────────────────────────
// helpers.php must be first — it defines parseProtectedR4Names() used above
require_once __DIR__ . '/src/helpers.php';

$PROTECTED_R4_NAMES = parseProtectedR4Names(getenv('INY_PROTECTED_R4_NAMES') ?: (defined('INY_PROTECTED_R4_NAMES') ? INY_PROTECTED_R4_NAMES : 'Lion Tooth'));

require_once __DIR__ . '/src/db-setup.php';
require_once __DIR__ . '/src/auth.php';
require_once __DIR__ . '/src/alliance.php';
require_once __DIR__ . '/src/presence-chat.php';
require_once __DIR__ . '/src/members.php';
require_once __DIR__ . '/src/entries.php';
require_once __DIR__ . '/src/access-requests.php';
require_once __DIR__ . '/src/admin.php';
require_once __DIR__ . '/src/archive.php';
require_once __DIR__ . '/src/my-chars.php';
require_once __DIR__ . '/src/zug.php';

// ─── Route parsing ────────────────────────────────────────────────────────────
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$scriptDir  = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/');
$path       = parse_url($requestUri, PHP_URL_PATH) ?? '/';
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
    ensurePreferredLanguageColumn($pdo);
    seedProtectedAdmins($pdo, $PROTECTED_R4_NAMES);
    enforceProtectedRanks($pdo, $ALLIANCE, $PROTECTED_R4_NAMES);
    try {
        $pdo->exec("ALTER TABLE player_identities DROP INDEX uq_player_discord");
    } catch (\PDOException) { /* already dropped or doesn't exist */ }

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

    // GET /tab-html
    if ($method === 'GET' && $path === '/tab-html') {
        handleTabHtml($pdo, $ALLIANCE);
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

    // PUT /members/{name}/beruf
    if ($method === 'PUT' && count($segments) === 3 && $segments[0] === 'members' && $segments[2] === 'beruf') {
        handleSaveMemberBeruf($pdo, $ALLIANCE, $segments[1], $body);
    }

    // PUT /members/{name}/language
    if ($method === 'PUT' && count($segments) === 3 && $segments[0] === 'members' && $segments[2] === 'language') {
        handleSetMemberLanguage($pdo, $ALLIANCE, $segments[1], $body);
    }

    // PUT /members/{name}
    if ($method === 'PUT' && count($segments) === 2 && $segments[0] === 'members') {
        handleUpdateMember($pdo, $ALLIANCE, $segments[1], $body, $PROTECTED_R4_NAMES);
    }

    // POST /members/{name}/transfer
    if ($method === 'POST' && count($segments) === 3 && $segments[0] === 'members' && $segments[2] === 'transfer') {
        handleTransferPlayer($pdo, $ALLIANCE, $segments[1], $body);
    }

    // DELETE /members/{name}
    if ($method === 'DELETE' && count($segments) === 2 && $segments[0] === 'members') {
        handleDeleteMember($pdo, $ALLIANCE, $segments[1], $body);
    }

    // access-requests
    if ($segments[0] === 'access-requests') {
        if ($method === 'GET'  && count($segments) === 1) handleListAccessRequests($pdo, $ALLIANCE);
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

    // GET /se-inactive
    if ($method === 'GET' && count($segments) === 1 && $segments[0] === 'se-inactive') {
        handleGetSeInactive($pdo, $ALLIANCE);
    }

    // GET /ranking-history
    if ($method === 'GET' && count($segments) === 1 && $segments[0] === 'ranking-history') {
        handleGetRankingHistory($pdo, $ALLIANCE);
    }

    // POST /apply-rank-change
    if ($method === 'POST' && count($segments) === 1 && $segments[0] === 'apply-rank-change') {
        handleApplyRankChange($pdo, $ALLIANCE, $body, $PROTECTED_R4_NAMES);
    }

    // GET /alliance-config
    if ($method === 'GET' && $path === '/alliance-config') {
        handleGetAllianceConfig($pdo, $ALLIANCE);
    }
    // POST /alliance-config
    if ($method === 'POST' && $path === '/alliance-config') {
        handleSetAllianceConfig($pdo, $ALLIANCE, $body);
    }

    // GET /alliances
    if ($method === 'GET' && $path === '/alliances') {
        handleGetAlliances($pdo);
    }
    // GET /alliances/open
    if ($method === 'GET' && $path === '/alliances/open') {
        handleGetOpenAlliances($pdo);
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

    // ─── Zug-Scheduler routes ─────────────────────────────────────────────────
    if (count($segments) >= 2 && $segments[0] === 'zug') {
        ensureZugTables($pdo, $ALLIANCE);
        $zugSub   = $segments[1] ?? '';
        $zugId    = rawurldecode($segments[2] ?? '');
        $zugExtra = $segments[3] ?? '';

        if ($method === 'GET'    && $zugSub === 'rulesets' && $zugId === '')   handleGetZugRulesets($pdo, $ALLIANCE);
        if ($method === 'POST'   && $zugSub === 'rulesets' && $zugId === '')   { requireZugR4($pdo, $ALLIANCE, $body); handleSaveZugRuleset($pdo, $ALLIANCE, $body); }
        if ($method === 'DELETE' && $zugSub === 'rulesets' && $zugId !== '')   { requireZugR4($pdo, $ALLIANCE, $body); handleDeleteZugRuleset($pdo, $ALLIANCE, $zugId); }
        if ($method === 'GET'    && $zugSub === 'queue'    && $zugId === '')   handleGetZugQueue($pdo, $ALLIANCE);
        if ($method === 'POST'   && $zugSub === 'queue'    && $zugId === 'sync')    { requireZugR4($pdo, $ALLIANCE, $body); handleSyncZugQueue($pdo, $ALLIANCE, $body); }
        if ($method === 'POST'   && $zugSub === 'queue'    && $zugId === 'reorder') { requireZugR4($pdo, $ALLIANCE, $body); handleReorderZugQueue($pdo, $ALLIANCE, $body); }
        if ($method === 'GET'    && $zugSub === 'schedule' && $zugId === '')   handleGetZugSchedule($pdo, $ALLIANCE);
        if ($method === 'POST'   && $zugSub === 'schedule' && $zugId === 'swap')    { requireZugR4($pdo, $ALLIANCE, $body); handleSwapZugSchedule($pdo, $ALLIANCE, $body); }
        if ($method === 'POST'   && $zugSub === 'schedule' && $zugId === '')   { requireZugR4($pdo, $ALLIANCE, $body); handleCreateZugSchedule($pdo, $ALLIANCE, $body); }
        if ($method === 'PUT'    && $zugSub === 'schedule' && $zugId !== '' && $zugExtra === '') { requireZugR4($pdo, $ALLIANCE, $body); handleUpdateZugSchedule($pdo, $ALLIANCE, $zugId, $body); }
        if ($method === 'DELETE' && $zugSub === 'schedule' && $zugId !== '' && $zugExtra === '') { requireZugR4($pdo, $ALLIANCE, $body); handleDeleteZugSchedule($pdo, $ALLIANCE, $zugId); }
        if ($method === 'POST'   && $zugSub === 'schedule' && $zugId !== '' && $zugExtra === 'noshow') { requireZugR4($pdo, $ALLIANCE, $body); handleNoShowZugSchedule($pdo, $ALLIANCE, $zugId, $body); }
        if ($method === 'GET'    && $zugSub === 'suggest')  handleGetZugSuggest($pdo, $ALLIANCE);
        if ($method === 'GET'    && $zugSub === 'my-turns') handleGetZugMyTurns($pdo, $ALLIANCE);
        jsonOut(404, ['error' => "Zug-Route nicht gefunden: {$method} {$path}"]);
    }

    jsonOut(404, ['error' => "Route not found: {$method} {$path}"]);

} catch (\Throwable $e) {
    jsonOut(500, ['error' => $e->getMessage()]);
}