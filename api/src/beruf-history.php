<?php
declare(strict_types=1);

// ── Berufe-Verlauf ─────────────────────────────────────────────────────────────
// Nach jeder Aenderung der Berufe einer Allianz (Planer, Scan, Archiv, Allianz-Wechsel, Zusammenfuehren)
// wird der ganze Stand als Schnappschuss gespeichert, aber nur, wenn er sich vom letzten unterscheidet.
// Damit laesst sich jeder fruehere Stand ansehen und wiederherstellen (Berufeplaner → 🕘 Verlauf), und wer
// aus dem Archiv oder einer anderen Allianz zurueckkommt, bekommt seinen Beruf und seine Ingenieure wieder.
// Bis 15.11.2026 gab es das nicht: beim VS-Aushelfen in NxU2 ging die Planung der Aushelfer verloren.

const BERUF_HISTORY_KEEP_DAYS = 365;

/** Tabelle anlegen. DDL, darum nur ausserhalb von Transaktionen aufrufen (api/index.php beim Start). */
function ensureBerufHistoryTable(PDO $pdo): void {
    static $done = false;
    if ($done) return;
    $done = true;
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS beruf_snapshots (
            snapshot_id BIGINT NOT NULL AUTO_INCREMENT,
            alliance VARCHAR(50) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            source VARCHAR(60) NOT NULL,
            changed_by VARCHAR(150) NULL,
            state_hash CHAR(40) NOT NULL,
            warlords SMALLINT NOT NULL DEFAULT 0,
            engineers SMALLINT NOT NULL DEFAULT 0,
            changes SMALLINT NOT NULL DEFAULT 0,
            changes_json TEXT NULL,
            state_json MEDIUMTEXT NOT NULL,
            PRIMARY KEY (snapshot_id),
            KEY ix_bs_alliance_time (alliance, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/** Aktueller Berufe-Stand: aktive Mitglieder ohne Ehrenrolle, nach Spieler-ID sortiert. */
function berufCurrentState(PDO $pdo, string $alliance): array {
    $stmt = $pdo->prepare("SELECT player_id, current_name, beruf, beruf_med_hilfe, beruf_winwin_id FROM players WHERE alliance = ? AND is_active = 1 AND " . sqlNoHonor('') . " ORDER BY player_id");
    $stmt->execute([$alliance]);
    $out = [];
    foreach ($stmt->fetchAll() as $r) {
        $out[] = [
            'id' => (string)$r['player_id'],
            'n'  => (string)$r['current_name'],
            'b'  => $r['beruf'] ?: null,
            'm'  => (int)($r['beruf_med_hilfe'] ?? 0),
            'w'  => $r['beruf_winwin_id'] ?: null,
        ];
    }
    return $out;
}

/** Hash ohne Namen: eine Umbenennung allein ist keine Berufe-Aenderung. */
function berufStateHash(array $state): string {
    return sha1(json_encode(array_map(fn($e) => [$e['id'], $e['b'], $e['m'], $e['w']], $state)));
}

/** Was hat sich von $prev zu $next geaendert? Liste fuer die Anzeige (Name, vorher, nachher). */
function berufStateDiff(array $prev, array $next): array {
    $p = array_column($prev, null, 'id');
    $n = array_column($next, null, 'id');
    $wwName = fn(array $map, ?string $id) => $id !== null ? ($map[$id]['n'] ?? null) : null;
    $label = fn(?array $e, array $map) => $e === null ? null : ['b' => $e['b'], 'm' => $e['m'], 'w' => $wwName($map, $e['w'])];
    $out = [];
    foreach ($n + $p as $id => $_) {
        $a = $p[$id] ?? null;
        $b = $n[$id] ?? null;
        if ($a && $b && $a['b'] === $b['b'] && $a['m'] === $b['m'] && $a['w'] === $b['w']) continue;
        // Kommen oder Gehen ohne Beruf ist keine Berufe-Aenderung
        if (!$a && !$b['b']) continue;
        if (!$b && !$a['b']) continue;
        $out[] = ['id' => $id, 'name' => ($b ?? $a)['n'], 'from' => $label($a, $p), 'to' => $label($b, $n)];
    }
    usort($out, fn($x, $y) => strcasecmp($x['name'], $y['name']));
    return $out;
}

/**
 * Schnappschuss speichern, falls sich der Stand seit dem letzten geaendert hat. Darf in einer Transaktion
 * laufen (nur DML); wird sie zurueckgerollt, verschwindet der Schnappschuss mit. Fehler brechen nie die
 * eigentliche Aktion ab.
 */
function recordBerufSnapshot(PDO $pdo, string $alliance, string $source, ?string $changedBy = null): void {
    try {
        $state = berufCurrentState($pdo, $alliance);
        $hash = berufStateHash($state);
        $last = $pdo->prepare("SELECT state_hash, state_json FROM beruf_snapshots WHERE alliance = ? ORDER BY snapshot_id DESC LIMIT 1");
        $last->execute([$alliance]);
        $prev = $last->fetch();
        if ($prev && $prev['state_hash'] === $hash) return;

        $diff = $prev ? berufStateDiff(json_decode((string)$prev['state_json'], true) ?: [], $state) : [];
        $warlords = count(array_filter($state, fn($e) => $e['b'] === 'kriegsherr'));
        $engineers = count(array_filter($state, fn($e) => $e['b'] === 'ingenieur'));
        $pdo->prepare("INSERT INTO beruf_snapshots (alliance, source, changed_by, state_hash, warlords, engineers, changes, changes_json, state_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            ->execute([$alliance, berufCut($source, 60), $changedBy !== null ? berufCut($changedBy, 150) : null, $hash, $warlords, $engineers,
                count($diff), json_encode(array_slice($diff, 0, 12), JSON_UNESCAPED_UNICODE), json_encode($state, JSON_UNESCAPED_UNICODE)]);

        if (random_int(1, 50) === 1) {
            $pdo->prepare("DELETE FROM beruf_snapshots WHERE alliance = ? AND created_at < NOW() - INTERVAL " . BERUF_HISTORY_KEEP_DAYS . " DAY")->execute([$alliance]);
        }
    } catch (\Throwable $e) {
        error_log("beruf_snapshot {$alliance}/{$source}: " . $e->getMessage());
    }
}

/** Auf $max Zeichen kuerzen (UTF-8, ohne mbstring – das ist nicht ueberall installiert). */
function berufCut(string $s, int $max): string {
    return preg_replace('/^(.{0,' . $max . '}).*$/us', '$1', $s) ?? substr($s, 0, $max);
}

/** Max. Ingenieure je Kriegsherr, ohne DDL (laeuft auch mitten im Scan-Sync). */
function berufMaxEngineersNoDdl(PDO $pdo, string $alliance): int {
    try {
        $stmt = $pdo->prepare("SELECT config_value FROM alliance_config WHERE alliance = ? AND config_key = 'berufe_max_ingenieure' LIMIT 1");
        $stmt->execute([$alliance]);
        $raw = $stmt->fetchColumn();
    } catch (\PDOException) { $raw = null; }
    return max(1, min(10, is_numeric($raw) ? (int)$raw : 3));
}

/**
 * Kommt ein Spieler zurueck (Archiv, anderer Allianz, Zusammenfuehren), holt das seinen letzten bekannten
 * Berufe-Stand in dieser Allianz zurueck: seinen Beruf und Kriegsherrn, falls er gerade keinen hat, und als
 * Kriegsherr seine frueheren Ingenieure, soweit sie noch Ingenieur ohne Kriegsherrn sind. Was inzwischen
 * neu eingeteilt wurde, bleibt. $historyId = ID im Verlauf (beim Zusammenfuehren die des Duplikats).
 */
function restoreBerufFromHistory(PDO $pdo, string $alliance, string $historyId, ?string $targetId = null): void {
    $targetId ??= $historyId;
    try {
        $stmt = $pdo->prepare("SELECT state_json FROM beruf_snapshots WHERE alliance = ? AND state_json LIKE ? ORDER BY snapshot_id DESC LIMIT 1");
        $stmt->execute([$alliance, '%"id":' . json_encode($historyId) . '%']);
        $json = $stmt->fetchColumn();
        if ($json === false) return;
        $state = json_decode((string)$json, true) ?: [];
        $old = null;
        foreach ($state as $e) if ($e['id'] === $historyId) { $old = $e; break; }
        if (!$old || !$old['b']) return;

        $cur = $pdo->prepare("SELECT beruf, beruf_winwin_id FROM players WHERE alliance = ? AND player_id = ? AND is_active = 1");
        $cur->execute([$alliance, $targetId]);
        $now = $cur->fetch();
        if (!$now) return;
        $max = berufMaxEngineersNoDdl($pdo, $alliance);
        $count = $pdo->prepare("SELECT COUNT(*) FROM players WHERE alliance = ? AND beruf_winwin_id = ? AND is_active = 1 AND " . sqlNoHonor(''));

        if (!$now['beruf']) {
            $ww = null;
            if ($old['b'] === 'ingenieur' && $old['w']) {
                $k = $pdo->prepare("SELECT 1 FROM players WHERE alliance = ? AND player_id = ? AND beruf = 'kriegsherr' AND is_active = 1");
                $k->execute([$alliance, $old['w']]);
                $count->execute([$alliance, $old['w']]);
                if ($k->fetch() && (int)$count->fetchColumn() < $max) $ww = $old['w'];
            }
            $pdo->prepare("UPDATE players SET beruf = ?, beruf_med_hilfe = ?, beruf_winwin_id = ? WHERE alliance = ? AND player_id = ?")
                ->execute([$old['b'], $old['b'] === 'ingenieur' ? (int)$old['m'] : 0, $ww, $alliance, $targetId]);
            $now['beruf'] = $old['b'];
        }

        if ($old['b'] === 'kriegsherr' && $now['beruf'] === 'kriegsherr') {
            $count->execute([$alliance, $targetId]);
            $free = $max - (int)$count->fetchColumn();
            $link = $pdo->prepare("UPDATE players SET beruf_winwin_id = ? WHERE alliance = ? AND player_id = ? AND is_active = 1 AND beruf = 'ingenieur' AND beruf_winwin_id IS NULL");
            foreach ($state as $e) {
                if ($free <= 0) break;
                if ($e['w'] !== $historyId || $e['b'] !== 'ingenieur') continue;
                $link->execute([$targetId, $alliance, $e['id']]);
                $free -= $link->rowCount();
            }
        }
    } catch (\Throwable $e) {
        error_log("beruf_restore_history {$alliance}/{$historyId}: " . $e->getMessage());
    }
}

// ── Endpunkte ──────────────────────────────────────────────────────────────────

/** GET /beruf-history – Liste der Schnappschuesse (neueste zuerst). */
function handleGetBerufHistory(PDO $pdo, string $alliance): never {
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 200)));
    $stmt = $pdo->prepare("SELECT snapshot_id, created_at, source, changed_by, warlords, engineers, changes, changes_json FROM beruf_snapshots WHERE alliance = ? ORDER BY snapshot_id DESC LIMIT $limit");
    $stmt->execute([$alliance]);
    $rows = array_map(function ($r) {
        $r['snapshot_id'] = (int)$r['snapshot_id'];
        foreach (['warlords', 'engineers', 'changes'] as $k) $r[$k] = (int)$r[$k];
        $r['changes_list'] = json_decode((string)($r['changes_json'] ?? ''), true) ?: [];
        unset($r['changes_json']);
        return $r;
    }, $stmt->fetchAll());
    jsonOut(200, ['ok' => true, 'snapshots' => $rows]);
}

function loadBerufSnapshot(PDO $pdo, string $alliance, int $id): array {
    $stmt = $pdo->prepare("SELECT snapshot_id, created_at, source, changed_by, state_json FROM beruf_snapshots WHERE alliance = ? AND snapshot_id = ?");
    $stmt->execute([$alliance, $id]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(404, ['error' => 'Stand nicht gefunden']);
    $row['state'] = json_decode((string)$row['state_json'], true) ?: [];
    unset($row['state_json']);
    return $row;
}

/**
 * Schnappschuss auf die heutigen Spieler abbilden: zuerst per Spieler-ID, sonst per Namens-Schluessel
 * (scanNameKey, gleiche Regel wie der Scanner) fuer Spieler, die inzwischen eine neue ID haben.
 * Liefert [Snapshot-ID => heutige ID].
 */
function berufSnapshotMapping(array $snapshot, array $current): array {
    $byId = array_column($current, null, 'id');
    $map = [];
    $used = [];
    foreach ($snapshot as $e) {
        if (isset($byId[$e['id']])) { $map[$e['id']] = $e['id']; $used[$e['id']] = true; }
    }
    $byKey = [];
    foreach ($current as $c) if (!isset($used[$c['id']])) $byKey[scanNameKey($c['n'])][] = $c['id'];
    foreach ($snapshot as $e) {
        if (isset($map[$e['id']])) continue;
        $hits = $byKey[scanNameKey($e['n'])] ?? [];
        if (count($hits) === 1 && !isset($used[$hits[0]])) { $map[$e['id']] = $hits[0]; $used[$hits[0]] = true; }
    }
    return $map;
}

/** Gewuenschter Stand der heutigen Spieler laut Schnappschuss (IDs schon umgeschrieben). */
function berufTargetState(array $snapshot, array $current, ?array $only = null): array {
    $map = berufSnapshotMapping($snapshot, $current);
    $target = array_column($current, null, 'id');
    foreach ($snapshot as $e) {
        $id = $map[$e['id']] ?? null;
        if ($id === null || ($only !== null && !in_array($id, $only, true))) continue;
        $target[$id] = ['id' => $id, 'n' => $target[$id]['n'], 'b' => $e['b'], 'm' => $e['m'], 'w' => $e['w'] !== null ? ($map[$e['w']] ?? null) : null];
    }
    // Ingenieur ohne Kriegsherrn im Ziel → ohne Zuordnung
    foreach ($target as $id => $t) {
        if ($t['w'] !== null && (($target[$t['w']]['b'] ?? null) !== 'kriegsherr' || $t['b'] !== 'ingenieur')) $target[$id]['w'] = null;
    }
    return array_values($target);
}

/** GET /beruf-history/{id} – Stand und was sich gegenueber heute aendern wuerde. */
function handleGetBerufSnapshot(PDO $pdo, string $alliance, string $id): never {
    $snap = loadBerufSnapshot($pdo, $alliance, (int)$id);
    $current = berufCurrentState($pdo, $alliance);
    $target = berufTargetState($snap['state'], $current);
    $mapped = berufSnapshotMapping($snap['state'], $current);
    $gone = [];
    foreach ($snap['state'] as $e) {
        if (!isset($mapped[$e['id']]) && $e['b']) $gone[] = ['name' => $e['n'], 'b' => $e['b']];
    }
    jsonOut(200, [
        'ok' => true,
        'snapshot' => ['snapshot_id' => (int)$snap['snapshot_id'], 'created_at' => $snap['created_at'], 'source' => $snap['source'], 'changed_by' => $snap['changed_by']],
        'changes' => berufStateDiff($current, $target),
        'gone' => $gone,
    ]);
}

/**
 * POST /beruf-history/{id}/restore – Stand wiederherstellen (R4/R5). body.player_ids (optional): nur diese
 * heutigen Spieler. Spieler, die im Stand nicht vorkommen, bleiben, wie sie sind.
 */
function handleRestoreBerufSnapshot(PDO $pdo, string $alliance, string $id, array $body): never {
    $caller = requireAllianceWriter($pdo, $alliance, 4, true, (string)($body['discord_id'] ?? ''));
    $by = $caller['member']['current_name'] ?? null;
    $snap = loadBerufSnapshot($pdo, $alliance, (int)$id);
    $only = isset($body['player_ids']) && is_array($body['player_ids']) ? array_values(array_map('strval', $body['player_ids'])) : null;

    recordBerufSnapshot($pdo, $alliance, 'restore:before', $by);
    $pdo->beginTransaction();
    try {
        $current = berufCurrentState($pdo, $alliance);
        $targetList = berufTargetState($snap['state'], $current, $only);
        $changes = berufStateDiff($current, $targetList);
        $target = array_column($targetList, null, 'id');
        $set = $pdo->prepare("UPDATE players SET beruf = ?, beruf_med_hilfe = ?, beruf_winwin_id = NULL WHERE alliance = ? AND player_id = ?");
        foreach ($changes as $c) {
            $t = $target[$c['id']] ?? null;
            if ($t) $set->execute([$t['b'], $t['b'] === 'ingenieur' ? (int)$t['m'] : 0, $alliance, $t['id']]);
        }
        $link = $pdo->prepare("UPDATE players SET beruf_winwin_id = ? WHERE alliance = ? AND player_id = ?");
        foreach ($changes as $c) {
            $t = $target[$c['id']] ?? null;
            if ($t && $t['w'] !== null) $link->execute([$t['w'], $alliance, $t['id']]);
        }
        releaseOrphanEngineers($pdo, $alliance);
        recordBerufSnapshot($pdo, $alliance, 'restore:' . $snap['created_at'], $by);
        $pdo->commit();
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    jsonOut(200, ['ok' => true, 'changed' => count($changes)]);
}
