# lwhub – Regeln für Claude

## Frontend: keine Inline-Handler

Ziel ist eine strenge CSP mit `script-src-attr 'none'` (siehe `.htaccess` und
`docs/konzept-frontend-umbau.html`). Seit dem 08.11.2026 gibt es in `index.html`,
`api/partials/` und `web-scanner-onnx/` **keine** `on…=`-Attribute mehr. Das bleibt so:

- **Nie** `onclick=`, `onchange=`, `oninput=`, `ondrop=`, `onload=` … schreiben, auch nicht in
  Template-Strings oder PHP.
- Stattdessen den zentralen Verteiler in `index.html` nutzen (Block „AKTIONEN statt
  Inline-Handlern“ am Anfang des Haupt-Scripts):
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
