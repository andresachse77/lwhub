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
