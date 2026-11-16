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
4. Seiten `assets/js/pages/`: `teams.js`, `entries.js` (Eintragen-Liste `/list`), `dashboard.js`
   (Dashboard, Ranking-Tabelle), `members.js` (Verwaltung), `stats.js` (SE-Inaktiv, Ergebnis), `events.js`
   (Wache/Wüste/Spezial/VS/Spenden), `admin.js`, `train.js` (Zug), `jobs.js` (Berufeplaner)
5. `assets/js/start.js` (Sync, Presence, `initApp()` und der Startaufruf), danach `char-switcher.js`

- Code oben in einer Datei (außerhalb von Funktionen) darf nur Dinge aus derselben oder einer **früher**
  geladenen Datei benutzen. Innerhalb von Funktionen ist alles erlaubt, die laufen erst nach dem Start.
- Eine Variable nie zweimal mit `let`/`const` anlegen, auch nicht in verschiedenen Dateien
  (das bricht die ganze Seite mit einem SyntaxError).
- Neue Seite → eigene Datei in `pages/`, Tag **vor** `start.js` eintragen.

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
