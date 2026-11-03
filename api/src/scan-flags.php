<?php
declare(strict_types=1);

// ─── VS- und Spenden-Haekchen direkt beim Scanner-Upload ─────────────────────────────────────────
// Nach jedem Sync mit VS- bzw. Spenden-Werten rechnet der Hub die Haekchen der betroffenen KW neu – die
// gleichen Regeln wie "Aus Scanner uebernehmen" (vsImportFromScanner / spendeImportFromScanner in
// index.html, dort bei Aenderungen mitziehen). Jeder gescannte Spieler bekommt einen Wocheneintrag, auch
// ohne Haekchen, damit er im Dashboard als erfasst zaehlt.
// Hat ein R4/R5 die Haekchen einer Kategorie bei einem Spieler von Hand gesetzt (Kachel im Event), steht
// eine Sperre in scan_flag_locks: diese Kategorie ruehrt der Upload bei ihm in der KW nicht mehr an.
// "Aus Scanner uebernehmen" hebt die Sperre wieder auf.

const SCAN_FLAG_KEYS = [
    'vs'     => ['vsTop10', 'vsTop30', 'vsUnter50', 'vsSpar'],
    'spende' => ['spendeTop20', 'spendeUnter35k'],
];
const SCAN_VS_MIN_POINTS = 43200000;
const SCAN_VS_SPAR_MAX_PER_DAY = 10000000;
const SCAN_DONATION_MIN_POINTS = 35000;
const SCAN_DONATION_TOP = 20;
// Hilfsaccounts von Thomas (Test-Accounts in NxU1/NxU2): bekommen nie Event-Haekchen aus dem Scanner.
// Gleiche Liste in index.html (SCAN_FLAG_SKIP_NAMES).
const SCAN_FLAG_SKIP_NAMES = ['Thomas1', 'Thomas2'];

function ensureScanFlagLocksTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS scan_flag_locks (
            alliance VARCHAR(50) NOT NULL,
            year_week INT NOT NULL,
            player_id CHAR(36) NOT NULL,
            category VARCHAR(10) NOT NULL,
            locked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (alliance, year_week, player_id, category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/** Sperre setzen (lock) oder aufheben (unlock) – aus dem Speichern/Loeschen eines Wocheneintrags. */
function setScanFlagLock(PDO $pdo, string $alliance, int $yearWeek, string $playerId, string $category, bool $lock): void {
    if (!isset(SCAN_FLAG_KEYS[$category])) return;
    if ($lock) {
        $pdo->prepare("INSERT INTO scan_flag_locks (alliance, year_week, player_id, category) VALUES (?, ?, ?, ?)
                       ON DUPLICATE KEY UPDATE locked_at = CURRENT_TIMESTAMP")
            ->execute([$alliance, $yearWeek, $playerId, $category]);
    } else {
        $pdo->prepare("DELETE FROM scan_flag_locks WHERE alliance = ? AND year_week = ? AND player_id = ? AND category = ?")
            ->execute([$alliance, $yearWeek, $playerId, $category]);
    }
}

function isScanSparwoche(PDO $pdo, string $alliance, int $yearWeek): bool {
    try {
        $stmt = $pdo->prepare("SELECT config_value FROM alliance_config WHERE alliance = ? AND config_key = 'vs_sparwochen'");
        $stmt->execute([$alliance]);
        return in_array($yearWeek, array_map('intval', explode(',', (string)($stmt->fetchColumn() ?: ''))), true);
    } catch (\PDOException $e) {
        if (isOptionalTableError($e)) return false;
        throw $e;
    }
}

/**
 * Gewuenschte Haekchen je player_id fuer eine Kategorie und KW (Rangliste der Allianz $alliance):
 * [player_id => ['alliance' => wo der Spieler heute ist, 'flags' => [flag_key, …] oder null]].
 * null = nur erfasst, Haekchen bleiben (VS ohne Platz – seit from_days mitzaehlt, kommt das kaum noch vor).
 * Spieler ohne verwertbare Werte fehlen (Sparwoche: ohne Tageswerte).
 */
function scanWantedFlags(PDO $pdo, string $alliance, int $yearWeek, string $category): array {
    $wanted = [];
    $put = function (array $p, ?array $flags) use (&$wanted, $alliance) {
        $wanted[$p['player_id']] = ['alliance' => $p['alliance'] ?? $alliance, 'flags' => $flags];
    };
    if ($category === 'vs') {
        $spar = isScanSparwoche($pdo, $alliance, $yearWeek);
        foreach (loadVsWeek($pdo, $alliance, $yearWeek)['players'] as $p) {
            if (in_array($p['name'], SCAN_FLAG_SKIP_NAMES, true)) continue;
            $flags = [];
            if ($spar) {
                $days = array_values((array)$p['days']);
                if (!$days) continue;
                if (max($days) <= SCAN_VS_SPAR_MAX_PER_DAY) $flags[] = 'vsSpar';
            } else {
                if ($p['place'] === null) { $put($p, null); continue; }
                if ($p['place'] <= 10) $flags[] = 'vsTop10';
                if ($p['place'] <= 30) $flags[] = 'vsTop30';
                if ($p['week_points'] < SCAN_VS_MIN_POINTS && $p['week_final']) $flags[] = 'vsUnter50'; // Strafe erst ab Samstag
            }
            $put($p, $flags);
        }
    } elseif ($category === 'spende') {
        foreach (loadDonationWeek($pdo, $alliance, $yearWeek)['players'] as $p) {
            if (in_array($p['name'], SCAN_FLAG_SKIP_NAMES, true)) continue;
            $flags = [];
            if ($p['place'] <= SCAN_DONATION_TOP) $flags[] = 'spendeTop20';
            if ($p['week_points'] < SCAN_DONATION_MIN_POINTS && $p['week_final']) $flags[] = 'spendeUnter35k'; // erst ab Samstag
            $put($p, $flags);
        }
    }
    return $wanted;
}

/**
 * Haekchen einer Kategorie in einer KW aus den Scan-Werten setzen. Nur die Haekchen dieser Kategorie werden
 * ersetzt, andere bleiben; fehlt der Eintrag, wird er mit dem aktuellen Rang angelegt. Gesperrte Spieler
 * (scan_flag_locks) bleiben unberuehrt. Rangliste = in $alliance gescannte Werte; der Eintrag liegt dort, wo
 * der Spieler heute ist (nach einem Allianz-Wechsel wandern seine Wochen mit). Kennt die Allianz des Eintrags
 * die Haekchen nicht, passiert dort nichts. Laeuft innerhalb der Transaktion des Syncs.
 * Rueckgabe: Zaehler fuer die Sync-Antwort.
 */
function applyScanWeekFlags(PDO $pdo, string $alliance, int $yearWeek, string $category): array {
    $result = ['year_week' => $yearWeek, 'category' => $category, 'changed' => 0, 'created' => 0, 'locked' => 0];
    $keys = SCAN_FLAG_KEYS[$category] ?? [];
    $in = implode(',', array_fill(0, count($keys), '?'));
    $known = $pdo->prepare("SELECT flag_key FROM flags WHERE alliance = ? AND flag_key IN ($in)");
    $knownCache = [];
    $knownKeys = function (string $a) use ($known, $keys, &$knownCache): array {
        if (!isset($knownCache[$a])) { $known->execute([$a, ...$keys]); $knownCache[$a] = array_column($known->fetchAll(), 'flag_key'); }
        return $knownCache[$a];
    };
    if (!$knownKeys($alliance)) return $result;

    $wanted = scanWantedFlags($pdo, $alliance, $yearWeek, $category);
    if (!$wanted) return $result;

    $locks = $pdo->prepare("SELECT alliance, player_id FROM scan_flag_locks WHERE year_week = ? AND category = ?");
    $locks->execute([$yearWeek, $category]);
    $locked = [];
    foreach ($locks->fetchAll() as $l) $locked[$l['alliance'] . '|' . $l['player_id']] = true;

    $weekOk = [];
    $findEntry = $pdo->prepare("SELECT entry_id FROM weekly_entries WHERE alliance = ? AND year_week = ? AND player_id = ?");
    $entryFlags = $pdo->prepare("SELECT flag_key FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ? AND flag_key IN ($in)");
    $rankOf = $pdo->prepare("SELECT current_rank_code FROM players WHERE alliance = ? AND player_id = ?");
    $delFlags = $pdo->prepare("DELETE FROM weekly_entry_flags WHERE alliance = ? AND entry_id = ? AND flag_key IN ($in)");
    $addFlag = $pdo->prepare("INSERT INTO weekly_entry_flags (alliance, entry_id, flag_key) VALUES (?, ?, ?)");

    foreach ($wanted as $playerId => ['alliance' => $ea, 'flags' => $flags]) {
        if (isset($locked[$ea . '|' . $playerId])) { $result['locked']++; continue; }
        $eaKeys = $knownKeys($ea);
        if (!$eaKeys) continue;
        if (!isset($weekOk[$ea])) {
            $pdo->prepare("INSERT INTO week_periods (alliance, year_week) VALUES (?, ?) ON DUPLICATE KEY UPDATE year_week = VALUES(year_week)")
                ->execute([$ea, $yearWeek]);
            $weekOk[$ea] = true;
        }

        $findEntry->execute([$ea, $yearWeek, $playerId]);
        $entryId = $findEntry->fetchColumn();
        if ($entryId === false) {
            $rankOf->execute([$ea, $playerId]);
            $rank = safeRank((int)($rankOf->fetchColumn() ?: 3));
            $entryId = uuid4();
            $pdo->prepare("INSERT INTO weekly_entries (alliance, entry_id, year_week, player_id, base_rank_code, final_rank_code, afk) VALUES (?, ?, ?, ?, ?, ?, 0)")
                ->execute([$ea, $entryId, $yearWeek, $playerId, $rank, $rank]);
            $result['created']++;
            $current = [];
        } else {
            $entryFlags->execute([$ea, $entryId, ...$keys]);
            $current = array_column($entryFlags->fetchAll(), 'flag_key');
        }
        if ($flags === null) continue;
        $flags = array_values(array_intersect($flags, $eaKeys));

        $same = !array_diff($flags, $current) && !array_diff($current, $flags);
        if ($same) continue;
        $delFlags->execute([$ea, $entryId, ...$keys]);
        foreach ($flags as $flagKey) $addFlag->execute([$ea, $entryId, $flagKey]);
        $pdo->prepare("UPDATE weekly_entries SET updated_at = CURRENT_TIMESTAMP WHERE alliance = ? AND entry_id = ?")
            ->execute([$ea, $entryId]);
        $result['changed']++;
    }
    return $result;
}
