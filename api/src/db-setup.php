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
