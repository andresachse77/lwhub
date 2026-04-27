# lwhub

Alliance tracker – PHP/MySQL edition.

## Setup

1. Webserver mit PHP 8.1+ und MySQL/MariaDB
2. `config.example.php` → `config.php` kopieren und Zugangsdaten eintragen
3. Dateien per SFTP/FTP hochladen (oder GitHub Actions Workflow nutzen)
4. DB-Schema einrichten: `c:/git/iny/mysql_free_2026_04_20/mysql_schema.sql` aus dem Elternprojekt

## Datenbank-Config

- Ort: `config.php` im Projekt-Root (neben `index.html`)
- Nie einchecken: Die Datei ist absichtlich in `.gitignore`
- Vorlage: `config.example.php`

## Lokaler Test

```
scripte\start-local.bat
# App: http://127.0.0.1:8080
# API: http://127.0.0.1:8080/api/health
```

Alternative ohne Script:

```
php -S 127.0.0.1:8080 scripte/router.php
```

## API-Routen

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | /api/health | DB-Check |
| GET | /api/verify-discord?discord_id= | Discord-Auth |
| GET | /api/member-history | Mitglieder-Historie |
| POST | /api/discord-profile-cache | Avatar cachen |
| GET | /api/rank-change-log | Rangänderungslog |
| GET | /api/members | Alle Mitglieder |
| POST | /api/members | Mitglied anlegen |
| PUT | /api/members/{name} | Mitglied bearbeiten |
| DELETE | /api/members/{name} | Mitglied löschen |
| GET | /api/entries/{kw} | Einträge einer KW |
| POST | /api/entries/{kw} | Eintrag speichern |
| DELETE | /api/entries/{kw}/{name} | Eintrag löschen |
| GET | /api/access-requests | Zugriffsanfragen |
| POST | /api/access-requests | Anfrage stellen |
| POST | /api/access-requests/{id}/resolve | Anfrage bearbeiten |

## Umgebungsvariablen (alternativ zu config.php)

```
MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD
INY_ALLIANCE, INY_PROTECTED_R4_NAMES
```

## Deployment nach Hetzner per GitHub Actions

Der Workflow liegt in `.github/workflows/deploy-hetzner.yml` und deployed bei jedem Push auf `master` per FTP/FTPS.

1. In GitHub unter **Settings -> Environments -> FTP** diese **Environment Secrets** anlegen (oder alternativ als Repository Secrets):
	- `FTP_SERVER` (z. B. `u123456.your-storagebox.de` oder Hetzner-FTP-Host laut Konsole)
	- `FTP_USERNAME` (FTP-Benutzer)
	- `FTP_PASSWORD` (FTP-Passwort)
	- `FTP_REMOTE_DIR` (z. B. `/www/htdocs/w01xxxx/lwhub/`)
	- optional: `FTP_PROTOCOL` (`ftps` oder `ftp`, Standard: `ftps`)
	- optional: `FTP_PORT` (Standard: `21`)

   Dein aktuelles Schema mit `SERVER`, `USERNAME`, `PASSWORD`, `REMOTE_DIR` wird ebenfalls unterstuetzt.

2. In Hetzner das Zielverzeichnis einmalig anlegen (falls noch nicht vorhanden).

3. Falls noch nicht vorhanden, auf dem Server einmalig `config.php` im Deploy-Verzeichnis anlegen (wird vom Workflow bewusst nicht ueberschrieben).

4. Push auf `master` ausfuehren. Der Action-Run synchronisiert die Dateien per FTP/FTPS.

Hinweise:
- Der Workflow schliesst `config.php`, `.git/` und `.github/` vom Upload aus.
- Nicht mehr vorhandene Dateien im Repo werden auf dem Ziel ebenfalls entfernt.
