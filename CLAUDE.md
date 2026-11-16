# lwhub – Regeln für Claude

## Frontend: keine Inline-Handler

Ziel ist eine strenge CSP mit `script-src-attr 'none'` (siehe `.htaccess` und
`docs/konzept-frontend-umbau.html`). Seit dem 08.11.2026 gibt es in `index.html`,
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

Prüfen: `grep -oE "\son[a-z]+=[\"'\`]" index.html api/partials/*.php web-scanner-onnx/js/*.js | wc -l`
muss 0 ergeben.

## Frontend: Adressen und Router

Seit dem 10.11.2026 hat jede Seite eine eigene Adresse (`/me`, `/train/plan`, `/members` …),
siehe Block „ROUTER“ vor `showPage()` in `index.html`.

- Neue Seite → Pfad in `LW_ROUTES` (englisch, kurz) **und** in der `RewriteRule` in `/.htaccess`
  eintragen. R4-Seiten zusätzlich in `LW_R4_PAGES`.
- Schema immer `/<bereich>/<ansicht>`. Hat eine Seite mehrere Ansichten (Reiter innerhalb der Seite),
  bekommt jede einen Eintrag in `LW_SUBVIEWS`, `lwCurrentSub()` liefert die aktive, und die Umschalt-
  Funktion ruft am Ende `lwSubChanged(id)` auf. Keine Ansicht als eigene Top-Level-Adresse anlegen.
  Reine Anzeige-Vorlieben (z. B. Tabelle/Akkordeon im Berufeplaner) bekommen keinen Link.
- Seiten immer über `showPage(id)` wechseln, nicht `.page.active` von Hand setzen. Nur so stimmen
  Adresse, Zurück/Vor und `lwhub_last_page`.
- `index.html` hat `<base href="/">`. Relative Adressen (`img/…`, `locales/…`) gelten also immer ab der
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

## Frontend: CSS/JS unter assets/

Seit dem 16.11.2026 steht das CSS der Hauptseite in `assets/css/app.css` (nicht mehr im `<style>` von
`index.html`). Neue Styles dort eintragen.

Seit dem 16.11.2026 liegt der Kern des Scripts in `assets/js/core/` (normale Scripts, **keine** Module,
alles bleibt global): `actions.js` (Verteiler, `LW_ACTIONS`), `api.js` (Adresse, `fetchJson`, `api`,
`apiPost`), `auth.js` (Discord-Login), `points.js` (Formeln, Kategorien, `escHtml`, KW-Helfer),
`state.js` (globale Variablen wie `members`, `kw`, `entries`). Sie laden in dieser Reihenfolge vor dem
großen `<script>` in `index.html`.

- Code oben in diesen Dateien (außerhalb von Funktionen) darf nur Dinge aus derselben oder einer
  früher geladenen Datei aufrufen, nicht aus `index.html`: die ist beim Laden noch nicht da.
- Eine Variable nie zweimal mit `let`/`const` anlegen, auch nicht in verschiedenen Dateien
  (das bricht die ganze Seite mit einem SyntaxError).

Seiten, die schon eigene Dateien haben, liegen in `assets/js/pages/` (seit 16.11.2026: `train.js` = Zug,
`jobs.js` = Berufeplaner). Ladereihenfolge in `index.html`: Kern → großes `<script>` → `pages/*.js` →
`assets/js/start.js` (ruft `initApp()` auf) → `char-switcher.js`, `deploy-refresh.js`.

- Eine neue Seiten-Datei kommt **vor** `start.js`, sonst ist sie beim Start der App noch nicht da.
- Code im großen `<script>` darf beim Laden (außerhalb von Funktionen) nichts aus `pages/` aufrufen.

- Dateien unter `assets/css/` und `assets/js/` in `index.html` **immer** mit `?v=dev` einbinden:
  `<link rel="stylesheet" href="assets/css/x.css?v=dev">`, `<script src="assets/js/x.js?v=dev">`.
  Das Deploy ersetzt `dev` durch einen Hash der Datei, die `.htaccess` erlaubt dann ein Jahr Cache.
  Ohne `?v=dev` bleibt die Datei bei `no-cache` (geht, ist nur langsamer); bricht das Deploy ab,
  steht irgendwo noch ein `?v=dev` ohne passende Datei.
- Die Zeichenfolge `?v=dev` sonst nirgends in `index.html` schreiben (auch nicht in Kommentaren).
