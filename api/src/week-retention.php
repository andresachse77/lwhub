<?php
declare(strict_types=1);

// ─── Aufbewahrung der Wertewochen ───────────────────────────────────────────────────────────────
// Jede Allianz behaelt nur die letzten N Wochen mit Eintraegen in weekly_entries (Einstellung
// history_weeks, Standard 4, hoechstens 8). Luecken zaehlen nicht: es sind die N neuesten Wochen,
// fuer die es Eintraege gibt. Die laufende Spielwoche (noch kein Sonntag) zaehlt nicht mit, damit
// Rangliste und Inaktiv-Check weiter N abgeschlossene Wochen sehen.
// Aeltere Wochen wandern in old_weekly_entries / old_entry_flags. Das sind NICHT die Archivtabellen
// fuer ausgetretene Spieler (archived_*), sondern nur ein Ablageort fuer alte Wochen.

const HISTORY_WEEKS_DEFAULT = 4;
const HISTORY_WEEKS_MAX = 8;

function ensureOldWeekTables(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS old_weekly_entries (
            alliance        VARCHAR(50) NOT NULL,
            entry_id        CHAR(36)    NOT NULL,
            origin_alliance VARCHAR(50) NULL DEFAULT NULL,
            year_week       INT         NOT NULL,
            player_id       CHAR(36)    NOT NULL,
            base_rank_code  INT         NOT NULL DEFAULT 3,
            final_rank_code INT         NOT NULL DEFAULT 3,
            afk             TINYINT(1)  NOT NULL DEFAULT 0,
            updated_at      DATETIME    NULL DEFAULT NULL,
            moved_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, entry_id),
            KEY ix_old_week (alliance, year_week),
            KEY ix_old_player (player_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS old_entry_flags (
            alliance VARCHAR(50) NOT NULL,
            entry_id CHAR(36)    NOT NULL,
            flag_key VARCHAR(60) NOT NULL,
            PRIMARY KEY (alliance, entry_id, flag_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/** Wie viele Wertewochen die Allianz behaelt (Einstellung history_weeks, 1–8, Standard 4). */
function historyWeeksKept(PDO $pdo, string $alliance): int {
    try {
        $stmt = $pdo->prepare("SELECT config_value FROM alliance_config WHERE alliance = ? AND config_key = 'history_weeks' LIMIT 1");
        $stmt->execute([$alliance]);
        $value = $stmt->fetchColumn();
    } catch (\PDOException $e) {
        if (!isOptionalTableError($e)) throw $e;
        $value = false;
    }
    $n = $value === false ? HISTORY_WEEKS_DEFAULT : (int)$value;
    return $n < 1 ? HISTORY_WEEKS_DEFAULT : min(HISTORY_WEEKS_MAX, $n);
}

/**
 * Verschiebt alle Wochen jenseits der letzten N nach old_weekly_entries / old_entry_flags.
 * Liefert die verschobenen Wochen. Fehler brechen den eigentlichen Request nicht ab (nur Log).
 */
function pruneOldWeeks(PDO $pdo, string $alliance): array {
    if ($pdo->inTransaction()) return []; // nur nach dem Commit des Aufrufers
    try {
        $keep = historyWeeksKept($pdo, $alliance);
        $stmt = $pdo->prepare("SELECT DISTINCT year_week FROM weekly_entries WHERE alliance = ? ORDER BY year_week DESC");
        $stmt->execute([$alliance]);
        $weeks = array_map('intval', array_column($stmt->fetchAll(), 'year_week'));

        $now = scanGameTime(time());
        $running = $now['game_day'] === 7 ? null : $now['year_week'];
        $counted = array_values(array_filter($weeks, fn($yw) => $yw !== $running));
        $move = array_slice($counted, $keep);
        if (!$move) return [];

        ensureOldWeekTables($pdo);
        $in = implode(',', array_fill(0, count($move), '?'));
        $args = [$alliance, ...$move];

        $pdo->beginTransaction();
        // Dieselbe Woche eines Spielers schon abgelegt (z. B. alte KW neu eingetragen): neue gewinnt
        $pdo->prepare("
            DELETE oef FROM old_entry_flags oef
            JOIN old_weekly_entries o ON o.alliance = oef.alliance AND o.entry_id = oef.entry_id
            JOIN weekly_entries we ON we.alliance = o.alliance AND we.year_week = o.year_week AND we.player_id = o.player_id
            WHERE we.alliance = ? AND we.year_week IN ($in)
        ")->execute($args);
        $pdo->prepare("
            DELETE o FROM old_weekly_entries o
            JOIN weekly_entries we ON we.alliance = o.alliance AND we.year_week = o.year_week AND we.player_id = o.player_id
            WHERE we.alliance = ? AND we.year_week IN ($in)
        ")->execute($args);

        $pdo->prepare("
            INSERT INTO old_weekly_entries (alliance, entry_id, origin_alliance, year_week, player_id, base_rank_code, final_rank_code, afk, updated_at)
            SELECT alliance, entry_id, origin_alliance, year_week, player_id, base_rank_code, final_rank_code, afk, updated_at
            FROM weekly_entries WHERE alliance = ? AND year_week IN ($in)
        ")->execute($args);
        $pdo->prepare("
            INSERT IGNORE INTO old_entry_flags (alliance, entry_id, flag_key)
            SELECT f.alliance, f.entry_id, f.flag_key
            FROM weekly_entry_flags f
            JOIN weekly_entries we ON we.alliance = f.alliance AND we.entry_id = f.entry_id
            WHERE we.alliance = ? AND we.year_week IN ($in)
        ")->execute($args);

        $pdo->prepare("
            DELETE f FROM weekly_entry_flags f
            JOIN weekly_entries we ON we.alliance = f.alliance AND we.entry_id = f.entry_id
            WHERE we.alliance = ? AND we.year_week IN ($in)
        ")->execute($args);
        $pdo->prepare("DELETE FROM weekly_entries WHERE alliance = ? AND year_week IN ($in)")->execute($args);
        $pdo->commit();
        return $move;
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('pruneOldWeeks(' . $alliance . '): ' . $e->getMessage());
        return [];
    }
}
