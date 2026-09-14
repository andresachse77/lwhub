# Teamsbearbeitung – Stand fuer morgen

## Zielbild
- Team-Editor mit T1-T4, je Team:
  - Team-Typ (Panzer/Flugzeug/Rakete)
  - Combat Power
  - Affe-Level
  - 6 Helden-Slots per Drag & Drop (Slot 6 = Affe)
- Helden nur einmal global ueber alle Teams.
- Slot-Overdrop tauscht Helden.
- Affe (Slot 6) darf nur in genau einem Team belegt sein.
- Allianz-Uebersicht zeigt Teamwerte inkl. Affe-Level.

## Bereits umgesetzt

### Backend/API
Datei: `api/src/teams.php`
- `member_teams` erweitert um:
  - `monkey_level INT NULL`
  - `heroes_json JSON NULL`
- Migrationssicher:
  - `ALTER TABLE ... ADD COLUMN monkey_level ...` (try/catch)
  - `ALTER TABLE ... ADD COLUMN heroes_json ...` (try/catch)
- Payload-Normalisierung:
  - `normalizeMonkeyLevel(...)`
  - `normalizeTeamHeroes(...)` (immer 6 Slots)
- Save/Load:
  - `heroes` wird in `heroes_json` gespeichert und wieder geladen
- Alliance-Endpoint:
  - liefert `t1_monkey_level` bis `t4_monkey_level`

### Frontend Team-Editor
Datei: `index.html`
- Team-Modal erweitert um Affe-Level-Eingaben pro T1-T4.
- Drag-&-Drop Builder eingebaut:
  - 6 Slots pro Team
  - globale Heldenliste
  - Unique-Belegung global
  - Swap bei Overdrop
  - Slot-6 (Affe) nur in einem Team, andere Slot-6 werden geleert/gesperrt
- Hero-Catalog-Loading:
  - Team-Typ `panzer` mapped auf Ordner `assets/heroes/tank`
  - Fallbacks fuer spaetere Kategorien (flugzeug/rakete)
- Save-Flow verhaertet:
  - Buttons explizit `type="button"`
  - Form-Submit wird abgefangen
  - klarere Fehlermeldungen im Catch
- Modal-Scroll-Fix:
  - Team-Modal vertikal scrollbar
  - Footer sticky, damit Speichern immer erreichbar bleibt

### Assets
- Panzer-Helden vorhanden:
  - `assets/heroes/tank/extracted/*.png` (13 Helden, 256x256)
  - `assets/heroes/tank/extracted/thumbs/*.png` (13 Helden, 160x160)
- Manifest aktualisiert:
  - `assets/heroes/tank/manifest.json`
  - `image` = 256x256
  - `thumb` = 160x160

## Aktuelle bekannte Probleme / Feinschliff
1. DnD-Layout noch weiter optimieren (User-Feedback: Breite/Komfort).
2. Visuelles Feintuning fuer Slot-Groesse und Abstaende.
3. Optional: Team-Bloecke einklappbar (T1-T4), damit Modal kompakter wird.
4. Optional: Button "Team leeren" pro T1-T4.

## Offene naechste Schritte (vereinbart)
1. Flugzeughelden wie Panzer verarbeiten:
   - ausschneiden
   - normalisieren (256x256)
   - thumbs erzeugen (160x160)
   - manifest anlegen/aktualisieren
2. Raketenhelden gleiches Vorgehen.
3. Danach DnD-Pool fuer Flugzeug/Rakete aktiv testen.

## Referenzdateien
- `index.html`
- `api/src/teams.php`
- `assets/heroes/tank/manifest.json`
- `assets/heroes/tank/README.md`
- `scripte/crop_tank_heroes.py`
- `scripte/generate_hero_thumbs.py`

## Testhinweise fuer morgen
- Nach Frontend-Aenderungen: hart neu laden (Strg+F5).
- API-Smoketest lokal:
  - `GET /api/my-teams/{name}?alliance=NxU1`
  - `POST /api/my-teams/{name}?alliance=NxU1` mit `teams[].heroes` (6 Slots)
- Sichtpruefung:
  - Save funktioniert
  - Slots tauschen korrekt
  - Affe-Slot-6-Exklusivregel greift
