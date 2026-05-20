<?php
declare(strict_types=1);

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
