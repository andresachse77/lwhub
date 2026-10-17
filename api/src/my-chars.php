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
                 SELECT p.player_id, p.alliance, p.current_name, p.current_rank_code, p.honor_role,
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
            $rank = safeRank((int)$p['current_rank_code']);
            $honorRole = normalizeHonorRole($p['honor_role'] ?? null);
            $chars[] = [
                'player_id' => $p['player_id'],
                'alliance'  => $p['alliance'],
                'name'      => $p['current_name'],
                'rank'      => $rank,
                'role'      => roleFromMemberState($rank, $honorRole),
                'honor_role'=> $honorRole,
                'can_manage'=> effectiveRankForAccess($rank, $honorRole) >= 4,
                'can_write' => memberCanWrite($honorRole),
                'preferred_language' => $p['preferred_language'] ?: 'de',
                'is_active' => $isActive,
            ];
        }
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }

    // Betreiber: alle Allianzen ohne eigenen Char zum Ansehen (Zuschauer, aendert nichts ausser Feature-Schaltern)
    $isSiteAdmin = isSiteAdmin($pdo, $discordId);
    $viewerAlliances = [];
    if ($isSiteAdmin) {
        $own = array_flip(array_column($chars, 'alliance'));
        try {
            foreach ($pdo->query("SELECT alliance, alliance_name FROM alliances WHERE is_active = 1 ORDER BY alliance")->fetchAll() as $a) {
                if (isset($own[$a['alliance']])) continue;
                $viewerAlliances[] = [
                    'alliance'  => $a['alliance'],
                    'title'     => $a['alliance_name'] ?: null,
                    'is_active' => $activeRow && $activeRow['player_id'] === '' && $activeRow['alliance'] === $a['alliance'],
                ];
            }
        } catch (\PDOException $e) {
            if (!isOptionalTableError($e)) throw $e;
        }
    }

    jsonOut(200, ['ok' => true, 'chars' => $chars, 'active' => $activeRow, 'is_site_admin' => $isSiteAdmin, 'viewer_alliances' => $viewerAlliances]);
}

/** Allianz, die der Betreiber gerade ohne eigenen Char ansieht (user_active_char mit leerer player_id), sonst null. */
function getSiteViewerAlliance(PDO $pdo, string $discordId): ?string {
    try {
        $stmt = $pdo->prepare("SELECT alliance, player_id FROM user_active_char WHERE discord_user_id = ?");
        $stmt->execute([$discordId]);
        $row = $stmt->fetch();
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        return null;
    }
    if (!$row || $row['player_id'] !== '' || !isSiteAdmin($pdo, $discordId)) return null;
    if (getDiscordMember($pdo, $row['alliance'], $discordId)) return null; // eigener Char geht vor
    return $row['alliance'];
}

/** Antwort von /verify-discord fuer den Betreiber als Zuschauer: sieht alles wie R5, darf nichts aendern. */
function siteViewerVerifyPayload(PDO $pdo, string $alliance, string $discordId): array {
    $profile = null;
    try {
        $stmt = $pdo->prepare("SELECT discord_username, discord_avatar FROM discord_profile_cache WHERE discord_user_id = ? ORDER BY updated_at DESC LIMIT 1");
        $stmt->execute([$discordId]);
        $profile = $stmt->fetch() ?: null;
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
    return [
        'ok'                => true,
        'alliance'          => $alliance,
        'member_id'         => null,
        'member_name'       => $profile['discord_username'] ?? 'Betreiber',
        'rank'              => 5,
        'role'              => 'site_viewer',
        'honor_role'        => null,
        'site_viewer'       => true,
        'can_manage'        => true,
        'can_write'         => false,
        'read_only'         => true,
        'can_set_features'  => true,
        'discord_id'        => $discordId,
        'discord_username'  => $profile['discord_username'] ?? null,
        'discord_avatar'    => $profile['discord_avatar'] ?? null,
        'discord_avatar_url'=> memberToDiscordAvatarUrl($discordId, $profile['discord_avatar'] ?? null, 128),
        'preferred_language'=> 'de',
    ];
}

function handleSetActiveChar(PDO $pdo, array $body): never {
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);

    $alliance = trim($body['alliance'] ?? '');
    $playerId = trim($body['player_id'] ?? '');
    if ($alliance === '') jsonOut(400, ['error' => 'alliance erforderlich']);

    // Ohne player_id: der Betreiber sieht eine Allianz an, in der er keinen eigenen Char hat
    if ($playerId === '') {
        $discordId = resolveCallerId($pdo, $alliance, $discordId)['id'];
        if (!isSiteAdmin($pdo, $discordId)) jsonOut(403, ['error' => 'Nur der Betreiber kann Allianzen ohne eigenen Charakter ansehen']);
        $aStmt = $pdo->prepare("SELECT 1 FROM alliances WHERE alliance = ? LIMIT 1");
        $aStmt->execute([$alliance]);
        if (!$aStmt->fetch()) jsonOut(404, ['error' => 'Allianz nicht gefunden']);
        ensureUserActiveCharTable($pdo);
        $pdo->prepare("
            INSERT INTO user_active_char (discord_user_id, alliance, player_id)
            VALUES (?, ?, '')
            ON DUPLICATE KEY UPDATE alliance = VALUES(alliance), player_id = VALUES(player_id)
        ")->execute([$discordId, $alliance]);
        jsonOut(200, ['ok' => true, 'site_viewer' => true]);
    }

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
    // Ehren-Eintraege tragen den Namen aus der Heimat-Allianz; den pflegt die Verwaltung (R4/R5)
    requireAllianceWriter($pdo, $alliance, 1, true, $discordId);

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
