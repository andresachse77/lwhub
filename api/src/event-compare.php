<?php
declare(strict_types=1);

// ─── Event-Auswertung Vorher/Nachher (web-scanner-onnx/event.html) ──────────────────────────────
// GET /scans/event-compare?alliance=X&start=2026-10-17T16:00&end=2026-10-17T20:00[&before_h=12][&after_min=90]
// Zum Ansehen wie der Trend: R4/R5, Ehren-R4 und Site-Admins.
//
// Je aktivem Spieler und Messwert (POWER, KILLS):
//   vorher  = letzter Scan in [start - before_h, start]
//   nachher = letzter Scan in (start, end + after_min] – endet das Event frueher, zaehlt der Scan direkt
//             danach; der Nachlauf faengt Scans auf, die kurz nach dem Ende gemacht werden.
// Dazu alle Kills-Messpunkte im Fenster (fuer "wer hat wann gekaempft"). Die Bewertung (Schwellen)
// macht die Seite.

function handleEventCompare(PDO $pdo, string $alliance): never {
    requireScannerAccess($pdo, $alliance, null, true);

    $start = strtotime((string)($_GET['start'] ?? ''));
    $end = strtotime((string)($_GET['end'] ?? ''));
    if (!$start || !$end || $end <= $start || $end - $start > 2 * 86400) {
        jsonOut(400, ['error' => 'Ungueltiger Zeitraum (start/end)']);
    }
    $beforeH = max(1, min(48, (int)($_GET['before_h'] ?? 12)));
    $afterMin = max(0, min(720, (int)($_GET['after_min'] ?? 90)));
    $fmt = fn(int $t) => date('Y-m-d H:i:s', $t);
    $from = $fmt($start - $beforeH * 3600);
    $startS = $fmt($start);
    $until = $fmt($end + $afterMin * 60);

    $players = [];
    $stmt = $pdo->prepare('
        SELECT player_id, current_name, current_rank_code, honor_role
        FROM players WHERE alliance = ? AND is_active = 1
    ');
    $stmt->execute([$alliance]);
    foreach ($stmt as $p) {
        $players[$p['player_id']] = [
            'player_id' => $p['player_id'],
            'name' => $p['current_name'],
            'rank' => (int)$p['current_rank_code'],
            'honor_role' => $p['honor_role'] ?: null,
            'power' => ['before' => null, 'after' => null],
            'kills' => ['before' => null, 'after' => null],
            'kills_points' => [],
        ];
    }

    $stmt = $pdo->prepare("
        SELECT player_id, metric_type, value_numeric, recorded_at
        FROM player_metrics
        WHERE alliance = ? AND metric_type IN ('POWER', 'KILLS') AND recorded_at >= ? AND recorded_at <= ?
        ORDER BY recorded_at
    ");
    $stmt->execute([$alliance, $from, $until]);
    $scanTimes = ['POWER' => [], 'KILLS' => []];
    foreach ($stmt as $m) {
        if (!isset($players[$m['player_id']])) continue;
        $isPower = $m['metric_type'] === 'POWER';
        $v = $isPower ? normalizeStoredPower($m['value_numeric']) : (is_numeric($m['value_numeric']) ? (float)$m['value_numeric'] : null);
        if ($v === null) continue;
        $at = (string)$m['recorded_at'];
        $point = ['v' => $v, 'at' => $at];
        $key = $isPower ? 'power' : 'kills';
        // ORDER BY recorded_at: jeweils der spaeteste Scan vor bzw. nach dem Start gewinnt
        $players[$m['player_id']][$key][$at <= $startS ? 'before' : 'after'] = $point;
        if (!$isPower && $at > $startS) $players[$m['player_id']]['kills_points'][] = $point;
        $scanTimes[$m['metric_type']][substr($at, 0, 16)] = true;
    }

    jsonOut(200, [
        'ok' => true,
        'alliance' => $alliance,
        'start' => $startS,
        'end' => $fmt($end),
        'window' => ['from' => $from, 'until' => $until],
        'scans' => ['power' => array_keys($scanTimes['POWER']), 'kills' => array_keys($scanTimes['KILLS'])],
        'players' => array_values($players),
    ]);
}
