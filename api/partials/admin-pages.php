<?php // Admin-Seite und Admin-Dialoge – nur nach verifiziertem Rank 5 ausgeliefert (members.php, handleTabHtml) ?>
<!-- ═══ ADMIN PAGE ═══ -->
<div class="page" id="page-a">
  <div class="admin-wrap">
    <div class="admin-nav">
      <button class="admin-nav-tab active" data-action="adminShowTab" data-args='["alliances",{"$":"el"}]'>Allianzen</button>
      <button class="admin-nav-tab" data-action="adminShowTab" data-args='["archive",{"$":"el"}]'>Archiv</button>
      <button class="admin-nav-tab" data-action="adminShowTab" data-args='["transfer",{"$":"el"}]'>Transfer</button>
      <button class="admin-nav-tab" data-action="adminShowTab" data-args='["merge",{"$":"el"}]'>Zusammenführen</button>
      <button class="admin-nav-tab" data-action="adminShowTab" data-args='["admins",{"$":"el"}]'>Admins</button>
      <button class="admin-nav-tab" data-action="adminShowTab" data-args='["tokens",{"$":"el"}]'>API-Tokens</button>
    </div>

    <!-- Allianzen -->
    <div class="admin-page active" id="admin-section-alliances">
      <div class="section-head">
        <div>
          <div class="section-title">Allianzen</div>
          <div class="section-sub">Kurznamen und Titel verwalten. Beim Umbenennen des Kürzels werden alle Spieler-Daten migriert.</div>
        </div>
        <button class="btn btn-gold" data-action="openCreateAlliance">+ Neue Allianz</button>
      </div>
      <div class="alliance-list" id="alliance-list"><div class="empty">Lade …</div></div>
    </div>

    <!-- Archiv -->
    <div class="admin-page" id="admin-section-archive">
      <div class="section-head">
        <div>
          <div class="section-title">Spieler-Archiv</div>
          <div class="section-sub">Gelöschte Spieler können hier wiederhergestellt werden (alle Daten inklusive).</div>
        </div>
      </div>
      <div class="archive-filter">
        <select id="archive-alliance-filter" data-on-change="loadArchive">
          <option value="">Alle Allianzen</option>
        </select>
        <button class="btn btn-ghost" data-action="loadArchive">↻ Aktualisieren</button>
      </div>
      <div class="card admin-card-scroll">
        <table class="archive-table" id="archive-table">
          <thead>
            <tr><th>Spieler</th><th>Allianz</th><th>Rank</th><th>Archiviert</th><th></th></tr>
          </thead>
          <tbody id="archive-tbody"><tr><td colspan="5" class="empty">Lade …</td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- Transfer -->
    <div class="admin-page" id="admin-section-transfer">
      <div class="section-head">
        <div>
          <div class="section-title">Spieler transferieren</div>
          <div class="section-sub">Spieler in eine andere Allianz verschieben. Alle Daten (Einträge, Identitäten, Namenshistorie) werden mitgenommen.</div>
        </div>
      </div>
      <div class="card admin-card-narrow">
        <div class="field">
          <label>Von Allianz</label>
          <select id="transfer-from" data-on-change="loadTransferPlayers"><option value="">– wählen –</option></select>
        </div>
        <div class="field">
          <label>Spieler</label>
          <select id="transfer-player"><option value="">Erst Allianz wählen</option></select>
        </div>
        <div class="field">
          <label>Nach Allianz</label>
          <select id="transfer-to"><option value="">Ziel-Allianz wählen …</option></select>
        </div>
        <div class="modal-footer admin-card-footer">
          <button class="btn btn-gold" data-action="submitTransfer">Transferieren</button>
        </div>
      </div>
    </div>

    <!-- Zusammenfuehren -->
    <div class="admin-page" id="admin-section-merge">
      <div class="section-head">
        <div>
          <div class="section-title">Duplikate zusammenführen</div>
          <div class="section-sub">Ein doppelter Eintrag (aktiv oder archiviert) geht im behaltenen Spieler auf. Name, Rang und Spieler-ID bleiben; Wochen, Scan-Werte, Namen, Discord, Teams und Zug-Platz kommen dazu. Doppelte Wochen: die des behaltenen Spielers gilt.</div>
        </div>
      </div>
      <div class="card admin-card-narrow">
        <div class="field">
          <label>Allianz</label>
          <select id="merge-alliance" data-on-change="loadMergePlayers"><option value="">– wählen –</option></select>
        </div>
        <div class="field">
          <label>Behalten</label>
          <select id="merge-keep"><option value="">Erst Allianz wählen</option></select>
        </div>
        <div class="field">
          <label>Duplikat (geht auf und verschwindet)</label>
          <select id="merge-drop"><option value="">Erst Allianz wählen</option></select>
        </div>
        <div class="modal-footer admin-card-footer">
          <button class="btn btn-gold" data-action="submitMerge">Zusammenführen</button>
        </div>
      </div>
    </div>

    <!-- Admins -->
    <div class="admin-page" id="admin-section-admins">
      <div class="section-head">
        <div>
          <div class="section-title">Admin-Verwaltung</div>
          <div class="section-sub">Spieler mit Admin-Rechten ausstatten (unabhängig vom Rang). R5-Spieler haben automatisch Zugriff.</div>
        </div>
        <button class="btn btn-gold" data-action="openGrantAdmin">+ Admin vergeben</button>
      </div>
      <div class="card admin-card-scroll">
        <table class="archive-table" id="admins-table">
          <thead>
            <tr><th>Spieler</th><th>Discord</th><th>Allianz</th><th>Vergeben von</th><th>Notiz</th><th>Seit</th><th></th></tr>
          </thead>
          <tbody id="admins-tbody"><tr><td colspan="7" class="empty">Lade …</td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- API-Tokens (Konzept v2, A4) -->
    <div class="admin-page" id="admin-section-tokens">
      <div class="section-head">
        <div>
          <div class="section-title">API-Tokens</div>
          <div class="section-sub">Zugänge für die Android-App und den Web-Scanner. Nur R5 der Allianz und der Betreiber legen Tokens an und widerrufen sie.</div>
        </div>
        <button class="btn btn-gold" data-action="openCreateApiToken">+ Token anlegen</button>
      </div>
      <div class="admin-tokens-filter">
        <label class="admin-tokens-filter-label">Allianz:</label>
        <select id="api-tokens-alliance" data-on-change="loadApiTokens" class="admin-tokens-select">
          <option value="">Lade …</option>
        </select>
      </div>
      <div class="card admin-card-scroll">
        <table class="archive-table" id="api-tokens-table">
          <thead>
            <tr><th>Name</th><th>Rolle</th><th>Erstellt von</th><th>Erstellt</th><th>Zuletzt benutzt</th><th>Läuft ab</th><th>Status</th><th></th></tr>
          </thead>
          <tbody id="api-tokens-tbody"><tr><td colspan="8" class="empty">Lade …</td></tr></tbody>
        </table>
      </div>
    </div>

  </div>
</div>

<!-- ── Admin-Dialoge ── -->
<div class="modal-bg hidden" id="modal-create-api-token">
  <div class="modal">
    <div class="modal-title">API-Token anlegen</div>
    <div class="field">
      <label>Name</label>
      <input type="text" id="api-token-name" maxlength="100" placeholder="z.B. Android-App Thomas" autocomplete="off">
      <div class="hint">Wofür ist der Token? Erscheint in der Liste und im Protokoll.</div>
    </div>
    <div class="field">
      <label>Rolle</label>
      <select id="api-token-role">
        <option value="scanner">Scanner – nur Werte für bekannte Spieler</option>
        <option value="r4">R4 – wie R4 im Web-Scanner</option>
        <option value="r5">R5 – wie R5 im Web-Scanner</option>
      </select>
    </div>
    <div class="field">
      <label>Ablaufdatum (optional)</label>
      <input type="date" id="api-token-expires">
      <div class="hint">Leer = unbegrenzt gültig. Abgelaufene Tokens werden abgewiesen.</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="closeModal" data-args='["modal-create-api-token"]'>Abbrechen</button>
      <button class="btn btn-gold" data-action="submitCreateApiToken">Anlegen</button>
    </div>
  </div>
</div>

<div class="modal-bg hidden" id="modal-api-token-created">
  <div class="modal">
    <div class="modal-title">Token angelegt</div>
    <div class="hint admin-token-warning">Dieser Token wird nicht wieder angezeigt. Kopiere ihn jetzt und gib ihn nur an die vorgesehene Person weiter.</div>
    <div class="field" data-i18n-skip="1">
      <input type="text" id="api-token-plain" readonly class="admin-token-plain" data-on-focus="lwSelectText" data-args-focus='[{"$":"el"}]'>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="copyApiToken" data-args='[{"$":"el"}]'>Kopieren</button>
      <button class="btn btn-gold" data-action="closeApiTokenCreated">Schließen</button>
    </div>
  </div>
</div>

<div class="modal-bg hidden" id="modal-grant-admin">
  <div class="modal">
    <div class="modal-title">Admin vergeben</div>
    <div class="field">
      <label>Spielername <em class="admin-label-note">(oder Discord-ID)</em></label>
      <input type="text" id="grant-player-name" placeholder="z.B. Lion Tooth" autocomplete="off">
      <div class="hint">Name muss exakt mit dem aktuellen Spielernamen übereinstimmen.</div>
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <input type="text" id="grant-note" maxlength="255" placeholder="z.B. Allianz-Leitung">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="closeModal" data-args='["modal-grant-admin"]'>Abbrechen</button>
      <button class="btn btn-gold" data-action="submitGrantAdmin">Vergeben</button>
    </div>
  </div>
</div>

<div class="modal-bg hidden" id="modal-create-alliance">
  <div class="modal">
    <div class="modal-title">Neue Allianz anlegen</div>
    <div class="field">
      <label>Kürzel (z.B. NxU1)</label>
      <input type="text" id="create-short" maxlength="50" placeholder="z.B. NxU1 oder my-ally">
      <div class="hint">Max. 50 Zeichen</div>
    </div>
    <div class="field">
      <label>Vollständiger Titel (optional)</label>
      <input type="text" id="create-title" maxlength="255" placeholder="NxU1 – Next Unit 1">
    </div>
    <div class="field">
      <label class="admin-check-label">
        <input type="checkbox" id="create-accepts-requests">
        Login-Anfragen akzeptieren
      </label>
      <div class="hint">Spieler können über das Login-Formular eine Beitrittsanfrage senden.</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="closeModal" data-args='["modal-create-alliance"]'>Abbrechen</button>
      <button class="btn btn-gold" data-action="submitCreate">Anlegen</button>
    </div>
  </div>
</div>

<div class="modal-bg hidden" id="modal-edit-alliance">
  <div class="modal">
    <div class="modal-title">Allianz bearbeiten</div>
    <input type="hidden" id="edit-old-short">
    <div class="field">
      <label>Kürzel</label>
      <input type="text" id="edit-short" maxlength="50">
      <div class="hint">⚠️ Kürzel-Änderung migriert alle Spieler, Einträge und Logs!</div>
    </div>
    <div class="field">
      <label>Vollständiger Titel</label>
      <input type="text" id="edit-title" maxlength="255" placeholder="NxU1 – Next Unit 1">
    </div>
    <div class="field">
      <label class="admin-check-label">
        <input type="checkbox" id="edit-accepts-requests">
        Login-Anfragen akzeptieren
      </label>
      <div class="hint">Spieler können über das Login-Formular eine Beitrittsanfrage senden.</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="closeModal" data-args='["modal-edit-alliance"]'>Abbrechen</button>
      <button class="btn btn-gold" data-action="submitEdit">Speichern</button>
    </div>
  </div>
</div>

<div class="modal-bg hidden" id="modal-alliance-features">
  <div class="modal admin-features-modal">
    <div class="modal-title" id="alliance-features-title">Features</div>
    <div class="modal-sub admin-features-sub" id="alliance-features-sub">Steuere hier, welche Bereiche diese Allianz nutzen darf.</div>
    <div id="alliance-features-body"><div class="empty">Lade …</div></div>
    <div class="modal-footer">
      <span class="hint admin-features-hint" data-i18n="s_alliance_settings_hint">Schalter wirken sofort, Zahlen und Namen mit „Speichern“.</span>
      <button class="btn btn-ghost" data-action="closeModal" data-args='["modal-alliance-features"]' data-i18n="s_schliessen">Schließen</button>
      <button class="btn btn-gold" id="alliance-features-save" data-action="saveAllianceSettings" data-args='[{"$":"el"}]' disabled data-i18n="s_speichern">Speichern</button>
    </div>
  </div>
</div>
