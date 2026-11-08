# lwhub – Regeln für Claude

## Frontend: keine neuen Inline-Handler

Ziel ist eine strenge CSP mit `script-src-attr 'none'` (siehe `.htaccess` und
`docs/konzept-frontend-umbau.html`). Deshalb gilt für jeden neuen oder geänderten Code
in `index.html` und `api/partials/`:

- **Keine neuen `on…=`-Attribute** (`onclick`, `onchange`, `oninput`, `ondrop`, `onload` …),
  auch nicht in Template-Strings.
- Neue Knöpfe bekommen `data-action="name"`, Parameter kommen als `data-*`-Attribute
  mit `escHtml()` (z. B. `data-name="${escHtml(name)}"`), nie als JS-String im Attribut.
- Die Aktion läuft über einen Listener am Container der Seite:
  `e.target.closest('[data-action]')` und eine `actions`-Tabelle. Gibt es auf der Seite
  noch keinen, wird einer angelegt.
- Andere Events genauso über den Container: `change`/`input`/`keydown`, Drag-Events,
  `focusin`/`focusout` statt `focus`/`blur`. `load`/`error` direkt im JS setzen.
- Wer einen bestehenden Handler anfasst, baut ihn bei der Gelegenheit gleich um, wenn das
  ohne großen Umbau geht.
- Selektoren wie `querySelector('[onclick=…]')` nicht neu schreiben, auf `[data-action=…]`
  umstellen.

Fortschritt prüfen: `grep -oE "\son[a-z]+=[\"'\`]" index.html api/partials/*.php | wc -l`
(Stand 08.11.2026: 231). Die Zahl darf nur sinken.
