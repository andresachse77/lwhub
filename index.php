<?php
// LWHub – Einstiegsseite. Hier steht nur der Rahmen: <head>, Plätze für die Rollen-Seiten und die Scripts.
// Seiten-HTML: views/*.php (für alle), api/partials/*.php (R4/R5, kommt per /tab-html).
// JS: assets/js/ (Reihenfolge der <script>-Tags unten = Ladereihenfolge), CSS: assets/css/app.css.
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache');
// Content-Security-Policy, SCHARF (blockiert) nur fuer die App-Seiten: nur eigene Scripts, keine Inline-Scripts,
// keine on…=-Attribute. Externe Ziele: Discord (Anmeldung, Avatare), unavatar.io. Schriften liegen in assets/fonts/.
// Scanner, docs/ und iny/ haben eigene Bedürfnisse und bleiben bei der Beobachtungs-Regel aus /.htaccess.
// Neue externe Quelle (Bild, API, Script)? Hier eintragen, sonst blockiert der Browser sie.
header("Content-Security-Policy: default-src 'self'; script-src 'self'; script-src-attr 'none'; "
    . "style-src 'self' 'unsafe-inline'; font-src 'self'; "
    . "img-src 'self' data: blob: https://cdn.discordapp.com https://unavatar.io; "
    . "connect-src 'self' https://discord.com https://unavatar.io; frame-src 'self'; frame-ancestors 'self'; "
    . "base-uri 'self'; form-action 'self'; object-src 'none'");
// Uebergang: dieselbe Regel OHNE 'unsafe-inline' bei style-src, nur beobachtend. Jedes noch vorhandene
// style="…" erscheint als Meldung in der Browser-Konsole. Sind alle weg, oben 'unsafe-inline' streichen
// und diese Zeile loeschen.
header("Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; script-src-attr 'none'; "
    . "style-src 'self'; font-src 'self'; "
    . "img-src 'self' data: blob: https://cdn.discordapp.com https://unavatar.io; "
    . "connect-src 'self' https://discord.com https://unavatar.io; frame-src 'self'; frame-ancestors 'self'; "
    . "base-uri 'self'; form-action 'self'; object-src 'none'", false);
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- Alle relativen Adressen (img/, api, locales/ …) gelten ab der Hauptadresse, auch unter /train/plan -->
<base href="/">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<title>Alli App</title>
<?php include __DIR__ . '/views/head-meta.php'; ?>
<meta name="lwhub-build" content="dev">
<!-- Schriften selbst gehostet (assets/fonts/), keine Verbindung zu Google -->
<link rel="preload" href="assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/rajdhani-700-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/css/fonts.css?v=dev">
<!-- "dev" in der Version ersetzt das Deploy durch einen Hash der Datei (.github/workflows/deploy-hetzner.yml) -->
<link rel="stylesheet" href="assets/css/app.css?v=dev">
</head>
<body>

<?php include __DIR__ . '/views/login.php'; ?>
<?php include __DIR__ . '/views/nav.php'; ?>

<?php include __DIR__ . '/views/me.php'; ?>
<?php include __DIR__ . '/views/teams.php'; ?>
<?php include __DIR__ . '/views/points.php'; ?>
<?php include __DIR__ . '/views/loader.php'; ?>
<?php include __DIR__ . '/views/train.php'; ?>

<!-- ═══ R4 TABS (serverseitig injiziert) ═══ -->
<div id="r4-pages-container"></div>

<!-- ═══ ADMIN (serverseitig injiziert, nur R5: api/partials/admin-pages.php) ═══ -->
<div id="admin-pages-container"></div>

<?php include __DIR__ . '/views/modals.php'; ?>

<script src="i18n.js"></script>
<!-- vor dem App-Code: liest ?showversion, bevor der Router die Adresse neu schreibt -->
<script src="deploy-refresh.js"></script>
<script src="assets/js/core/actions.js?v=dev"></script>
<script src="assets/js/core/api.js?v=dev"></script>
<script src="assets/js/core/auth.js?v=dev"></script>
<script src="assets/js/core/points.js?v=dev"></script>
<script src="assets/js/core/state.js?v=dev"></script>
<script src="assets/js/core/features.js?v=dev"></script>
<script src="assets/js/core/ui.js?v=dev"></script>
<script src="assets/js/core/data.js?v=dev"></script>
<script src="assets/js/pages/me.js?v=dev"></script>
<script src="assets/js/core/router.js?v=dev"></script>
<script src="assets/js/pages/teams.js?v=dev"></script>
<script src="assets/js/pages/train.js?v=dev"></script>
<script src="assets/js/start.js?v=dev"></script>
<script src="char-switcher.js"></script>
<!-- Seiten nur fuer R4/R5: werden erst geladen, wenn die R4-Reiter kommen (lwLoadR4Scripts in core/router.js).
     Im <template> laedt der Browser nichts; R1–R3 sparen so rund 210 KB. Reihenfolge = Ausfuehrungsreihenfolge. -->
<template id="lw-r4-scripts">
<script src="assets/js/pages/entries.js?v=dev"></script>
<script src="assets/js/pages/dashboard.js?v=dev"></script>
<script src="assets/js/pages/members.js?v=dev"></script>
<script src="assets/js/pages/stats.js?v=dev"></script>
<script src="assets/js/pages/events.js?v=dev"></script>
<script src="assets/js/pages/admin.js?v=dev"></script>
<script src="assets/js/pages/jobs.js?v=dev"></script>
</template>
</body>
</html>


