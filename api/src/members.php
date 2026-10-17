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
    if (!$member && isSiteAdmin($pdo, $discordId)) {
        // Betreiber ohne eigenen Char: sieht alles wie R5, die Schreibrouten weisen ihn ab
        $member = siteViewerMember($discordId);
    }
    if (!$member) {
        jsonOut(403, ['ok' => false, 'error' => 'Nicht berechtigt']);
    }

    $rank = safeRank((int)$member['current_rank_code']);
    $effectiveRank = effectiveRankForAccess($rank, normalizeHonorRole($member['honor_role'] ?? null));

    if ($section === 'r4'    && $effectiveRank < 4) jsonOut(403, ['ok' => false, 'error' => 'Rang 4 oder höher erforderlich']);
    if ($section === 'admin' && $effectiveRank < 5) jsonOut(403, ['ok' => false, 'error' => 'Rang 5 erforderlich']);

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

    // Betreiber, der gerade eine Allianz ohne eigenen Char ansieht (user_active_char mit leerer player_id)
    $viewAlliance = getSiteViewerAlliance($pdo, $discordId);
    if ($viewAlliance !== null) {
        jsonOut(200, siteViewerVerifyPayload($pdo, $viewAlliance, $discordId));
    }

    // Resolve effective membership first (prefers server-side active char) to keep
    // re-login/reopen in the same alliance context across sessions/devices.
    $member = getDiscordMemberAcrossAlliances($pdo, $discordId);
    if ($member && !empty($member['alliance'])) {
        $alliance = (string)$member['alliance'];
    } elseif (!$member) {
        // Backward-compatible fallback for installations without full cross-alliance linkage.
        $member = getDiscordMember($pdo, $alliance, $discordId);
    }
    if (!$member && isSiteAdmin($pdo, $discordId)) {
        jsonOut(200, siteViewerVerifyPayload($pdo, $alliance, $discordId));
    }
    if (!$member) jsonOut(200, ['ok' => false, 'error' => 'Kein Zugriff']);

    $rank = safeRank((int)$member['current_rank_code']);
    $honorRole = normalizeHonorRole($member['honor_role'] ?? null);
    $effectiveRank = effectiveRankForAccess($rank, $honorRole);
    $resolvedRole = roleFromMemberState($rank, $honorRole);
    $canWrite = memberCanWrite($honorRole);
    jsonOut(200, [
        'ok'                => true,
        'alliance'          => $alliance,
        'member_id'         => $member['player_id'],
        'member_name'       => $member['current_name'],
        'rank'              => $rank,
        'role'              => $resolvedRole,
        'honor_role'        => $honorRole,
        'can_manage'        => $effectiveRank >= 4,
        'can_write'         => $canWrite,
        'read_only'         => !$canWrite,
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
    $honorRole = normalizeHonorRole($member['honor_role'] ?? null);
    $effectiveRank = effectiveRankForAccess($rank, $honorRole);
    $resolvedRole = roleFromMemberState($rank, $honorRole);
    $canWrite = memberCanWrite($honorRole);
    jsonOut(200, [
        'ok'     => true,
        'member' => [
            'id'               => $member['player_id'],
            'name'             => $member['current_name'],
            'rank'             => $rank,
            'role'             => $resolvedRole,
            'honor_role'       => $honorRole,
            'can_manage'       => $effectiveRank >= 4,
            'can_write'        => $canWrite,
            'read_only'        => !$canWrite,
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
    // Rangwechsel von Ehren-Eintraegen gehoeren nicht ins Protokoll der Allianz
    $noHonor = "AND (player_id IS NULL OR player_id NOT IN (SELECT hp.player_id FROM players hp WHERE hp.alliance = rank_change_log.alliance AND NOT " . sqlNoHonor('hp') . "))";

    if ($nameFilter !== '') {
        $stmt = $pdo->prepare("
            SELECT player_name, old_rank_code, requested_rank_code, applied_rank_code,
                   source, is_blocked, reason, created_at
            FROM rank_change_log
            WHERE alliance = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?)) {$noHonor}
            ORDER BY created_at DESC
            LIMIT {$limit}
        ");
        $stmt->execute([$alliance, $nameFilter]);
    } else {
        $stmt = $pdo->prepare("
            SELECT player_name, old_rank_code, requested_rank_code, applied_rank_code,
                   source, is_blocked, reason, created_at
            FROM rank_change_log
            WHERE alliance = ? {$noHonor}
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
    ensureScannerColumns($pdo);

    // ?scope=game: nur wer im Spiel in der Allianz ist (ohne Ehrenrollen) – fuer Scanner und Auswertungen.
    // Ohne scope kommen alle, damit die Verwaltung die Ehren-Eintraege anzeigen und pflegen kann.
    $gameFilter = ($_GET['scope'] ?? '') === 'game' ? 'AND ' . sqlNoHonor() : '';

    // Heimat-Allianz eines Ehren-Eintrags: Freitext, der auf eine angelegte Allianz verweist, wenn das Kuerzel passt
    $knownAlliances = [];
    try {
        foreach ($pdo->query("SELECT alliance, alliance_name FROM alliances")->fetchAll() as $a) {
            $knownAlliances[strtolower($a['alliance'])] = $a;
        }
    } catch (\PDOException) {}

    $aliasesByPlayer = [];
    try {
        $aliasStmt = $pdo->prepare("SELECT player_id, player_name FROM player_name_history WHERE alliance = ?");
        $aliasStmt->execute([$alliance]);
        foreach ($aliasStmt->fetchAll() as $ah) {
            $aliasesByPlayer[$ah['player_id']][] = $ah['player_name'];
        }
    } catch (\PDOException) {}

    $stmt = $pdo->prepare("
        SELECT p.player_id, p.alliance, p.current_name, p.current_rank_code, p.honor_role, p.honor_home, p.last_visit_at, p.preferred_language,
               p.beruf, p.beruf_med_hilfe, p.beruf_winwin,
               p.current_power, p.hq_level, p.last_scanned_at, p.last_seen_status,
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
        WHERE p.alliance = ? AND p.is_active = 1 {$gameFilter}
        ORDER BY p.current_name
    ");
    $stmt->execute([$alliance]);
    $rows = $stmt->fetchAll();

    $result = array_map(static function($r) use ($aliasesByPlayer, $knownAlliances): array {
        $rank = safeRank((int)$r['current_rank_code']);
        $honorRole = normalizeHonorRole($r['honor_role'] ?? null);
        $effectiveRank = effectiveRankForAccess($rank, $honorRole);
        $canWrite = memberCanWrite($honorRole);
        $aliases = array_values(array_unique(array_filter($aliasesByPlayer[$r['player_id']] ?? [])));
        return [
            'id'                 => $r['player_id'],
            'alliance'           => $r['alliance'],
            'name'               => $r['current_name'],
            'default_rank'       => $rank,
            'role'               => roleFromMemberState($rank, $honorRole),
            'honor_role'         => $honorRole,
            'honor_home'         => $honorRole !== null ? ($r['honor_home'] ?? null) : null,
            'honor_home_alliance'=> $honorRole !== null && !empty($r['honor_home'])
                ? ($knownAlliances[strtolower((string)$r['honor_home'])]['alliance'] ?? null) : null,
            'can_manage'         => $effectiveRank >= 4,
            'can_write'          => $canWrite,
            'read_only'          => !$canWrite,
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
            'current_power'      => is_numeric($r['current_power']) ? (int)$r['current_power'] : null,
            'hq_level'           => is_numeric($r['hq_level']) ? (int)$r['hq_level'] : null,
            'last_scanned_at'    => $r['last_scanned_at'] ?? null,
            'last_seen_status'   => $r['last_seen_status'] ?? null,
            'aliases'            => $aliases,
        ];
    }, $rows);

    jsonOut(200, $result);
}

function handleAddMember(PDO $pdo, string $alliance, array $body, array $protectedNames): never {
    ensurePreferredLanguageColumn($pdo);
    ensureHonorRoleColumn($pdo);
    // body.discord_id ist hier die Discord-ID des neuen Mitglieds; der Aufrufer kommt aus Token/X-Discord-Id
    requireAllianceWriter($pdo, $alliance, 4);
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
        $honorRole = normalizeHonorRole($body['honor_role'] ?? null, true);
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }
    try {
        $preferredLanguage = normalizePreferredLanguage($body['preferred_language'] ?? 'de');
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }
    $honorHome     = $honorRole !== null ? normalizeHonorHome($body['honor_home'] ?? null) : null;
    $protection    = applyProtectedRankRule($name, $requestedRank, $protectedNames);
    $rank          = $protection['effectiveRank'];
    if ($honorRole === 'honor_r4') $rank = 4;
    $playerId      = uuid4();
    $nameEventId   = uuid4();

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("INSERT INTO players (alliance, player_id, current_name, current_rank_code, honor_role, honor_home, preferred_language, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)");
        $stmt->execute([$alliance, $playerId, $name, $rank, $honorRole, $honorHome, $preferredLanguage]);

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
    requireR5($pdo, $discordId, $fromAlliance);

    $toAlliance = trim($body['to_alliance'] ?? '');
    if ($toAlliance === '') jsonOut(400, ['error' => 'Ziel-Allianz fehlt']);
    if ($toAlliance === $fromAlliance) jsonOut(400, ['error' => 'Spieler ist bereits in dieser Allianz']);

    $aStmt = $pdo->prepare("SELECT 1 FROM alliances WHERE alliance = ? LIMIT 1");
    $aStmt->execute([$toAlliance]);
    if (!$aStmt->fetch()) jsonOut(404, ['error' => 'Ziel-Allianz nicht gefunden']);

    $stmt = $pdo->prepare("SELECT player_id, current_rank_code, honor_role FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1 LIMIT 1");
    $stmt->execute([$fromAlliance, $name]);
    $player = $stmt->fetch();
    if (!$player) jsonOut(404, ['error' => 'Spieler nicht gefunden']);
    if (normalizeHonorRole($player['honor_role'] ?? null) !== null) {
        jsonOut(400, ['error' => 'Ehren-Eintraege werden nicht verschoben – in der Heimat-Allianz bitte einen eigenen Eintrag anlegen']);
    }

    $check = $pdo->prepare("SELECT 1 FROM players WHERE alliance = ? AND current_name = ? LIMIT 1");
    $check->execute([$toAlliance, $name]);
    if ($check->fetch()) jsonOut(409, ['error' => 'Name bereits in Ziel-Allianz vergeben']);

    $playerId = $player['player_id'];

    // Gleiche Funktion wie der Scanner-Sync (Konzept v2, A6): Wochen samt Flags, Namen, Discord- und
    // Konto-Verknuepfung, aktiver Charakter und Scan-Werte wandern mit.
    $pdo->beginTransaction();
    try {
        movePlayerToAlliance($pdo, $playerId, $fromAlliance, $toAlliance);
        $pdo->commit();
        jsonOut(200, ['ok' => true, 'player_id' => $playerId, 'to_alliance' => $toAlliance]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function handleUpdateMember(PDO $pdo, string $alliance, string $oldNameEncoded, array $body, array $protectedNames): never {
    ensurePreferredLanguageColumn($pdo);
    ensureHonorRoleColumn($pdo);
    // body.discord_id ist hier die Discord-ID des bearbeiteten Mitglieds; der Aufrufer kommt aus Token/X-Discord-Id
    requireAllianceWriter($pdo, $alliance, 4);
    $oldName = rawurldecode($oldNameEncoded);
    $newName = trim($body['name'] ?? $oldName);
    if ($newName === '') jsonOut(400, ['error' => 'Name fehlt']);

    $requestedRank = safeRank((int)($body['default_rank'] ?? $body['rank'] ?? 3));
    try {
        $honorRole = normalizeHonorRole($body['honor_role'] ?? null, true);
    } catch (\InvalidArgumentException $e) {
        jsonOut(400, ['error' => $e->getMessage()]);
    }

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
        if ($honorRole === 'honor_r4') $rank = 4;
        if ($honorRole === null || array_key_exists('honor_home', $body)) {
            $pdo->prepare("UPDATE players SET honor_home = ? WHERE alliance = ? AND player_id = ?")
                ->execute([$honorRole !== null ? normalizeHonorHome($body['honor_home'] ?? null) : null, $alliance, $playerId]);
        }
        if ($preferredLanguageSet) {
            $stmt = $pdo->prepare("UPDATE players SET current_name = ?, current_rank_code = ?, honor_role = ?, preferred_language = ?, is_active = 1, retired_at = NULL WHERE alliance = ? AND player_id = ?");
            $stmt->execute([$newName, $rank, $honorRole, $preferredLanguage, $alliance, $playerId]);
        } else {
            $stmt = $pdo->prepare("UPDATE players SET current_name = ?, current_rank_code = ?, honor_role = ?, is_active = 1, retired_at = NULL WHERE alliance = ? AND player_id = ?");
            $stmt->execute([$newName, $rank, $honorRole, $alliance, $playerId]);
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

    $requester = requireAllianceWriter($pdo, $alliance, 1, true, $discordId)['member'];
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

function archivePlayerInternal(PDO $pdo, string $alliance, string $playerId, ?string $archivedBy = null): bool {
    if (!$pdo->inTransaction()) {
        ensureArchiveTables($pdo);
        ensureUserActiveCharTable($pdo);
    }

    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code, created_at FROM players WHERE alliance = ? AND player_id = ?");
    $stmt->execute([$alliance, $playerId]);
    $row = $stmt->fetch();
    if (!$row) return false;

    $archiveId = uuid4();

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
    } catch (\PDOException) {}
    $pdo->prepare("DELETE FROM weekly_entries WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
    try { $pdo->prepare("DELETE FROM player_name_history WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]); } catch (\PDOException) {}
    try { $pdo->prepare("DELETE FROM player_user_links WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]); } catch (\PDOException) {}
    try { $pdo->prepare("DELETE FROM player_identities WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]); } catch (\PDOException) {}
    $pdo->prepare("DELETE FROM players WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
    try {
        $pdo->prepare("DELETE FROM user_active_char WHERE alliance = ? AND player_id = ?")->execute([$alliance, $playerId]);
    } catch (\PDOException) {}

    return true;
}

function handleDeleteMember(PDO $pdo, string $alliance, string $nameEncoded, array $body = []): never {
    requireAllianceWriter($pdo, $alliance, 4, false, (string)($body['discord_id'] ?? ''));
    $name = rawurldecode($nameEncoded);
    $stmt = $pdo->prepare("SELECT player_id FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $name]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(200, ['ok' => true]);

    $archivedBy = null;
    try { $archivedBy = normalizeDiscordId($body['discord_id'] ?? ''); } catch (\InvalidArgumentException) {}
    if ($archivedBy === '') $archivedBy = null;

    $pdo->beginTransaction();
    try {
        archivePlayerInternal($pdo, $alliance, $row['player_id'], $archivedBy);
        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function handleArchiveMemberById(PDO $pdo, string $alliance, string $idOrNameEncoded, array $body = []): never {
    $idOrName = rawurldecode($idOrNameEncoded);
    $stmt = $pdo->prepare("SELECT player_id FROM players WHERE alliance = ? AND (player_id = ? OR current_name = ?) LIMIT 1");
    $stmt->execute([$alliance, $idOrName, $idOrName]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(404, ['error' => 'Spieler nicht gefunden']);

    $archivedBy = null;
    try { $archivedBy = normalizeDiscordId($body['discord_id'] ?? ''); } catch (\InvalidArgumentException) {}
    if ($archivedBy === '') $archivedBy = 'scanner';

    $pdo->beginTransaction();
    try {
        archivePlayerInternal($pdo, $alliance, $row['player_id'], $archivedBy);
        $pdo->commit();
        jsonOut(200, ['ok' => true, 'player_id' => $row['player_id']]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function handleSwapIdToDiscord(PDO $pdo, string $alliance, string $nameEncoded): never {
    requireAllianceWriter($pdo, $alliance, 4);
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

    $stmt = $pdo->prepare("SELECT player_id, current_name FROM players WHERE alliance = ? AND is_active = 1 AND " . sqlNoHonor('') . " ORDER BY current_name");
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

    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM players WHERE alliance = ? AND is_active = 1 AND " . sqlNoHonor('') . " ORDER BY current_name");
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
    requireAllianceWriter($pdo, $alliance, 4, false, (string)($body['discord_id'] ?? ''));

    $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code, honor_role FROM players WHERE alliance = ? AND current_name = ?");
    $stmt->execute([$alliance, $name]);
    $player = $stmt->fetch();
    if (!$player) jsonOut(404, ['error' => 'Spieler nicht gefunden']);
    if (normalizeHonorRole($player['honor_role'] ?? null) !== null) {
        jsonOut(400, ['error' => 'Ehrenrollen haben keinen Spielrang in dieser Allianz']);
    }

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

    $requester = requireAllianceWriter($pdo, $alliance, 1, true, $requestDiscordId)['member'];
    if (!$requester) jsonOut(403, ['error' => 'Nicht berechtigt']);

    $requesterRank = safeRank((int)$requester['current_rank_code']);
    $requesterName = $requester['current_name'];

    if ($requesterRank < 4 && strtolower($requesterName) !== strtolower($targetName)) {
        jsonOut(403, ['error' => 'Nur eigene Berufsdaten erlaubt']);
    }

    $stmt = $pdo->prepare("SELECT player_id FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1 AND " . sqlNoHonor('') . " LIMIT 1");
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
        $chk = $pdo->prepare("SELECT beruf FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1 AND " . sqlNoHonor('') . " LIMIT 1");
        $chk->execute([$alliance, $winwin]);
        $chkRow = $chk->fetch();
        if (!$chkRow || $chkRow['beruf'] !== 'kriegsherr') {
            jsonOut(400, ['error' => 'Win-Win Ziel ist kein Kriegsherr']);
        }
        $cntStmt = $pdo->prepare(
            "SELECT COUNT(*) AS cnt FROM players WHERE alliance = ? AND beruf_winwin = ? AND player_id != ? AND is_active = 1 AND " . sqlNoHonor('')
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

// Wochen-Eintraege (samt Flags) eines Spielers in eine andere Allianz verschieben: in der Ziel-Allianz neu
// anlegen (insertWeeklyEntryWithFlags, archive.php), dann in der alten loeschen – die Fremdschluessel lassen
// kein Umschreiben der Allianz zu. Wochen, die er im Ziel schon hat, bleiben in der alten Allianz.
function moveWeeklyEntries(PDO $pdo, string $playerId, string $fromAlliance, string $toAlliance): void {
    $rows = $pdo->prepare("SELECT * FROM weekly_entries WHERE alliance = ? AND player_id = ?");
    $rows->execute([$fromAlliance, $playerId]);
    $flags = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
    foreach ($rows->fetchAll() as $entry) {
        $flags->execute([$fromAlliance, $entry['entry_id']]);
        if (!insertWeeklyEntryWithFlags($pdo, $toAlliance, $entry, array_column($flags->fetchAll(), 'flag_key'))) continue;
        $pdo->prepare("DELETE FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?")->execute([$fromAlliance, $entry['entry_id']]);
        $pdo->prepare("DELETE FROM weekly_entries WHERE alliance = ? AND entry_id = ?")->execute([$fromAlliance, $entry['entry_id']]);
    }
}

// Spieler samt Historie in eine andere Allianz verschieben (Sync: er ist noch in einer anderen Allianz aktiv,
// z. B. ein Urlauber kommt zurueck). Die Fremdschluessel auf players (Allianz + Spieler, RESTRICT) verbieten,
// players.alliance direkt umzuschreiben – das brach bis 17.10. den ganzen Sync ab, sobald der Spieler auch nur
// einen Namens-Eintrag hatte. Darum: Spieler in der Ziel-Allianz anlegen, Abhaengiges umhaengen, alte Zeile
// loeschen. Was im Ziel schon existiert (gleiche Woche), gilt dort; der doppelte alte Eintrag entfaellt.
// Auch das R5-Werkzeug "Spieler verschieben" (handleTransferPlayer) nutzt diese Funktion. Der Aufrufer
// oeffnet die Transaktion.
function movePlayerToAlliance(PDO $pdo, string $playerId, string $fromAlliance, string $toAlliance): void {
    for ($r = 1; $r <= 5; $r++) {
        $pdo->prepare("INSERT IGNORE INTO ranks (alliance, rank_code) VALUES (?, ?)")->execute([$toAlliance, $r]);
    }
    $cols = array_values(array_diff(array_column($pdo->query("SHOW COLUMNS FROM players")->fetchAll(), 'Field'), ['alliance']));
    $list = implode(', ', array_map(fn($c) => "`$c`", $cols));
    $pdo->prepare("INSERT INTO players (alliance, $list) SELECT ?, $list FROM players WHERE alliance = ? AND player_id = ?")
        ->execute([$toAlliance, $fromAlliance, $playerId]);

    foreach (['player_identities', 'player_name_history', 'player_user_links'] as $tbl) {
        try {
            $pdo->prepare("UPDATE IGNORE `$tbl` SET alliance = ? WHERE alliance = ? AND player_id = ?")->execute([$toAlliance, $fromAlliance, $playerId]);
            $pdo->prepare("DELETE FROM `$tbl` WHERE alliance = ? AND player_id = ?")->execute([$fromAlliance, $playerId]);
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
    }

    moveWeeklyEntries($pdo, $playerId, $fromAlliance, $toAlliance);
    $pdo->prepare("DELETE wef FROM weekly_entry_flags wef JOIN weekly_entries we ON wef.alliance = we.alliance AND wef.entry_id = we.entry_id WHERE we.alliance = ? AND we.player_id = ?")
        ->execute([$fromAlliance, $playerId]);
    $pdo->prepare("DELETE FROM weekly_entries WHERE alliance = ? AND player_id = ?")->execute([$fromAlliance, $playerId]);

    foreach (['user_active_char', 'player_metrics'] as $tbl) {
        try {
            $pdo->prepare("UPDATE `$tbl` SET alliance = ? WHERE alliance = ? AND player_id = ?")->execute([$toAlliance, $fromAlliance, $playerId]);
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
    }
    $pdo->prepare("DELETE FROM players WHERE alliance = ? AND player_id = ?")->execute([$fromAlliance, $playerId]);
}

// Vergleichsschluessel fuer Namen aus dem Scanner: OCR verwechselt Gross/klein, I/l/1, O/0 und liest
// Umlaute ohne Punkte bzw. ß als B ("LMNTRIX" fuer "LMNTRiX", "Muller214" fuer "Müller214").
function scanNameKey(string $name): string {
    $s = strtr(trim($name), ['Ä' => 'a', 'Ö' => 'o', 'Ü' => 'u', 'ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'ß' => 'b', 'Ø' => '0', 'ø' => '0']);
    $s = strtolower($s); // nur ASCII; andere Schriften bleiben, wie sie sind (beide Seiten gleich behandelt)
    $s = preg_replace('/[^\p{L}\p{N}]/u', '', $s) ?? '';
    return strtr($s, ['i' => '1', 'l' => '1', '|' => '1', 'o' => '0']);
}

/**
 * Archivierten Spieler zu einem gescannten Namen finden, der in der Ziel-Allianz nicht aktiv ist.
 * Reihenfolge: gleicher Name in der Ziel-Allianz, gleicher Name in einer anderen Allianz, dann gleicher
 * Vergleichsschluessel (scanNameKey) – zuerst in der Ziel-Allianz. Beim Vergleichsschluessel nur, wenn genau
 * ein archivierter Spieler passt und der Archiv-Name in der Ziel-Allianz nicht schon vergeben ist.
 * $allowed(alliance) grenzt ein, aus welchen Archiven geholt werden darf (Konzept v2, A5: nur Allianzen, in
 * denen der Aufrufer selbst R4/R5 ist).
 */
function findArchivedPlayerForScan(PDO $pdo, string $name, string $targetAlliance, callable $allowed): ?array {
    $cols = "archive_id, alliance, player_id, current_name, current_rank_code, player_created_at";
    $stmt = $pdo->prepare("SELECT $cols FROM archived_players WHERE current_name = ? ORDER BY alliance = ? DESC, archived_at DESC");
    $stmt->execute([$name, $targetAlliance]);
    foreach ($stmt->fetchAll() as $exact) {
        if ($allowed($exact['alliance'])) return $exact;
    }

    $key = scanNameKey($name);
    if (strlen($key) < 3) return null;
    $all = $pdo->query("SELECT $cols, archived_at FROM archived_players ORDER BY archived_at DESC")->fetchAll();
    $matches = array_values(array_filter($all, fn($a) => scanNameKey((string)$a['current_name']) === $key && $allowed($a['alliance'])));
    if (!$matches) return null;
    $home = array_values(array_filter($matches, fn($a) => $a['alliance'] === $targetAlliance));
    $pool = $home ?: $matches;
    if (count(array_unique(array_column($pool, 'player_id'))) !== 1) return null;

    $taken = $pdo->prepare("SELECT 1 FROM players WHERE alliance = ? AND current_name = ? AND player_id <> ? LIMIT 1");
    $taken->execute([$targetAlliance, $pool[0]['current_name'], $pool[0]['player_id']]);
    return $taken->fetch() ? null : $pool[0];
}

// Allianz-Kuerzel aus einer VS-Liste ("[NxU1]") gegen die eigene Allianz. OCR-Verwechslungen (I/l/1, O/0,
// Klammern) gleicht die Normalisierung aus; sonst exakt, denn Schwester-Allianzen unterscheiden sich oft nur
// in einer Ziffer (NxU1/NxU2).
function scanAllianceTagMatches(string $tag, string $alliance): bool {
    $n = fn(string $t) => preg_replace('/[^a-z0-9]/', '', strtr(strtolower(trim($t)), ['i' => '1', 'l' => '1', '|' => '1', 'o' => '0'])) ?? '';
    return $n($tag) === $n($alliance);
}

// Spielwoche wie weekly_entries.year_week (2642 = 2026 KW 42). Die App darf 202642 schicken.
function normalizeScanYearWeek(mixed $value): ?int {
    if ($value === null || $value === '' || !is_numeric($value)) return null;
    $s = (string)(int)$value;
    if (strlen($s) === 6) $s = substr($s, 2);
    if (strlen($s) !== 4) return null;
    $week = (int)substr($s, 2);
    return $week >= 1 && $week <= 53 ? (int)$s : null;
}

const SCAN_VALUE_TYPES = ['VS_DAY', 'VS_WEEK', 'KILLS', 'DONATION_DAY', 'DONATION_WEEK'];
const SCAN_READ_STATUSES = ['ok', 'corrected', 'conflicting', 'unreadable'];

function handleSyncScans(PDO $pdo, string $alliance, array $body, array $protectedNames = []): never {
    set_time_limit(120);
    ensureScannerColumns($pdo);
    ensurePlayerMetricsTable($pdo);
    ensureArchiveTables($pdo);
    ensureUserActiveCharTable($pdo);

    $targetAlliance = !empty($body['alliance']) ? trim($body['alliance']) : $alliance;
    // App-Token: die Allianz kommt aus dem Token, body.alliance muss leer sein oder passen.
    $tokenAlliance = requestApiTokenAlliance($pdo);
    if ($tokenAlliance !== null) {
        if (!empty($body['alliance']) && strcasecmp(trim($body['alliance']), $tokenAlliance) !== 0) {
            $targetAlliance = trim($body['alliance']); // requireScannerAccess lehnt ab und protokolliert
        } else {
            $targetAlliance = $tokenAlliance;
        }
    }
    // Nur R4/R5 der Ziel-Allianz (oder Site-Admins) mit von Discord bestaetigtem Token duerfen schreiben,
    // dazu App-Tokens der Allianz. Rolle scanner nur eingeschraenkt (siehe $scannerOnly).
    $claimedId = (string)($body['discord_id'] ?? '');
    $caller = requireScannerAccess($pdo, $targetAlliance, preg_match('/^\d+$/', $claimedId) ? $claimedId : null, false, true);
    // Rolle scanner (Konzept v2, A5): nur Werte bei bekannter player_id oder eindeutigem exaktem Namen in
    // der eigenen Allianz. Nichts anlegen, zurueckholen, verschieben, archivieren, kein Rang. Rest -> unmatched.
    $scannerOnly = ($caller['token_role'] ?? null) === 'scanner';
    $dryRun = !empty($body['dry_run']);
    $entries = $body['entries'] ?? [];
    if (!is_array($entries)) jsonOut(400, ['error' => 'Ungültige Entries-Liste']);

    $source = trim($body['source'] ?? 'scanner');
    $recordedAt = !empty($body['recorded_at']) ? date('Y-m-d H:i:s', strtotime($body['recorded_at'])) : date('Y-m-d H:i:s');

    // Konzept v2, A12 (App-Format): scan_type fuer die ganze Erfassung, Wert in entries[].value_numeric.
    // Ohne scan_type gilt das Web-Scanner-Format (power_str, vs[]) wie bisher.
    $scanType = strtoupper(trim((string)($body['scan_type'] ?? '')));
    if ($scanType === 'DONATION') $scanType = 'DONATION_WEEK'; // Typname der App
    if ($scanType !== '' && !in_array($scanType, [...SCAN_VALUE_TYPES, 'POWER', 'MEMBERS_LIST'], true)) {
        jsonOut(400, ['error' => "Unbekannter scan_type: {$scanType}"]);
    }
    // scan_id: dieselbe Erfassung erneut hochgeladen -> alte Werte dieser scan_id ersetzen
    $scanId = trim((string)($body['scan_id'] ?? ''));
    if ($scanId !== '' && !preg_match('/^[0-9a-fA-F-]{8,36}$/', $scanId)) jsonOut(400, ['error' => 'Ungültige scan_id']);
    $scanId = $scanId !== '' ? strtolower($scanId) : null;
    $yearWeekOverride = normalizeScanYearWeek($body['year_week'] ?? null);
    $bodyGameDay = isset($body['game_day']) && is_numeric($body['game_day']) && (int)$body['game_day'] >= 1 && (int)$body['game_day'] <= 7
        ? (int)$body['game_day'] : null;

    // Verschieben aus einer anderen Allianz nur fuer R5 (Konzept v2, A6). Andere Allianzen (Verschieben,
    // Archiv) nur, wo der Aufrufer selbst R4/R5 ohne Ehrenrolle ist; App-Tokens nur ihre eigene Allianz.
    $canTransfer = !$scannerOnly && (int)($caller['rank'] ?? 0) >= 5;
    $managed = [];
    $canManage = function (string $other) use ($pdo, $caller, $targetAlliance, &$managed): bool {
        if (strcasecmp($other, $targetAlliance) === 0) return true;
        if (!empty($caller['token_id'])) return false;
        $id = $caller['discord_id'] ?? null;
        if ($id === null) return ($caller['can_scan'] ?? false) === true; // lokal bzw. Modus off
        if (!array_key_exists($other, $managed)) {
            $m = getDiscordMember($pdo, $other, $id, true);
            $managed[$other] = $m !== null && empty($m['site_viewer']) && normalizeHonorRole($m['honor_role'] ?? null) === null;
        }
        return $managed[$other];
    };

    $summary = [
        'total' => count($entries),
        'updated' => 0,
        'created' => 0,
        'restored' => 0,
        'transferred' => 0,
        'archived' => 0,
        'rank_changes' => 0,
        'unmatched' => 0,
        'ignored_other_alliance' => 0,
    ];
    $replacedPrevious = false;
    $details = [];
    $conflicts = [];
    $unmatched = [];

    // Resolve a scanned shield number (R1–R5) against the stored rank:
    // - protected R4 names always stay at rank 4; blocked deviations -> conflict + rank_change_log
    // - honor members are read-only; the scanned rank never overwrites their stored rank
    // Returns [finalRank, blocked, reason].
    $resolveScanRank = function (string $name, ?int $requested, int $oldRank, ?string $honorRole, ?string $playerId) use ($protectedNames, &$conflicts): array {
        if ($requested === null) return [$oldRank, false, null];
        if ($playerId !== null && !memberCanWrite($honorRole)) {
            $conflicts[] = [
                'name'         => $name,
                'scanned_rank' => $requested,
                'kept_rank'    => $oldRank,
                'blocked'      => true,
                'reason'       => 'honor-member-read-only',
            ];
            return [$oldRank, false, null];
        }
        $p = applyProtectedRankRule($name, $requested, $protectedNames);
        if ($p['blocked']) {
            $conflicts[] = [
                'name'         => $name,
                'scanned_rank' => $requested,
                'kept_rank'    => $p['effectiveRank'],
                'blocked'      => true,
                'reason'       => 'protected-r4-member',
            ];
        }
        return [$p['effectiveRank'], $p['blocked'], $p['protectedMember'] ? 'protected-r4-member' : null];
    };

    $archivePlayerIds = $body['archive_player_ids'] ?? [];
    if (!is_array($archivePlayerIds)) $archivePlayerIds = [];
    if ($scannerOnly && $archivePlayerIds) {
        $conflicts[] = ['blocked' => true, 'reason' => 'scanner-no-archive', 'count' => count($archivePlayerIds)];
        $archivePlayerIds = [];
    }

    $pdo->beginTransaction();
    try {
        if ($scanId !== null) {
            $del = $pdo->prepare("DELETE FROM player_metrics WHERE alliance = ? AND scan_id = ?");
            $del->execute([$targetAlliance, $scanId]);
            $replacedPrevious = $del->rowCount() > 0;
        }

        // Process any members to archive
        foreach ($archivePlayerIds as $archTarget) {
            $archTarget = trim((string)$archTarget);
            if ($archTarget === '') continue;
            // Can be player_id or current_name
            $stmt = $pdo->prepare("SELECT player_id, current_name, honor_role FROM players WHERE alliance = ? AND (player_id = ? OR current_name = ?) LIMIT 1");
            $stmt->execute([$targetAlliance, $archTarget, $archTarget]);
            $pRow = $stmt->fetch();
            // Ehrenrollen stehen im Spiel nie in der Mitgliederliste – fehlen ist bei ihnen kein Grund zum Archivieren
            if ($pRow && normalizeHonorRole($pRow['honor_role'] ?? null) !== null) {
                $conflicts[] = ['name' => $pRow['current_name'], 'blocked' => true, 'reason' => 'honor-not-archivable'];
                continue;
            }
            if ($pRow) {
                if (archivePlayerInternal($pdo, $targetAlliance, $pRow['player_id'], 'scanner_sync')) {
                    $summary['archived']++;
                }
            }
        }

        foreach ($entries as $e) {
            $name = trim($e['name'] ?? '');
            if ($name === '') continue;

            // Gegner aus VS-Listen: Kuerzel einer anderen Allianz -> verwerfen
            $tag = trim((string)($e['alliance_tag'] ?? ''));
            if ($tag !== '' && !scanAllianceTagMatches($tag, $targetAlliance)) {
                $summary['ignored_other_alliance']++;
                $details[] = ['name' => $name, 'action' => 'ignored_other_alliance', 'alliance_tag' => $tag];
                continue;
            }

            $readStatus = in_array($e['read_status'] ?? null, SCAN_READ_STATUSES, true) ? $e['read_status'] : null;
            $observations = isset($e['observations']) && is_numeric($e['observations'])
                ? max(0, min(32767, (int)$e['observations'])) : null;

            // App-Format: value_numeric ist der Wert des scan_type, bei Werte-Listen also keine Kampfkraft
            if (in_array($scanType, SCAN_VALUE_TYPES, true)) {
                if (isset($e['value_numeric']) && is_numeric($e['value_numeric'])) {
                    $e['vs'] = [...($e['vs'] ?? []), ['type' => $scanType, 'points' => $e['value_numeric'], 'game_day' => $e['game_day'] ?? $bodyGameDay]];
                }
                unset($e['value_numeric']);
            }

            $playerId = !empty($e['player_id']) ? trim($e['player_id']) : null;
            $powerStr = trim((string)($e['power_str'] ?? ''));
            $powerNum = null;
            if ($powerStr !== '') {
                $cleanP = str_replace(['M', 'm', ' '], '', $powerStr);
                $cleanP = str_replace(',', '.', $cleanP);
                if (is_numeric($cleanP)) {
                    // Mitgliederliste: "270,5M" = Millionen. Staerke-Rangliste: ganze Zahl "270514649" =
                    // absolute Kampfkraft. Ab 100000 kann es keine Millionen-Angabe mehr sein.
                    $powerNum = (float)$cleanP >= 100000
                        ? (int)round((float)$cleanP)
                        : (int)round((float)$cleanP * 1000000);
                }
            }
            if ($powerNum === null && isset($e['value_numeric']) && is_numeric($e['value_numeric'])) {
                $powerNum = (int)$e['value_numeric'];
            }

            $levelNum = null;
            $levelStr = trim((string)($e['level_str'] ?? ''));
            if ($levelStr !== '' && is_numeric($levelStr)) {
                $levelNum = (int)$levelStr;
            }
            $statusStr = trim((string)($e['status'] ?? '')) ?: null;

            // Rank code from the golden shield number (R1–R5), never from the rank name.
            // null = shield number not readable in this scan -> existing rank is kept.
            $requestedRank = isset($e['rank']) && !$scannerOnly ? safeRank($e['rank']) : null;

            $player = null;
            if ($scannerOnly) {
                // Nur aktive Spieler der eigenen Allianz; Name exakt (auch Gross-/Kleinschreibung) und eindeutig
                if ($playerId) {
                    $stmt = $pdo->prepare("SELECT player_id, current_name, alliance, current_rank_code, honor_role FROM players WHERE alliance = ? AND player_id = ? AND is_active = 1 LIMIT 1");
                    $stmt->execute([$targetAlliance, $playerId]);
                    $player = $stmt->fetch() ?: null;
                }
                $reason = $playerId ? 'unknown-player-id' : 'no-exact-name';
                if (!$player && !$playerId) {
                    $stmt = $pdo->prepare("SELECT player_id, current_name, alliance, current_rank_code, honor_role FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1");
                    $stmt->execute([$targetAlliance, $name]);
                    $hits = array_values(array_filter($stmt->fetchAll(), fn($r) => $r['current_name'] === $name));
                    if (count($hits) === 1) $player = $hits[0];
                    elseif (count($hits) > 1) $reason = 'ambiguous-name';
                }
                if (!$player) {
                    $summary['unmatched']++;
                    $unmatched[] = ['name' => $name, 'player_id' => $playerId, 'reason' => $reason];
                    continue;
                }
            } elseif ($playerId) {
                $stmt = $pdo->prepare("SELECT player_id, current_name, alliance, current_rank_code, honor_role FROM players WHERE alliance = ? AND player_id = ? LIMIT 1");
                $stmt->execute([$targetAlliance, $playerId]);
                $player = $stmt->fetch();
            }

            if (!$player) {
                $stmt = $pdo->prepare("SELECT player_id, current_name, alliance, current_rank_code, honor_role FROM players WHERE alliance = ? AND current_name = ? AND is_active = 1 LIMIT 1");
                $stmt->execute([$targetAlliance, $name]);
                $player = $stmt->fetch();
            }

            // Ehrenrollen sind im Spiel nicht in dieser Allianz: ein Treffer ist ein Namensvetter oder OCR-Zufall.
            // Nichts uebernehmen (keine Werte, kein Rang), damit sie in keiner Auswertung auftauchen.
            if ($player && normalizeHonorRole($player['honor_role'] ?? null) !== null) {
                $conflicts[] = ['name' => $name, 'blocked' => true, 'reason' => 'honor-role-not-in-game'];
                continue;
            }

            if ($player) {
                $finalPlayerId = $player['player_id'];
                $oldRank = (int)$player['current_rank_code'];
                [$finalRank, $blocked, $reason] = $resolveScanRank($name, $requestedRank, $oldRank, normalizeHonorRole($player['honor_role'] ?? null), $finalPlayerId);

                $upd = $pdo->prepare("
                    UPDATE players
                    SET current_power = COALESCE(?, current_power),
                        hq_level = COALESCE(?, hq_level),
                        last_scanned_at = ?,
                        last_seen_status = COALESCE(?, last_seen_status)
                    WHERE alliance = ? AND player_id = ?
                ");
                $upd->execute([$powerNum, $levelNum, $recordedAt, $statusStr, $targetAlliance, $finalPlayerId]);

                if ($finalRank !== $oldRank) {
                    $pdo->prepare("UPDATE players SET current_rank_code = ? WHERE alliance = ? AND player_id = ?")
                        ->execute([$finalRank, $targetAlliance, $finalPlayerId]);
                    $summary['rank_changes']++;
                }
                if ($blocked || $finalRank !== $oldRank) {
                    logRankChange($pdo, $targetAlliance, [
                        'playerId'      => $finalPlayerId,
                        'playerName'    => $name,
                        'oldRank'       => $oldRank,
                        'requestedRank' => $requestedRank,
                        'appliedRank'   => $finalRank,
                        'source'        => 'scanner_sync',
                        'blocked'       => $blocked,
                        'reason'        => $reason,
                    ]);
                }

                $summary['updated']++;
                $details[] = ['name' => $name, 'action' => 'updated', 'player_id' => $finalPlayerId, 'rank' => $finalRank];
            } else {
                $arch = findArchivedPlayerForScan($pdo, $name, $targetAlliance, $canManage);

                if ($arch) {
                    $finalPlayerId = $arch['player_id'];
                    $oldRank = (int)$arch['current_rank_code'];
                    // Der Name aus dem Archiv ist die richtige Schreibweise; der gescannte kann eine OCR-Variante sein
                    $name = $arch['current_name'];
                    [$finalRank, $blocked, $reason] = $resolveScanRank($name, $requestedRank, $oldRank, null, null);

                    $pdo->prepare("
                        INSERT INTO players (alliance, player_id, current_name, current_rank_code, is_active, current_power, hq_level, last_scanned_at, last_seen_status, created_at)
                        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, COALESCE(?, NOW()))
                        ON DUPLICATE KEY UPDATE is_active = 1, current_rank_code = VALUES(current_rank_code), current_power = VALUES(current_power), hq_level = VALUES(hq_level), last_scanned_at = VALUES(last_scanned_at), last_seen_status = VALUES(last_seen_status)
                    ")->execute([$targetAlliance, $finalPlayerId, $name, $finalRank, $powerNum, $levelNum, $recordedAt, $statusStr, $arch['player_created_at']]);
                    // Wochen-Eintraege, Namens-Historie und Discord-Verknuepfung mit zurueckholen (wie der
                    // Wiederherstellen-Knopf); bis 17.10. blieben sie verwaist im Archiv liegen.
                    restoreArchivedPlayerData($pdo, $arch['archive_id'], $targetAlliance);

                    if ($blocked || $finalRank !== $oldRank) {
                        logRankChange($pdo, $targetAlliance, [
                            'playerId'      => $finalPlayerId,
                            'playerName'    => $name,
                            'oldRank'       => $oldRank,
                            'requestedRank' => $requestedRank,
                            'appliedRank'   => $finalRank,
                            'source'        => 'scanner_sync',
                            'blocked'       => $blocked,
                            'reason'        => $reason,
                        ]);
                        if ($finalRank !== $oldRank) $summary['rank_changes']++;
                    }

                    $summary['restored']++;
                    $details[] = ['name' => $name, 'action' => 'restored', 'player_id' => $finalPlayerId, 'rank' => $finalRank];
                } else {
                    // Ehren-Eintraege nie verschieben: der Ehren-R4 einer Gast-Allianz behaelt dort seine Rolle,
                    // auch wenn ihn seine Heimat-Allianz scannt (dort bekommt er einen eigenen Eintrag).
                    // Nur Allianzen, in denen der Aufrufer selbst R4/R5 ist; Spieler fremder Allianzen bleiben
                    // unangetastet (dann Neuanlage hier). Verschieben selbst nur fuer R5.
                    $otherStmt = $pdo->prepare("SELECT player_id, alliance, current_rank_code, honor_role FROM players WHERE current_name = ? AND is_active = 1 AND alliance <> ? AND " . sqlNoHonor(''));
                    $otherStmt->execute([$name, $targetAlliance]);
                    $others = array_values(array_filter($otherStmt->fetchAll(), fn($o) => $canManage($o['alliance'])));
                    $other = $others[0] ?? null;
                    if (count($others) > 1) {
                        $conflicts[] = ['name' => $name, 'blocked' => true, 'reason' => 'ambiguous-other-alliance', 'alliances' => array_column($others, 'alliance')];
                        continue;
                    }
                    if ($other && !$canTransfer) {
                        $conflicts[] = ['name' => $name, 'blocked' => true, 'reason' => 'transfer-needs-r5', 'from_alliance' => $other['alliance']];
                        continue;
                    }

                    if ($other) {
                        $finalPlayerId = $other['player_id'];
                        $oldRank = (int)$other['current_rank_code'];
                        [$finalRank, $blocked, $reason] = $resolveScanRank($name, $requestedRank, $oldRank, normalizeHonorRole($other['honor_role'] ?? null), $finalPlayerId);

                        movePlayerToAlliance($pdo, $finalPlayerId, $other['alliance'], $targetAlliance);
                        $pdo->prepare("UPDATE players SET current_rank_code = ?, current_power = COALESCE(?, current_power), hq_level = COALESCE(?, hq_level), last_scanned_at = ?, last_seen_status = COALESCE(?, last_seen_status) WHERE alliance = ? AND player_id = ?")
                            ->execute([$finalRank, $powerNum, $levelNum, $recordedAt, $statusStr, $targetAlliance, $finalPlayerId]);

                        if ($blocked || $finalRank !== $oldRank) {
                            logRankChange($pdo, $targetAlliance, [
                                'playerId'      => $finalPlayerId,
                                'playerName'    => $name,
                                'oldRank'       => $oldRank,
                                'requestedRank' => $requestedRank,
                                'appliedRank'   => $finalRank,
                                'source'        => 'scanner_sync',
                                'blocked'       => $blocked,
                                'reason'        => $reason,
                            ]);
                            if ($finalRank !== $oldRank) $summary['rank_changes']++;
                        }

                        $summary['transferred']++;
                        $details[] = ['name' => $name, 'action' => 'transferred', 'player_id' => $finalPlayerId, 'rank' => $finalRank];
                    } else {
                        $finalPlayerId = uuid4();
                        $finalRank = 3;
                        $blocked = false;
                        if ($requestedRank !== null) {
                            $p = applyProtectedRankRule($name, $requestedRank, $protectedNames);
                            $finalRank = $p['effectiveRank'];
                            $blocked = $p['blocked'];
                            if ($blocked) {
                                $conflicts[] = [
                                    'name'         => $name,
                                    'scanned_rank' => $requestedRank,
                                    'kept_rank'    => $finalRank,
                                    'blocked'      => true,
                                    'reason'       => 'protected-r4-member',
                                ];
                                logRankChange($pdo, $targetAlliance, [
                                    'playerId'      => $finalPlayerId,
                                    'playerName'    => $name,
                                    'oldRank'       => null,
                                    'requestedRank' => $requestedRank,
                                    'appliedRank'   => $finalRank,
                                    'source'        => 'scanner_sync',
                                    'blocked'       => true,
                                    'reason'        => 'protected-r4-member',
                                ]);
                            }
                        }

                        $pdo->prepare("
                            INSERT INTO players (alliance, player_id, current_name, current_rank_code, is_active, current_power, hq_level, last_scanned_at, last_seen_status)
                            VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
                        ")->execute([$targetAlliance, $finalPlayerId, $name, $finalRank, $powerNum, $levelNum, $recordedAt, $statusStr]);

                        $pdo->prepare("INSERT IGNORE INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, 0)")
                            ->execute([$targetAlliance, uuid4(), $finalPlayerId, $name]);
                        $summary['created']++;
                        $details[] = ['name' => $name, 'action' => 'created', 'player_id' => $finalPlayerId, 'rank' => $finalRank];
                    }
                }
            }

            $ts = strtotime($recordedAt);
            $yearWeek = $yearWeekOverride ?? (int)(substr(date('o', $ts), 2) . date('W', $ts)); // wie weekly_entries: 2642 = 2026 KW 42

            if ($powerNum !== null) {
                $pdo->prepare("
                    INSERT INTO player_metrics (metric_id, alliance, player_id, metric_type, value_numeric, source, recorded_at, scan_id, year_week, game_day, read_status, observations)
                    VALUES (?, ?, ?, 'POWER', ?, ?, ?, ?, ?, ?, ?, ?)
                ")->execute([uuid4(), $targetAlliance, $finalPlayerId, $powerNum, $source, $recordedAt, $scanId, $yearWeek, (int)date('N', $ts), $readStatus, $observations]);
            }

            // VS-Punkte (Allianz-Duell): ein Wert je Spieler, Woche und Tag (VS_DAY, game_day 1 = Mo … 6 = Sa)
            // bzw. Woche (VS_WEEK). Ein hoeherer Wert ersetzt einen niedrigeren – VS-Punkte steigen nur.
            // Kills (KILLS): jeder Sync ist ein eigener Messpunkt mit Zeitstempel – fuer Vorher/Nachher bei
            // Events wie dem Kriegszonen-Duell. Spenden (DONATION_DAY/_WEEK) wie VS: hoechster Wert je Tag/Woche.
            foreach (($e['vs'] ?? []) as $vs) {
                $vsType = (string)($vs['type'] ?? '');
                if (!in_array($vsType, SCAN_VALUE_TYPES, true)
                    || !is_numeric($vs['points'] ?? null)) continue;
                $vsPoints = (int)$vs['points'];
                if ($vsPoints < 0) continue;
                $countKey = $vsType === 'KILLS' ? 'kills' : (str_starts_with($vsType, 'DONATION') ? 'donation' : 'vs');

                if ($vsType === 'KILLS') {
                    $pdo->prepare("
                        INSERT INTO player_metrics (metric_id, alliance, player_id, metric_type, value_numeric, source, recorded_at, year_week, game_day, scan_id, read_status, observations)
                        VALUES (?, ?, ?, 'KILLS', ?, ?, ?, ?, ?, ?, ?, ?)
                    ")->execute([uuid4(), $targetAlliance, $finalPlayerId, $vsPoints, $source, $recordedAt, $yearWeek, (int)date('N', $ts), $scanId, $readStatus, $observations]);
                    $summary[$countKey] = ($summary[$countKey] ?? 0) + 1;
                    continue;
                }

                // Spieltag: App schickt game_day (1 = Mo … 7 = So), der Web-Scanner den Reiter ("Mo" … "Sa")
                $dayIdx = array_search((string)($vs['day'] ?? ''), ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], true);
                $sentDay = isset($vs['game_day']) && is_numeric($vs['game_day']) && (int)$vs['game_day'] >= 1 && (int)$vs['game_day'] <= 7
                    ? (int)$vs['game_day'] : null;
                $gameDay = match ($vsType) {
                    'VS_DAY' => $sentDay ?? ($dayIdx === false ? null : $dayIdx + 1),
                    'DONATION_DAY' => $sentDay ?? (int)date('N', $ts), // Tagesspenden zeigen immer den aktuellen Tag
                    default => null,
                };
                if ($vsType === 'VS_DAY' && $gameDay === null) continue;

                $sel = $pdo->prepare("
                    SELECT metric_id, value_numeric FROM player_metrics
                    WHERE alliance = ? AND player_id = ? AND metric_type = ? AND year_week = ? AND game_day <=> ?
                    LIMIT 1
                ");
                $sel->execute([$targetAlliance, $finalPlayerId, $vsType, $yearWeek, $gameDay]);
                $existing = $sel->fetch();
                if ($existing) {
                    // Der Wert gehoert dann zu dieser Erfassung (scan_id): ein erneuter Upload ersetzt ihn
                    if ($vsPoints > (int)$existing['value_numeric']) {
                        $pdo->prepare("UPDATE player_metrics SET value_numeric = ?, source = ?, recorded_at = ?, scan_id = ?, read_status = ?, observations = ? WHERE alliance = ? AND metric_id = ?")
                            ->execute([$vsPoints, $source, $recordedAt, $scanId, $readStatus, $observations, $targetAlliance, $existing['metric_id']]);
                    }
                } else {
                    $pdo->prepare("
                        INSERT INTO player_metrics (metric_id, alliance, player_id, metric_type, value_numeric, value_text, source, recorded_at, year_week, game_day, scan_id, read_status, observations)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ")->execute([uuid4(), $targetAlliance, $finalPlayerId, $vsType, $vsPoints, $vs['day'] ?? null, $source, $recordedAt, $yearWeek, $gameDay, $scanId, $readStatus, $observations]);
                }
                $summary[$countKey] = ($summary[$countKey] ?? 0) + 1;
            }
        }

        // dry_run: alles ausfuehren, dann zurueckrollen – die Antwort zeigt, was passieren wuerde
        if ($dryRun) $pdo->rollBack();
        else $pdo->commit();
        jsonOut(200, ['ok' => true, 'dry_run' => $dryRun, 'scan_id' => $scanId, 'replaced_previous_upload' => $replacedPrevious, 'summary' => $summary, 'details' => $details, 'unmatched' => $unmatched, 'conflicts' => $conflicts]);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        jsonOut(500, ['error' => 'Fehler beim Synchronisieren: ' . $e->getMessage()]);
    }
}
