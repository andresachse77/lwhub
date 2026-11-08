<?php
declare(strict_types=1);

// ─── Mitglieder einer Allianz in einer bestimmten Woche ─────────────────────────────────────────
// Der Hub zeigte in jeder KW die heutigen Mitglieder: Neue tauchten in alten Wochen auf, Ausgetretene
// (archiviert) und Gewechselte (Wochen wandern mit) fehlten. weekRoster() ermittelt, wer in KW W in der
// Allianz war – aus Nachweisen:
//   - Scan-Werte nach scan_alliance (ab KW 42 fast taeglich, sehr verlaesslich)
//   - Wochen-Eintraege nach origin_alliance, archivierte Eintraege nach ihrer alliance (auch KW 16–21)
// Zwischen zwei Nachweisen in derselben Allianz gilt er als dabei, solange dazwischen kein Nachweis in einer
// anderen liegt. Heutige Mitglieder sind ausserdem ab ihrer Beitrittswoche dabei: created_at bzw. – nach
// einem Wechsel – die Woche nach dem letzten Nachweis in der alten Allianz.
// Ehemalige (archiviert oder inzwischen in einer anderen Allianz) kommen mit former = 'archived' | 'moved'.

/** Spielwoche (2645 = 2026 KW 45) zu einem Zeitpunkt, wie scanGameTime. */
function rosterYearWeek(?string $datetime): ?int {
    if ($datetime === null || $datetime === '') return null;
    $ts = strtotime($datetime);
    return $ts === false ? null : scanGameTime($ts)['year_week'];
}

/** Nachweise je Spieler: [player_id => [alliance => [year_week => true]]] */
function rosterEvidence(PDO $pdo): array {
    $ev = [];
    $add = function (array $rows) use (&$ev) {
        foreach ($rows as $r) if ($r['yw'] !== null) $ev[$r['player_id']][$r['a']][(int)$r['yw']] = true;
    };
    $add($pdo->query("SELECT player_id, COALESCE(scan_alliance, alliance) a, year_week yw FROM player_metrics
                      WHERE year_week IS NOT NULL GROUP BY player_id, COALESCE(scan_alliance, alliance), year_week")->fetchAll());
    $add($pdo->query("SELECT player_id, COALESCE(origin_alliance, alliance) a, year_week yw FROM weekly_entries")->fetchAll());
    try {
        $add($pdo->query("SELECT player_id, alliance a, year_week yw FROM archived_weekly_entries")->fetchAll());
    } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
    // Abgelegte alte Wertewochen (week-retention.php)
    try {
        $add($pdo->query("SELECT player_id, COALESCE(origin_alliance, alliance) a, year_week yw FROM old_weekly_entries")->fetchAll());
    } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
    return $ev;
}

/** War der Spieler in KW $yw in $alliance? $evidence = rosterEvidence()[$playerId], $joinWeek nur fuer heutige Mitglieder. */
function rosterPresent(array $evidence, string $alliance, int $yw, ?int $joinWeek): bool {
    $mine = array_keys($evidence[$alliance] ?? []);
    if (in_array($yw, $mine, true)) return true;
    $other = [];
    foreach ($evidence as $a => $weeks) if ($a !== $alliance) $other = [...$other, ...array_keys($weeks)];
    if (in_array($yw, $other, true)) return false;
    if ($joinWeek !== null && $yw >= $joinWeek) return true;
    // Luecke zwischen zwei eigenen Nachweisen, ohne fremden dazwischen
    $before = array_filter($mine, fn($w) => $w < $yw);
    $after = array_filter($mine, fn($w) => $w > $yw);
    if (!$before || !$after) return false;
    $lo = max($before); $hi = min($after);
    foreach ($other as $w) if ($w > $lo && $w < $hi) return false;
    return true;
}

/**
 * Mitglieder von $alliance in KW $yw: Liste ['player_id', 'name', 'rank', 'former' => null|'moved'|'archived',
 * 'now_alliance' => wo er heute ist (bei moved)]. Ehrenrollen nicht (wie im Hub).
 */
function weekRoster(PDO $pdo, string $alliance, int $yw): array {
    $ev = rosterEvidence($pdo);
    $out = [];

    $players = $pdo->query("SELECT alliance, player_id, current_name, current_rank_code, created_at, honor_role
                            FROM players WHERE is_active = 1")->fetchAll();
    foreach ($players as $p) {
        if (normalizeHonorRole($p['honor_role'] ?? null) !== null) continue;
        $pid = $p['player_id'];
        $evidence = $ev[$pid] ?? [];
        $here = $p['alliance'] === $alliance;
        if (!$here && !isset($evidence[$alliance])) continue;
        $joinWeek = null;
        if ($here) {
            // Beitritt: nach einem Wechsel die Woche nach dem letzten Nachweis in der alten Allianz
            $otherWeeks = [];
            foreach ($evidence as $a => $weeks) if ($a !== $alliance) $otherWeeks = [...$otherWeeks, ...array_keys($weeks)];
            $ownWeeks = array_keys($evidence[$alliance] ?? []);
            $joinWeek = $otherWeeks
                ? max($otherWeeks) + 1
                : min(array_filter([rosterYearWeek($p['created_at']), $ownWeeks ? min($ownWeeks) : null], fn($w) => $w !== null) ?: [0]);
        }
        if (!rosterPresent($evidence, $alliance, $yw, $joinWeek)) continue;
        $out[$pid] = [
            'player_id' => $pid, 'name' => $p['current_name'], 'rank' => (int)$p['current_rank_code'],
            'former' => $here ? null : 'moved', 'now_alliance' => $here ? null : $p['alliance'],
        ];
    }

    try {
        $archived = $pdo->prepare("SELECT player_id, current_name, current_rank_code, archived_at FROM archived_players
                                   WHERE alliance = ? ORDER BY archived_at");
        $archived->execute([$alliance]);
        foreach ($archived->fetchAll() as $p) {
            $pid = $p['player_id'];
            if (isset($out[$pid]) || !isset($ev[$pid][$alliance])) continue;
            if (!rosterPresent($ev[$pid], $alliance, $yw, null)) continue;
            $out[$pid] = [
                'player_id' => $pid, 'name' => $p['current_name'], 'rank' => (int)$p['current_rank_code'],
                'former' => 'archived', 'now_alliance' => null,
            ];
        }
    } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }

    // Gleicher Name wie ein heutiges Mitglied: das Mitglied gewinnt (der Hub arbeitet mit Namen)
    $names = [];
    foreach ($out as $pid => $m) if ($m['former'] === null) $names[$m['name']] = true;
    $out = array_filter($out, fn($m) => $m['former'] === null || !isset($names[$m['name']]));
    usort($out, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    return array_values($out);
}

/** GET /week-roster?alliance=X&year_week=2642 – Mitglieder der Woche (lesen wie /members). */
function handleWeekRoster(PDO $pdo, string $alliance): never {
    $yw = (int)($_GET['year_week'] ?? 0);
    if ($yw < 1000 || $yw > 9953) jsonOut(400, ['error' => 'Ungueltige Woche']);
    jsonOut(200, ['ok' => true, 'alliance' => $alliance, 'year_week' => $yw, 'members' => weekRoster($pdo, $alliance, $yw)]);
}
