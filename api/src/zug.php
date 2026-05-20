<?php
declare(strict_types=1);

function ensureZugTables(PDO $pdo, string $alliance): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS zug_rulesets (
            alliance         VARCHAR(50)  NOT NULL,
            ruleset_key      VARCHAR(50)  NOT NULL,
            ruleset_name     VARCHAR(100) NOT NULL,
            description      VARCHAR(255) NULL,
            allowed_weekdays VARCHAR(20)  NULL,
            is_active        TINYINT(1)   NOT NULL DEFAULT 1,
            sort_order       INT          NOT NULL DEFAULT 0,
            PRIMARY KEY (alliance, ruleset_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS zug_queue (
            alliance       VARCHAR(50)  NOT NULL,
            ruleset_key    VARCHAR(50)  NOT NULL,
            member_name    VARCHAR(150) NOT NULL,
            queue_position INT          NOT NULL,
            last_turn_date DATE         NULL,
            turn_count     INT          NOT NULL DEFAULT 0,
            PRIMARY KEY (alliance, ruleset_key, member_name),
            KEY ix_zug_queue_pos (alliance, ruleset_key, queue_position)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS zug_schedule (
            id                      CHAR(36)     NOT NULL,
            alliance                VARCHAR(50)  NOT NULL,
            event_date              DATE         NOT NULL,
            ruleset_key             VARCHAR(50)  NOT NULL DEFAULT 'standard',
            schaffner_name          VARCHAR(150) NOT NULL,
            vip_name                VARCHAR(150) NULL,
            status                  VARCHAR(20)  NOT NULL DEFAULT 'planned',
            is_substitute           TINYINT(1)   NOT NULL DEFAULT 0,
            original_schaffner_name VARCHAR(150) NULL,
            notes                   VARCHAR(255) NULL,
            created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by              VARCHAR(150) NOT NULL DEFAULT '',
            PRIMARY KEY (id),
            UNIQUE KEY uq_zug_date_ruleset (alliance, event_date, ruleset_key),
            KEY ix_zug_date (alliance, event_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    // Seed default ruleset for this alliance
    $pdo->prepare("
        INSERT IGNORE INTO zug_rulesets (alliance, ruleset_key, ruleset_name, description, is_active, sort_order)
        VALUES (?, 'standard', 'Standard (Listenprinzip)', 'Alle Spieler der Reihe nach; wer dran war kommt ans Ende.', 1, 0)
    ")->execute([$alliance]);
}

function requireZugR4(PDO $pdo, string $alliance, array $body): array {
    try {
        $did = normalizeDiscordId($body['discord_id'] ?? '');
    } catch (\InvalidArgumentException $e) {
        jsonOut(401, ['error' => $e->getMessage()]);
    }
    if ($did === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    $member = getDiscordMember($pdo, $alliance, $did, true);
    if (!$member) jsonOut(403, ['error' => 'Nur R4/R5 darf diese Zug-Aktion ausführen']);
    return $member;
}

function getZugQueueRows(PDO $pdo, string $alliance, string $rulesetKey): array {
    $stmt = $pdo->prepare("
        SELECT member_name, queue_position, last_turn_date, turn_count
        FROM zug_queue
        WHERE alliance=? AND ruleset_key=?
        ORDER BY queue_position ASC
    ");
    $stmt->execute([$alliance, $rulesetKey]);
    return $stmt->fetchAll();
}

function advanceZugQueue(PDO $pdo, string $alliance, string $rulesetKey, string $memberName, string $eventDate): void {
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("SELECT queue_position FROM zug_queue WHERE alliance=? AND ruleset_key=? AND member_name=?");
        $stmt->execute([$alliance, $rulesetKey, $memberName]);
        $row = $stmt->fetch();
        if (!$row) { $pdo->commit(); return; }
        $oldPos = (int)$row['queue_position'];

        $maxStmt = $pdo->prepare("SELECT MAX(queue_position) as mx FROM zug_queue WHERE alliance=? AND ruleset_key=?");
        $maxStmt->execute([$alliance, $rulesetKey]);
        $maxPos = (int)($maxStmt->fetch()['mx'] ?? $oldPos);

        // Shift everyone above oldPos down by 1
        $pdo->prepare("UPDATE zug_queue SET queue_position=queue_position-1 WHERE alliance=? AND ruleset_key=? AND queue_position>? AND member_name!=?")
            ->execute([$alliance, $rulesetKey, $oldPos, $memberName]);
        // Move member to end
        $pdo->prepare("UPDATE zug_queue SET queue_position=?, last_turn_date=?, turn_count=turn_count+1 WHERE alliance=? AND ruleset_key=? AND member_name=?")
            ->execute([$maxPos, $eventDate, $alliance, $rulesetKey, $memberName]);

        $pdo->commit();
    } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
}

function resetZugQueueToFront(PDO $pdo, string $alliance, string $rulesetKey, string $memberName): void {
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("SELECT queue_position FROM zug_queue WHERE alliance=? AND ruleset_key=? AND member_name=?");
        $stmt->execute([$alliance, $rulesetKey, $memberName]);
        $row = $stmt->fetch();
        if (!$row) { $pdo->commit(); return; }
        $oldPos = (int)$row['queue_position'];
        if ($oldPos === 1) { $pdo->commit(); return; }

        // Shift everyone before oldPos forward by 1
        $pdo->prepare("UPDATE zug_queue SET queue_position=queue_position+1 WHERE alliance=? AND ruleset_key=? AND queue_position<? AND member_name!=?")
            ->execute([$alliance, $rulesetKey, $oldPos, $memberName]);
        // Move member to front and undo turn count
        $pdo->prepare("UPDATE zug_queue SET queue_position=1, turn_count=GREATEST(0,turn_count-1), last_turn_date=NULL WHERE alliance=? AND ruleset_key=? AND member_name=?")
            ->execute([$alliance, $rulesetKey, $memberName]);

        $pdo->commit();
    } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
}

function hasWeeklyZugRole(PDO $pdo, string $alliance, string $memberName, string $eventDate, ?string $excludeId = null): bool {
    $sql = "SELECT COUNT(*) FROM zug_schedule WHERE alliance=? AND YEARWEEK(event_date,3)=YEARWEEK(?,3) AND (schaffner_name=? OR vip_name=?) AND status!='cancelled'";
    $params = [$alliance, $eventDate, $memberName, $memberName];
    if ($excludeId !== null) { $sql .= " AND id!=?"; $params[] = $excludeId; }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return (int)$stmt->fetchColumn() > 0;
}

function handleGetZugRulesets(PDO $pdo, string $alliance): never {
    $stmt = $pdo->prepare("SELECT ruleset_key,ruleset_name,description,allowed_weekdays,is_active,sort_order FROM zug_rulesets WHERE alliance=? ORDER BY sort_order,ruleset_key");
    $stmt->execute([$alliance]);
    jsonOut(200, ['ok' => true, 'rulesets' => $stmt->fetchAll()]);
}

function handleSaveZugRuleset(PDO $pdo, string $alliance, array $body): never {
    $key  = trim((string)($body['ruleset_key']  ?? ''));
    $name = trim((string)($body['ruleset_name'] ?? ''));
    if ($key === '' || $name === '') jsonOut(400, ['error' => 'ruleset_key und ruleset_name sind erforderlich']);
    if (!preg_match('/^[a-z0-9_-]+$/', $key)) jsonOut(400, ['error' => 'ruleset_key darf nur a-z 0-9 _ - enthalten']);
    $desc     = trim((string)($body['description']      ?? '')) ?: null;
    $weekdays = trim((string)($body['allowed_weekdays'] ?? '')) ?: null;
    $active   = isset($body['is_active']) ? (int)(bool)$body['is_active'] : 1;
    $order    = (int)($body['sort_order'] ?? 0);
    $pdo->prepare("
        INSERT INTO zug_rulesets (alliance,ruleset_key,ruleset_name,description,allowed_weekdays,is_active,sort_order)
        VALUES(?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE ruleset_name=VALUES(ruleset_name),description=VALUES(description),
            allowed_weekdays=VALUES(allowed_weekdays),is_active=VALUES(is_active),sort_order=VALUES(sort_order)
    ")->execute([$alliance,$key,$name,$desc,$weekdays,$active,$order]);
    handleGetZugRulesets($pdo, $alliance);
}

function handleDeleteZugRuleset(PDO $pdo, string $alliance, string $key): never {
    if ($key === 'standard') jsonOut(400, ['error' => 'Das Standard-Regelwerk kann nicht gelöscht werden']);
    $pdo->prepare("DELETE FROM zug_rulesets WHERE alliance=? AND ruleset_key=?")->execute([$alliance, $key]);
    handleGetZugRulesets($pdo, $alliance);
}

function handleGetZugQueue(PDO $pdo, string $alliance): never {
    $rulesetKey = trim($_GET['ruleset'] ?? 'standard');
    $queue = getZugQueueRows($pdo, $alliance, $rulesetKey);
    jsonOut(200, ['ok' => true, 'ruleset' => $rulesetKey, 'queue' => $queue]);
}

function handleSyncZugQueue(PDO $pdo, string $alliance, array $body): never {
    $rulesetKey = trim((string)($body['ruleset'] ?? 'standard'));
    $stmt = $pdo->prepare("SELECT current_name FROM players WHERE alliance=? AND is_active=1 ORDER BY current_name");
    $stmt->execute([$alliance]);
    $activeMembers = array_column($stmt->fetchAll(), 'current_name');
    $queue = getZugQueueRows($pdo, $alliance, $rulesetKey);
    $inQueue = array_column($queue, 'member_name');
    $maxPos = !empty($queue) ? (int)max(array_column($queue, 'queue_position')) : 0;
    foreach ($activeMembers as $m) {
        if (!in_array($m, $inQueue, true)) {
            $maxPos++;
            $pdo->prepare("INSERT IGNORE INTO zug_queue (alliance,ruleset_key,member_name,queue_position) VALUES(?,?,?,?)")
                ->execute([$alliance, $rulesetKey, $m, $maxPos]);
        }
    }
    foreach ($inQueue as $m) {
        if (!in_array($m, $activeMembers, true)) {
            $pdo->prepare("DELETE FROM zug_queue WHERE alliance=? AND ruleset_key=? AND member_name=?")
                ->execute([$alliance, $rulesetKey, $m]);
        }
    }
    // Re-compact positions
    $upd = getZugQueueRows($pdo, $alliance, $rulesetKey);
    foreach ($upd as $i => $r) {
        $pdo->prepare("UPDATE zug_queue SET queue_position=? WHERE alliance=? AND ruleset_key=? AND member_name=?")
            ->execute([$i+1, $alliance, $rulesetKey, $r['member_name']]);
    }
    handleGetZugQueue($pdo, $alliance);
}

function handleReorderZugQueue(PDO $pdo, string $alliance, array $body): never {
    $rulesetKey = trim((string)($body['ruleset'] ?? 'standard'));
    $order = $body['order'] ?? [];
    if (!is_array($order)) jsonOut(400, ['error' => 'order muss ein Array sein']);
    $pdo->beginTransaction();
    try {
        foreach ($order as $i => $name) {
            if (!is_string($name) || $name === '') continue;
            $pdo->prepare("UPDATE zug_queue SET queue_position=? WHERE alliance=? AND ruleset_key=? AND member_name=?")
                ->execute([$i+1, $alliance, $rulesetKey, (string)$name]);
        }
        $pdo->commit();
    } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
    handleGetZugQueue($pdo, $alliance);
}

function handleGetZugSchedule(PDO $pdo, string $alliance): never {
    $month = trim($_GET['month'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) $month = date('Y-m');
    $firstOfMonth = new \DateTime($month . '-01');
    $dow = (int)$firstOfMonth->format('N');
    $rangeStart = (clone $firstOfMonth)->modify('-' . ($dow - 1) . ' days');
    $lastOfMonth = new \DateTime($month . '-' . $firstOfMonth->format('t'));
    $dow2 = (int)$lastOfMonth->format('N');
    $rangeEnd = (clone $lastOfMonth)->modify('+' . (7 - $dow2) . ' days');
    $stmt = $pdo->prepare("
        SELECT id,event_date,ruleset_key,schaffner_name,vip_name,status,
               is_substitute,original_schaffner_name,notes,created_by
        FROM zug_schedule
        WHERE alliance=? AND event_date BETWEEN ? AND ?
        ORDER BY event_date ASC
    ");
    $stmt->execute([$alliance, $rangeStart->format('Y-m-d'), $rangeEnd->format('Y-m-d')]);
    jsonOut(200, ['ok' => true, 'month' => $month, 'entries' => $stmt->fetchAll()]);
}

function handleGetZugSuggest(PDO $pdo, string $alliance): never {
    $rulesetKey = trim($_GET['ruleset'] ?? 'standard');
    $eventDate  = trim($_GET['date'] ?? date('Y-m-d'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $eventDate)) $eventDate = date('Y-m-d');
    $queue = getZugQueueRows($pdo, $alliance, $rulesetKey);
    $sugSchaffner = null; $sugVip = null;
    foreach ($queue as $row) {
        if ($sugSchaffner === null && !hasWeeklyZugRole($pdo, $alliance, $row['member_name'], $eventDate)) {
            $sugSchaffner = $row['member_name'];
        } elseif ($sugSchaffner !== null && $sugVip === null && !hasWeeklyZugRole($pdo, $alliance, $row['member_name'], $eventDate)) {
            $sugVip = $row['member_name'];
            break;
        }
    }
    jsonOut(200, ['ok' => true, 'suggested_schaffner' => $sugSchaffner, 'suggested_vip' => $sugVip]);
}

function handleCreateZugSchedule(PDO $pdo, string $alliance, array $body): never {
    $eventDate  = trim((string)($body['event_date']     ?? ''));
    $rulesetKey = trim((string)($body['ruleset_key']    ?? 'standard'));
    $schaffner  = trim((string)($body['schaffner_name'] ?? ''));
    $vip        = trim((string)($body['vip_name']       ?? '')) ?: null;
    $notes      = trim((string)($body['notes']          ?? '')) ?: null;
    $autoAdv    = (bool)($body['auto_advance'] ?? true);
    $createdBy  = trim((string)($body['created_by']     ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $eventDate)) jsonOut(400, ['error' => 'Ungültiges Datum (YYYY-MM-DD erwartet)']);
    if ($schaffner === '') jsonOut(400, ['error' => 'Schaffner-Name erforderlich']);
    if (hasWeeklyZugRole($pdo, $alliance, $schaffner, $eventDate)) {
        jsonOut(409, ['error' => "{$schaffner} ist diese Woche bereits als Schaffner oder VIP eingeplant."]);
    }
    if ($vip !== null && hasWeeklyZugRole($pdo, $alliance, $vip, $eventDate)) {
        jsonOut(409, ['error' => "{$vip} ist diese Woche bereits als Schaffner oder VIP eingeplant."]);
    }
    $id = uuid4();
    $pdo->prepare("
        INSERT INTO zug_schedule (id,alliance,event_date,ruleset_key,schaffner_name,vip_name,status,notes,created_by)
        VALUES(?,?,?,?,?,?,'planned',?,?)
    ")->execute([$id,$alliance,$eventDate,$rulesetKey,$schaffner,$vip,$notes,$createdBy]);
    if ($autoAdv) advanceZugQueue($pdo, $alliance, $rulesetKey, $schaffner, $eventDate);
    jsonOut(201, ['ok' => true, 'id' => $id]);
}

function handleUpdateZugSchedule(PDO $pdo, string $alliance, string $id, array $body): never {
    $stmt = $pdo->prepare("SELECT * FROM zug_schedule WHERE id=? AND alliance=?");
    $stmt->execute([$id, $alliance]);
    $entry = $stmt->fetch();
    if (!$entry) jsonOut(404, ['error' => 'Eintrag nicht gefunden']);
    $schaffner = isset($body['schaffner_name']) ? trim((string)$body['schaffner_name']) : $entry['schaffner_name'];
    $vip       = array_key_exists('vip_name', $body) ? (trim((string)$body['vip_name']) ?: null) : $entry['vip_name'];
    $status    = isset($body['status']) ? trim((string)$body['status']) : $entry['status'];
    $notes     = array_key_exists('notes', $body) ? (trim((string)$body['notes']) ?: null) : $entry['notes'];
    if (!in_array($status, ['planned','completed','noshow','cancelled'], true)) jsonOut(400, ['error' => 'Ungültiger Status']);
    if ($schaffner !== $entry['schaffner_name'] && hasWeeklyZugRole($pdo, $alliance, $schaffner, $entry['event_date'], $id)) {
        jsonOut(409, ['error' => "{$schaffner} ist diese Woche bereits als Schaffner oder VIP eingeplant."]);
    }
    if ($vip !== null && $vip !== $entry['vip_name'] && hasWeeklyZugRole($pdo, $alliance, $vip, $entry['event_date'], $id)) {
        jsonOut(409, ['error' => "{$vip} ist diese Woche bereits als Schaffner oder VIP eingeplant."]);
    }
    $pdo->prepare("UPDATE zug_schedule SET schaffner_name=?,vip_name=?,status=?,notes=? WHERE id=? AND alliance=?")
        ->execute([$schaffner,$vip,$status,$notes,$id,$alliance]);
    jsonOut(200, ['ok' => true]);
}

function handleNoShowZugSchedule(PDO $pdo, string $alliance, string $id, array $body): never {
    $stmt = $pdo->prepare("SELECT * FROM zug_schedule WHERE id=? AND alliance=?");
    $stmt->execute([$id, $alliance]);
    $entry = $stmt->fetch();
    if (!$entry) jsonOut(404, ['error' => 'Eintrag nicht gefunden']);
    $sub   = trim((string)($body['substitute_name'] ?? '')) ?: null;
    $notes = trim((string)($body['notes']           ?? '')) ?: null;
    if ($sub !== null && hasWeeklyZugRole($pdo, $alliance, $sub, $entry['event_date'], $id)) {
        jsonOut(409, ['error' => "{$sub} ist diese Woche bereits als Schaffner oder VIP eingeplant."]);
    }
    if ($sub !== null) {
        $pdo->prepare("
            UPDATE zug_schedule SET status='completed',is_substitute=1,
                original_schaffner_name=schaffner_name,schaffner_name=?,notes=COALESCE(?,notes)
            WHERE id=? AND alliance=?
        ")->execute([$sub,$notes,$id,$alliance]);
        resetZugQueueToFront($pdo, $alliance, $entry['ruleset_key'], $entry['schaffner_name']);
        advanceZugQueue($pdo, $alliance, $entry['ruleset_key'], $sub, $entry['event_date']);
    } else {
        $pdo->prepare("UPDATE zug_schedule SET status='noshow',notes=COALESCE(?,notes) WHERE id=? AND alliance=?")
            ->execute([$notes,$id,$alliance]);
        resetZugQueueToFront($pdo, $alliance, $entry['ruleset_key'], $entry['schaffner_name']);
    }
    jsonOut(200, ['ok' => true]);
}

function handleSwapZugSchedule(PDO $pdo, string $alliance, array $body): never {
    $date1   = trim((string)($body['date1']       ?? ''));
    $date2   = trim((string)($body['date2']       ?? ''));
    $ruleset = trim((string)($body['ruleset_key'] ?? 'standard'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date1) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date2)) {
        jsonOut(400, ['error' => 'Ungültige Datumsangaben']);
    }
    if ($date1 === $date2) jsonOut(400, ['error' => 'Quell- und Zieldatum sind identisch']);
    $stmt = $pdo->prepare('SELECT * FROM zug_schedule WHERE alliance=? AND event_date=? AND ruleset_key=?');
    $stmt->execute([$alliance, $date1, $ruleset]);
    $e1 = $stmt->fetch();
    $stmt->execute([$alliance, $date2, $ruleset]);
    $e2 = $stmt->fetch();
    if (!$e1 && !$e2) jsonOut(404, ['error' => 'Keine Einträge gefunden']);
    if ($e1 && $e1['status'] !== 'planned') jsonOut(409, ['error' => "Eintrag am {$date1} ist nicht mehr planbar (Status: {$e1['status']})"]);
    if ($e2 && $e2['status'] !== 'planned') jsonOut(409, ['error' => "Eintrag am {$date2} ist nicht mehr planbar (Status: {$e2['status']})"]);
    $pdo->beginTransaction();
    try {
        if ($e1 && $e2) {
            $pdo->prepare('UPDATE zug_schedule SET schaffner_name=?,vip_name=? WHERE id=? AND alliance=?')
                ->execute([$e2['schaffner_name'], $e2['vip_name'], $e1['id'], $alliance]);
            $pdo->prepare('UPDATE zug_schedule SET schaffner_name=?,vip_name=? WHERE id=? AND alliance=?')
                ->execute([$e1['schaffner_name'], $e1['vip_name'], $e2['id'], $alliance]);
            $pdo->commit();
            jsonOut(200, ['ok' => true, 'action' => 'swapped',
                'msg' => "{$e1['schaffner_name']} ({$date1}) ↔ {$e2['schaffner_name']} ({$date2}) getauscht"]);
        } else {
            $entry   = $e1 ?: $e2;
            $newDate = $e1 ? $date2 : $date1;
            $pdo->prepare('UPDATE zug_schedule SET event_date=? WHERE id=? AND alliance=?')
                ->execute([$newDate, $entry['id'], $alliance]);
            $pdo->commit();
            jsonOut(200, ['ok' => true, 'action' => 'moved',
                'msg' => "{$entry['schaffner_name']} verschoben nach {$newDate}"]);
        }
    } catch (\Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function handleDeleteZugSchedule(PDO $pdo, string $alliance, string $id): never {
    $stmt = $pdo->prepare("SELECT * FROM zug_schedule WHERE id=? AND alliance=?");
    $stmt->execute([$id, $alliance]);
    $entry = $stmt->fetch();
    if (!$entry) jsonOut(404, ['error' => 'Eintrag nicht gefunden']);
    $pdo->prepare("DELETE FROM zug_schedule WHERE id=? AND alliance=?")->execute([$id, $alliance]);
    if ($entry['status'] === 'planned' && !(int)$entry['is_substitute']) {
        resetZugQueueToFront($pdo, $alliance, $entry['ruleset_key'], $entry['schaffner_name']);
    }
    jsonOut(200, ['ok' => true]);
}

function handleGetZugMyTurns(PDO $pdo, string $alliance): never {
    $discordIdRaw = $_GET['discord_id'] ?? '';
    try { $discordId = normalizeDiscordId($discordIdRaw); }
    catch (\InvalidArgumentException $e) { jsonOut(400, ['error' => $e->getMessage()]); }
    if ($discordId === '') jsonOut(401, ['error' => 'Discord-ID fehlt']);
    $member = getDiscordMember($pdo, $alliance, $discordId);
    if (!$member) jsonOut(403, ['error' => 'Kein Zugriff']);
    $mName = (string)$member['current_name'];

    $stmtPast = $pdo->prepare("
        SELECT id,event_date,ruleset_key,schaffner_name,vip_name,status,is_substitute,original_schaffner_name
        FROM zug_schedule
        WHERE alliance=? AND (schaffner_name=? OR vip_name=?) AND status IN ('completed','noshow')
        ORDER BY event_date DESC LIMIT 10
    ");
    $stmtPast->execute([$alliance, $mName, $mName]);
    $past = $stmtPast->fetchAll();

    $stmtUp = $pdo->prepare("
        SELECT id,event_date,ruleset_key,schaffner_name,vip_name,status
        FROM zug_schedule
        WHERE alliance=? AND (schaffner_name=? OR vip_name=?) AND status='planned' AND event_date>=CURDATE()
        ORDER BY event_date ASC LIMIT 5
    ");
    $stmtUp->execute([$alliance, $mName, $mName]);
    $upcoming = $stmtUp->fetchAll();

    $stmtQ = $pdo->prepare("SELECT ruleset_key,queue_position,last_turn_date,turn_count FROM zug_queue WHERE alliance=? AND member_name=?");
    $stmtQ->execute([$alliance, $mName]);
    $queuePos = [];
    foreach ($stmtQ->fetchAll() as $r) {
        $queuePos[$r['ruleset_key']] = ['position' => (int)$r['queue_position'], 'last_turn_date' => $r['last_turn_date'], 'turn_count' => (int)$r['turn_count']];
    }
    jsonOut(200, ['ok' => true, 'member_name' => $mName, 'upcoming' => $upcoming, 'past' => $past, 'queue_positions' => $queuePos]);
}
