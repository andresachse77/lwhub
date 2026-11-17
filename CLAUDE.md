# lwhub – Regeln für Claude

## Frontend: keine Inline-Handler

Ziel ist eine strenge CSP mit `script-src-attr 'none'` (siehe `.htaccess` und
`docs/konzept-frontend-umbau.html`). Seit dem 08.11.2026 gibt es in `index.php`, `views/`,
`api/partials/` und `web-scanner-onnx/` **keine** `on…=`-Attribute mehr. Das bleibt so:

- **Nie** `onclick=`, `onchange=`, `oninput=`, `ondrop=`, `onload=` … schreiben, auch nicht in
  Template-Strings oder PHP.
- Stattdessen den zentralen Verteiler in `assets/js/core/actions.js` nutzen (Block „AKTIONEN statt
  Inline-Handlern“, dort steht auch `LW_ACTIONS`):
  - Klick: `data-action="fn"` und optional `data-args='["a", 1]'`
  - andere Events: `data-on-change="fn"` und `data-args-change='[…]'`
    (ebenso `input`, `keydown`, `focus`, `mousedown`, `mouseover`, `mouseout`,
    `dragstart`, `dragover`, `dragleave`, `drop`, `dragend`)
  - Argumente im JS immer mit `lwArgs(…)` erzeugen: `data-args="${lwArgs(name, 'bad')}"`.
    Nie Namen in einen JS-String im Attribut setzen.
  - Element bzw. Event als Argument: `LW_EL` / `LW_EVENT` (im HTML `{"$":"el"}` / `{"$":"event"}`).
  - statt `event.stopPropagation()` → `data-stop="click"`, statt `event.preventDefault()` →
    `data-prevent="click"` (mehrere Events mit Leerzeichen).
- Die aufgerufene Funktion muss global sein (`function fn` oben im Script oder `window.fn = …`)
  **und in `LW_ACTIONS` stehen**. Sonst passiert nichts, nur eine Warnung in der Konsole.
- Im Scanner (`web-scanner-onnx/`) Listener direkt per `addEventListener` setzen, nachdem
  `innerHTML` geschrieben wurde.
- Selektoren nach `[data-action="fn"]` fragen, nicht nach `[onclick=…]`.

Prüfen: `grep -oE "\son[a-z]+=[\"'\`]" index.php views/*.php api/partials/*.php web-scanner-onnx/js/*.js | wc -l`
muss 0 ergeben.

## Frontend: Adressen und Router

Seit dem 10.11.2026 hat jede Seite eine eigene Adresse (`/me`, `/train/plan`, `/members` …),
siehe Block „ROUTER“ vor `showPage()` in `assets/js/core/router.js`.

- Neue Seite → Pfad in `LW_ROUTES` (englisch, kurz) **und** in der `RewriteRule` in `/.htaccess`
  eintragen. R4-Seiten zusätzlich in `LW_R4_PAGES`.
- Schema immer `/<bereich>/<ansicht>`. Hat eine Seite mehrere Ansichten (Reiter innerhalb der Seite),
  bekommt jede einen Eintrag in `LW_SUBVIEWS`, `lwCurrentSub()` liefert die aktive, und die Umschalt-
  Funktion ruft am Ende `lwSubChanged(id)` auf. Keine Ansicht als eigene Top-Level-Adresse anlegen.
  Reine Anzeige-Vorlieben (z. B. Tabelle/Akkordeon im Berufeplaner) bekommen keinen Link.
- Unteradressen (seit 17.11.2026): `/train/2026-11-12` markiert einen Tag (`zugRoFocusDate`),
  `/members/<name>` klappt ein Mitglied auf (`vOpenMemberFromLink`, Groß/Klein egal, alte Namen über
  `memberMeta.aliases`), `/me/<name>` zeigt R4/R5 Mein Bereich eines Mitglieds (Me-Ansicht, immer über
  `openMemberMeInApp()` → `showPage('m', { detail })`, nie `.page.active` von Hand), `?w=2646` (oder `?w=46`) setzt die KW auf Dashboard, Liste und Events (`LW_KW_PAGES`).
  Neuer teilbarer Teil einer Seite → `LW_DETAIL_PAGES`, `lwCurrentDetail()`, `lwApplyDetail()` erweitern und nach
  jeder Änderung `lwDetailChanged(id)` aufrufen. In der Adresszeile steht `?w=` nur bei einer anderen als der
  aktuellen Woche; „Link teilen“ hängt immer `?w=` und `?a=<Allianz>` an. `?a=` prüft `lwCheckLinkAlliance()`
  beim Start (Rückfrage, zum eigenen Charakter der Allianz zu wechseln) und nimmt es danach aus der Adresse.
- Seiten immer über `showPage(id)` wechseln, nicht `.page.active` von Hand setzen. Nur so stimmen
  Adresse, Zurück/Vor und `lwhub_last_page`.
- `index.php` hat `<base href="/">`. Relative Adressen (`img/…`, `locales/…`) gelten also immer ab der
  Hauptadresse. **Nie** `location.pathname` oder `location.href` als Basis für Dateien oder die API
  nehmen (unter `/train/plan` wäre das falsch), sondern `document.baseURI`, `LW_APP_BASE` oder
  `window.getApiBase()`.
- Keine `href="#…"`-Links: mit `<base>` springen sie auf die Hauptadresse.
- Keine „In eigenem Fenster öffnen“-Links und kein `target="_blank"` auf LWHub-Seiten oder Scanner,
  Trend und Event. Die laufen eingebettet, die Navigation macht der LWHub (`/scan`, `/stats/trend`,
  `/stats/events`). Neue Tabs nur für Dokumente unter `docs/`.
  Der eingebettete Scanner ist über `Document-Isolation-Policy` (web-scanner-onnx/.htaccess) genauso
  schnell wie allein. Im iframe kein Zugriff auf `parent`/`top`, nur über API oder `localStorage`.
- Hat eine eingebettete Seite einen teilbaren Stand (z. B. welches Event), meldet sie ihn mit
  `LwhubAccess.reportState(params)`. Der LWHub übernimmt nur die Schlüssel aus `LW_FRAME_PARAMS` als
  `?…` in seine Adresse und gibt sie beim Öffnen eines Links an den Rahmen weiter.


## Verwaltung: Liste + Mitglied (seit 17.11.2026)

Umsetzung von Variante B aus `docs/konzept-verwaltung-ux.html` (Block „VERWALTUNG“ oben in `pages/members.js`).

- Am PC Liste links, Mitglied rechts (`#v-layout`, `#v-list`, `#v-detail`); unter 900 px ist das Mitglied eine
  eigene Seite (`.has-sel`, `#page-v.v-member-open`), „←“ (`vBackToList`) bzw. die Zurück-Geste führt zurück.
- **Alles speichert sofort**, es gibt keinen Bearbeiten-Modus und keinen Speichern-Knopf: Änderungen über
  `vRun(kasten, text, doFn, undoFn)`. Das zeigt „✓ gespeichert“ im Kasten und unten `lwToastUndo` (core/ui.js) mit
  „Rückgängig“. Neue Felder genauso anbinden, mit einer echten Gegenänderung als `undoFn`.
- Profil (Name, Rang, Rolle, Heimat-Allianz, Discord-ID) immer über `vSaveProfile(name, änderungen)`: Der Server
  (`PUT /members/{name}`) will den ganzen Stand, die Discord-ID nur, wenn sie mitgeschickt wird.
- Nachfragen nur bei Umbenennen, Entfernen und dem Sprung auf R4/R5.
- „Alle Flags weg“ = erfasst mit 0 Punkten (wie in der Eintragen-Liste); löschen nur mit „Wocheneintrag löschen“.
- Tippflächen mindestens 48 px, Felder 16 px Schrift (CSS-Block „Verwaltung: Liste + Mitglied“ in app.css).
- Hinweise unten: versteckt immer `visibility: hidden; pointer-events: none`, sonst blockieren sie Knöpfe.
## Dokumentseiten (docs/)

Jede Seite unter `docs/` (Konzepte, Aufgabenlisten, Handbuch) bekommt oben rechts **🔗 Teilen** und
**← Zur App**: den Link `<a class="back-to-app" href="../">` mit `backToApp()`-Listener (kein `onclick=`)
und am Ende `<script src="doc-share.js"></script>` (im Handbuch `../doc-share.js`). Ohne diese Knöpfe
kommt man im Vollbild (iPad) nicht zurück und kann nichts teilen.

## Frontend: Einstiegsseite index.php und views/

Seit dem 16.11.2026 ist die Einstiegsseite `index.php` (nicht mehr `index.html`; `/index.html` leitet auf `/`
um). Sie enthält nur den Rahmen: `<head>`, die Plätze `#r4-pages-container`/`#admin-pages-container` und die
Script-Tags. Das HTML für alle steht in `views/*.php` und wird per `include` eingesetzt (`login`, `nav`, `me`,
`teams`, `points`, `loader`, `train`, `modals`). `views/head-meta.php` setzt `og:title` je Adresse für die
Vorschau in Discord.

- Neue Seite für alle → `views/<name>.php` anlegen und in `index.php` einbinden, Titel in `head-meta.php`.
- `views/` ist nicht direkt aufrufbar (`views/.htaccess`, lokal `scripte/router.php`).
- In `views/` nur HTML, keine Datenbank-Abfragen: die Seite muss auch ohne Anmeldung gleich aussehen.
- Das Deploy lädt `index.php`, die Root-`.htaccess` und `deploy-version.json` **zuletzt** hoch (Durchgang 2),
  damit nie eine neue Seite auf Dateien zeigt, die noch nicht oben sind.
- `exclude` der FTP-Aktion gilt mit `matchBase`: ein Muster **ohne** `/` (z. B. `index.html`, `.htaccess`)
  trifft diesen Namen in **jedem** Ordner. Dateien, die später kommen sollen, nicht per `exclude` ausnehmen,
  sondern wie im Schritt „Hold back entry files“ vorher aus dem Upload-Ordner legen.
- `DirectoryIndex` in der Root-`.htaccess` gilt für alle Unterordner (`docs/handbuch/`, `iny/`, Scanner
  haben `index.html`), deshalb `index.php index.html`.

## Sicherheit: CSP und Schriften

- Die App-Seiten (`index.php`) senden eine **blockierende** Content-Security-Policy: nur eigene Scripts,
  kein Inline-Script, keine `on…=`-Attribute, kein `style="…"` (`style-src 'self'`). Externe Ziele sind nur Discord (`discord.com`,
  `cdn.discordapp.com`) und `unavatar.io`. Neue externe Quelle (Bild, API, Script) → im `header(...)`
  oben in `index.php` eintragen, sonst blockiert der Browser sie.
- Scanner, `docs/` und `iny/` haben nur die beobachtende CSP aus der Root-`.htaccess`
  (`Content-Security-Policy-Report-Only`). Lokal spiegelt `scripte/router.php` diese Header.
- Keine Google Fonts und keine anderen Fremd-Server für Schriften: Rajdhani und Inter liegen in
  `assets/fonts/`, eingebunden über `assets/css/fonts.css` (latin, latin-ext, kyrillisch).
- HSTS steht seit 16.11.2026 auf 1 Woche (`max-age=604800`), nächster Schritt 1 Jahr.
- **Kein `style="…"`** (seit 17.11.2026), weder in `index.php`/`views/`/`api/partials/` noch in JS-Vorlagen für
  `innerHTML`, auch nicht in SVG-Strings. Feste Styles → Klasse in `assets/css/app.css` (Präfix der Seite, z. B.
  `zug-…`, `v-…`, `dash-…`). Werte aus einer kleinen festen Menge (Rang, Status) → Modifier-Klassen
  (`wt-rank-r4`, `zug-status-planned`). Nur wirklich berechnete Werte (Breite in %, Höhe in px) als
  `data-css="width:${pct}%"` (Text-Werte mit `escHtml`); `lwApplyDataCss()` in `core/ui.js` setzt sie per CSSOM.
  In PHP kein `data-css`. `el.style.x = …` im JS ist erlaubt. Aufpassen: Startet ein Element per Klasse
  versteckt, muss das Einblenden einen Wert setzen (`el.style.display = 'block'`), `''` ließe es versteckt.
  Prüfen: `grep -nE "style=[\"'\\]" index.php views/*.php api/partials/*.php assets/js/*/*.js assets/js/start.js char-switcher.js`
  darf nur Kommentare finden.

## Frontend: CSS/JS unter assets/

Seit dem 16.11.2026 steht das CSS der Hauptseite in `assets/css/app.css` (nicht mehr im `<style>` von
`index.html`). Neue Styles dort eintragen.

Seit dem 16.11.2026 steht **kein JavaScript mehr in `index.php`** (und `views/`) (kein Inline-`<script>`, auch nicht für
Kleinigkeiten: die CSP soll später `script-src 'self'` ohne `unsafe-inline` werden). Alles liegt in normalen
Scripts, **keine** Module, alles bleibt global. Die Reihenfolge der `<script>`-Tags in `index.php` ist die
Ladereihenfolge:

1. `i18n.js`, `deploy-refresh.js` (liest `?showversion`, bevor der Router die Adresse neu schreibt)
2. Kern `assets/js/core/`: `actions.js` (Verteiler, `LW_ACTIONS`), `api.js` (`fetchJson`, `api`, `apiPost`),
   `auth.js` (Discord-Login), `points.js` (Formeln, Kategorien, `escHtml`, KW-Helfer), `state.js` (globale
   Variablen wie `members`, `kw`, `entries`), `features.js` (Feature-Schalter, `flagConfig`), `ui.js`
   (`toast`, `tr`, Ladeanimation), `data.js` (Daten laden/speichern, Bearbeiten-Dialog, KW-Wechsel)
3. `pages/me.js` (Mein Bereich), dann `core/router.js` (Navigation, R4-/Admin-Reiter, `LW_ROUTES`,
   `showPage`, `renderAll`, Ansichten der Auswertungen)
4. Seiten für alle `assets/js/pages/`: `teams.js`, `train.js` (Zug, enthält auch den R4-Planer)
5. `assets/js/start.js` (Sync, Presence, `initApp()` und der Startaufruf), danach `char-switcher.js`
6. **Erst für R4/R5** (seit 17.11.2026, `lwLoadR4Scripts()` in `router.js`, aufgerufen von `injectR4Tabs()`):
   `entries.js` (Eintragen-Liste `/list`), `dashboard.js` (Dashboard, Ranking-Tabelle), `members.js`
   (Verwaltung), `stats.js` (SE-Inaktiv, Ergebnis), `events.js` (Wache/Wüste/Spezial/VS/Spenden), `admin.js`,
   `jobs.js` (Berufeplaner). Sie stehen in `index.php` im `<template id="lw-r4-scripts">`; dort lädt der
   Browser nichts, R1–R3 bekommen sie nie. Ihr Code läuft erst nach `start.js` und nach `DOMContentLoaded`
   (also kein `DOMContentLoaded`-Listener darin).

- Code oben in einer Datei (außerhalb von Funktionen) darf nur Dinge aus derselben oder einer **früher**
  geladenen Datei benutzen. Innerhalb von Funktionen ist alles erlaubt, die laufen erst nach dem Start.
- Eine Variable nie zweimal mit `let`/`const` anlegen, auch nicht in verschiedenen Dateien
  (das bricht die ganze Seite mit einem SyntaxError).
- Neue Seite → eigene Datei in `pages/`. Für alle: Tag **vor** `start.js`. Nur R4/R5: ins `<template id="lw-r4-scripts">`.
- Was gemeinsamer Code (Kern, `me.js`, `teams.js`, `train.js`, `start.js`) aufruft, gehört **nicht** in eine R4-Datei,
  sonst fehlt es bei R1–R3 (z. B. `trf`, `openModal`/`closeModal` in `ui.js`, `adminApi` in `api.js`,
  Reiter-Sichtbarkeit in `features.js`). Aufrufe von R4-Funktionen aus dem Kern nur auf R4-Seiten oder mit
  `typeof fn === 'function'` bzw. `window.fn?.()`.

HTML, das nur R4/R5 oder nur R5 sehen dürfen, steht **nicht** in `index.php`/`views/`, sondern kommt vom Server
(`/tab-html`, `api/src/members.php`): `api/partials/r4-pages.php` (R4-Seiten und Berufeplaner-Dialoge,
eingefügt in `#r4-pages-container`) und `api/partials/admin-pages.php` (Admin-Seite und Admin-Dialoge, nur
R5, in `#admin-pages-container`). Neue Dialoge einer R4-/Admin-Seite gehören in das passende Partial.

- Dateien unter `assets/css/` und `assets/js/` in `index.php` **immer** mit `?v=dev` einbinden:
  `<link rel="stylesheet" href="assets/css/x.css?v=dev">`, `<script src="assets/js/x.js?v=dev">`.
  Das Deploy ersetzt `dev` durch einen Hash der Datei, die `.htaccess` erlaubt dann ein Jahr Cache.
  Ohne `?v=dev` bleibt die Datei bei `no-cache` (geht, ist nur langsamer); bricht das Deploy ab,
  steht irgendwo noch ein `?v=dev` ohne passende Datei.
- Die Zeichenfolge `?v=dev` sonst nirgends in `index.php` schreiben (auch nicht in Kommentaren).
