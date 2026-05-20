<?php
declare(strict_types=1);

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
