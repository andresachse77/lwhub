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
