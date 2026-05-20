# lwhub – Projektstatus (Stand: 20.05.2026)

## Überblick

Alliance-Management-SPA (Vanilla JS + PHP/MySQL).
Lokaler Dev-Server: `http://127.0.0.1:8080` via `scripte/router.php` → `php -S 127.0.0.1:8080 scripte/router.php`

---

## Abgeschlossene Arbeiten (alle Sessions)

### Refactoring: api/index.php → Thin Router + 12 Module
- `api/index.php` war ein 3329-Zeilen-Monolith → jetzt **310 Zeilen** Thin Router
- 12 Module unter `api/src/`:
  - `helpers.php` – jsonOut, uuid4, safeRank, normalizeDiscordId, normalizeMemberName, parseProtectedR4Names, isProtectedR4Member, applyProtectedRankRule, roleFromRank, normalizePreferredLanguage, isLocalRequest, isOptionalTableError, isBadFieldError, openDb
  - `db-setup.php` – ensureRankChangeLogTable, ensureAccessRequestsTable, ensureDiscordProfileCacheTable, ensurePresenceTable, ensureLastVisitColumn, ensureBerufColumns, ensurePreferredLanguageColumn, ensureChatTable
  - `presence-chat.php` – getOnlineMembers, handlePresenceList, handlePresencePing, handleGetChat, handlePostChat, handleDeleteChatMessage
  - `auth.php` – logRankChange, enforceProtectedRanks, getDiscordMemberSql, getDiscordMemberByActiveChar, getDiscordMember, getMemberByNameSql, getMemberByName, memberToDiscordAvatarUrl, ensureSiteAdminsTable, seedProtectedAdmins, isSiteAdmin, requireR5
  - `members.php` – handleHealth, handleTabHtml, handleVerifyDiscord, handleMemberHistory, handleCacheDiscordProfile, handleListRankChangeLog, handleGetMembers, handleAddMember, handleTransferPlayer, handleUpdateMember, handleSetMemberLanguage, handleDeleteMember, handleSwapIdToDiscord, handleGetSeInactive, handleGetRankingHistory, handleApplyRankChange, handleSaveMemberBeruf
  - `entries.php` – handleGetEntries, handleSaveEntry, handleDeleteEntry
  - `access-requests.php` – handleListAccessRequests, handleSubmitAccessRequest, handleResolveAccessRequest
  - `alliance.php` – ensureAlliancesTable, ensureAllianceConfigTable, handleGetAllianceConfig, handleSetAllianceConfig, upsertAllianceFromConfig, seedFlagsForAlliance, ensureUserActiveCharTable, ensureArchiveTables, handleGetAlliances, handleGetOpenAlliances, handleCreateAlliance, handleUpdateAlliance
  - `admin.php` – handleGetAdmins, handleGrantAdmin, handleRevokeAdmin
  - `archive.php` – handleGetArchivedPlayers, handleRestorePlayer
  - `my-chars.php` – handleGetMyChars, handleSetActiveChar, handleSelfRename, handleGetNameHistory
  - `zug.php` – ensureZugTables, requireZugR4, getZugQueueRows, advanceZugQueue, resetZugQueueToFront, hasWeeklyZugRole, handleGetZugRulesets, handleSaveZugRuleset, handleDeleteZugRuleset, handleGetZugQueue, handleSyncZugQueue, handleReorderZugQueue, handleGetZugSchedule, handleGetZugSuggest, handleCreateZugSchedule, handleUpdateZugSchedule, handleNoShowZugSchedule, handleSwapZugSchedule, handleDeleteZugSchedule, handleGetZugMyTurns

### Bugfixes in dieser Session
- **BOM in api/index.php** behoben: PowerShell `WriteAllText` mit Default-UTF-8 schreibt BOM → `declare(strict_types=1)` schlug fehl. Fix: `[System.Text.UTF8Encoding]::new($false)`.
- **scripte/router.php** gefixt: Zeigte noch auf gelöschtes `iny/api/index.php` → auf `api/index.php` umgebogen.
- **JS classList null-Fehler** (line 3276, index.html) behoben: `getElementById('page-e').classList` → `getElementById('page-e')?.classList` (Optional Chaining, gleiches für `page-w`).
- **"Unexpected token '<'" JSON-Fehler** behoben: BOM-Entfernung.

### Bereinigung (frühere Sessions)
- `loadAccessRequests()` zu `showPage('v')` hinzugefügt
- Login-Anfragen-Panel über Mitgliederliste verschoben
- `iny/` auf Redirect-Stubs reduziert (→ `https://lwhub.de/`)
- `_archiv/` gelöscht, `scriptes/` gelöscht, 21 tote Skripte gelöscht
- `shared-bottom.js` entfernt
- `loadHistory()/historyData/case 'history'` entfernt

---

## Aktueller Zustand der Schlüsseldateien

### `api/index.php` (310 Zeilen, BOM-frei)
- Lädt `config.php`, setzt `$ALLIANCE` aus `INY_ALLIANCE`
- `require_once helpers.php` **zuerst** (Pflicht, wegen `parseProtectedR4Names`)
- `$PROTECTED_R4_NAMES = parseProtectedR4Names(...)` direkt danach
- Restliche 11 `require_once` für src/-Module
- CORS-Header, Route-Parsing, Dispatch Try/Catch
- **`?alliance=`-Override**: `$_GET['alliance']` überschreibt `$ALLIANCE` (nach DB-Setup-Aufrufen, vor Route-Dispatch) – nötig für Char-Switcher-Feature

### `scripte/router.php`
- `/iny/api/...` und `/api/...` → beide auf `api/index.php`
- `$_SERVER['SCRIPT_NAME'] = '/api/index.php'`

### `index.html` (~6400 Zeilen, SPA)
- `fetchJson(path)` hängt automatisch `?alliance=<activeChar.alliance>` aus localStorage an (außer `/verify-discord`)
- `API_BASE_CANDIDATES` für Fallback-URLs
- `loadMembers()` → `api('members')` → `fetchJson('/members')` → befüllt `members[]`, `PREV`, `R4`, `R5`, `memberMeta`
- `renderVerwaltung()` (line 4501): Flache alphabetische Mitgliederliste
- `renderTable()` (line 3406): Ergebnis-Tabelle mit Einträgen und Rank-Badges
- Optional Chaining an den classList-Aufrufen für `page-e` und `page-w`

### `char-switcher.js`
- Speichert aktiven Char in `localStorage('iny_active_char_v1')` mit `{ alliance, player_id, name }`
- Bei Alliance-Wechsel: localStorage aktualisieren, kein Auto-Reload

### `config.php` (root, gitignored)
```php
define('INY_ALLIANCE', 'NxU1');
define('INY_PROTECTED_R4_NAMES', 'Lion Tooth');
```

---

## API-Endpunkte (Übersicht)

| Methode | Pfad | Funktion |
|---------|------|----------|
| GET | /health | handleHealth |
| GET | /verify-discord | handleVerifyDiscord |
| GET | /members | handleGetMembers (WHERE alliance=? AND is_active=1) |
| POST | /members | handleAddMember |
| PUT | /members/{name} | handleUpdateMember |
| PUT | /members/{name}/beruf | handleSaveMemberBeruf |
| PUT | /members/{name}/language | handleSetMemberLanguage |
| DELETE | /members/{name} | handleDeleteMember |
| POST | /members/{name}/transfer | handleTransferPlayer |
| POST | /members/{name}/self-rename | handleSelfRename |
| POST | /members/{name}/swap-id-to-discord | handleSwapIdToDiscord |
| GET | /members/{name}/name-history | handleGetNameHistory |
| GET | /entries/{kw} | handleGetEntries |
| POST | /entries/{kw} | handleSaveEntry |
| DELETE | /entries/{kw}/{name} | handleDeleteEntry |
| GET | /access-requests | handleListAccessRequests |
| POST | /access-requests | handleSubmitAccessRequest |
| POST | /access-requests/{id}/resolve | handleResolveAccessRequest |
| GET | /ranking-history | handleGetRankingHistory |
| GET | /se-inactive | handleGetSeInactive |
| POST | /apply-rank-change | handleApplyRankChange |
| GET | /rank-change-log | handleListRankChangeLog |
| GET | /tab-html | handleTabHtml |
| GET | /alliance-config | handleGetAllianceConfig |
| POST | /alliance-config | handleSetAllianceConfig |
| GET | /alliances | handleGetAlliances |
| GET | /alliances/open | handleGetOpenAlliances |
| POST | /alliances | handleCreateAlliance |
| PUT | /alliances/{name} | handleUpdateAlliance |
| GET | /archived-players | handleGetArchivedPlayers |
| POST | /archived-players/{id}/restore | handleRestorePlayer |
| GET | /admins | handleGetAdmins |
| POST | /admins | handleGrantAdmin |
| DELETE | /admins/{discord_id} | handleRevokeAdmin |
| GET | /my-chars | handleGetMyChars |
| POST | /my-chars/active | handleSetActiveChar |
| GET /POST | /presence | handlePresenceList / handlePresencePing |
| GET /POST | /chat | handleGetChat / handlePostChat |
| DELETE | /chat/{id} | handleDeleteChatMessage |
| GET | /member-history | handleMemberHistory |
| POST | /discord-profile-cache | handleCacheDiscordProfile |
| GET | /zug/rulesets | handleGetZugRulesets |
| POST | /zug/rulesets | handleSaveZugRuleset |
| DELETE | /zug/rulesets/{key} | handleDeleteZugRuleset |
| GET | /zug/queue | handleGetZugQueue |
| POST | /zug/queue/sync | handleSyncZugQueue |
| POST | /zug/queue/reorder | handleReorderZugQueue |
| GET | /zug/schedule | handleGetZugSchedule |
| POST | /zug/schedule | handleCreateZugSchedule |
| PUT | /zug/schedule/{id} | handleUpdateZugSchedule |
| DELETE | /zug/schedule/{id} | handleDeleteZugSchedule |
| POST | /zug/schedule/{id}/noshow | handleNoShowZugSchedule |
| POST | /zug/schedule/swap | handleSwapZugSchedule |
| GET | /zug/suggest | handleGetZugSuggest |
| GET | /zug/my-turns | handleGetZugMyTurns |

---

## Wichtige technische Hinweise

- **PHP-Dateien per PowerShell schreiben**: Immer `[System.Text.UTF8Encoding]::new($false)` verwenden – Standard-UTF-8 schreibt BOM, was PHP-`declare(strict_types=1)` zerstört.
- **PHP 8+**: `declare(strict_types=1)`, `never`-Returntyp, Named Args, kein Composer/Autoloader – alles manuell per `require_once`.
- **PDO**: Alle DB-Zugriffe via PDO mit Prepared Statements.
- **Multi-Alliance**: `$ALLIANCE` aus config/ENV, überschreibbar via `?alliance=` GET-Parameter (für Char-Switcher).
- **handleTabHtml**: Nutzt `__DIR__ . '/../partials/'` → `api/partials/r4-pages.php` und `api/partials/admin-tab-btns.php`.

---

## Workspace-Struktur (Wesentliches)

```
api/
  index.php          ← Thin Router (310 Zeilen, BOM-frei)
  src/               ← 12 Module
  partials/
    admin-tab-btns.php
    r4-pages.php
    r4-tab-btns.php
config.php           ← gitignored, INY_ALLIANCE=NxU1
index.html           ← SPA (~6400 Zeilen)
char-switcher.js     ← Char-Switcher-Komponente
i18n.js              ← Internationalisierung
locales/             ← de, en, es, fr, it, pl, zh
iny/                 ← Nur Redirect-Stubs → lwhub.de
scripte/
  router.php         ← PHP Dev-Server Router
  start-local.bat    ← Startet lokalen Dev-Server
```
