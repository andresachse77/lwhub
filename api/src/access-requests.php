<?php
declare(strict_types=1);

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

    $reqAlliance = trim($body['alliance'] ?? '');
    if ($reqAlliance === '') jsonOut(400, ['error' => 'Allianz fehlt']);
    $username    = trim($body['discord_username'] ?? '') ?: null;
    $avatar      = trim($body['discord_avatar'] ?? '') ?: null;
    $note        = trim($body['note'] ?? '') ?: null;

    // Validate: only alliances with accepts_requests=1 may receive login requests
    ensureAlliancesTable($pdo);
    $check = $pdo->prepare("SELECT 1 FROM alliances WHERE alliance = ? AND accepts_requests = 1");
    $check->execute([$reqAlliance]);
    if (!$check->fetch()) jsonOut(400, ['error' => 'Diese Allianz nimmt aktuell keine Login-Anfragen an']);

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
    ")->execute([$reqAlliance, uuid4(), $discordId, $username, $avatar, $reqAlliance, $playerName, $note]);
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
