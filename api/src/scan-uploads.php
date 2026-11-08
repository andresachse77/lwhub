<?php
declare(strict_types=1);

// Wer hat wann gescannt? Ein Eintrag je erfolgreichem Upload aus dem Scanner (POST /scans/sync).
// player_metrics haelt nur die Werte, nicht den Scannenden – dafuer gibt es diese Tabelle.

function ensureScanUploadsTable(PDO $pdo): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS scan_uploads (
            upload_id BIGINT NOT NULL AUTO_INCREMENT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            alliance VARCHAR(50) NOT NULL,
            discord_user_id VARCHAR(50) NULL,
            scanner_name VARCHAR(150) NULL,
            token_id CHAR(36) NULL,
            source VARCHAR(50) NULL,
            scan_id CHAR(36) NULL,
            entries INT NOT NULL DEFAULT 0,
            updated INT NOT NULL DEFAULT 0,
            created INT NOT NULL DEFAULT 0,
            PRIMARY KEY (upload_id),
            KEY ix_scan_uploads_alliance (alliance, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/** Protokolliert einen Upload. Darf den Upload nie scheitern lassen. */
function logScanUpload(PDO $pdo, string $alliance, array $caller, ?string $claimedId, string $source, ?string $scanId, array $summary): void {
    try {
        ensureScanUploadsTable($pdo);
        $discordId = $caller['discord_id'] ?? null;
        if ($discordId === null && $claimedId !== null && $claimedId !== '') $discordId = $claimedId; // lokal / Modus off
        $pdo->prepare("
            INSERT INTO scan_uploads (alliance, discord_user_id, scanner_name, token_id, source, scan_id, entries, updated, created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ")->execute([
            $alliance,
            $discordId,
            isset($caller['name']) ? mb_substr((string)$caller['name'], 0, 150) : null,
            $caller['token_id'] ?? null,
            mb_substr($source, 0, 50),
            $scanId,
            (int)($summary['total'] ?? 0),
            (int)($summary['updated'] ?? 0),
            (int)($summary['created'] ?? 0),
        ]);
    } catch (\Throwable $e) {
        error_log("logScanUpload {$alliance}: " . $e->getMessage());
    }
}

/** GET /scans/uploads?alliance=X&limit=10 – letzte Uploads der Allianz (R4/R5, Ehren-R4, Site-Admins lesend). */
function handleListScanUploads(PDO $pdo, string $alliance): never {
    requireScannerAccess($pdo, $alliance, null, true);
    ensureScanUploadsTable($pdo);
    $limit = max(1, min(50, (int)($_GET['limit'] ?? 10)));
    $stmt = $pdo->prepare("
        SELECT u.created_at, u.source, u.entries, u.updated, u.created,
               COALESCE(u.scanner_name, d.discord_username, t.client_name) AS scanner
        FROM scan_uploads u
        LEFT JOIN discord_profile_cache d ON d.discord_user_id = u.discord_user_id
        LEFT JOIN api_tokens t ON t.token_id = u.token_id
        WHERE u.alliance = ?
        ORDER BY u.created_at DESC, u.upload_id DESC
        LIMIT {$limit}
    ");
    $stmt->execute([$alliance]);
    jsonOut(200, ['ok' => true, 'uploads' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}
