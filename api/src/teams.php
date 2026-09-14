<?php
declare(strict_types=1);

function normalizeTeamType(mixed $value): ?string {
    $raw = strtolower(trim((string)($value ?? '')));
    if ($raw === '' || $raw === 'null') return null;
    if (in_array($raw, ['panzer', 'flugzeug', 'rakete'], true)) return $raw;
    return null;
}

function normalizeCombatPower(mixed $value, int $correctionValue = 40): ?int {
    if ($value === null || $value === '') return null;
    $n = (int)$value;
    if ($n >= 999) return max(0, min(998, $correctionValue));
    return max(0, min(999, $n));
}

function getCombatPowerCorrectionValue(PDO $pdo, string $alliance): int {
    try {
        $stmt = $pdo->prepare("SELECT config_value FROM alliance_config WHERE alliance=? AND config_key='combat_power_correction_value' LIMIT 1");
        $stmt->execute([$alliance]);
        $value = $stmt->fetchColumn();
        $parsed = filter_var($value, FILTER_VALIDATE_INT);
        return $parsed === false ? 40 : max(0, min(998, (int)$parsed));
    } catch (Throwable) {
        return 40;
    }
}

function validateTotalHeroPower(?int $totalHeroPower, array $teams): void {
    if ($totalHeroPower === null) return;
    $teamPowerSum = 0;
    foreach ($teams as $team) {
        $teamPowerSum += (int)($team['combat_power'] ?? 0);
    }
    $maxTotal = (int)floor($teamPowerSum * 1.2);
    if ($totalHeroPower > $maxTotal) {
        jsonOut(400, ['error' => "Heldenkampfkraft darf höchstens 120% der Team-Kampfkraft betragen (max. {$maxTotal})."]);
    }
}

function normalizeMonkeyLevel(mixed $value): ?int {
    if ($value === null || $value === '') return null;
    $n = (int)$value;
    if ($n <= 0) return null;
    return $n;
}

function normalizeTeamHeroes(mixed $value): array {
    $result = array_fill(0, 6, null);
    if (!is_array($value)) return $result;
    for ($i = 0; $i < 6; $i++) {
        $raw = $value[$i] ?? null;
        if ($raw === null) continue;
        $id = trim((string)$raw);
        $result[$i] = $id !== '' ? $id : null;
    }
    return $result;
}

function normalizeTeamRequestPayload(array $body, int $correctionValue = 40): array {
    $teams = [];
    if (!empty($body['teams']) && is_array($body['teams'])) {
        foreach ($body['teams'] as $entry) {
            if (!is_array($entry)) continue;
            $slot = isset($entry['slot']) ? (int)$entry['slot'] : 0;
            if ($slot < 1 || $slot > 4) continue;
            $teams[$slot] = [
                'slot' => $slot,
                'team_type' => normalizeTeamType($entry['team_type'] ?? null),
                'combat_power' => normalizeCombatPower($entry['combat_power'] ?? null, $correctionValue),
                'monkey_level' => normalizeMonkeyLevel($entry['monkey_level'] ?? null),
                'heroes' => normalizeTeamHeroes($entry['heroes'] ?? []),
            ];
        }
    }
    return $teams;
}

function resolveTeamTargetPlayer(PDO $pdo, string $alliance, ?string $nameRaw): ?array {
    $name = trim((string)($nameRaw ?? ''));
    if ($name === '') return null;
    return getMemberByName($pdo, $alliance, $name);
}

function ensureMemberTeamTables(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS member_teams (
            alliance VARCHAR(50) NOT NULL,
            player_id CHAR(36) NOT NULL,
            member_name VARCHAR(150) NOT NULL,
            slot TINYINT NOT NULL,
            team_type VARCHAR(30) NULL DEFAULT NULL,
            combat_power INT NULL DEFAULT NULL,
            monkey_level INT NULL DEFAULT NULL,
            heroes_json JSON NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, player_id, slot),
            KEY ix_member_teams_name (alliance, member_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    static $monkeyLevelChecked = false;
    if (!$monkeyLevelChecked) {
        $monkeyLevelChecked = true;
        try {
            $pdo->exec("ALTER TABLE member_teams ADD COLUMN monkey_level INT NULL DEFAULT NULL");
        } catch (\PDOException) {
            // Column already exists.
        }
    }

    static $heroesJsonChecked = false;
    if (!$heroesJsonChecked) {
        $heroesJsonChecked = true;
        try {
            $pdo->exec("ALTER TABLE member_teams ADD COLUMN heroes_json JSON NULL");
        } catch (\PDOException) {
            // Column already exists.
        }
    }

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS member_team_totals (
            alliance VARCHAR(50) NOT NULL,
            player_id CHAR(36) NOT NULL,
            member_name VARCHAR(150) NOT NULL,
            total_hero_power INT NULL DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, player_id),
            KEY ix_member_team_totals_name (alliance, member_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function buildTeamResponse(PDO $pdo, string $alliance, array $player): array {
    $playerId = (string)($player['player_id'] ?? '');
    $memberName = (string)($player['current_name'] ?? '');

    $teams = [];
    for ($slot = 1; $slot <= 4; $slot++) {
        $teams[$slot] = [
            'slot' => $slot,
            'team_type' => null,
            'combat_power' => null,
            'monkey_level' => null,
            'heroes' => array_fill(0, 6, null),
        ];
    }

    $updatedAt = null;
    $stmt = $pdo->prepare(
        'SELECT slot, team_type, combat_power, monkey_level, heroes_json, updated_at FROM member_teams WHERE alliance = ? AND player_id = ? ORDER BY slot ASC'
    );
    $stmt->execute([$alliance, $playerId]);
    foreach ($stmt->fetchAll() as $row) {
        $slot = (int)($row['slot'] ?? 0);
        if ($slot < 1 || $slot > 4) continue;
        $heroes = array_fill(0, 6, null);
        if (!empty($row['heroes_json'])) {
            $decoded = json_decode((string)$row['heroes_json'], true);
            $heroes = normalizeTeamHeroes($decoded);
        }
        $teams[$slot] = [
            'slot' => $slot,
            'team_type' => $row['team_type'],
            'combat_power' => $row['combat_power'] !== null ? (int)$row['combat_power'] : null,
            'monkey_level' => $row['monkey_level'] !== null ? (int)$row['monkey_level'] : null,
            'heroes' => $heroes,
        ];
        if ($row['updated_at'] && ($updatedAt === null || $row['updated_at'] > $updatedAt)) {
            $updatedAt = (string)$row['updated_at'];
        }
    }

    $totalValue = null;
    $totalUpdatedAt = null;
    $totalStmt = $pdo->prepare(
        'SELECT total_hero_power, updated_at FROM member_team_totals WHERE alliance = ? AND player_id = ? LIMIT 1'
    );
    $totalStmt->execute([$alliance, $playerId]);
    $totalRow = $totalStmt->fetch();
    if ($totalRow) {
        $totalValue = $totalRow['total_hero_power'] !== null ? (int)$totalRow['total_hero_power'] : null;
        $totalUpdatedAt = $totalRow['updated_at'];
        if ($totalUpdatedAt && ($updatedAt === null || $totalUpdatedAt > $updatedAt)) {
            $updatedAt = (string)$totalUpdatedAt;
        }
    }

    $hasData = false;
    foreach ($teams as $slotData) {
        if ($slotData['team_type'] !== null || $slotData['combat_power'] !== null) {
            $hasData = true;
            break;
        }
    }
    if ($totalValue !== null) {
        $hasData = true;
    }

    return [
        'member_name' => $memberName,
        'player_id' => $playerId,
        'teams' => array_values($teams),
        'total_hero_power' => $totalValue,
        'has_data' => $hasData,
        'updated_at' => $updatedAt,
    ];
}

function saveTeamPayload(PDO $pdo, string $alliance, array $player, array $teams, ?int $totalHeroPower): array {
    $playerId = (string)($player['player_id'] ?? '');
    $memberName = (string)($player['current_name'] ?? '');

    $pdo->beginTransaction();
    try {
        foreach ($teams as $slotData) {
            $slot = (int)($slotData['slot'] ?? 0);
            if ($slot < 1 || $slot > 4) continue;
            $stmt = $pdo->prepare(
                'INSERT INTO member_teams (alliance, player_id, member_name, slot, team_type, combat_power, monkey_level, heroes_json) '
                . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) '
                . 'ON DUPLICATE KEY UPDATE member_name = VALUES(member_name), team_type = VALUES(team_type), combat_power = VALUES(combat_power), monkey_level = VALUES(monkey_level), heroes_json = VALUES(heroes_json)'
            );
            $heroesJson = json_encode(normalizeTeamHeroes($slotData['heroes'] ?? []), JSON_UNESCAPED_UNICODE);
            $stmt->execute([
                $alliance,
                $playerId,
                $memberName,
                $slot,
                $slotData['team_type'] ?? null,
                $slotData['combat_power'] ?? null,
                $slotData['monkey_level'] ?? null,
                $heroesJson,
            ]);
        }

        $totalStmt = $pdo->prepare(
            'INSERT INTO member_team_totals (alliance, player_id, member_name, total_hero_power) '
            . 'VALUES (?, ?, ?, ?) '
            . 'ON DUPLICATE KEY UPDATE member_name = VALUES(member_name), total_hero_power = VALUES(total_hero_power)'
        );
        $totalStmt->execute([$alliance, $playerId, $memberName, $totalHeroPower]);

        $pdo->commit();
        return buildTeamResponse($pdo, $alliance, $player);
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function handleGetMyTeams(PDO $pdo, string $alliance, ?string $nameRaw): never {
    $name = trim((string)($nameRaw ?? ''));
    if ($name === '') {
        jsonOut(400, ['error' => 'Name fehlt']);
    }
    $player = resolveTeamTargetPlayer($pdo, $alliance, $name);
    if (!$player) {
        jsonOut(404, ['error' => 'Mitglied nicht gefunden']);
    }
    jsonOut(200, buildTeamResponse($pdo, $alliance, $player));
}

function handleSaveMyTeams(PDO $pdo, string $alliance, ?string $nameRaw, array $body): never {
    $name = trim((string)($nameRaw ?? ''));
    if ($name === '') {
        $name = trim((string)($body['member_name'] ?? ''));
    }
    if ($name === '') {
        jsonOut(400, ['error' => 'Name fehlt']);
    }
    $player = resolveTeamTargetPlayer($pdo, $alliance, $name);
    if (!$player) {
        jsonOut(404, ['error' => 'Mitglied nicht gefunden']);
    }

    $teams = normalizeTeamRequestPayload($body, getCombatPowerCorrectionValue($pdo, $alliance));
    $totalHeroPower = isset($body['total_hero_power']) && $body['total_hero_power'] !== ''
        ? normalizeCombatPower($body['total_hero_power'])
        : null;
    validateTotalHeroPower($totalHeroPower, $teams);

    $result = saveTeamPayload($pdo, $alliance, $player, array_values($teams), $totalHeroPower);
    jsonOut(200, $result);
}

function handleGetMemberTeams(PDO $pdo, string $alliance, string $nameRaw): never {
    $player = resolveTeamTargetPlayer($pdo, $alliance, $nameRaw);
    if (!$player) {
        jsonOut(404, ['error' => 'Mitglied nicht gefunden']);
    }
    jsonOut(200, buildTeamResponse($pdo, $alliance, $player));
}

function handleSaveMemberTeams(PDO $pdo, string $alliance, string $nameRaw, array $body): never {
    $player = resolveTeamTargetPlayer($pdo, $alliance, $nameRaw);
    if (!$player) {
        jsonOut(404, ['error' => 'Mitglied nicht gefunden']);
    }

    $teams = normalizeTeamRequestPayload($body, getCombatPowerCorrectionValue($pdo, $alliance));
    $totalHeroPower = isset($body['total_hero_power']) && $body['total_hero_power'] !== ''
        ? normalizeCombatPower($body['total_hero_power'])
        : null;
    validateTotalHeroPower($totalHeroPower, $teams);

    $result = saveTeamPayload($pdo, $alliance, $player, array_values($teams), $totalHeroPower);
    jsonOut(200, $result);
}

function handleGetAllianceTeams(PDO $pdo, string $alliance): never {
    $stmt = $pdo->prepare(
        'SELECT '
        . 'p.current_name, '
        . 'mtt.total_hero_power, '
        . 'MAX(CASE WHEN mt.slot = 1 THEN mt.team_type END) AS t1_type, '
        . 'MAX(CASE WHEN mt.slot = 1 THEN mt.combat_power END) AS t1_power, '
        . 'MAX(CASE WHEN mt.slot = 1 AND mt.heroes_json LIKE \'%"overlord"%\' THEN mt.monkey_level END) AS t1_monkey_level, '
        . 'MAX(CASE WHEN mt.slot = 2 THEN mt.team_type END) AS t2_type, '
        . 'MAX(CASE WHEN mt.slot = 2 THEN mt.combat_power END) AS t2_power, '
        . 'MAX(CASE WHEN mt.slot = 2 AND mt.heroes_json LIKE \'%"overlord"%\' THEN mt.monkey_level END) AS t2_monkey_level, '
        . 'MAX(CASE WHEN mt.slot = 3 THEN mt.team_type END) AS t3_type, '
        . 'MAX(CASE WHEN mt.slot = 3 THEN mt.combat_power END) AS t3_power, '
        . 'MAX(CASE WHEN mt.slot = 3 AND mt.heroes_json LIKE \'%"overlord"%\' THEN mt.monkey_level END) AS t3_monkey_level, '
        . 'MAX(CASE WHEN mt.slot = 4 THEN mt.team_type END) AS t4_type, '
        . 'MAX(CASE WHEN mt.slot = 4 THEN mt.combat_power END) AS t4_power, '
        . 'MAX(CASE WHEN mt.slot = 4 AND mt.heroes_json LIKE \'%"overlord"%\' THEN mt.monkey_level END) AS t4_monkey_level, '
        . 'CASE '
        . 'WHEN MAX(mt.updated_at) IS NULL THEN mtt.updated_at '
        . 'WHEN mtt.updated_at IS NULL THEN MAX(mt.updated_at) '
        . 'WHEN MAX(mt.updated_at) > mtt.updated_at THEN MAX(mt.updated_at) '
        . 'ELSE mtt.updated_at '
        . 'END AS updated_at '
        . 'FROM players p '
        . 'LEFT JOIN member_team_totals mtt '
        . 'ON mtt.alliance = p.alliance AND mtt.player_id = p.player_id '
        . 'LEFT JOIN member_teams mt '
        . 'ON mt.alliance = p.alliance AND mt.player_id = p.player_id '
        . 'WHERE p.alliance = ? AND p.is_active = 1 '
        . 'GROUP BY p.current_name, mtt.total_hero_power, mtt.updated_at '
        . 'HAVING '
        . 'mtt.total_hero_power IS NOT NULL '
        . 'OR SUM(CASE WHEN mt.team_type IS NOT NULL OR mt.combat_power IS NOT NULL THEN 1 ELSE 0 END) > 0 '
        . 'ORDER BY p.current_name ASC'
    );
    $stmt->execute([$alliance]);
    $rows = $stmt->fetchAll();
    jsonOut(200, ['members' => $rows]);
}
