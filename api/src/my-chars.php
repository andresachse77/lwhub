<?php
declare(strict_types=1);

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
                     p.preferred_language,
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
                'preferred_language' => $p['preferred_language'] ?: 'de',
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

function handleSelfRename(PDO $pdo, string $alliance, string $oldNameEncoded, array $body): never {
    $oldName = rawurldecode($oldNameEncoded);
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);

    $newName = trim($body['new_name'] ?? '');
    if ($newName === '') jsonOut(400, ['error' => 'Neuer Name fehlt']);

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
    if (!$member) jsonOut(403, ['error' => 'Kein Zugriff auf diesen Charakter']);

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
        } catch (\PDOException $e) { /* presence table may not exist */ }
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
