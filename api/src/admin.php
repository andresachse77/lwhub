<?php
declare(strict_types=1);

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
