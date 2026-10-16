<?php
declare(strict_types=1);

// ─── Kampfkraft-Verlauf fuer die Trend-Seite (web-scanner-onnx/trend.html) ──────────────────────
// GET /scans/power-history?alliance=X&weeks=8  – nur R4/R5 der Allianz bzw. Site-Admins (wie der Scanner).
// Liefert je aktivem Spieler einen Wert pro Kalendertag. Gibt es an einem Tag mehrere Messungen,
// gewinnt der genaue Ranglisten-Wert (ganze Zahl) vor dem auf 0,1 Mio. gerundeten Wert aus der
// Mitgliederliste, sonst die spaeteste Messung. Die Auswertung (Wochen, Samstag-Opfer, Schwankung)
// passiert in der Seite.

function handlePowerHistory(PDO $pdo, string $alliance): never {
    requireScannerAccess($pdo, $alliance);

    $weeks = max(1, min(26, (int)($_GET['weeks'] ?? 8)));
    $since = date('Y-m-d', strtotime("monday this week -" . ($weeks - 1) . " weeks"));

    $players = [];
    $stmt = $pdo->prepare('
        SELECT player_id, current_name, current_rank_code, current_power, honor_role
        FROM players WHERE alliance = ? AND is_active = 1
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

    $stmt = $pdo->prepare("
        SELECT player_id, value_numeric, recorded_at
        FROM player_metrics
        WHERE alliance = ? AND metric_type = 'POWER' AND recorded_at >= ?
        ORDER BY recorded_at
    ");
    $stmt->execute([$alliance, $since . ' 00:00:00']);
    $best = []; // player_id -> date -> [value, exact]
    foreach ($stmt as $m) {
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

/** Kampfkraft absolut; Werte > 10^12 stammen aus dem alten Sync-Fehler (x 10^6) und werden zurueckgerechnet. */
function normalizeStoredPower(mixed $value): ?float {
    if ($value === null || !is_numeric($value)) return null;
    $v = (float)$value;
    if ($v <= 0) return null;
    return $v > 1e12 ? round($v / 1e6) : $v;
}
