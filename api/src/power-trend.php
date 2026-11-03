<?php
declare(strict_types=1);

// ─── Kampfkraft-Verlauf fuer die Trend-Seite (web-scanner-onnx/trend.html) ──────────────────────
// GET /scans/power-history?alliance=X&weeks=8  – zum Ansehen: R4/R5, Ehren-R4 und Site-Admins.
// Liefert je aktivem Spieler einen Wert pro Kalendertag. Gibt es an einem Tag mehrere Messungen,
// gewinnt der genaue Ranglisten-Wert (ganze Zahl) vor dem auf 0,1 Mio. gerundeten Wert aus der
// Mitgliederliste, sonst die spaeteste Messung. Die Auswertung (Wochen, Samstag-Opfer, Schwankung)
// passiert in der Seite.

function handlePowerHistory(PDO $pdo, string $alliance): never {
    requireScannerAccess($pdo, $alliance, null, true);

    $weeks = max(1, min(26, (int)($_GET['weeks'] ?? 8)));
    $since = date('Y-m-d', strtotime("monday this week -" . ($weeks - 1) . " weeks"));

    $players = [];
    $stmt = $pdo->prepare('
        SELECT player_id, current_name, current_rank_code, current_power, honor_role
        FROM players WHERE alliance = ? AND is_active = 1 AND ' . sqlNoHonor('') . '
    ');
    $stmt->execute([$alliance]);
    foreach ($stmt as $p) {
        $players[$p['player_id']] = [
            'player_id' => $p['player_id'],
            'name' => $p['current_name'],
            'rank' => (int)$p['current_rank_code'],
            'honor_role' => $p['honor_role'] ?: null,
            'current_power' => normalizeStoredPower($p['current_power']),
            'days' => [],
        ];
    }

    // Werte nach der Allianz, in der sie gescannt wurden: wer gewechselt hat, zaehlt hier nur fuer seine Zeit
    // hier (dann mit former/now_alliance), ein Neuzugang erst ab seinem Wechsel; Ausgetretene mit ihren Werten
    // bis zum Austritt (former 'archived'). Siehe week-roster.php.
    $stmt = $pdo->prepare("
        SELECT player_id, value_numeric, recorded_at
        FROM player_metrics
        WHERE COALESCE(scan_alliance, alliance) = ? AND metric_type = 'POWER' AND recorded_at >= ?
        ORDER BY recorded_at
    ");
    $stmt->execute([$alliance, $since . ' 00:00:00']);
    $rows = $stmt->fetchAll();
    $missing = array_values(array_diff(array_unique(array_column($rows, 'player_id')), array_keys($players)));
    if ($missing) {
        $in = implode(',', array_fill(0, count($missing), '?'));
        $other = $pdo->prepare("SELECT player_id, alliance, current_name, current_rank_code, current_power, honor_role FROM players WHERE is_active = 1 AND player_id IN ($in)");
        $other->execute($missing);
        foreach ($other->fetchAll() as $p) {
            if (normalizeHonorRole($p['honor_role'] ?? null) !== null) continue;
            $players[$p['player_id']] = [
                'player_id' => $p['player_id'], 'name' => $p['current_name'], 'rank' => (int)$p['current_rank_code'],
                'honor_role' => null, 'current_power' => null, 'days' => [],
                'former' => 'moved', 'now_alliance' => $p['alliance'],
            ];
        }
        try {
            $arch = $pdo->prepare("SELECT player_id, current_name, current_rank_code FROM archived_players WHERE player_id IN ($in) ORDER BY archived_at");
            $arch->execute($missing);
            foreach ($arch->fetchAll() as $p) {
                if (isset($players[$p['player_id']]) && empty($players[$p['player_id']]['former'])) continue;
                $players[$p['player_id']] ??= [
                    'player_id' => $p['player_id'], 'name' => $p['current_name'], 'rank' => (int)$p['current_rank_code'],
                    'honor_role' => null, 'current_power' => null, 'days' => [], 'former' => 'archived', 'now_alliance' => null,
                ];
            }
        } catch (\PDOException $e) { if (!isOptionalTableError($e)) throw $e; }
    }
    $best = []; // player_id -> date -> [value, exact]
    foreach ($rows as $m) {
        if (!isset($players[$m['player_id']])) continue;
        $value = normalizeStoredPower($m['value_numeric']);
        if ($value === null) continue;
        $date = substr((string)$m['recorded_at'], 0, 10);
        $exact = fmod($value, 100000) != 0.0; // Mitgliederliste ist auf 0,1 Mio. gerundet
        $prev = $best[$m['player_id']][$date] ?? null;
        // genauer Wert schlaegt gerundeten; bei gleicher Art gewinnt die spaetere Messung
        if ($prev === null || $exact || !$prev[1]) {
            $best[$m['player_id']][$date] = [$value, $exact];
        }
    }
    foreach ($best as $pid => $days) {
        ksort($days);
        foreach ($days as $date => [$value, $exact]) {
            $players[$pid]['days'][] = ['d' => $date, 'v' => $value, 'exact' => $exact];
        }
    }

    jsonOut(200, [
        'ok' => true,
        'alliance' => $alliance,
        'since' => $since,
        'players' => array_values($players),
    ]);
}

/**
 * GET /scans/vs-week?alliance=X&year_week=2642 – gescannte VS-Wochenpunkte je Spieler (ansehen: R4/R5,
 * Ehren-R4, Site-Admins), fuer
 * "Aus Scanner uebernehmen" im VS-Event der Hauptseite. Platz = Reihenfolge nach Wochenpunkten unter den
 * aktiven Mitgliedern. Dazu die Tageswerte und welche Tage ueberhaupt gescannt wurden.
 */
function handleVsWeek(PDO $pdo, string $alliance): never {
    requireScannerAccess($pdo, $alliance, null, true);
    $yearWeek = (int)($_GET['year_week'] ?? 0);
    if ($yearWeek < 1000 || $yearWeek > 9953) jsonOut(400, ['error' => 'Ungueltige Woche']);
    jsonOut(200, ['ok' => true, 'alliance' => $alliance, 'year_week' => $yearWeek, ...loadVsWeek($pdo, $alliance, $yearWeek)]);
}

/**
 * Daten fuer handleVsWeek, auch genutzt vom Scanner-Sync (applyScanWeekFlags in scan-flags.php). Die Rangliste
 * enthaelt alle Werte, die in $alliance gescannt wurden (scan_alliance) – auch von Spielern, die inzwischen
 * gewechselt sind: Bienenfluesterer war bis 01.11. in NxU1, seine Wochen 42–44 zaehlen dort, nicht in NxU2.
 */
function loadVsWeek(PDO $pdo, string $alliance, int $yearWeek): array {
    $stmt = $pdo->prepare("
        SELECT m.player_id, p.current_name, p.alliance AS current_alliance, m.metric_type, m.game_day, m.value_numeric, m.recorded_at
        FROM player_metrics m
        JOIN players p ON p.alliance = m.alliance AND p.player_id = m.player_id AND p.is_active = 1
        WHERE COALESCE(m.scan_alliance, m.alliance) = ? AND m.year_week = ? AND m.metric_type IN ('VS_DAY', 'VS_WEEK')
          AND " . sqlNoHonor() . "
    ");
    $stmt->execute([$alliance, $yearWeek]);
    $players = [];
    $daysScanned = [];
    $lastScan = null;
    foreach ($stmt as $r) {
        $pid = $r['player_id'];
        // alliance: wo der Spieler heute ist (nach einem Wechsel nicht die Allianz der Rangliste) – dort liegen seine Wochen
        $players[$pid] ??= ['player_id' => $pid, 'name' => $r['current_name'], 'alliance' => $r['current_alliance'], 'week_points' => null, 'week_final' => false, 'days' => new stdClass()];
        if ($r['metric_type'] === 'VS_WEEK') {
            $players[$pid]['week_points'] = (int)$r['value_numeric'];
            $players[$pid]['week_final'] = isFinalWeekScan((string)$r['recorded_at'], $yearWeek);
        } else {
            $players[$pid]['days']->{(int)$r['game_day']} = (int)$r['value_numeric'];
            $daysScanned[(int)$r['game_day']] = true;
        }
        if ($lastScan === null || $r['recorded_at'] > $lastScan) $lastScan = $r['recorded_at'];
    }
    // Wer in der Wochen-Rangliste fehlt (beim Scrollen uebersprungen), aber Tageswerte hat, kommt mit der Summe
    // der Tage in die Rangliste (from_days). Die Summe ist eine Untergrenze – sein echter Wochenwert ist
    // mindestens so hoch –, darum zaehlt sein Platz fuer Top 10/30 (NxU2 KW43: Bienenfluesterer Mo–Fr 63,4 Mio
    // = Platz 21 ohne Haekchen). week_final bleibt false: eine Strafe gibt es aus der Summe nie.
    foreach ($players as &$p) {
        $p['from_days'] = false;
        if ($p['week_points'] === null && count((array)$p['days'])) {
            $p['week_points'] = array_sum((array)$p['days']);
            $p['from_days'] = true;
        }
    }
    unset($p);
    $list = array_values(array_filter($players, fn($p) => $p['week_points'] !== null));
    usort($list, fn($a, $b) => $b['week_points'] <=> $a['week_points']);
    foreach ($list as $i => &$p) $p['place'] = $i + 1;
    unset($p);
    ksort($daysScanned);

    return [
        'days_scanned' => array_keys($daysScanned),
        'last_scan' => $lastScan,
        'players' => $list,
    ];
}

/**
 * GET /scans/donation-week?alliance=X&year_week=2642 – gescannte Wochenspenden je Spieler (ansehen wie
 * vs-week), fuer "Aus Scanner uebernehmen" im Spenden-Event. Wochenwert aus der Wochen-Rangliste
 * (DONATION_WEEK); fehlt er, die Summe der gescannten Tageswerte (DONATION_DAY, from_days = true).
 * Platz = Reihenfolge nach Wochenspenden unter den aktiven Mitgliedern.
 */
function handleDonationWeek(PDO $pdo, string $alliance): never {
    requireScannerAccess($pdo, $alliance, null, true);
    $yearWeek = (int)($_GET['year_week'] ?? 0);
    if ($yearWeek < 1000 || $yearWeek > 9953) jsonOut(400, ['error' => 'Ungueltige Woche']);
    jsonOut(200, ['ok' => true, 'alliance' => $alliance, 'year_week' => $yearWeek, ...loadDonationWeek($pdo, $alliance, $yearWeek)]);
}

/** Daten fuer handleDonationWeek, auch genutzt vom Scanner-Sync (applyScanWeekFlags in scan-flags.php). */
function loadDonationWeek(PDO $pdo, string $alliance, int $yearWeek): array {
    $stmt = $pdo->prepare("
        SELECT m.player_id, p.current_name, p.alliance AS current_alliance, m.metric_type, m.game_day, m.value_numeric, m.recorded_at
        FROM player_metrics m
        JOIN players p ON p.alliance = m.alliance AND p.player_id = m.player_id AND p.is_active = 1
        WHERE COALESCE(m.scan_alliance, m.alliance) = ? AND m.year_week = ? AND m.metric_type IN ('DONATION_DAY', 'DONATION_WEEK')
          AND " . sqlNoHonor() . "
    ");
    $stmt->execute([$alliance, $yearWeek]);
    $players = [];
    $daysScanned = [];
    $lastScan = null;
    $lastWeekScan = null;
    foreach ($stmt as $r) {
        $pid = $r['player_id'];
        // alliance: wo der Spieler heute ist (nach einem Wechsel nicht die Allianz der Rangliste) – dort liegen seine Wochen
        $players[$pid] ??= ['player_id' => $pid, 'name' => $r['current_name'], 'alliance' => $r['current_alliance'], 'week_points' => null, 'week_final' => false, 'days' => new stdClass()];
        if ($r['metric_type'] === 'DONATION_WEEK') {
            $players[$pid]['week_points'] = (int)$r['value_numeric'];
            $players[$pid]['week_final'] = isFinalWeekScan((string)$r['recorded_at'], $yearWeek);
            if ($lastWeekScan === null || $r['recorded_at'] > $lastWeekScan) $lastWeekScan = $r['recorded_at'];
        } else {
            $players[$pid]['days']->{(int)$r['game_day']} = (int)$r['value_numeric'];
            $daysScanned[(int)$r['game_day']] = true;
        }
        if ($lastScan === null || $r['recorded_at'] > $lastScan) $lastScan = $r['recorded_at'];
    }
    foreach ($players as &$p) {
        $p['from_days'] = false;
        if ($p['week_points'] === null && count((array)$p['days'])) {
            $p['week_points'] = array_sum((array)$p['days']);
            $p['from_days'] = true;
        }
    }
    unset($p);
    $list = array_values(array_filter($players, fn($p) => $p['week_points'] !== null));
    usort($list, fn($a, $b) => $b['week_points'] <=> $a['week_points']);
    foreach ($list as $i => &$p) $p['place'] = $i + 1;
    unset($p);
    ksort($daysScanned);

    return [
        'days_scanned' => array_keys($daysScanned),
        'last_scan' => $lastScan,
        'last_week_scan' => $lastWeekScan,
        'players' => $list,
    ];
}

/**
 * POST /scans/sparwoche { year_week, active } – KW als VS-Sparwoche markieren oder nicht (R4/R5, per
 * Discord-Token geprueft). Gespeichert in alliance_config "vs_sparwochen" als kommagetrennte KW-Liste,
 * die die Hauptseite ueber /alliance-config schon mitlaedt.
 */
function handleSetSparwoche(PDO $pdo, string $alliance, array $body): never {
    $caller = requireScannerAccess($pdo, $alliance);
    ensureAllianceConfigTable($pdo);
    $yearWeek = (int)($body['year_week'] ?? 0);
    if ($yearWeek < 1000 || $yearWeek > 9953) jsonOut(400, ['error' => 'Ungueltige Woche']);
    $active = !empty($body['active']);

    $stmt = $pdo->prepare("SELECT config_value FROM alliance_config WHERE alliance = ? AND config_key = 'vs_sparwochen'");
    $stmt->execute([$alliance]);
    $weeks = array_filter(array_map('intval', explode(',', (string)($stmt->fetchColumn() ?: ''))));
    $weeks = array_values(array_unique($active ? [...$weeks, $yearWeek] : array_diff($weeks, [$yearWeek])));
    sort($weeks);
    $value = implode(',', $weeks);

    $pdo->prepare("
        INSERT INTO alliance_config (alliance, config_key, config_value, updated_by)
        VALUES (?, 'vs_sparwochen', ?, ?)
        ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP
    ")->execute([$alliance, $value, $caller['name'] ?? ($caller['site_admin'] ? 'Site-Admin' : null)]);

    jsonOut(200, ['ok' => true, 'vs_sparwochen' => $value]);
}

/**
 * Stammt ein Wochenwert aus einem Scan vom Samstag (Spieltag 6) oder spaeter? Erst dann ist er fuer eine
 * Strafe (unter 43,2 Mio / unter 35K) belastbar – unter der Woche liegt fast jeder noch darunter, und ein
 * Wert vom Dienstag, den der Samstags-Scan nicht erneuert hat, waere sicher zu niedrig. Gescannt wird meist
 * nur bis Samstagabend, deshalb reicht Samstag. Die Top-Plaetze gelten auch frueher.
 */
function isFinalWeekScan(string $recordedAt, int $yearWeek): bool {
    $ts = strtotime($recordedAt);
    if ($ts === false) return false;
    $t = scanGameTime($ts);
    return $t['year_week'] > $yearWeek || ($t['year_week'] === $yearWeek && $t['game_day'] >= 6);
}

/** Kampfkraft absolut; Werte > 10^12 stammen aus dem alten Sync-Fehler (x 10^6) und werden zurueckgerechnet. */
function normalizeStoredPower(mixed $value): ?float {
    if ($value === null || !is_numeric($value)) return null;
    $v = (float)$value;
    if ($v <= 0) return null;
    return $v > 1e12 ? round($v / 1e6) : $v;
}
