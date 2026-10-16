# Scanner-Cockpit mit Browser-OCR (ONNX)

Gleiches Cockpit wie `web-scanner/cockpit.html`, aber die Texterkennung läuft komplett im Browser
(onnxruntime-web in einem Web Worker). Es gibt keinen Python-OCR-Server, und die Screenshots verlassen
den Rechner nicht. Die Seite lässt sich deshalb mit dem normalen FTP-Deploy auf lwhub.de betreiben:
`https://lwhub.de/web-scanner-onnx/`.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/ocr-engine.js` | Port von RapidOCR 1.4.4: PP-OCRv4-Detektion und -Erkennung, dieselben Modelle und Parameter wie `server.py` (ohne Winkel-Klassifikator) |
| `js/scanner-pipeline.js` | 1:1-Port der Gruppierung aus `web-scanner/server.py` (Karten, Rangliste, Leader-Banner, Shield-Rescue). Liefert dasselbe JSON wie `POST /process` |
| `js/ocr-worker.js` | Web Worker: lädt onnxruntime-web 1.30.0 von jsDelivr und die Modelle aus `models/` |
| `js/ocr-client.js` | `BrowserOcr.process(canvas)` als Ersatz für den alten Aufruf `fetch(OCR_SERVER + '/process')` |
| `models/` | `ch_PP-OCRv4_det_infer.onnx`, `ch_PP-OCRv4_rec_infer.onnx` (aus `rapidocr_onnxruntime`), `ppocr_keys_v1.txt` (Zeichenliste aus den Metadaten des Erkennungsmodells) |
| `.htaccess` | COOP/COEP-Header, damit WASM mehrere Threads nutzen kann |

Matching, Drag-and-Drop und CSS werden aus `../web-scanner/` mitgenutzt.

## Zugang (nur R4/R5)

- **Seite:** Der Scanner übernimmt den lwhub-Login aus dem `localStorage` (`discord_token`) und fragt
  `GET /api/scans/access?alliance=X` mit `Authorization: Bearer <discord_token>`. Ohne Zugang bleibt
  die Arbeitsfläche gesperrt, und es werden keine Mitglieder geladen.
- **Server:** `api/src/caller-auth.php` prüft das Token bei Discord (`/users/@me`, 15 Minuten Cache in
  `api_auth_cache`). Durchgelassen werden R4/R5 der Ziel-Allianz ohne Ehrenrolle sowie Site-Admins.
  `POST /scans/sync` prüft dasselbe für die Allianz im Body. Jede Ablehnung landet in `api_auth_log`.
- **Ausnahme:** Requests vom lokalen PHP-Server (127.0.0.1) sind wie in der übrigen API ausgenommen.
- **Notschalter:** `define('LWHUB_SCANNER_AUTH_MODE', 'log');` (nur protokollieren) oder `'off'` in
  `config.php`. Standard ist `'enforce'`.
- **Altes Python-Cockpit:** `web-scanner/cockpit.html` sendet kein Token und kann deshalb nur noch
  gegen den lokalen PHP-Server synchronisieren, nicht mehr gegen lwhub.de.

Wichtig: Wer die Heuristiken in `server.py` ändert, muss die Änderung auch in `js/scanner-pipeline.js` nachziehen.

## Lokal starten

`start.bat` startet `node tests/serve.js` und öffnet dann `http://127.0.0.1:8796/web-scanner-onnx/`.
Der PHP-Router (`scripte/router.php`) eignet sich dafür nicht, weil er keine Verzeichnis-Index-Seiten
und keine COOP/COEP-Header ausliefert. Die API wird lokal über `https://lwhub.de/api` erreicht;
ist sie nicht erreichbar, verwendet das Cockpit Mock-Mitglieder.

## Geschwindigkeit

Mehrere Bilder werden parallel verarbeitet, in einem Pool aus Web Workern mit je eigener
ONNX-Session. Mehr als 4 Threads pro Session bringen nichts: Auf einem i9 mit 32 Threads lag eine
Session mit 4 Threads bei 1,7 s/Frame, mit 16 bei 1,9 s und mit 32 bei 2,9 s. Deshalb gibt es im
Cockpit die Auswahl **CPU-Kerne** (Standard: alle logischen Prozessoren minus 1). Daraus ergibt
sich ein Worker mit 4 Threads je 4 Kerne, höchstens 8 Worker. Jeder Worker belegt etwa 600 MB RAM.

Der Browser kennt keine P- und E-Kerne; auf welchen Kernen die Threads laufen, entscheidet das
Betriebssystem.

**Backend:** Standard ist WebGPU, falls der Browser es anbietet. Startet WebGPU nicht, fällt das
Cockpit automatisch auf CPU zurück.

Durchsatz in Edge auf i9-14900K und RTX 4070 mit den 84 Captures (846×1394):

| Konfiguration | Durchsatz |
|---|---|
| WebGPU, 7 Worker (Standard bei 32 Threads) | 84 Frames in 14 s → 0,17 s/Frame |
| CPU, 7 × 4 Threads | 84 Frames in 40 s → 0,48 s/Frame |
| CPU, 1 × 4 Threads | ca. 1,7 s/Frame |
| CPU, 1 Thread (ohne COOP/COEP-Header, z. B. Safari) | ca. 2–4 s/Frame |

Was am meisten gebracht hat:

- **Shield-Rescue liest nur noch Schild-förmige Boxen** (Seitenverhältnis ≤ 2,5, gemessen 1,15–1,83).
  Dieser zweite, vergrößerte Durchlauf ist bei fast jedem Frame nötig; das halbiert seine Kosten.
  Die Ergebnisse bleiben gleich.
- **Scheduler:** Jeder freie Worker nimmt sofort das nächste Bild; die Ergebnisse werden trotzdem
  in Reihenfolge übernommen.
- **Dekodieren im Worker:** Das Dekodieren läuft per `createImageBitmap` außerhalb des Haupt-Threads,
  das Auslesen der Pixel im Worker.

Was nichts gebracht hat:

- **Größere Erkennungs-Batches:** kaum schneller, aber andere Ergebnisse, weil das Auffüllen der
  Zeilen sich ändert.
- **Zusätzliche CPU-Worker neben WebGPU:** langsamer, weil die CPU im GPU-Modus schon die Vor- und
  Nachbearbeitung erledigt.
- **Mehr als 4 Threads pro Worker.**

Jedes Ergebnis enthält `timings` (ms je Stufe) und `rescued` zur Analyse.

URL-Parameter für Messungen: `?workers=N` und `?threads=N` überschreiben die Aufteilung.

Beim ersten Aufruf werden etwa 15 MB Modelle und etwa 14 MB WASM-Laufzeit geladen; danach kommen
beide aus dem Browser-Cache.

## Tests (`tests/`)

Die Tests brauchen die lokalen Captures in `web-scanner/images/`. Dieser Ordner ist per gitignore
ausgeschlossen, auf einem frischen Clone laufen die Tests deshalb ins Leere.

```
cd web-scanner-onnx/tests
npm install
py -3.12 dump_reference.py         # Python-Referenz (server.py) nach reference/ schreiben
node parity.js                     # JS-Port unter onnxruntime-node gegen die Referenz
node browser-test.js --frames=10   # echter Browser (headless Edge), optional --backend=wasm|webgpu / --no-coi / --throughput=84
```

Stand 16.10.2026, gemessen über alle 84 Captures:

- Modus und Zeilenzahl: 84/84 identisch
- Kampfkraft, Rang-Code und Level: 100 % identisch
- Restliche Abweichungen: Leerzeichen im Status („Vor 3 Min.“ / „Vor3Min.“) und der doppelte Buchstabe
  im Leader-Namen („Emiliee“ / „Emiliiee“). Ursache sind Pixel-Unterschiede um ±1 beim
  Bild-Resize gegenüber cv2.

## Kampfkraft-Trend (`trend.html`)

Die Seite `trend.html` ist im Cockpit über „📈 Trend“ erreichbar. Sie ist wie der Scanner nur für
R4/R5 und Site-Admins und lädt `GET /api/scans/power-history?alliance=X&weeks=N`
(`api/src/power-trend.php`): je Spieler ein Wert pro Tag. Gibt es mehrere Werte an einem Tag, hat
der genaue Ranglisten-Wert Vorrang vor dem gerundeten Wert aus der Mitgliederliste.

Die Auswertung steckt in `js/power-trend.js`:

| Kennzahl | Berechnung |
|---|---|
| Wochenzuwachs | letzter Wert der Woche gegen letzten Wert der Vorwoche |
| Samstag-Opfer | letzter Wert Mo–Fr gegen Tiefstwert am Sa/So |
| Wiederaufbau | Höchstwert der Folgewoche gegen das Opfer (100 % = komplett wieder aufgebaut) |
| Bewegung / Tag | mittlere Veränderung zwischen zwei Messungen |

Einstufung: 🔥 opfert (& baut auf), 📈 wächst, ➖ normal, ⚠️ stagniert (Gesprächskandidat),
❔ zu wenig Daten (unter 6 Tagen Verlauf). Die Schwellen lassen sich in der Seite anpassen.

Am aussagekräftigsten sind Scans am Freitag (vor dem Event), am Sonntag (danach) und einmal unter
der Woche.
