<?php
declare(strict_types=1);

function jsonOut(int $status, mixed $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function uuid4(): string {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function safeRank(mixed $value): int {
    $n = (int)$value;
    if ($n < 1 || $n > 5) return 3;
    return $n;
}

function normalizeDiscordId(mixed $value): string {
    $id = trim((string)($value ?? ''));
    if ($id === '') return '';
    if (isLocalRequest() && $id === 'local-preview') return 'local-preview';
    if (!preg_match('/^\d+$/', $id)) throw new InvalidArgumentException('Discord-ID muss numerisch sein');
    return $id;
}

function normalizeMemberName(mixed $value): string {
    return strtolower(trim((string)($value ?? '')));
}

function parseProtectedR4Names(string $value): array {
    $names = [];
    foreach (explode(',', $value) as $v) {
        $n = normalizeMemberName($v);
        if ($n !== '') $names[$n] = true;
    }
    return $names;
}

function isProtectedR4Member(string $name, array $protectedNames): bool {
    return isset($protectedNames[normalizeMemberName($name)]);
}

function applyProtectedRankRule(string $name, int $requestedRank, array $protectedNames): array {
    if (!isProtectedR4Member($name, $protectedNames)) {
        return ['effectiveRank' => $requestedRank, 'protectedMember' => false, 'blocked' => false];
    }
    return ['effectiveRank' => 4, 'protectedMember' => true, 'blocked' => $requestedRank !== 4];
}

function roleFromRank(int $rank): string {
    if ($rank === 5) return 'r5';
    if ($rank === 4) return 'r4';
    return 'normal';
}

function normalizeHonorRole(mixed $value, bool $strict = false): ?string {
    $role = strtolower(trim((string)($value ?? '')));
    if ($role === '' || $role === 'none' || $role === 'normal') return null;
    if ($role === 'honor_r4' || $role === 'ehren_r4') return 'honor_r4';
    if ($role === 'honor_member' || $role === 'ehrenmitglied') return 'honor_member';
    if ($strict) {
        throw new InvalidArgumentException('Ungueltige Ehrenrolle. Erlaubt: honor_r4, honor_member oder leer');
    }
    return null;
}

function effectiveRankForAccess(int $rank, ?string $honorRole): int {
    if ($honorRole === 'honor_r4') return 4;
    if ($honorRole === 'honor_member') return min($rank, 3);
    return $rank;
}

function roleFromMemberState(int $rank, ?string $honorRole): string {
    if ($honorRole === 'honor_r4') return 'honor_r4';
    if ($honorRole === 'honor_member') return 'honor_member';
    return roleFromRank($rank);
}

function memberCanWrite(?string $honorRole): bool {
    return $honorRole === null;
}

/**
 * SQL-Bedingung "Spieler ohne Ehrenrolle". Ehrenrollen sind im Spiel nicht in der Allianz und zaehlen
 * deshalb in keiner Auswertung mit (Mitgliederzahl, Wochen, VS, Kampfkraft, Zug, Inaktiv-Listen ...).
 */
function sqlNoHonor(string $alias = 'p'): string {
    $col = $alias !== '' ? "{$alias}.honor_role" : 'honor_role';
    return "({$col} IS NULL OR {$col} NOT IN ('honor_r4', 'honor_member'))";
}

/** Heimat-Allianz eines Ehren-Eintrags: Freitext (max. 50 Zeichen) oder Kuerzel einer angelegten Allianz. */
function normalizeHonorHome(mixed $value): ?string {
    $home = trim((string)($value ?? ''));
    if ($home === '') return null;
    return preg_replace('/^(.{50}).+$/us', '$1', $home) ?? $home; // hoechstens 50 Zeichen (UTF-8)
}

function normalizePreferredLanguage(mixed $value): string {
    $lang = strtolower(trim((string)($value ?? '')));
    if ($lang === '') return 'de';
    if (!in_array($lang, ['de', 'en', 'it'], true)) {
        throw new InvalidArgumentException('Ungueltige Sprache. Erlaubt: de, en, it');
    }
    return $lang;
}

/** True when the PHP dev-server is serving a local request (127.0.0.1). */
function isLocalRequest(): bool {
    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    return $remote === '127.0.0.1' || $remote === '::1';
}

function isOptionalTableError(\PDOException $e): bool {
    $code = $e->getCode();
    $msg  = $e->getMessage();
    // ER_NO_SUCH_TABLE=1146, ER_TABLEACCESS_DENIED_ERROR=1142, ER_BAD_FIELD_ERROR=1054
    return in_array($code, ['42S02', '42000', '42S22'], true)
        || str_contains($msg, "doesn't exist")
        || str_contains($msg, 'Table') && str_contains($msg, 'exist');
}

function isBadFieldError(\PDOException $e): bool {
    return $e->getCode() === '42S22'
        || str_contains($e->getMessage(), "Unknown column");
}

function openDb(string $host, int $port, string $db, string $user, string $pass, string $sslCa = ''): PDO {
    $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    if ($sslCa !== '' && defined('PDO::MYSQL_ATTR_SSL_CA')) {
        $options[PDO::MYSQL_ATTR_SSL_CA] = $sslCa;
        if (defined('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')) {
            $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = true;
        }
    }
    return new PDO($dsn, $user, $pass, $options);
}


// ── Berufe-Rangcheck (S1) ──────────────────────────────────────────────────────
// Gleiche Regel wie im Browser (index.html: bpExpectedBeruf / bpBerufStatus). Aenderungen bitte an beiden Stellen.

/** Rangcheck-Einstellung der Allianz: null = aus, sonst Beruf, den R2 bedeutet ('ingenieur' | 'kriegsherr').
 *  Liest nur (kein CREATE TABLE), darf also auch in einer laufenden Transaktion aufgerufen werden. */
function berufRankCheckR2(PDO $pdo, string $alliance): ?string {
    try {
        $stmt = $pdo->prepare("SELECT config_key, config_value FROM alliance_config WHERE alliance = ? AND config_key IN ('berufe_rangcheck', 'berufe_rangcheck_r2')");
        $stmt->execute([$alliance]);
        $cfg = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    } catch (\PDOException $e) {
        return null; // Tabelle fehlt: Rangcheck kann nicht an sein
    }
    if (($cfg['berufe_rangcheck'] ?? 'false') !== 'true') return null;
    return ($cfg['berufe_rangcheck_r2'] ?? 'ingenieur') === 'kriegsherr' ? 'kriegsherr' : 'ingenieur';
}

/** Erwarteter Beruf aus dem Rang; null = nicht pruefbar (R1/R4/R5). */
function berufExpectedForRank(int $rank, string $r2): ?string {
    if ($rank === 2) return $r2;
    if ($rank === 3) return $r2 === 'ingenieur' ? 'kriegsherr' : 'ingenieur';
    return null;
}

/** Aktive Mitglieder (ohne Ehrenmitglieder), deren Beruf nicht zum Rang passt, mit dem Rang, der jetzt gilt.
 *  beruf = wie im Planer eingeteilt; null = Warteschlange ("noch nicht eingeteilt", G4).
 *  $ranksBefore: player_id => Rang vor dem Scan, fuer rank_changed / old_rank. */
function berufMismatches(PDO $pdo, string $alliance, string $r2, array $ranksBefore = []): array {
    try {
        $stmt = $pdo->prepare("SELECT player_id, current_name, current_rank_code, beruf, beruf_winwin_id FROM players WHERE alliance = ? AND is_active = 1 AND " . sqlNoHonor('') . " ORDER BY current_name");
        $stmt->execute([$alliance]);
        $rows = $stmt->fetchAll();
    } catch (\PDOException $e) {
        return []; // Berufe-Spalten fehlen noch: nichts zu pruefen
    }
    $warlords = [];
    foreach ($rows as $r) if (($r['beruf'] ?? null) === 'kriegsherr') $warlords[$r['player_id']] = true;

    $out = [];
    foreach ($rows as $r) {
        $rank = (int)$r['current_rank_code'];
        $expected = berufExpectedForRank($rank, $r2);
        if ($expected === null) continue;
        // Wie im Planer: Ingenieur nur mit gueltigem Kriegsherrn, sonst steht er in der Warteschlange
        $placed = ($r['beruf'] ?? null) === 'kriegsherr' ? 'kriegsherr'
            : ((($r['beruf'] ?? null) === 'ingenieur' && isset($warlords[$r['beruf_winwin_id'] ?? ''])) ? 'ingenieur' : null);
        if ($placed === $expected) continue;
        $old = array_key_exists($r['player_id'], $ranksBefore) ? (int)$ranksBefore[$r['player_id']] : $rank;
        $out[] = [
            'name'         => $r['current_name'],
            'player_id'    => $r['player_id'],
            'rank'         => $rank,
            'beruf'        => $placed,
            'expected'     => $expected,
            'rank_changed' => $old !== $rank,
            'old_rank'     => $old !== $rank ? $old : null,
        ];
    }
    // Frisch geaenderte Raenge zuerst (meist Berufswechsel, Planer noch alt), dann falsch Eingeteilte, dann Warteschlange
    usort($out, static fn($a, $b) => [$b['rank_changed'], $a['beruf'] === null, mb_strtolower($a['name'])] <=> [$a['rank_changed'], $b['beruf'] === null, mb_strtolower($b['name'])]);
    return $out;
}
