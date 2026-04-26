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
