<?php
declare(strict_types=1);

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

function ensureBerufColumns(PDO $pdo): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    foreach ([
        "ALTER TABLE players ADD COLUMN beruf VARCHAR(20) NULL DEFAULT NULL",
        "ALTER TABLE players ADD COLUMN beruf_med_hilfe TINYINT(1) NOT NULL DEFAULT 0",
        "ALTER TABLE players ADD COLUMN beruf_winwin VARCHAR(150) NULL DEFAULT NULL",
    ] as $sql) {
        try { $pdo->exec($sql); } catch (\PDOException) {}
    }
}

function ensurePreferredLanguageColumn(PDO $pdo): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    try {
        $pdo->exec("ALTER TABLE players ADD COLUMN preferred_language VARCHAR(8) NOT NULL DEFAULT 'de'");
    } catch (\PDOException) {
        // Spalte existiert bereits – ignorieren
    }
}

function ensureHonorRoleColumn(PDO $pdo): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    try {
        $pdo->exec("ALTER TABLE players ADD COLUMN honor_role VARCHAR(20) NULL DEFAULT NULL");
    } catch (\PDOException) {
        // Spalte existiert bereits – ignorieren
    }
    // Heimat-Allianz eines Ehren-Eintrags (Freitext oder Kuerzel aus alliances)
    try {
        $pdo->exec("ALTER TABLE players ADD COLUMN honor_home VARCHAR(50) NULL DEFAULT NULL AFTER honor_role");
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

function ensureScannerColumns(PDO $pdo): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    foreach ([
        "ALTER TABLE players ADD COLUMN current_power BIGINT NULL DEFAULT NULL",
        "ALTER TABLE players ADD COLUMN hq_level TINYINT NULL DEFAULT NULL",
        "ALTER TABLE players ADD COLUMN last_scanned_at DATETIME NULL DEFAULT NULL",
        "ALTER TABLE players ADD COLUMN last_seen_status VARCHAR(100) NULL DEFAULT NULL",
    ] as $sql) {
        try { $pdo->exec($sql); } catch (\PDOException) {}
    }
}

function ensurePlayerMetricsTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS player_metrics (
            metric_id CHAR(36) NOT NULL,
            alliance VARCHAR(50) NOT NULL,
            player_id CHAR(36) NOT NULL,
            metric_type VARCHAR(40) NOT NULL,
            value_numeric BIGINT NULL,
            value_text VARCHAR(255) NULL,
            extra_json JSON NULL,
            source VARCHAR(50) NOT NULL,
            recorded_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, metric_id),
            KEY ix_metrics_player (alliance, player_id, metric_type, recorded_at),
            KEY ix_metrics_type_time (alliance, metric_type, recorded_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function ensureApiTokensTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS api_tokens (
            token_id CHAR(36) NOT NULL,
            alliance VARCHAR(50) NOT NULL,
            token_hash VARCHAR(128) NOT NULL,
            client_name VARCHAR(100) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'scanner',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            PRIMARY KEY (token_id),
            KEY ix_token_hash (token_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

// Konzept v2: Spalten nachruesten, alles nullable, damit der bestehende Sync-INSERT weiter funktioniert
function ensureScannerV2Columns(PDO $pdo): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    foreach ([
        "ALTER TABLE player_metrics ADD COLUMN scan_id CHAR(36) NULL DEFAULT NULL",
        "ALTER TABLE player_metrics ADD COLUMN year_week INT NULL DEFAULT NULL",
        "ALTER TABLE player_metrics ADD COLUMN game_day TINYINT NULL DEFAULT NULL",
        "ALTER TABLE player_metrics ADD COLUMN read_status VARCHAR(20) NULL DEFAULT NULL",
        "ALTER TABLE player_metrics ADD COLUMN observations SMALLINT NULL DEFAULT NULL",
        "ALTER TABLE player_metrics ADD KEY ix_metrics_scan (alliance, scan_id)",
        "ALTER TABLE player_metrics ADD KEY ix_metrics_week (alliance, metric_type, year_week)",
        "ALTER TABLE api_tokens ADD COLUMN created_by VARCHAR(50) NULL DEFAULT NULL",
        "ALTER TABLE api_tokens ADD COLUMN expires_at DATETIME NULL DEFAULT NULL",
        "ALTER TABLE api_tokens ADD UNIQUE KEY uq_token_hash (token_hash)",
    ] as $sql) {
        try { $pdo->exec($sql); } catch (\PDOException) {}
    }
}

// VS und Spenden: genau ein Wert je Spieler, Woche und Tag, es zaehlt der hoechste (POWER/KILLS: jeder Scan
// ein eigener Messpunkt, daher nicht dabei)
const METRIC_MAX_TYPES = ['VS_DAY', 'VS_WEEK', 'DONATION_DAY', 'DONATION_WEEK'];

// 20.10.: UNIQUE fuer METRIC_MAX_TYPES. Ohne ihn fanden zwei gleichzeitige Syncs (App + Web-Scanner) per SELECT
// beide keinen Wert und legten je eine Zeile an. value_day ist nur bei diesen Typen gefuellt (Wochenwerte: 0,
// weil MySQL mehrere NULL im UNIQUE erlaubt), bei allen anderen NULL – dort bleiben mehrere Zeilen erlaubt.
// Vorher bestehende Doppel bereinigen: der hoechste Wert bleibt. Schlaegt das ALTER fehl (z. B. neues Doppel
// dazwischen), versucht es die naechste Anfrage erneut.
function ensureMetricsValueKey(PDO $pdo): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    if ($pdo->query("SHOW INDEX FROM player_metrics WHERE Key_name = 'uq_metrics_value'")->fetch()) return;
    $types = "'" . implode("', '", METRIC_MAX_TYPES) . "'";
    try {
        $pdo->exec("
            DELETE m FROM player_metrics m
            JOIN player_metrics k ON k.alliance = m.alliance AND k.player_id = m.player_id AND k.metric_type = m.metric_type
                AND k.year_week = m.year_week AND k.game_day <=> m.game_day
                AND (COALESCE(k.value_numeric, -1) > COALESCE(m.value_numeric, -1)
                     OR (COALESCE(k.value_numeric, -1) = COALESCE(m.value_numeric, -1) AND k.metric_id > m.metric_id))
            WHERE m.metric_type IN ($types)
        ");
        try {
            $pdo->exec("ALTER TABLE player_metrics ADD COLUMN value_day TINYINT
                GENERATED ALWAYS AS (CASE WHEN metric_type IN ($types) THEN COALESCE(game_day, 0) END) STORED");
        } catch (\PDOException) {} // Spalte schon da
        $pdo->exec("ALTER TABLE player_metrics ADD UNIQUE KEY uq_metrics_value (alliance, player_id, metric_type, year_week, value_day)");
    } catch (\PDOException $e) {
        error_log('ensureMetricsValueKey: ' . $e->getMessage());
    }
}

// Haekchen "Sparwoche eingehalten" (vsSpar) in jeder Allianz mit VS-Kategorie anlegen: weekly_entry_flags
// verweist per Fremdschluessel auf flags, ohne Eintrag dort wird das Speichern abgelehnt.
function ensureVsSparFlag(PDO $pdo): void {
    try {
        $pdo->exec("
            INSERT IGNORE INTO flags (alliance, flag_key, category_key, flag_label, flag_type, points_weight, is_active, sort_order)
            SELECT fc.alliance, 'vsSpar', 'vs', 'vsSpar', 'b', 0, 1,
                   COALESCE((SELECT MAX(f.sort_order) FROM flags f WHERE f.alliance = fc.alliance AND f.category_key = 'vs'), 0) + 1
            FROM flag_categories fc
            WHERE fc.category_key = 'vs'
              AND NOT EXISTS (SELECT 1 FROM flags x WHERE x.alliance = fc.alliance AND x.flag_key = 'vsSpar')
        ");
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
}

function ensureApiAuthTables(PDO $pdo): void {
    // Cache fuer serverseitig gepruefte Discord-Tokens (SHA-256 des Access-Tokens)
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS api_auth_cache (
            token_hash CHAR(64) NOT NULL,
            discord_user_id VARCHAR(32) NOT NULL,
            expires_at DATETIME NOT NULL,
            PRIMARY KEY (token_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    // Protokoll fuer LWHUB_AUTH_MODE = 'log'
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS api_auth_log (
            log_id BIGINT NOT NULL AUTO_INCREMENT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            method VARCHAR(8) NOT NULL,
            path VARCHAR(190) NOT NULL,
            alliance VARCHAR(50) NULL,
            claimed_discord_id VARCHAR(32) NULL,
            verified_discord_id VARCHAR(32) NULL,
            token_id CHAR(36) NULL,
            verdict VARCHAR(30) NOT NULL,
            ip VARCHAR(45) NULL,
            PRIMARY KEY (log_id),
            KEY ix_auth_log_time (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

