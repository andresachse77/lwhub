<?php
// Vorschau in Discord & Co.: og:title je Adresse (/train/plan → "LWHub · Zug-Planer").
// Pfade wie LW_ROUTES in assets/js/core/router.js und die RewriteRule in /.htaccess.
$lwPath = trim((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
$lwTitles = [
    'me' => 'Mein Bereich', 'teams' => 'Meine Teams', 'points' => 'Punkte-Guide',
    'train' => 'Zug', 'train/plan' => 'Zug-Planer', 'events' => 'Events', 'jobs' => 'Berufeplaner',
    'stats' => 'Auswertungen', 'list' => 'Eintragen', 'members' => 'Verwaltung', 'scan' => 'Scanner',
    'admin' => 'Admin',
];
$lwParts = explode('/', strtolower($lwPath));
$lwPage = $lwTitles[implode('/', array_slice($lwParts, 0, 2))] ?? $lwTitles[$lwParts[0]] ?? null;
// Zug an einem bestimmten Tag (/train/2026-11-12): Datum im Titel
if (preg_match('#^train/(\d{4})-(\d{2})-(\d{2})$#', strtolower($lwPath), $lwDay)) {
    $lwPage = 'Zug · ' . $lwDay[3] . '.' . $lwDay[2] . '.' . $lwDay[1];
}
$lwOgTitle = $lwPage ? 'LWHub · ' . $lwPage : 'LWHub';
$lwHost = preg_match('/^[a-z0-9.-]+(:\d+)?$/i', $_SERVER['HTTP_HOST'] ?? '') ? $_SERVER['HTTP_HOST'] : 'lwhub.de';
$lwScheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$h = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
?>
<meta property="og:site_name" content="LWHub">
<meta property="og:type" content="website">
<meta property="og:title" content="<?= $h($lwOgTitle) ?>">
<meta property="og:description" content="Allianz-Werkzeug für Last War: Punkte, Events, Zug und Berufe.">
<meta property="og:url" content="<?= $h($lwScheme . '://' . $lwHost . ($lwPath === '' ? '/' : '/' . $lwPath)) ?>">
<meta property="og:image" content="<?= $h($lwScheme . '://' . $lwHost . '/img/og-image.png') ?>">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:image:alt" content="LWHub">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#f0a500">
