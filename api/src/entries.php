<?php
declare(strict_types=1);

/** Wochen-Eintraege pflegen R4/R5 (Seiten aus api/partials/r4-pages.php); Ehrenrollen und Zuschauer nie. */
function assertHonorReadOnlyWriter(PDO $pdo, string $alliance, array $body): void {
    requireAllianceWriter($pdo, $alliance, 4, false, (string)($body['discord_id'] ?? ''));
}

/**
 * GET /entries/{kw}. Mit ?with_former=1 (Hub) die Woche so, wie sie war: Eintraege nach origin_alliance – auch
 * von Spielern, die inzwischen gewechselt sind (former 'moved', now_alliance) –, dazu archivierte Eintraege
 * Ausgetretener (former 'archived'); Wochen, die ein Wechsler aus einer anderen Allianz mitgebracht hat, nicht.
 * Ohne den Parameter wie bisher: alle Eintraege, die heute in der Allianz liegen.
 */
function handleGetEntries(PDO $pdo, string $alliance, int $kw): never {
    $asWas = !empty($_GET['with_former']);
    $stmt = $pdo->prepare("
        SELECT we.entry_id, we.alliance, we.final_rank_code, p.current_name
        FROM weekly_entries we
        JOIN players p ON p.alliance = we.alliance AND p.player_id = we.player_id
        WHERE " . ($asWas ? "COALESCE(we.origin_alliance, we.alliance) = ?" : "we.alliance = ?") . " AND we.year_week = ? AND " . sqlNoHonor() . "
        ORDER BY p.current_name
    ");
    $stmt->execute([$alliance, $kw]);
    $rows = $stmt->fetchAll();

    $result = [];
    $fs = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?");
    foreach ($rows as $row) {
        $fs->execute([$row['alliance'], $row['entry_id']]);
        $flags = [];
        foreach ($fs->fetchAll() as $f) $flags[$f['flag_key']] = true;
        // (object): ein Eintrag ohne Haekchen (Mittelfeld aus dem Scanner) kommt als {} statt [] an
        $e = ['name' => $row['current_name'], 'rank' => (int)$row['final_rank_code'], 'flags' => (object)$flags];
        if ($row['alliance'] !== $alliance) $e += ['former' => 'moved', 'now_alliance' => $row['alliance']];
        $result[] = $e;
    }

    if ($asWas) {
        $have = array_flip(array_column($result, 'name'));
        try {
            $arch = $pdo->prepare("
                SELECT ae.archive_id, ae.entry_id, ae.final_rank_code, ap.current_name
                FROM archived_weekly_entries ae JOIN archived_players ap ON ap.archive_id = ae.archive_id
                WHERE ae.alliance = ? AND ae.year_week = ?
            ");
            $arch->execute([$alliance, $kw]);
            $af = $pdo->prepare("SELECT flag_key FROM archived_entry_flags WHERE archive_id = ? AND entry_id = ?");
            foreach ($arch->fetchAll() as $row) {
                if (isset($have[$row['current_name']])) continue; // Name gehoert einem heutigen Mitglied
                $af->execute([$row['archive_id'], $row['entry_id']]);
                $flags = [];
                foreach ($af->fetchAll() as $f) $flags[$f['flag_key']] = true;
                $result[] = ['name' => $row['current_name'], 'rank' => (int)$row['final_rank_code'], 'flags' => (object)$flags, 'former' => 'archived'];
            }
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
    }
    jsonOut(200, $result);
}

function handleSaveEntry(PDO $pdo, string $alliance, int $kw, array $body, array $protectedNames): never {
    assertHonorReadOnlyWriter($pdo, $alliance, $body);
    $name = trim($body['name'] ?? '');
    if ($name === '') jsonOut(400, ['error' => 'Name fehlt']);

    $requestedRank = safeRank((int)($body['rank'] ?? 3));
    $flags         = (array)($body['flags'] ?? []);
    $protection    = applyProtectedRankRule($name, $requestedRank, $protectedNames);
    $rank          = $protection['effectiveRank'];

    $txStarted = false;
    try {
        $txStarted = $pdo->beginTransaction();
    } catch (\PDOException) {
        $txStarted = false;
    }
    
    try {
        $pdo->prepare("INSERT INTO week_periods (alliance, year_week) VALUES (?, ?) ON DUPLICATE KEY UPDATE year_week = VALUES(year_week)")->execute([$alliance, $kw]);

        $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code, honor_role FROM players WHERE alliance = ? AND current_name = ?");
        $stmt->execute([$alliance, $name]);
        $playerRow = $stmt->fetch();

        if ($playerRow) {
            $playerHonorRole = normalizeHonorRole($playerRow['honor_role'] ?? null);
            if ($playerHonorRole !== null) {
                jsonOut(403, ['error' => 'Ehrenmitglieder koennen nicht in Events/Zeiten erfasst werden']);
            }
            $playerId = $playerRow['player_id'];
            $oldRank  = (int)$playerRow['current_rank_code'];
            $p        = applyProtectedRankRule($playerRow['current_name'], $requestedRank, $protectedNames);
            $rank     = $p['effectiveRank'];
            $pdo->prepare("UPDATE players SET current_rank_code = ?, is_active = 1, retired_at = NULL WHERE alliance = ? AND player_id = ?")->execute([$rank, $alliance, $playerId]);
            if ($oldRank !== $rank || $p['blocked'] || $p['protectedMember']) {
                logRankChange($pdo, $alliance, [
                    'playerId' => $playerId, 'playerName' => $playerRow['current_name'] ?: $name,
                    'oldRank' => $oldRank, 'requestedRank' => $requestedRank, 'appliedRank' => $rank,
                    'source' => "entries:{$kw}", 'blocked' => $p['blocked'],
                    'reason' => $p['protectedMember'] ? 'protected-r4-member' : null,
                ]);
            }
        } else {
            $playerId = uuid4();
            $p        = applyProtectedRankRule($name, $requestedRank, $protectedNames);
            $rank     = $p['effectiveRank'];
            $pdo->prepare("INSERT INTO players (alliance, player_id, current_name, current_rank_code, is_active) VALUES (?, ?, ?, ?, 1)")->execute([$alliance, $playerId, $name, $rank]);
            if ($p['protectedMember']) {
                logRankChange($pdo, $alliance, [
                    'playerId' => $playerId, 'playerName' => $name,
                    'oldRank' => null, 'requestedRank' => $requestedRank, 'appliedRank' => $rank,
                    'source' => "entries:{$kw}", 'blocked' => $p['blocked'], 'reason' => 'protected-r4-member',
                ]);
            }
            $pdo->prepare("INSERT INTO player_name_history (alliance, name_event_id, player_id, player_name, valid_from_yw) VALUES (?, ?, ?, ?, ?)")->execute([$alliance, uuid4(), $playerId, $name, $kw]);
        }

        $stmt = $pdo->prepare("SELECT entry_id FROM weekly_entries WHERE alliance = ? AND year_week = ? AND player_id = ?");
        $stmt->execute([$alliance, $kw, $playerId]);
        $entryRow = $stmt->fetch();

        if ($entryRow) {
            $entryId = $entryRow['entry_id'];
            $pdo->prepare("UPDATE weekly_entries SET base_rank_code = ?, final_rank_code = ?, afk = ?, updated_at = CURRENT_TIMESTAMP WHERE alliance = ? AND entry_id = ?")
                ->execute([$rank, $rank, (!empty($flags['afk'])) ? 1 : 0, $alliance, $entryId]);
        } else {
            $entryId = uuid4();
            $pdo->prepare("INSERT INTO weekly_entries (alliance, origin_alliance, entry_id, year_week, player_id, base_rank_code, final_rank_code, afk) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                ->execute([$alliance, $alliance, $entryId, $kw, $playerId, $rank, $rank, (!empty($flags['afk'])) ? 1 : 0]);
        }

        $pdo->prepare("DELETE FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?")->execute([$alliance, $entryId]);
        foreach ($flags as $flagKey => $active) {
            if (!$active) continue;
            $pdo->prepare("INSERT INTO weekly_entry_flags (alliance, entry_id, flag_key) VALUES (?, ?, ?)")->execute([$alliance, $entryId, $flagKey]);
        }
        // Von Hand gesetzt (scan_lock) bzw. aus dem Scanner uebernommen (scan_unlock): steuert, ob der
        // Scanner-Upload diese Kategorie bei dem Spieler in der KW neu setzt (scan-flags.php)
        if (!empty($body['scan_lock'])) setScanFlagLock($pdo, $alliance, $kw, $playerId, (string)$body['scan_lock'], true);
        if (!empty($body['scan_unlock'])) setScanFlagLock($pdo, $alliance, $kw, $playerId, (string)$body['scan_unlock'], false);

        if ($txStarted && $pdo->inTransaction()) {
            $pdo->commit();
        }
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        if ($txStarted && $pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function handleDeleteEntry(PDO $pdo, string $alliance, int $kw, string $nameEncoded, array $body = []): never {
    assertHonorReadOnlyWriter($pdo, $alliance, $body);
    $name = rawurldecode($nameEncoded);
    $stmt = $pdo->prepare("SELECT we.entry_id, we.player_id FROM weekly_entries we JOIN players p ON p.alliance = we.alliance AND p.player_id = we.player_id WHERE we.alliance = ? AND we.year_week = ? AND p.current_name = ?");
    $stmt->execute([$alliance, $kw, $name]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(200, ['ok' => true]);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("DELETE FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ?")->execute([$alliance, $row['entry_id']]);
        $pdo->prepare("DELETE FROM weekly_entries WHERE alliance = ? AND entry_id = ?")->execute([$alliance, $row['entry_id']]);
        if (!empty($body['scan_lock'])) setScanFlagLock($pdo, $alliance, $kw, $row['player_id'], (string)$body['scan_lock'], true);
        $pdo->commit();
        jsonOut(200, ['ok' => true]);
    } catch (\PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}
