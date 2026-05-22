<?php
declare(strict_types=1);

function handleHealth(PDO $pdo, string $alliance): never {
    $stmt = $pdo->query('SELECT 1 AS ok');
    $row  = $stmt->fetch();
    $title = null;
    try {
        ensureAlliancesTable($pdo);
        upsertAllianceFromConfig($pdo, $alliance);
        $aStmt = $pdo->prepare("SELECT alliance_name FROM alliances WHERE alliance = ?");
        $aStmt->execute([$alliance]);
        $aRow = $aStmt->fetch();
        $title = $aRow ? ($aRow['alliance_name'] ?? null) : null;
    } catch (\PDOException) {}
    jsonOut(200, [
        'ok'             => (bool)($row['ok'] ?? false),
        'backend'        => 'php-mysql',
        'alliance'       => $alliance,
        'alliance_title' => $title,
    ]);
}

function handleTabHtml(PDO $pdo, string $alliance): never {
    $section    = trim($_GET['section']    ?? '');
    $discordIdRaw = $_GET['discord_id'] ?? '';
    try {
        $discordId = normalizeDiscordId($discordIdRaw);
    } catch (\InvalidArgumentException) {
        jsonOut(403, ['ok' => false, 'error' => 'Nicht autorisiert']);
    }
    if (!in_array($section, ['r4', 'admin'], true)) {
        jsonOut(400, ['ok' => false, 'error' => 'Ungültiger Abschnitt']);
    }
    if ($discordId === '') {
        jsonOut(403, ['ok' => false, 'error' => 'Nicht autorisiert']);
    }

    $member = getDiscordMember($pdo, $alliance, $discordId);
    if (!$member) {
        jsonOut(403, ['ok' => false, 'error' => 'Nicht berechtigt']);
    }

    $rank = safeRank((int)$member['current_rank_code']);

    if ($section === 'r4'    && $rank < 4) jsonOut(403, ['ok' => false, 'error' => 'Rang 4 oder höher erforderlich']);
    if ($section === 'admin' && $rank < 5) jsonOut(403, ['ok' => false, 'error' => 'Rang 5 erforderlich']);

    $partialsDir = __DIR__ . '/../partials/';

    ob_start();
    include $partialsDir . $section . '-tab-btns.php';
    $tabBtns = (string)ob_get_clean();

    ob_start();
    $pagesFile = $partialsDir . $section . '-pages.php';
    if (file_exists($pagesFile)) include $pagesFile;
    $pages = (string)ob_get_clean();

    jsonOut(200, ['ok' => true, 'tabBtns' => $tabBtns, 'pages' => $pages]);
}

function handleVerifyDiscord(PDO $pdo, string $alliance): never {
    $discordIdRaw = $_GET['discord_id'] ?? '';
    try {
        $discordId = normalizeDiscordId($discordIdRaw);
    } catch (\InvalidArgumentException) {
        jsonOut(200, ['ok' => false, 'error' => 'Discord-ID fehlt oder ungueltig']);
    }
    if ($discordId === '') jsonOut(200, ['ok' => false, 'error' => 'Discord-ID fehlt']);

    // Resolve effective membership first (prefers server-side active char) to keep
    // re-login/reopen in the same alliance context across sessions/devices.
    $member = getDiscordMemberAcrossAlliances($pdo, $discordId);
    if ($member && !empty($member['alliance'])) {
        $alliance = (string)$member['alliance'];
    } elseif (!$member) {
        // Backward-compatible fallback for installations without full cross-alliance linkage.
        $member = getDiscordMember($pdo, $alliance, $discordId);
    }
    if (!$member) jsonOut(200, ['ok' => false, 'error' => 'Kein Zugriff']);

    $rank = safeRank((int)$member['current_rank_code']);
    jsonOut(200, [
        'ok'                => true,
        'alliance'          => $alliance,
        'member_id'         => $member['player_id'],
        'member_name'       => $member['current_name'],
        'rank'              => $rank,
        'role'              => roleFromRank($rank),
        'can_manage'        => $rank >= 4,
        'discord_id'        => $member['discord_user_id'] ?? null,
        'discord_username'  => $member['discord_username'] ?? null,
        'discord_avatar'    => $member['discord_avatar'] ?? null,
        'discord_avatar_url'=> memberToDiscordAvatarUrl($member['discord_user_id'] ?? null, $member['discord_avatar'] ?? null, 128),
        'preferred_language'=> normalizePreferredLanguage($member['preferred_language'] ?? 'de'),
    ]);
}

function handleMemberHistory(PDO $pdo, string $alliance): never {
    $discordIdRaw = $_GET['discord_id'] ?? '';
    $nameRaw      = $_GET['name'] ?? '';
    $rawLimit     = isset($_GET['limit']) ? (int)$_GET['limit'] : 16;
    $limit        = max(1, min(52, $rawLimit));

    $discordId = '';
    if ($discordIdRaw !== '') {
        try {
            $discordId = normalizeDiscordId($discordIdRaw);
        } catch (\InvalidArgumentException $e) {
            jsonOut(400, ['error' => $e->getMessage()]);
        }
    }

    if ($discordId === '' && trim($nameRaw) === '') {
        jsonOut(400, ['error' => 'Discord-ID oder Name fehlt']);
    }

    $member = $discordId !== ''
        ? getDiscordMember($pdo, $alliance, $discordId)
        : getMemberByName($pdo, $alliance, $nameRaw);

    if (!$member) jsonOut(404, ['error' => 'Mitglied nicht gefunden']);

    // Weekly entries
    $entryRows = [];
    try {
        $stmt = $pdo->prepare("
            SELECT entry_id, year_week, base_rank_code, final_rank_code, afk, updated_at
            FROM weekly_entries
            WHERE alliance = ? AND player_id = ?
            ORDER BY year_week DESC
            LIMIT {$limit}
        ");
        $stmt->execute([$alliance, $member['player_id']]);
        $entryRows = $stmt->fetchAll();
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        if (isBadFieldError($e)) {
            try {
                $stmt = $pdo->prepare("
                    SELECT entry_id, year_week, final_rank_code, NULL AS updated_at
                    FROM weekly_entries
                    WHERE alliance = ? AND player_id = ?
                    ORDER BY year_week DESC
                    LIMIT {$limit}
                ");
                $stmt->execute([$alliance, $member['player_id']]);
                foreach ($stmt->fetchAll() as $row) {
                    $entryRows[] = array_merge($row, ['base_rank_code' => $row['final_rank_code'], 'afk' => 0]);
                }
            } catch (\PDOException $e2) {
                if (!isOptionalTableError($e2)) throw $e2;
            }
        }
    }

    $weeks = [];
    foreach ($entryRows as $row) {
        $flagRows = [];
        try {
            $stmt = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
            $stmt->execute([$alliance, $row['entry_id']]);
            $flagRows = $stmt->fetchAll();
        } catch (\PDOException $e) {
            if (!isOptionalTableError($e)) throw $e;
        }
        $flags = [];
        foreach ($flagRows as $f) $flags[$f['flag_key']] = true;
        $weeks[] = [
            'year_week'  => $row['year_week'],
            'base_rank'  => safeRank((int)$row['base_rank_code']),
            'final_rank' => safeRank((int)$row['final_rank_code']),
            'afk'        => (bool)$row['afk'],
            'updated_at' => $row['updated_at'],
            'flags'      => $flags,
        ];
    }

    // Rank change log
    $changeRows = [];
    try {
        ensureRankChangeLogTable($pdo, $alliance);
        $stmt = $pdo->prepare("
            SELECT old_rank_code, requested_rank_code, applied_rank_code,
                   source, is_blocked, reason, created_at
            FROM rank_change_log
            WHERE alliance = ? AND player_id = ?
            ORDER BY created_at DESC
            LIMIT 25
        ");
        $stmt->execute([$alliance, $member['player_id']]);
        $changeRows = $stmt->fetchAll();
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        if (isBadFieldError($e)) {
            try {
                $stmt = $pdo->prepare("
                    SELECT old_rank_code, requested_rank_code, applied_rank_code,
                           source, is_blocked, reason, created_at
                    FROM rank_change_log
                    WHERE alliance = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))
                    ORDER BY created_at DESC
                    LIMIT 25
                ");
                $stmt->execute([$alliance, $member['current_name']]);
                $changeRows = $stmt->fetchAll();
            } catch (\PDOException $e2) {
                if (!isOptionalTableError($e2)) throw $e2;
            }
        }
    }

    $rank = safeRank((int)$member['current_rank_code']);
    jsonOut(200, [
        'ok'     => true,
        'member' => [
            'id'               => $member['player_id'],
            'name'             => $member['current_name'],
            'rank'             => $rank,
            'role'             => roleFromRank($rank),
            'can_manage'       => $rank >= 4,
            'discord_id'       => $member['discord_user_id'] ?? null,
            'discord_username' => $member['discord_username'] ?? null,
            'discord_avatar'   => $member['discord_avatar'] ?? null,
            'discord_avatar_url' => memberToDiscordAvatarUrl($member['discord_user_id'] ?? null, $member['discord_avatar'] ?? null, 128),
            'beruf'            => $member['beruf'] ?? null,
            'beruf_med_hilfe'  => (bool)($member['beruf_med_hilfe'] ?? false),
            'beruf_winwin'     => $member['beruf_winwin'] ?? null,
            'preferred_language'=> normalizePreferredLanguage($member['preferred_language'] ?? 'de'),
        ],
        'weeks'        => $weeks,
        'rank_changes' => array_map(fn($row) => [
            'old_rank'       => is_numeric($row['old_rank_code']) ? (int)$row['old_rank_code'] : null,
            'requested_rank' => is_numeric($row['requested_rank_code']) ? (int)$row['requested_rank_code'] : null,
            'applied_rank'   => safeRank((int)$row['applied_rank_code']),
            'source'         => $row['source'],
            'is_blocked'     => (bool)$row['is_blocked'],
            'reason'         => $row['reason'] ?? null,
            'created_at'     => $row['created_at'],
        ], $changeRows),
    ]);
}

function handleCacheDiscordProfile(PDO $pdo, string $alliance, array $body): never {
    $discordIdRaw = $body['discord_id'] ?? '';
    try {
        $discordId = normalizeDiscordId($discordIdRaw);
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }
    if ($discordId === '') jsonOut(400, ['error' => 'Discord-ID fehlt']);

    $username = trim((string)($body['discord_username'] ?? '')) ?: null;
    $avatar   = trim((string)($body['discord_avatar'] ?? '')) ?: null;

    ensureDiscordProfileCacheTable($pdo);
    $stmt = $pdo->prepare("
        INSERT INTO discord_profile_cache (alliance, discord_user_id, discord_username, discord_avatar)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            discord_username = VALUES(discord_username),
            discord_avatar   = VALUES(discord_avatar),
            updated_at       = CURRENT_TIMESTAMP
    ");
    $stmt->execute([$alliance, $discordId, $username, $avatar]);
    jsonOut(200, ['ok' => true]);
}

function handleListRankChangeLog(PDO $pdo, string $alliance): never {
    ensureRankChangeLogTable($pdo, $alliance);
    $rawLimit  = isset($_GET['limit']) ? (int)$_GET['limit'] : 100;
    $limit     = max(1, min(200, $rawLimit));
    $nameFilter = trim($_GET['name'] ?? '');

    if ($nameFilter !== '') {
        $stmt = $pdo->prepare("
            SELECT player_name, old_rank_code, requested_rank_code, applied_rank_code,
                   source, is_blocked, reason, created_at
            FROM rank_change_log
            WHERE alliance = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))
            ORDER BY created_at DESC
            LIMIT {$limit}
        ");
        $stmt->execute([$alliance, $nameFilter]);
    } else {
        $stmt = $pdo->prepare("
            SELECT player_name, old_rank_code, requested_rank_code, applied_rank_code,
                   source, is_blocked, reason, created_at
            FROM rank_change_log
            WHERE alliance = ?
            ORDER BY created_at DESC
            LIMIT {$limit}
        ");
        $stmt->execute([$alliance]);
    }
    jsonOut(200, $stmt->fetchAll());
}

function handleGetMembers(PDO $pdo, string $alliance): never {
    ensureDiscordProfileCacheTable($pdo);
    ensureLastVisitColumn($pdo);
    ensureBerufColumns($pdo);
    ensurePreferredLanguageColumn($pdo);
    $stmt = $pdo->prepare("
        SELECT p.player_id, p.alliance, p.current_name, p.current_rank_code, p.last_visit_at, p.preferred_language,
               p.beruf, p.beruf_med_hilfe, p.beruf_winwin,
               COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
               COALESCE(puld.discord_username, dpc.discord_username) AS discord_username,
               COALESCE(puld.discord_avatar, dpc.discord_avatar) AS discord_avatar
        FROM players p
        LEFT JOIN (
            SELECT alliance, player_id, MIN(discord_user_id) AS discord_user_id
            FROM player_identities WHERE discord_user_id IS NOT NULL
            GROUP BY alliance, player_id
        ) pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        LEFT JOIN (
            SELECT pul.alliance, pul.player_id,
                   MIN(uda.discord_user_id) AS discord_user_id,
                   MIN(uda.discord_username) AS discord_username,
                   MIN(uda.discord_avatar) AS discord_avatar
            FROM player_user_links pul
            JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            GROUP BY pul.alliance, pul.player_id
        ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        LEFT JOIN discord_profile_cache dpc
            ON dpc.alliance = p.alliance
           AND dpc.discord_user_id = COALESCE(pid.discord_user_id, puld.discord_user_id)
        WHERE p.alliance = ? AND p.is_active = 1
        ORDER BY p.current_name
    ");
    $stmt->execute([$alliance]);
    $rows = $stmt->fetchAll();

    $result = array_map(fn($r) => [
        'id'                 => $r['player_id'],
        'alliance'           => $r['alliance'],
        'name'               => $r['current_name'],
        'default_rank'       => (int)$r['current_rank_code'],
        'role'               => roleFromRank((int)$r['current_rank_code']),
        'discord_id'         => $r['discord_user_id'] ?? null,
        'discord_username'   => $r['discord_username'] ?? null,
        'discord_avatar'     => $r['discord_avatar'] ?? null,
        'discord_connected'  => !empty($r['discord_user_id']),
        'discord_avatar_url' => memberToDiscordAvatarUrl($r['discord_user_id'] ?? null, $r['discord_avatar'] ?? null, 64),
        'last_visit_at'      => $r['last_visit_at'] ?? null,
        'beruf'              => $r['beruf'] ?? null,
        'beruf_med_hilfe'    => (bool)($r['beruf_med_hilfe'] ?? false),
        'beruf_winwin'       => $r['beruf_winwin'] ?? null,
        'preferred_language' => normalizePreferredLanguage($r['preferred_language'] ?? 'de'),
    ], $rows);

    jsonOut(200, $result);
}

function handleAddMember(PDO $pdo, string $alliance, array $body, array $protectedNames): never {
    ensurePreferredLanguageColumn($pdo);
    $name = trim($body['name'] ?? '');
    if ($name === '') jsonOut(400, ['error' => 'Name fehlt']);

    $existing = $pdo->prepare("SELECT player_id, is_active FROM players WHERE alliance = ? AND current_name = ? LIMIT 1");
    $existing->execute([$alliance, $name]);
    $existingRow = $existing->fetch();
    if ($existingRow) {
        if ((int)$existingRow['is_active'] === 0) {
            jsonOut(409, ['error' => 'Dieser Spieler ist archiviert. Bitte über Archiv wiederherstellen.']);
        }
        jsonOut(409, ['error' => 'Mitglied mit diesem Namen existiert bereits']);
    }

    $discordIdRaw = trim($body['discord_id'] ?? '');
    $discordId = '';
    if ($discordIdRaw !== '') {
        try { $discordId = normalizeDiscordId($discordIdRaw); }
        catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => 'Ungültige Discord-ID: ' . $e->getMessage()]); }
    }

    $requestedRank = safeRank((int)($body['default_rank'] ?? $body['rank'] ?? 3));
    try {
        $preferredLanguage = normalizePreferredLanguage($body['preferred_language'] ?? 'de');
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }
    $protection    = applyProtectedRankRule($name, $requestedRank, $protectedNames);
    $rank          = $protection['effectiveRank'];
    $playerId      = uuid4();
    $nameEventId   = uuid4();

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("INSERT INTO players (alliance, player_id, current_name, current_rank_code, preferred_language, is_active) VALUES (?, ?, ?, ?, ?, 1)");
        $stmt->execute([$alliance, $playerId, $name, $rank, $preferredLanguage]);

        if ($requestedRank !== $rank || isProtectedR4Member($name, $protectedNames)) {
            logRankChange($pdo, $alliance, [
                'playerId'      => $playerId,
                'playerName'    => $name,
                'oldRank'       => null,
                'requestedRank' => $requestedRank,
                'appliedRank'   => $rank,
                'source'        => 'members:add',
                'blocked'       => $protection['blocked'],
                'reason'        => $protection['blocked'] ? 'protected-r4-member' : 'protected-r4-enforced',
            ]);
        }

        $stmt = $pdo->prepare("INSERT IGNORE INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, 0)");
        $stmt->execute([$alliance, $nameEventId, $playerId, $name]);

        if ($discordId !== '') {
            try {
                $pdo->prepare("INSERT IGNORE INTO player_identities (alliance, identity_id, player_id, discord_user_id) VALUES (?, ?, ?, ?)"
                )->execute([$alliance, uuid4(), $playerId, $discordId]);
            } catch (\PDOException $e) {
                if (!isOptionalTableError($e)) throw $e;
            }
        }

        $pdo->commit();
        jsonOut(201, ['ok' => true, 'player_id' => $playerId]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate') || $e->getCode() === '23000') {
            jsonOut(409, ['error' => 'Mitglied mit diesem Namen existiert bereits']);
        }
        throw $e;
    }
}

function handleTransferPlayer(PDO $pdo, string $fromAlliance, string $nameEncoded, array $body): never {
    $name = rawurldecode($nameEncoded);
    try { $discordId = normalizeDiscordId($body['discord_id'] ?? ''); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    requireR5($pdo, $discordId);

    $toAlliance = trim($body['to_alliance'] ?? '');
    if ($toAlliance === '') jsonOut(400, ['error' => 'Ziel-Allianz fehlt']);
    if ($toAlliance === $fromAlliance) jsonOut(400, ['error' => 'Spieler ist bereits in dieser Allianz']);

    $aStmt = $pdo->prepare("SELECT 1 FROM alliances WHERE alliance = ? LIMIT 1");
    $aStmt->execute([$toAlliance]);
    if (!$aStmt->fetch()) jsonOut(404, ['error' => 'Ziel-Allianz nicht gefunden']);

    $stmt = $pdo->prepare("SELECT player_id, current_rank_code FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1 LIMIT 1");
    $stmt->execute([$fromAlliance, $name]);
    $player = $stmt->fetch();
    if (!$player) jsonOut(404, ['error' => 'Spieler nicht gefunden']);

    $check = $pdo->prepare("SELECT 1 FROM players WHERE alliance = ? AND current_name = ? LIMIT 1");
    $check->execute([$toAlliance, $name]);
    if ($check->fetch()) jsonOut(409, ['error' => 'Name bereits in Ziel-Allianz vergeben']);

    $playerId = $player['player_id'];

    for ($r = 1; $r <= 5; $r++) {
        $pdo->prepare("INSERT IGNORE INTO ranks (alliance, rank_code) VALUES (?, ?)")->execute([$toAlliance, $r]);
    }

    $pdo->beginTransaction();
    try {
        $pdo->exec("SET FOREIGN_KEY_CHECKS=0");

        foreach (['players', 'player_identities', 'player_name_history'] as $tbl) {
            try {
                $pdo->prepare("UPDATE `{$tbl}` SET alliance = ? WHERE alliance = ? AND player_id = ?")
                    ->execute([$toAlliance, $fromAlliance, $playerId]);
            } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        }
        try {
            $pdo->prepare("UPDATE weekly_entry_flags wef
                JOIN weekly_entries we ON wef.alliance = we.alliance AND wef.entry_id = we.entry_id
                SET wef.alliance = ?
                WHERE wef.alliance = ? AND we.player_id = ?")
                ->execute([$toAlliance, $fromAlliance, $playerId]);
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        try {
            $pdo->prepare("UPDATE weekly_entries SET alliance = ? WHERE alliance = ? AND player_id = ?")
                ->execute([$toAlliance, $fromAlliance, $playerId]);
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }

        $pdo->exec("SET FOREIGN_KEY_CHECKS=1");

        $pdo->commit();
        jsonOut(200, ['ok' => true, 'player_id' => $playerId, 'to_alliance' => $toAlliance]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function handleUpdateMember(PDO $pdo, string $alliance, string $oldNameEncoded, array $body, array $protectedNames): never {
    ensurePreferredLanguageColumn($pdo);
    $oldName = rawurldecode($oldNameEncoded);
    $newName = trim($body['name'] ?? $oldName);
    if ($newName === '') jsonOut(400, ['error' => 'Name fehlt']);

    $requestedRank = safeRank((int)($body['default_rank'] ?? $body['rank'] ?? 3));

    $discordId = null;
    $discordIdSet = array_key_exists('discord_id', $body);
    if ($discordIdSet) {
        try {
            $discordId = normalizeDiscordId($body['discord_id'] ?? '');
        } catch (\InvalidArgumentException $e) {
            jsonOut(400, ['error' => $e->getMessage()]);
        }
    }

    $preferredLanguage = 'de';
    $preferredLanguageSet = array_key_exists('preferred_language', $body);
    if ($preferredLanguageSet) {
        try {
            $preferredLanguage = normalizePreferredLanguage($body['preferred_language'] ?? 'de');
        } catch (\InvalidArgumentException $e) {
            jsonOut(400, ['error' => $e->getMessage()]);
        }
    }

    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $oldName]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(404, ['error' => 'Mitglied nicht gefunden']);

    $playerId = $row['player_id'];
    $oldRank  = (int)$row['current_rank_code'];
    $pA       = applyProtectedRankRule($row['current_name'], $requestedRank, $protectedNames);
    $pB       = applyProtectedRankRule($newName, $requestedRank, $protectedNames);
    $protected = $pA['protectedMember'] || $pB['protectedMember'];
    $rank      = $protected ? 4 : $requestedRank;
    $blocked   = $protected && $requestedRank !== 4;

    $pdo->beginTransaction();
    try {
        if ($preferredLanguageSet) {
            $stmt = $pdo->prepare("UPDATE players SET current_name = ?, current_rank_code = ?, preferred_language = ?, is_active = 1, retired_at = NULL WHERE alliance = ? AND player_id = ?");
            $stmt->execute([$newName, $rank, $preferredLanguage, $alliance, $playerId]);
        } else {
            $stmt = $pdo->prepare("UPDATE players SET current_name = ?, current_rank_code = ?, is_active = 1, retired_at = NULL WHERE alliance = ? AND player_id = ?");
            $stmt->execute([$newName, $rank, $alliance, $playerId]);
        }

        if ($oldRank !== $rank || $blocked || $protected) {
            logRankChange($pdo, $alliance, [
                'playerId'      => $playerId,
                'playerName'    => $newName,
                'oldRank'       => $oldRank,
                'requestedRank' => $requestedRank,
                'appliedRank'   => $rank,
                'source'        => 'members:update',
                'blocked'       => $blocked,
                'reason'        => $protected ? 'protected-r4-member' : null,
            ]);
        }

        if ($newName !== $row['current_name']) {
            $stmt = $pdo->prepare("INSERT IGNORE INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, 0)");
            $stmt->execute([$alliance, uuid4(), $playerId, $newName]);
        }

        if ($discordIdSet) {
            if ($discordId === '') {
                $pdo->prepare("UPDATE player_identities SET discord_user_id = NULL WHERE alliance = ? AND player_id = ?")
                    ->execute([$alliance, $playerId]);
            } else {
                $existing = $pdo->prepare("SELECT identity_id FROM player_identities WHERE alliance = ? AND player_id = ? ORDER BY created_at, identity_id LIMIT 1");
                $existing->execute([$alliance, $playerId]);
                $identityRow = $existing->fetch();

                if ($identityRow) {
                    $pdo->prepare("UPDATE player_identities SET discord_user_id = NULL WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
                    $pdo->prepare("UPDATE player_identities SET discord_user_id = ? WHERE alliance = ? AND identity_id = ?")->execute([$discordId, $alliance, $identityRow['identity_id']]);
                } else {
                    $pdo->prepare("INSERT INTO player_identities (alliance, identity_id, player_id, discord_user_id) VALUES (?, ?, ?, ?)")
                        ->execute([$alliance, uuid4(), $playerId, $discordId]);
                }
            }
        }

        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate entry')) {
            jsonOut(409, ['error' => 'Name existiert bereits']);
        }
        throw $e;
    }
}

function handleSetMemberLanguage(PDO $pdo, string $alliance, string $nameEncoded, array $body): never {
    ensurePreferredLanguageColumn($pdo);
    $name = rawurldecode($nameEncoded);
    if (trim($name) === '') jsonOut(400, ['error' => 'Name fehlt']);

    try {
        $discordId = normalizeDiscordId($body['discord_id'] ?? '');
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);

    try {
        $preferredLanguage = normalizePreferredLanguage($body['preferred_language'] ?? 'de');
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }

    $requester = getDiscordMember($pdo, $alliance, $discordId);
    if (!$requester) jsonOut(403, ['error' => 'Nicht berechtigt']);

    $targetStmt = $pdo->prepare("SELECT player_id, current_name FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1 LIMIT 1");
    $targetStmt->execute([$alliance, $name]);
    $target = $targetStmt->fetch();
    if (!$target) jsonOut(404, ['error' => 'Mitglied nicht gefunden']);

    $requesterRank = safeRank((int)$requester['current_rank_code']);
    $isSelf = normalizeMemberName((string)$requester['current_name']) === normalizeMemberName((string)$target['current_name']);
    if (!$isSelf && $requesterRank < 4) jsonOut(403, ['error' => 'Nicht berechtigt']);

    $pdo->prepare("UPDATE players SET preferred_language = ? WHERE alliance = ? AND player_id = ?")
        ->execute([$preferredLanguage, $alliance, $target['player_id']]);

    jsonOut(200, ['ok' => true, 'preferred_language' => $preferredLanguage]);
}

function handleDeleteMember(PDO $pdo, string $alliance, string $nameEncoded, array $body = []): never {
    $name = rawurldecode($nameEncoded);
    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code, created_at FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $name]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(200, ['ok' => true]);

    $playerId  = $row['player_id'];
    $archiveId = uuid4();
    $archivedBy = null;
    try { $archivedBy = normalizeDiscordId($body['discord_id'] ?? ''); } catch (\InvalidArgumentException) {}
    if ($archivedBy === '') $archivedBy = null;

    ensureArchiveTables($pdo);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO archived_players (archive_id, archived_by, alliance, player_id, current_name, current_rank_code, player_created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            ->execute([$archiveId, $archivedBy, $alliance, $playerId, $row['current_name'], $row['current_rank_code'], $row['created_at']]);

        try {
            $entries = $pdo->prepare("SELECT * FROM weekly_entries WHERE alliance = ? AND player_id = ?");
            $entries->execute([$alliance, $playerId]);
            foreach ($entries->fetchAll() as $entry) {
                $brc = $entry['base_rank_code'] ?? $entry['final_rank_code'];
                $pdo->prepare("INSERT INTO archived_weekly_entries (archive_id, entry_id, year_week, player_id, alliance, base_rank_code, final_rank_code, afk) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                    ->execute([$archiveId, $entry['entry_id'], $entry['year_week'], $entry['player_id'], $alliance, $brc, $entry['final_rank_code'], $entry['afk'] ?? 0]);
                $flags = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
                $flags->execute([$alliance, $entry['entry_id']]);
                foreach ($flags->fetchAll() as $flag) {
                    $pdo->prepare("INSERT INTO archived_entry_flags (archive_id, entry_id, flag_key) VALUES (?, ?, ?)")
                        ->execute([$archiveId, $entry['entry_id'], $flag['flag_key']]);
                }
            }
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }

        try {
            $hist = $pdo->prepare("SELECT * FROM player_name_history WHERE alliance = ? AND player_id = ?");
            $hist->execute([$alliance, $playerId]);
            foreach ($hist->fetchAll() as $h) {
                $pdo->prepare("INSERT INTO archived_name_history (archive_id, name_event_id, player_id, alliance, player_name, valid_from_yw) VALUES (?, ?, ?, ?, ?, ?)")
                    ->execute([$archiveId, $h['name_event_id'], $playerId, $alliance, $h['player_name'], $h['valid_from_yw']]);
            }
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }

        try {
            $ids = $pdo->prepare("SELECT * FROM player_identities WHERE alliance = ? AND player_id = ?");
            $ids->execute([$alliance, $playerId]);
            foreach ($ids->fetchAll() as $id) {
                $pdo->prepare("INSERT INTO archived_player_identities (archive_id, identity_id, player_id, alliance, discord_user_id) VALUES (?, ?, ?, ?, ?)")
                    ->execute([$archiveId, $id['identity_id'], $playerId, $alliance, $id['discord_user_id']]);
            }
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }

        try {
            $pdo->prepare("DELETE wef FROM weekly_entry_flags wef JOIN weekly_entries we ON wef.alliance = we.alliance AND wef.entry_id = we.entry_id WHERE wef.alliance = ? AND we.player_id = ?")->execute([$alliance, $playerId]);
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        $pdo->prepare("DELETE FROM weekly_entries WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        try { $pdo->prepare("DELETE FROM player_name_history WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]); } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        try { $pdo->prepare("DELETE FROM player_user_links WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]); } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        try { $pdo->prepare("DELETE FROM player_identities WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]); } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
        $pdo->prepare("DELETE FROM players WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        try {
            ensureUserActiveCharTable($pdo);
            $pdo->prepare("DELETE FROM user_active_char WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
        } catch (\PDOException $e) {}

        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function handleSwapIdToDiscord(PDO $pdo, string $alliance, string $nameEncoded): never {
    $name = rawurldecode($nameEncoded);
    $stmt = $pdo->prepare("
        SELECT p.player_id, p.current_name, p.current_rank_code, p.is_active, p.created_at, p.retired_at,
               COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id
        FROM players p
        LEFT JOIN (SELECT alliance, player_id, MIN(discord_user_id) AS discord_user_id FROM player_identities WHERE discord_user_id IS NOT NULL GROUP BY alliance, player_id) pid ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        LEFT JOIN (SELECT pul.alliance, pul.player_id, MIN(uda.discord_user_id) AS discord_user_id FROM player_user_links pul JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id GROUP BY pul.alliance, pul.player_id) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        WHERE p.alliance = ? AND p.current_name = ?
    ");
    $stmt->execute([$alliance, $name]);
    $rows = $stmt->fetchAll();
    if (!$rows) jsonOut(404, ['error' => 'Mitglied nicht gefunden']);

    $oldPlayerId   = $rows[0]['player_id'];
    $discordUserId = $rows[0]['discord_user_id'] ?? null;
    if (!$discordUserId) jsonOut(400, ['error' => 'Kein verknuepfter Discord-Account vorhanden']);
    if (strlen($discordUserId) > 36) jsonOut(400, ['error' => 'Discord-ID ist zu lang fuer player_id']);
    if ($oldPlayerId === $discordUserId) jsonOut(200, ['ok' => true, 'swapped' => false, 'player_id' => $oldPlayerId]);

    $taken = $pdo->prepare("SELECT 1 FROM players WHERE alliance = ? AND player_id = ? AND player_id <> ? LIMIT 1");
    $taken->execute([$alliance, $discordUserId, $oldPlayerId]);
    if ($taken->fetch()) jsonOut(409, ['error' => 'Discord-ID wird bereits von einem anderen Spieler genutzt']);

    $pdo->beginTransaction();
    try {
        $tempName = '__swap__' . substr(str_replace('-', '', uuid4()), 0, 12);
        $pdo->prepare("UPDATE players SET current_name = ? WHERE alliance = ? AND player_id = ?")->execute([$tempName, $alliance, $oldPlayerId]);
        $pdo->prepare("INSERT INTO players (alliance, player_id, current_name, current_rank_code, is_active, created_at, retired_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            ->execute([$alliance, $discordUserId, $rows[0]['current_name'], $rows[0]['current_rank_code'], $rows[0]['is_active'], $rows[0]['created_at'], $rows[0]['retired_at']]);
        foreach (['weekly_entries', 'player_name_history', 'player_identities', 'player_user_links'] as $tbl) {
            $pdo->prepare("UPDATE {$tbl} SET player_id = ? WHERE alliance = ? AND player_id = ?")->execute([$discordUserId, $alliance, $oldPlayerId]);
        }
        $pdo->prepare("DELETE FROM players WHERE alliance = ? AND player_id = ?")->execute([$alliance, $oldPlayerId]);
        $pdo->commit();
        jsonOut(200, ['ok' => true, 'swapped' => true, 'old_player_id' => $oldPlayerId, 'player_id' => $discordUserId]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate') || $e->getCode() === '23000') {
            jsonOut(409, ['error' => 'ID-Tausch nicht moeglich (Konflikt)']);
        }
        throw $e;
    }
}

function handleGetSeInactive(PDO $pdo, string $alliance): never {
    $weeks = max(1, min(12, (int)($_GET['weeks'] ?? 4)));

    $stmt = $pdo->prepare("
        SELECT DISTINCT we.year_week
        FROM weekly_entries we
        WHERE we.alliance = ?
        ORDER BY we.year_week DESC
        LIMIT ?
    ");
    $stmt->execute([$alliance, $weeks]);
    $recentWeeks = array_column($stmt->fetchAll(), 'year_week');

    if (empty($recentWeeks)) {
        jsonOut(200, ['weeks' => [], 'inactive' => []]);
    }

    $stmt = $pdo->prepare("SELECT player_id, current_name FROM players WHERE alliance = ? AND is_active = 1 ORDER BY current_name");
    $stmt->execute([$alliance]);
    $allPlayers = $stmt->fetchAll();

    $inactive = [];
    foreach ($allPlayers as $player) {
        $neverSE    = true;
        $alwaysAfk  = true;
        $weekDetails = [];

        foreach ($recentWeeks as $yw) {
            $stmt2 = $pdo->prepare("
                SELECT we.entry_id, we.afk
                FROM weekly_entries we
                WHERE we.alliance = ? AND we.year_week = ? AND we.player_id = ?
            ");
            $stmt2->execute([$alliance, $yw, $player['player_id']]);
            $entry = $stmt2->fetch();

            if (!$entry) {
                $weekDetails[$yw] = ['status' => 'missing', 'flags' => []];
                $alwaysAfk = false;
                continue;
            }

            if ($entry['afk']) {
                $weekDetails[$yw] = ['status' => 'afk', 'flags' => []];
                continue;
            }

            $alwaysAfk = false;

            $stmtF = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
            $stmtF->execute([$alliance, $entry['entry_id']]);
            $flags = array_column($stmtF->fetchAll(), 'flag_key');

            $hasSE = in_array('seTeilnahme', $flags, true);
            if ($hasSE) $neverSE = false;

            $weekDetails[$yw] = [
                'status' => $hasSE ? 'se' : 'no_se',
                'flags'  => $flags,
            ];
        }

        $hasAnyAfk = in_array('afk', array_column($weekDetails, 'status'), true);
        if ($neverSE && !$hasAnyAfk) {
            $inactive[] = [
                'name'  => $player['current_name'],
                'weeks' => $weekDetails,
            ];
        }
    }

    jsonOut(200, ['weeks' => $recentWeeks, 'inactive' => $inactive]);
}

function handleGetRankingHistory(PDO $pdo, string $alliance): never {
    $weeks = max(2, min(8, (int)($_GET['weeks'] ?? 4)));

    $currentKw = (int)(date('y') . date('W'));
    $weekClosed = (int)date('N') === 7;

    $stmt = $pdo->prepare("
        SELECT DISTINCT year_week FROM weekly_entries
        WHERE alliance = ? ORDER BY year_week DESC LIMIT ?
    ");
    $stmt->execute([$alliance, $weeks + 1]);
    $allWeeks = array_column($stmt->fetchAll(), 'year_week');

    $recentWeeks = [];
    $currentKwFiltered = false;
    foreach ($allWeeks as $yw) {
        if ((int)$yw === $currentKw && !$weekClosed) {
            $currentKwFiltered = true;
            continue;
        }
        $recentWeeks[] = $yw;
        if (count($recentWeeks) >= $weeks) break;
    }

    if (empty($recentWeeks)) {
        jsonOut(200, ['weeks' => [], 'players' => [], 'currentKwFiltered' => $currentKwFiltered]);
    }

    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM players WHERE alliance = ? AND is_active = 1 ORDER BY current_name");
    $stmt->execute([$alliance]);
    $allPlayers = $stmt->fetchAll();

    $result = [];
    foreach ($allPlayers as $player) {
        $playerWeeks = [];
        foreach ($recentWeeks as $yw) {
            $stmt2 = $pdo->prepare("SELECT we.entry_id, we.afk FROM weekly_entries we WHERE we.alliance = ? AND we.year_week = ? AND we.player_id = ?");
            $stmt2->execute([$alliance, $yw, $player['player_id']]);
            $entry = $stmt2->fetch();
            if (!$entry) {
                $playerWeeks[$yw] = ['flags' => [], 'afk' => false, 'missing' => true];
                continue;
            }
            $stmtF = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
            $stmtF->execute([$alliance, $entry['entry_id']]);
            $flags = [];
            foreach ($stmtF->fetchAll() as $f) $flags[$f['flag_key']] = true;
            $playerWeeks[$yw] = ['flags' => $flags, 'afk' => (bool)$entry['afk'], 'missing' => false];
        }
        $result[] = [
            'name'    => $player['current_name'],
            'rank'    => (int)$player['current_rank_code'],
            'entries' => $playerWeeks,
        ];
    }

    jsonOut(200, ['weeks' => $recentWeeks, 'players' => $result, 'currentKwFiltered' => $currentKwFiltered, 'currentKw' => $currentKw]);
}

function handleApplyRankChange(PDO $pdo, string $alliance, array $body, array $protectedNames): never {
    $name    = trim($body['name'] ?? '');
    $newRank = (int)($body['newRank'] ?? 0);
    $confirm = trim($body['confirmation'] ?? '');

    if ($name === '') jsonOut(400, ['error' => 'Name fehlt']);
    if ($newRank < 1 || $newRank > 5) jsonOut(400, ['error' => 'Ungültiger Rang']);
    if ($confirm === '') jsonOut(400, ['error' => 'Bestätigung fehlt']);

    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $name]);
    $player = $stmt->fetch();
    if (!$player) jsonOut(404, ['error' => 'Spieler nicht gefunden']);

    if ($player['current_rank_code'] >= 4 || $newRank >= 4) {
        jsonOut(403, ['error' => 'R4/R5 können nicht über dieses Tool geändert werden']);
    }

    $protection = applyProtectedRankRule($name, $newRank, $protectedNames);
    $effectiveRank = $protection['effectiveRank'];

    $oldRank = (int)$player['current_rank_code'];
    $pdo->prepare("UPDATE players SET current_rank_code = ? WHERE alliance = ? AND player_id = ?")
        ->execute([$effectiveRank, $alliance, $player['player_id']]);

    logRankChange($pdo, $alliance, [
        'playerId'      => $player['player_id'],
        'playerName'    => $player['current_name'],
        'oldRank'       => $oldRank,
        'requestedRank' => $newRank,
        'appliedRank'   => $effectiveRank,
        'source'        => 'manual:ergebnis',
        'blocked'       => $protection['blocked'],
        'reason'        => "confirmation:{$confirm}",
    ]);

    jsonOut(200, ['ok' => true, 'oldRank' => $oldRank, 'newRank' => $effectiveRank]);
}

function getBerufeMaxEngineersPerKriegsherr(PDO $pdo, string $alliance): int {
    ensureAllianceConfigTable($pdo);
    $stmt = $pdo->prepare("SELECT config_value FROM alliance_config WHERE alliance = ? AND config_key = 'berufe_max_ingenieure' LIMIT 1");
    $stmt->execute([$alliance]);
    $raw = $stmt->fetchColumn();
    $val = is_numeric($raw) ? (int)$raw : 3;
    if ($val < 1) $val = 1;
    if ($val > 10) $val = 10;
    return $val;
}

function handleSaveMemberBeruf(PDO $pdo, string $alliance, string $nameEncoded, array $body): never {
    ensureBerufColumns($pdo);
    $targetName = rawurldecode($nameEncoded);
    if (trim($targetName) === '') jsonOut(400, ['error' => 'Name fehlt']);

    $discordIdRaw = $body['discord_id'] ?? '';
    try {
        $requestDiscordId = normalizeDiscordId($discordIdRaw);
    } catch (\InvalidArgumentException) {
        jsonOut(403, ['error' => 'Nicht autorisiert']);
    }
    if ($requestDiscordId === '') jsonOut(403, ['error' => 'Nicht autorisiert']);

    $requester = getDiscordMember($pdo, $alliance, $requestDiscordId);
    if (!$requester) jsonOut(403, ['error' => 'Nicht berechtigt']);

    $requesterRank = safeRank((int)$requester['current_rank_code']);
    $requesterName = $requester['current_name'];

    if ($requesterRank < 4 && strtolower($requesterName) !== strtolower($targetName)) {
        jsonOut(403, ['error' => 'Nur eigene Berufsdaten erlaubt']);
    }

    $stmt = $pdo->prepare("SELECT player_id FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1 LIMIT 1");
    $stmt->execute([$alliance, $targetName]);
    $target = $stmt->fetch();
    if (!$target) jsonOut(404, ['error' => 'Mitglied nicht gefunden']);

    $beruf = array_key_exists('beruf', $body) ? ($body['beruf'] ?: null) : null;
    if ($beruf !== null && !in_array($beruf, ['ingenieur', 'kriegsherr'], true)) {
        jsonOut(400, ['error' => 'Ungültiger Beruf']);
    }
    $medHilfe = ($beruf === 'ingenieur' && !empty($body['med_hilfe'])) ? 1 : 0;
    $winwin   = ($beruf === 'ingenieur') ? (trim((string)($body['winwin'] ?? '')) ?: null) : null;

    if ($winwin !== null) {
        $maxEngineers = getBerufeMaxEngineersPerKriegsherr($pdo, $alliance);
        $chk = $pdo->prepare("SELECT beruf FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1 LIMIT 1");
        $chk->execute([$alliance, $winwin]);
        $chkRow = $chk->fetch();
        if (!$chkRow || $chkRow['beruf'] !== 'kriegsherr') {
            jsonOut(400, ['error' => 'Win-Win Ziel ist kein Kriegsherr']);
        }
        $cntStmt = $pdo->prepare(
            "SELECT COUNT(*) AS cnt FROM players WHERE alliance = ? AND beruf_winwin = ? AND player_id != ? AND is_active = 1"
        );
        $cntStmt->execute([$alliance, $winwin, $target['player_id']]);
        if ((int)($cntStmt->fetch()['cnt'] ?? 0) >= $maxEngineers) {
            jsonOut(409, ['error' => "Dieser Kriegsherr hat bereits {$maxEngineers} Ingenieure"]);
        }
    }

    $pdo->prepare("UPDATE players SET beruf = ?, beruf_med_hilfe = ?, beruf_winwin = ? WHERE alliance = ? AND player_id = ?")
        ->execute([$beruf, $medHilfe, $winwin, $alliance, $target['player_id']]);

    if ($beruf !== 'kriegsherr') {
        $pdo->prepare("UPDATE players SET beruf_winwin = NULL WHERE alliance = ? AND beruf_winwin = ?")
            ->execute([$alliance, $targetName]);
    }

    jsonOut(200, ['ok' => true]);
}
