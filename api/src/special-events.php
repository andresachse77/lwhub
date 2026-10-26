<?php
declare(strict_types=1);

// ─── Spezialevent je KW (Events-Tab "Spezial") ──────────────────────────────────────────────────
// Die Spezialevents wechseln sich ab und sind auf einem Server fuer alle Allianzen gleich; manche Wochen
// haben keins. Gespeichert je Server und KW (Server-Nr. aus alliance_config "server", ohne Server-Nr.
// nur fuer die eigene Allianz): welches Event, Tag und Zeitfenster (fuer "Aus Scanner uebernehmen" ueber
// /scans/event-compare) oder "kein Event". Ob eine Allianz das Event auswertet, legt sie selbst fest
// (special_event_skips). Wochen ohne Event oder ohne Auswertung zaehlen in /se-inactive nicht mit.

function ensureSpecialEventsTables(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS special_events (
            scope VARCHAR(60) NOT NULL,
            year_week INT NOT NULL,
            no_event TINYINT(1) NOT NULL DEFAULT 0,
            title VARCHAR(100) NULL,
            event_date DATE NULL,
            start_time CHAR(5) NULL,
            end_time CHAR(5) NULL,
            updated_by VARCHAR(150) NULL,
            updated_alliance VARCHAR(50) NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (scope, year_week)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS special_event_skips (
            alliance VARCHAR(50) NOT NULL,
            year_week INT NOT NULL,
            updated_by VARCHAR(150) NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, year_week)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/** Server-Nr. der Allianz (alliance_config "server") oder null. */
function allianceServer(PDO $pdo, string $alliance): ?string {
    ensureAllianceConfigTable($pdo);
    $stmt = $pdo->prepare("SELECT config_value FROM alliance_config WHERE alliance = ? AND config_key = 'server'");
    $stmt->execute([$alliance]);
    $server = trim((string)($stmt->fetchColumn() ?: ''));
    return preg_match('/^\d{1,6}$/', $server) ? $server : null;
}

/** Speicherbereich der Events: alle Allianzen eines Servers teilen sich die Liste. */
function specialEventScope(PDO $pdo, string $alliance): string {
    $server = allianceServer($pdo, $alliance);
    return $server !== null ? "server:{$server}" : "alliance:" . strtolower($alliance);
}

function specialEventRow(array $r): array {
    return [
        'year_week' => (int)$r['year_week'],
        'no_event' => (bool)$r['no_event'],
        'title' => $r['title'],
        'event_date' => $r['event_date'],
        'start' => $r['start_time'],
        'end' => $r['end_time'],
        'updated_by' => $r['updated_by'],
        'updated_alliance' => $r['updated_alliance'],
        'updated_at' => $r['updated_at'],
    ];
}

/**
 * GET /special-events – Events des Servers (neueste zuerst), die KWs, die diese Allianz nicht auswertet,
 * und bisher genutzte Eventnamen fuer die Auswahl.
 */
function handleGetSpecialEvents(PDO $pdo, string $alliance): never {
    ensureSpecialEventsTables($pdo);
    $scope = specialEventScope($pdo, $alliance);
    $stmt = $pdo->prepare("SELECT * FROM special_events WHERE scope = ? ORDER BY year_week DESC LIMIT 60");
    $stmt->execute([$scope]);
    $events = array_map('specialEventRow', $stmt->fetchAll());

    $stmt = $pdo->prepare("
        SELECT title FROM special_events WHERE scope = ? AND title IS NOT NULL AND title <> ''
        GROUP BY title ORDER BY MAX(year_week) DESC LIMIT 30
    ");
    $stmt->execute([$scope]);
    $titles = array_column($stmt->fetchAll(), 'title');

    $stmt = $pdo->prepare("SELECT year_week FROM special_event_skips WHERE alliance = ? ORDER BY year_week DESC LIMIT 60");
    $stmt->execute([$alliance]);

    jsonOut(200, [
        'ok' => true,
        'server' => allianceServer($pdo, $alliance),
        'events' => $events,
        'skipped_weeks' => array_map('intval', array_column($stmt->fetchAll(), 'year_week')),
        'titles' => $titles,
    ]);
}

/**
 * POST /special-events – R4/R5.
 *   { year_week, skip: true|false }                               nur diese Allianz: KW (nicht) auswerten
 *   { year_week, no_event, title, event_date, start, end }        Event des Servers festlegen
 *   { year_week, clear: true }                                    Festlegung des Servers entfernen
 */
function handleSaveSpecialEvent(PDO $pdo, string $alliance, array $body): never {
    $caller = requireAllianceWriter($pdo, $alliance, 4, true, (string)($body['discord_id'] ?? ''));
    ensureSpecialEventsTables($pdo);
    $yearWeek = (int)($body['year_week'] ?? 0);
    if ($yearWeek < 1000 || $yearWeek > 9953) jsonOut(400, ['error' => 'Ungueltige Woche']);
    $by = $caller['member']['current_name'] ?? null;

    if (array_key_exists('skip', $body)) {
        if (!empty($body['skip'])) {
            $pdo->prepare("INSERT IGNORE INTO special_event_skips (alliance, year_week, updated_by) VALUES (?, ?, ?)")
                ->execute([$alliance, $yearWeek, $by]);
        } else {
            $pdo->prepare("DELETE FROM special_event_skips WHERE alliance = ? AND year_week = ?")->execute([$alliance, $yearWeek]);
        }
        handleGetSpecialEvents($pdo, $alliance);
    }

    $scope = specialEventScope($pdo, $alliance);
    if (!empty($body['clear'])) {
        $pdo->prepare("DELETE FROM special_events WHERE scope = ? AND year_week = ?")->execute([$scope, $yearWeek]);
        handleGetSpecialEvents($pdo, $alliance);
    }

    $noEvent = !empty($body['no_event']);
    $title = mb_substr(trim((string)($body['title'] ?? '')), 0, 100) ?: null;
    $date = trim((string)($body['event_date'] ?? ''));
    $time = fn($v) => preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', trim((string)$v)) ? trim((string)$v) : null;
    $start = $time($body['start'] ?? '');
    $end = $time($body['end'] ?? '');
    if ($noEvent) {
        $date = null; $start = null; $end = null; $title = null;
    } elseif (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !strtotime($date)) {
        jsonOut(400, ['error' => 'Ungueltiges Datum']);
    }

    $pdo->prepare("
        INSERT INTO special_events (scope, year_week, no_event, title, event_date, start_time, end_time, updated_by, updated_alliance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE no_event = VALUES(no_event), title = VALUES(title), event_date = VALUES(event_date),
            start_time = VALUES(start_time), end_time = VALUES(end_time), updated_by = VALUES(updated_by),
            updated_alliance = VALUES(updated_alliance)
    ")->execute([$scope, $yearWeek, $noEvent ? 1 : 0, $title, $date, $start, $end, $by, $alliance]);
    handleGetSpecialEvents($pdo, $alliance);
}

/** KWs ohne Spezialevent auf dem Server oder ohne Auswertung in dieser Allianz (fuer /se-inactive). */
function specialEventFreeWeeks(PDO $pdo, string $alliance): array {
    ensureSpecialEventsTables($pdo);
    $stmt = $pdo->prepare("
        SELECT year_week FROM special_events WHERE scope = ? AND no_event = 1
        UNION SELECT year_week FROM special_event_skips WHERE alliance = ?
    ");
    $stmt->execute([specialEventScope($pdo, $alliance), $alliance]);
    return array_map('intval', array_column($stmt->fetchAll(), 'year_week'));
}
