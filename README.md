# lwhub

Alliance tracker – PHP/MySQL edition.

## Setup

1. Webserver mit PHP 8.1+ und MySQL/MariaDB
2. `config.example.php` → `config.php` kopieren und Zugangsdaten eintragen
3. Dateien per SFTP/FTP hochladen (oder GitHub Actions Workflow nutzen)
4. DB-Schema einrichten: `mysql_free_2026_04_20/mysql_schema.sql` aus dem iny-Repo

## Lokaler Test

```
php -S localhost:8080
# API: http://localhost:8080/api/health
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

Der Workflow liegt in `.github/workflows/deploy-hetzner.yml` und deployed bei jedem Push auf `master`.

1. In GitHub unter **Settings -> Secrets and variables -> Actions** diese **Repository Secrets** anlegen:
	- `HETZNER_HOST` (z. B. `example.your-server.de`)
	- `HETZNER_USER` (SSH-User auf dem Server)
	- `HETZNER_SSH_KEY` (private SSH-Key, der auf den Server darf)
	- `HETZNER_DEPLOY_PATH` (z. B. `/var/www/lwhub`)
	- optional: `HETZNER_SSH_PORT` (Standard ist `22`)
	- optional: `HETZNER_KNOWN_HOSTS` (Inhalt von `known_hosts` fuer den Host)

2. Auf dem Hetzner-Server den passenden Public Key in `~/.ssh/authorized_keys` des Deploy-Users eintragen.

3. Falls noch nicht vorhanden, auf dem Server einmalig `config.php` im Deploy-Verzeichnis anlegen (wird vom Workflow bewusst nicht ueberschrieben).

4. Push auf `master` ausfuehren. Der Action-Run synchronisiert die Dateien per `rsync`.

Hinweise:
- Der Workflow schliesst `config.php`, `.git/` und `.github/` vom Upload aus.
- Durch `--delete` werden Dateien entfernt, die im Repo nicht mehr vorhanden sind.
