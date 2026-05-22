<?php
declare(strict_types=1);

function logRankChange(PDO $pdo, string $alliance, array $payload): void {
    $stmt = $pdo->prepare("
        INSERT INTO rank_change_log
            (alliance, log_id, player_id, player_name, old_rank_code, requested_rank_code,
             applied_rank_code, source, is_blocked, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $alliance,
        uuid4(),
        $payload['playerId'] ?? null,
        $payload['playerName'],
        isset($payload['oldRank']) && $payload['oldRank'] !== null ? (int)$payload['oldRank'] : null,
        isset($payload['requestedRank']) && $payload['requestedRank'] !== null ? (int)$payload['requestedRank'] : null,
        (int)$payload['appliedRank'],
        $payload['source'],
        ($payload['blocked'] ?? false) ? 1 : 0,
        $payload['reason'] ?? null,
    ]);
}

function enforceProtectedRanks(PDO $pdo, string $alliance, array $protectedNames): void {
    if (empty($protectedNames)) return;
    $names = array_keys($protectedNames);
    $placeholders = implode(',', array_fill(0, count($names), '?'));
    $stmt = $pdo->prepare("
        SELECT player_id, current_name, current_rank_code
        FROM players
        WHERE alliance = ?
          AND LOWER(TRIM(current_name)) IN ({$placeholders})
          AND current_rank_code <> 4
    ");
    $stmt->execute([$alliance, ...$names]);
    $rows = $stmt->fetchAll();

    foreach ($rows as $row) {
        $upd = $pdo->prepare("
            UPDATE players SET current_rank_code = 4, is_active = 1, retired_at = NULL
            WHERE alliance = ? AND player_id = ?
        ");
        $upd->execute([$alliance, $row['player_id']]);
        logRankChange($pdo, $alliance, [
            'playerId'      => $row['player_id'],
            'playerName'    => $row['current_name'],
            'oldRank'       => (int)$row['current_rank_code'],
            'requestedRank' => 4,
            'appliedRank'   => 4,
            'source'        => 'system:protected-r4-enforce',
            'blocked'       => true,
            'reason'        => 'protected-r4-member-auto-fix',
        ]);
    }
}

function getDiscordMemberSql(bool $withCache, bool $leadershipOnly): string {
    $rankFilter = $leadershipOnly ? 'AND p.current_rank_code IN (4, 5)' : '';
    if ($withCache) {
        return "
                 SELECT p.player_id, p.current_name, p.current_rank_code,
                     p.beruf, p.beruf_med_hilfe, p.beruf_winwin,
                                         p.preferred_language,
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
            WHERE p.alliance = ? AND p.is_active = 1 {$rankFilter}
              AND (pid.discord_user_id = ? OR puld.discord_user_id = ?)
            LIMIT 1
        ";
    }
    return "
         SELECT p.player_id, p.current_name, p.current_rank_code,
             p.beruf, p.beruf_med_hilfe, p.beruf_winwin,
                         p.preferred_language,
               COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
               puld.discord_username, puld.discord_avatar
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
        WHERE p.alliance = ? AND p.is_active = 1 {$rankFilter}
                    AND (pid.discord_user_id = ? OR puld.discord_user_id = ?)
        LIMIT 1
    ";
}

function getDiscordMemberByActiveChar(PDO $pdo, string $alliance, string $discordId, bool $leadershipOnly = false): ?array {
    $rankFilter = $leadershipOnly ? 'AND p.current_rank_code IN (4, 5)' : '';
    try {
        $stmt = $pdo->prepare(" 
                 SELECT p.player_id, p.current_name, p.current_rank_code,
                     p.beruf, p.beruf_med_hilfe, p.beruf_winwin,
                                         p.preferred_language,
                   uac.discord_user_id AS discord_user_id,
                   COALESCE(uda.discord_username, dpc.discord_username) AS discord_username,
                   COALESCE(uda.discord_avatar, dpc.discord_avatar) AS discord_avatar
            FROM user_active_char uac
            JOIN players p
              ON p.alliance = uac.alliance
             AND p.player_id = uac.player_id
             AND p.is_active = 1
            LEFT JOIN (
                SELECT pul.alliance, pul.player_id,
                       MIN(uda.discord_username) AS discord_username,
                       MIN(uda.discord_avatar) AS discord_avatar
                FROM player_user_links pul
                JOIN user_discord_accounts uda
                  ON uda.alliance = pul.alliance
                 AND uda.user_id = pul.user_id
                GROUP BY pul.alliance, pul.player_id
            ) uda ON uda.alliance = p.alliance AND uda.player_id = p.player_id
            LEFT JOIN discord_profile_cache dpc
              ON dpc.alliance = p.alliance
             AND dpc.discord_user_id = uac.discord_user_id
            WHERE uac.discord_user_id = ?
              AND uac.alliance = ?
              {$rankFilter}
            LIMIT 1
        ");
        $stmt->execute([$discordId, $alliance]);
        return $stmt->fetch() ?: null;
    } catch (PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        return null;
    }
}

function getDiscordMember(PDO $pdo, string $alliance, string $discordId, bool $leadershipOnly = false): ?array {
    $activeMember = getDiscordMemberByActiveChar($pdo, $alliance, $discordId, $leadershipOnly);
    if ($activeMember) return $activeMember;

    try {
        $stmt = $pdo->prepare(getDiscordMemberSql(true, $leadershipOnly));
            $stmt->execute([$alliance, $discordId, $discordId]);
        return $stmt->fetch() ?: null;
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        $stmt = $pdo->prepare(getDiscordMemberSql(false, $leadershipOnly));
            $stmt->execute([$alliance, $discordId, $discordId]);
        return $stmt->fetch() ?: null;
    }
}

function getDiscordMemberAcrossAlliancesSql(bool $withCache, bool $leadershipOnly): string {
    $rankFilter = $leadershipOnly ? 'AND p.current_rank_code IN (4, 5)' : '';
    if ($withCache) {
        return "
            SELECT p.alliance, p.player_id, p.current_name, p.current_rank_code,
                   p.beruf, p.beruf_med_hilfe, p.beruf_winwin,
                   p.preferred_language,
                   COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
                   COALESCE(puld.discord_username, dpc.discord_username) AS discord_username,
                   COALESCE(puld.discord_avatar, dpc.discord_avatar) AS discord_avatar,
                   CASE WHEN uac.discord_user_id IS NULL THEN 0 ELSE 1 END AS is_active_char
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
            LEFT JOIN user_active_char uac
                ON uac.discord_user_id = ?
               AND uac.alliance = p.alliance
               AND uac.player_id = p.player_id
            WHERE p.is_active = 1 {$rankFilter}
                            AND (pid.discord_user_id = ? OR puld.discord_user_id = ?)
            ORDER BY is_active_char DESC, p.current_rank_code DESC, p.alliance ASC, p.current_name ASC
            LIMIT 1
        ";
    }
    return "
        SELECT p.alliance, p.player_id, p.current_name, p.current_rank_code,
               p.beruf, p.beruf_med_hilfe, p.beruf_winwin,
               p.preferred_language,
               COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
               puld.discord_username, puld.discord_avatar,
               CASE WHEN uac.discord_user_id IS NULL THEN 0 ELSE 1 END AS is_active_char
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
        LEFT JOIN user_active_char uac
            ON uac.discord_user_id = ?
           AND uac.alliance = p.alliance
           AND uac.player_id = p.player_id
        WHERE p.is_active = 1 {$rankFilter}
                    AND (pid.discord_user_id = ? OR puld.discord_user_id = ?)
        ORDER BY is_active_char DESC, p.current_rank_code DESC, p.alliance ASC, p.current_name ASC
        LIMIT 1
    ";
}

function getDiscordMemberAcrossAlliances(PDO $pdo, string $discordId, bool $leadershipOnly = false): ?array {
    try {
        $stmt = $pdo->prepare(getDiscordMemberAcrossAlliancesSql(true, $leadershipOnly));
            $stmt->execute([$discordId, $discordId, $discordId]);
        return $stmt->fetch() ?: null;
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        $stmt = $pdo->prepare(getDiscordMemberAcrossAlliancesSql(false, $leadershipOnly));
            $stmt->execute([$discordId, $discordId, $discordId]);
        return $stmt->fetch() ?: null;
    }
}

function getMemberByNameSql(bool $withCache): string {
    if ($withCache) {
        return "
            SELECT p.player_id, p.current_name, p.current_rank_code,
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
              AND LOWER(TRIM(p.current_name)) = LOWER(TRIM(?))
            LIMIT 1
        ";
    }
    return "
        SELECT p.player_id, p.current_name, p.current_rank_code,
               COALESCE(pid.discord_user_id, puld.discord_user_id) AS discord_user_id,
               puld.discord_username, puld.discord_avatar
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
        WHERE p.alliance = ? AND p.is_active = 1
          AND LOWER(TRIM(p.current_name)) = LOWER(TRIM(?))
        LIMIT 1
    ";
}

function getMemberByName(PDO $pdo, string $alliance, string $nameRaw): ?array {
    $name = trim($nameRaw);
    if ($name === '') return null;
    try {
        $stmt = $pdo->prepare(getMemberByNameSql(true));
        $stmt->execute([$alliance, $name]);
        return $stmt->fetch() ?: null;
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        $stmt = $pdo->prepare(getMemberByNameSql(false));
        $stmt->execute([$alliance, $name]);
        return $stmt->fetch() ?: null;
    }
}

function memberToDiscordAvatarUrl(?string $discordUserId, ?string $discordAvatar, int $size = 64): ?string {
    if (!$discordUserId || !$discordAvatar) return null;
    return "https://cdn.discordapp.com/avatars/{$discordUserId}/{$discordAvatar}.png?size={$size}";
}

function ensureSiteAdminsTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS site_admins (
            discord_user_id VARCHAR(30)  NOT NULL,
            granted_by      VARCHAR(30)  NOT NULL DEFAULT 'system',
            note            VARCHAR(255) NOT NULL DEFAULT '',
            granted_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (discord_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
}

/** Auto-seed players whose names are in $protectedR4Names as site-admins. */
function seedProtectedAdmins(PDO $pdo, array $protectedNames): void {
    $names = array_keys($protectedNames);
    if (empty($names)) return;
    try {
        $placeholders = implode(',', array_fill(0, count($names), '?'));
        $stmt = $pdo->prepare("
            SELECT COALESCE(pid.discord_user_id, uda.discord_user_id) AS discord_user_id
            FROM players p
            LEFT JOIN player_identities pid
                ON pid.alliance = p.alliance AND pid.player_id = p.player_id
            LEFT JOIN player_user_links pul
                ON pul.alliance = p.alliance AND pul.player_id = p.player_id
            LEFT JOIN user_discord_accounts uda
                ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            WHERE p.current_name IN ($placeholders) AND p.is_active = 1
              AND COALESCE(pid.discord_user_id, uda.discord_user_id) IS NOT NULL
            GROUP BY COALESCE(pid.discord_user_id, uda.discord_user_id)
        ");
        $stmt->execute($names);
        $ins = $pdo->prepare("
            INSERT IGNORE INTO site_admins (discord_user_id, granted_by, note)
            VALUES (?, 'system', 'Auto-seeded from protected R4 names config')
        ");
        foreach ($stmt->fetchAll() as $row) {
            if (!empty($row['discord_user_id'])) {
                $ins->execute([$row['discord_user_id']]);
            }
        }
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
    }
}

function isSiteAdmin(PDO $pdo, string $discordId): bool {
    try {
        $stmt = $pdo->prepare("SELECT 1 FROM site_admins WHERE discord_user_id = ? LIMIT 1");
        $stmt->execute([$discordId]);
        return (bool)$stmt->fetch();
    } catch (\PDOException $e) {
        return false; // table might not exist yet
    }
}

function requireR5(PDO $pdo, string $discordId): array {
    // Local dev-server: bypass auth entirely
    if (isLocalRequest()) {
        return ['player_id' => null, 'current_name' => 'Lokaler Admin', 'current_rank_code' => 5, 'alliance' => null];
    }

    // Site-admins have full access regardless of rank
    if (isSiteAdmin($pdo, $discordId)) {
        $stmt = $pdo->prepare("
            SELECT p.player_id, p.current_name, p.current_rank_code, p.alliance
            FROM players p
            LEFT JOIN player_identities pid
                ON pid.alliance = p.alliance AND pid.player_id = p.player_id
            LEFT JOIN (
                SELECT pul.alliance, pul.player_id, uda.discord_user_id
                FROM player_user_links pul
                JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
            ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
            WHERE p.is_active = 1
                            AND (pid.discord_user_id = ? OR puld.discord_user_id = ?)
            LIMIT 1
        ");
                $stmt->execute([$discordId, $discordId]);
        $row = $stmt->fetch();
        if ($row) return $row;
        return ['player_id' => null, 'current_name' => null, 'current_rank_code' => 5, 'alliance' => null];
    }

    $stmt = $pdo->prepare("
        SELECT p.player_id, p.current_name, p.current_rank_code, p.alliance
        FROM players p
        LEFT JOIN player_identities pid
            ON pid.alliance = p.alliance AND pid.player_id = p.player_id
        LEFT JOIN (
            SELECT pul.alliance, pul.player_id, uda.discord_user_id
            FROM player_user_links pul
            JOIN user_discord_accounts uda ON uda.alliance = pul.alliance AND uda.user_id = pul.user_id
        ) puld ON puld.alliance = p.alliance AND puld.player_id = p.player_id
        WHERE p.is_active = 1 AND p.current_rank_code = 5
                    AND (pid.discord_user_id = ? OR puld.discord_user_id = ?)
        LIMIT 1
    ");
        $stmt->execute([$discordId, $discordId]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(403, ['error' => 'Kein Zugriff – nur Admins dürfen diesen Bereich nutzen']);
    return $row;
}
