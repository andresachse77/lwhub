<?php
declare(strict_types=1);

function ensureAlliancesTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS alliances (
            alliance          VARCHAR(50)  NOT NULL,
            alliance_name     VARCHAR(200) NULL,
            is_active         TINYINT(1)  NOT NULL DEFAULT 1,
            accepts_requests  TINYINT(1)  NOT NULL DEFAULT 0,
            created_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    // One-time migration: add column if table already existed
    try {
        $pdo->exec("ALTER TABLE alliances ADD COLUMN accepts_requests TINYINT(1) NOT NULL DEFAULT 0");
    } catch (\PDOException) { /* column already exists */ }
}

function ensureAllianceConfigTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS alliance_config (
            alliance    VARCHAR(50)  NOT NULL,
            config_key  VARCHAR(100) NOT NULL,
            config_value TEXT        NOT NULL,
            updated_by  VARCHAR(150) NULL,
            updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, config_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function handleGetAllianceConfig(PDO $pdo, string $alliance): never {
    ensureAllianceConfigTable($pdo);
    $stmt = $pdo->prepare("SELECT config_key, config_value FROM alliance_config WHERE alliance = ?");
    $stmt->execute([$alliance]);
    $config = [];
    foreach ($stmt->fetchAll() as $row) {
        $v = $row['config_value'];
        $config[$row['config_key']] = ($v === 'false') ? false : ($v === 'true' ? true : $v);
    }
    jsonOut(200, ['ok' => true, 'config' => $config]);
}

function handleSetAllianceConfig(PDO $pdo, string $alliance, array $body): never {
    ensureAllianceConfigTable($pdo);
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    $admin = requireR5($pdo, $discordId);
    $updatedBy = $admin['current_name'] ?? null;

    $stmt = $pdo->prepare("
        INSERT INTO alliance_config (alliance, config_key, config_value, updated_by)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE config_value = VALUES(config_value),
                                updated_by   = VALUES(updated_by),
                                updated_at   = CURRENT_TIMESTAMP
    ");

    if (isset($body['config']) && is_array($body['config'])) {
        foreach ($body['config'] as $k => $v) {
            $key = trim((string)$k);
            if ($key === '') continue;
            $stmt->execute([$alliance, $key, ($v === false || $v === 'false') ? 'false' : 'true', $updatedBy]);
        }
    } else {
        $key = trim((string)($body['key'] ?? ''));
        if ($key === '') jsonOut(400, ['error' => 'key fehlt']);
        $v = $body['value'] ?? true;
        $stmt->execute([$alliance, $key, ($v === false || $v === 'false') ? 'false' : 'true', $updatedBy]);
    }
    handleGetAllianceConfig($pdo, $alliance);
}

function upsertAllianceFromConfig(PDO $pdo, string $alliance): void {
    $pdo->prepare("INSERT IGNORE INTO alliances (alliance) VALUES (?)")->execute([$alliance]);
    try {
        for ($r = 1; $r <= 5; $r++) {
            $pdo->prepare("INSERT IGNORE INTO ranks (alliance, rank_code) VALUES (?, ?)")->execute([$alliance, $r]);
        }
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
    seedFlagsForAlliance($pdo, $alliance);
}

function seedFlagsForAlliance(PDO $pdo, string $alliance): void {
    try {
        $source = $pdo->query(
            "SELECT DISTINCT alliance FROM flags WHERE alliance != " . $pdo->quote($alliance) . " LIMIT 1"
        )->fetchColumn();
        if (!$source) return;

        $pdo->prepare(
            "INSERT IGNORE INTO flag_categories (alliance, category_key, category_label, category_type, bg_color, border_color, label_color, sort_order)
             SELECT ?, category_key, category_label, category_type, bg_color, border_color, label_color, sort_order FROM flag_categories WHERE alliance = ?"
        )->execute([$alliance, $source]);

        $pdo->prepare(
            "INSERT IGNORE INTO flags (alliance, flag_key, category_key, flag_label, flag_type, points_weight, is_active, sort_order)
             SELECT ?, flag_key, category_key, flag_label, flag_type, points_weight, is_active, sort_order FROM flags WHERE alliance = ?"
        )->execute([$alliance, $source]);
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

function handleGetAlliances(PDO $pdo): never {
    ensureAlliancesTable($pdo);
    $rows = $pdo->query("SELECT alliance AS short_name, alliance_name AS title, accepts_requests, created_at FROM alliances ORDER BY alliance")->fetchAll();
    jsonOut(200, ['ok' => true, 'alliances' => $rows]);
}

function handleGetOpenAlliances(PDO $pdo): never {
    ensureAlliancesTable($pdo);
    $rows = $pdo->query("SELECT alliance AS short_name, alliance_name AS title FROM alliances WHERE accepts_requests = 1 ORDER BY alliance")->fetchAll();
    jsonOut(200, ['ok' => true, 'alliances' => $rows]);
}

function handleCreateAlliance(PDO $pdo, array $body): never {
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);

    $shortName = trim($body['short_name'] ?? '');
    if ($shortName === '' || strlen($shortName) > 50) jsonOut(400, ['error' => 'Kürzel fehlt oder zu lang (max 50)']);
    $title           = trim($body['title'] ?? '') ?: null;
    $acceptsRequests = !empty($body['accepts_requests']) ? 1 : 0;

    ensureAlliancesTable($pdo);
    try {
        $pdo->prepare("INSERT INTO alliances (alliance, alliance_name, accepts_requests) VALUES (?, ?, ?)")->execute([$shortName, $title, $acceptsRequests]);
    } catch (\PDOException $e) {
        if ($e->getCode() === '23000') jsonOut(409, ['error' => 'Allianz existiert bereits']);
        throw $e;
    }
    try {
        for ($r = 1; $r <= 5; $r++) {
            $pdo->prepare("INSERT IGNORE INTO ranks (alliance, rank_code) VALUES (?, ?)")->execute([$shortName, $r]);
        }
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
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
    $stmt = $pdo->prepare("SELECT alliance AS short_name, alliance_name AS title, accepts_requests FROM alliances WHERE alliance = ?");
    $stmt->execute([$oldShort]);
    $existing = $stmt->fetch();
    if (!$existing) jsonOut(404, ['error' => 'Allianz nicht gefunden']);

    $newShort           = trim($body['short_name'] ?? $oldShort);
    $titleSet           = array_key_exists('title', $body);
    $acceptsRequestsSet = array_key_exists('accepts_requests', $body);
    $newTitle           = $titleSet ? (trim($body['title'] ?? '') ?: null) : ($existing['title'] ?? null);
    $newAcceptsRequests = $acceptsRequestsSet ? (!empty($body['accepts_requests']) ? 1 : 0) : (int)($existing['accepts_requests'] ?? 0);

    if ($newShort === $oldShort && !$titleSet && !$acceptsRequestsSet) jsonOut(400, ['error' => 'Keine Änderungen angegeben']);

    $pdo->beginTransaction();
    try {
        if ($newShort !== $oldShort) {
            $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
            try {
                $pdo->prepare("INSERT INTO alliances (alliance, alliance_name, accepts_requests) VALUES (?, ?, ?)")->execute([$newShort, $newTitle, $newAcceptsRequests]);
            } catch (\PDOException $e) {
                $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
                if ($e->getCode() === '23000') {
                    if ($pdo->inTransaction()) $pdo->rollBack();
                    jsonOut(409, ['error' => 'Allianz-Kürzel bereits vergeben']);
                }
                throw $e;
            }
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
            $pdo->prepare("UPDATE alliances SET alliance_name = ?, accepts_requests = ? WHERE alliance = ?")->execute([$newTitle, $newAcceptsRequests, $oldShort]);
        }
        $pdo->commit();
        jsonOut(200, ['ok' => true, 'short_name' => $newShort, 'title' => $newTitle, 'accepts_requests' => $newAcceptsRequests]);
    } catch (\PDOException $e) {
        try { $pdo->exec('SET FOREIGN_KEY_CHECKS=1'); } catch (\Throwable) {}
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}
