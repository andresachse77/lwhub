<?php // R4 Pages – nur nach verifiziertem Rank ≥4 ausgeliefert ?>
<!-- ═══ DASHBOARD ═══ -->
<div class="page" id="page-d">

  <div class="stats">
    <div class="stat"><div class="stat-label">Erfasst</div><div class="stat-num g" id="s-count">0</div><div class="stat-sub">von 100 Mitgliedern</div></div>
    <div class="stat"><div class="stat-label">Warnungen</div><div class="stat-num r" id="s-warn">0</div><div class="stat-sub">Strafpunkte aktiv</div></div>
    <div class="stat"><div class="stat-label">Aufsteiger</div><div class="stat-num gr" id="s-up">0</div><div class="stat-sub">Rank verbessert</div></div>
    <div class="stat"><div class="stat-label">Absteiger</div><div class="stat-num b" id="s-down">0</div><div class="stat-sub">Rank verschlechtert</div></div>
  </div>

  <div class="prog">
    <div class="prog-top"><span>Erfassungsfortschritt KW <span id="kw-d">15</span></span><span id="prog-pct">0%</span></div>
    <div class="prog-bar"><div class="prog-fill" id="prog-fill" style="width:0%"></div></div>
  </div>

  <div class="grid2">
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Warnliste</div><div class="panel-sub" id="warn-ct"></div></div>
      <div id="warn-list"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Top Performer</div><div class="panel-sub">beste Beteiligung</div></div>
      <div id="top-list"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Rank-Verteilung</div><div class="panel-sub">diese Woche</div></div>
      <div class="rdist" id="rdist"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Aktivste Felder</div><div class="panel-sub">Häufigkeit</div></div>
      <div class="bars" id="field-bars"></div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <div class="panel-title">Alle Mitglieder</div>
      <div class="filter-row" id="filterBar">
        <button class="flt on" data-f="all">Alle</button>
        <button class="flt" data-f="warn">⚠ Warnungen</button>
        <button class="flt" data-f="up">↑ Aufsteiger</button>
        <button class="flt" data-f="down">↓ Absteiger</button>
        <button class="flt" data-f="missing">○ Ausstehend</button>
      </div>
    </div>
    <div style="overflow-x:auto;">
      <table class="rtable">
        <thead><tr><th>#</th><th>Mitglied</th><th>Rank</th><th>Tendenz</th><th>Flags</th><th>Status</th></tr></thead>
        <tbody id="rankingBody"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ═══ EINGABE ═══ -->
<div class="page" id="page-e">

  <div class="search-bar">
    <div style="display:flex;align-items:center;">
      <input type="text" class="search-input" id="searchInput" placeholder="🔍  Mitglied suchen...">
      <span class="list-counter" id="listCounter"></span>
    </div>
    <div class="filter-row" style="width:100%;justify-content:space-between;align-items:center;">
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button class="flt on" data-lf="all">Alle</button>
        <button class="flt" data-lf="missing">○ Ausstehend</button>
        <button class="flt" data-lf="done">✓ Erfasst</button>
      </div>
      <button class="flt-toggle" id="btn-done-bottom" title="Erfasste Mitglieder ans Ende sortieren (nochmal klicken: ausblenden)" onclick="toggleDoneMode()">↓ Erfasste ans Ende</button>
    </div>
  </div>

  <!-- EDITOR -->
  <div class="editor-wrap" id="editor">
    <div class="editor-header">
      <div class="editor-name" id="editorName"></div>
      <button class="editor-close" id="editorClose">✕</button>
    </div>

    <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--soft);margin-bottom:8px;">Rank</div>
    <div class="rank-selector" id="rankRow">
      <div class="rk-btn" data-r="1"><div class="rk-num">1</div><div class="rk-lbl">Rookie</div></div>
      <div class="rk-btn" data-r="2"><div class="rk-num">2</div><div class="rk-lbl">Pro</div></div>
      <div class="rk-btn on" data-r="3"><div class="rk-num">3</div><div class="rk-lbl">Elite</div></div>
      <div class="rk-btn" data-r="4"><div class="rk-num">4</div><div class="rk-lbl">Leader</div></div>
      <div class="rk-btn" data-r="5"><div class="rk-num">5</div><div class="rk-lbl">Chef</div></div>
    </div>
    <div class="fixed-note" id="fixedNote"></div>

    <div class="flag-cats" id="flagCats"></div>
    <button class="save-btn" id="saveBtn">✓ Speichern</button>
  </div>

  <div class="member-list" id="memberList"></div>
</div>

<!-- ═══ WACHE ═══ -->
<div class="page" id="page-w">
  <div class="panel">
    <div class="panel-head">
      <div class="panel-title">🧩 Events</div>
      <div class="panel-sub">Wache 1-3, Wüste und Spezialevents</div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <div class="wache-tabs">
        <button class="wache-tab on" data-ev="w1" onclick="selectEventView('w1')">Wache 1</button>
        <button class="wache-tab" data-ev="w2" onclick="selectEventView('w2')">Wache 2</button>
        <button class="wache-tab" data-ev="w3" onclick="selectEventView('w3')">Wache 3</button>
        <button class="wache-tab" data-ev="wu" onclick="selectEventView('wu')">Wüste</button>
        <button class="wache-tab" data-ev="se" onclick="selectEventView('se')">Spezial</button>
        <button class="wache-tab" data-ev="vs" onclick="selectEventView('vs')">VS</button>
        <button class="wache-tab" data-ev="sp" onclick="selectEventView('sp')">Spenden</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="flt-toggle" id="btn-event-done-bottom" title="Erfasste ans Ende sortieren (nochmal: ausblenden)" onclick="toggleEventDoneMode()">↓ Erfasste ans Ende</button>
        <button class="flt-toggle" id="btn-event-contrast" title="Hoeherer Kontrast fuer Event-Erfassung" onclick="toggleEventContrast()">◐ High Contrast</button>
      </div>
    </div>

    <div class="event-section active" data-event="w">
      <div class="wache-legend">
        <span><span style="color:var(--red);">⚠</span> wenig Schaden (&lt;2G)</span>
        <span><span style="color:var(--green);">⚔</span> guter Schaden</span>
        <span><span style="color:var(--softer);">○</span> nicht dabei</span>
        <span style="margin-left:auto;" class="wache-counter" id="w-counter">0 / 0</span>
      </div>
      <div class="wache-grid" id="wache-grid"></div>
    </div>

    <div class="event-section" data-event="wu">
      <div class="wache-legend">
        <span><span style="color:var(--blue);">📋</span> Anmeldung</span>
        <span><span style="color:var(--green);">⚔</span> Teilnahme</span>
        <span><span style="color:var(--red);">⚠</span> Fehlen (Strafe)</span>
        <span style="margin-left:auto;" class="wache-counter" id="wu-counter">0 / 0</span>
      </div>
      <div class="wache-grid" id="wueste-grid"></div>
    </div>

    <div class="event-section" data-event="se">
      <div class="wache-legend">
        <span><span style="color:var(--blue);">⚔</span> Teilnahme</span>
        <span><span style="color:var(--green);">🏅</span> Top 50</span>
        <span><span style="color:var(--gold);">🏆</span> Top 20</span>
        <span style="margin-left:auto;" class="wache-counter" id="se-counter">0 / 0</span>
      </div>
      <div class="wache-grid" id="spezial-grid"></div>
    </div>

    <div class="event-section" data-event="vs">
      <div class="wache-legend">
        <span><span style="color:var(--red);">⚠</span> unter 50 Mio (Strafe)</span>
        <span><span style="color:var(--blue);">🥈</span> Top 30 (Bonus)</span>
        <span><span style="color:var(--gold);">🏆</span> Top 10 (Bonus)</span>
        <span style="margin-left:auto;" class="wache-counter" id="vs-counter">0 / 0</span>
      </div>
      <div class="wache-grid" id="vs-grid"></div>
    </div>

    <div class="event-section" data-event="sp">
      <div class="wache-legend">
        <span><span style="color:var(--red);">⚠</span> unter 35K (Strafe)</span>
        <span><span style="color:var(--blue);">🏅</span> Top 20 (Bonus)</span>
        <span style="margin-left:auto;" class="wache-counter" id="sp-counter">0 / 0</span>
      </div>
      <div class="wache-grid" id="spende-grid"></div>
    </div>
  </div>
</div>

<!-- ═══ ERGEBNIS ═══ -->
<div class="page" id="page-r">
  <div class="panel" style="max-width:100%;">
    <div class="panel-head" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div class="panel-title">📊 Rang-Empfehlungen</div>
      <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
        <label style="font-size:0.85rem;color:var(--muted);">Wochen:</label>
        <select id="ergebnis-weeks" style="background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:0.85rem;">
          <option value="3">3</option>
          <option value="4" selected>4</option>
          <option value="5">5</option>
          <option value="6">6</option>
        </select>
        <button class="wt-btn" onclick="loadErgebnis()" style="padding:5px 14px;">🔄 Laden</button>
      </div>
    </div>
    <div id="ergebnis-legend" style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.78rem;margin-bottom:12px;color:var(--muted);">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#2ecb7a;margin-right:4px;vertical-align:middle;"></span>Beförderung empfohlen (≥2 Wochen stabil)</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#e05545;margin-right:4px;vertical-align:middle;"></span>Herabstufung empfohlen (&gt;2 Wochen schlecht)</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f0a500;margin-right:4px;vertical-align:middle;"></span>AFK (sperrt Rang-Änderung)</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#888;margin-right:4px;vertical-align:middle;"></span>Keine Daten vorhanden</span>
    </div>
    <div id="ergebnis-loading" style="display:none;color:var(--muted);text-align:center;padding:24px;">Lade Daten…</div>
    <div id="ergebnis-info" style="display:none;background:rgba(240,165,0,0.1);border:1px solid rgba(240,165,0,0.3);border-radius:6px;padding:8px 14px;font-size:0.83rem;color:#f0a500;margin-bottom:10px;"></div>
    <div id="ergebnis-empty" style="display:none;color:var(--muted);text-align:center;padding:24px;">Keine Daten vorhanden.</div>
    <div id="ergebnis-table-wrap" style="overflow-x:auto;"></div>
  </div>
</div>

<!-- ═══ VERWALTUNG ═══ -->
<div class="page" id="page-v">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">

    <!-- ADD MEMBER -->
    <div class="panel">
      <div class="panel-head"><div class="panel-title">➕ Mitglied hinzufügen</div></div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <div class="vlabel">Name</div>
          <input class="vinput" id="v-new-name" placeholder="Spielername..." type="text">
        </div>
        <div>
          <div class="vlabel">Discord-ID <span style="color:var(--soft);font-size:11px;font-weight:400">(optional)</span></div>
          <input class="vinput" id="v-new-discord" placeholder="z.B. 123456789012345678" type="text" inputmode="numeric">
        </div>
        <div>
          <div class="vlabel">Rang</div>
          <div style="display:flex;gap:6px;">
            <button class="vrank-btn" data-vr="1">1 · Rookie</button>
            <button class="vrank-btn" data-vr="2">2 · Pro</button>
            <button class="vrank-btn on" data-vr="3">3 · Elite</button>
            <button class="vrank-btn" data-vr="4">4 · Leader</button>
            <button class="vrank-btn" data-vr="5">5 · Chef</button>
          </div>
        </div>
        <button class="save-btn" id="v-add-btn" style="margin-top:4px;">+ Hinzufügen</button>
      </div>
    </div>

    <!-- STATS -->
    <div class="panel">
      <div class="panel-head"><div class="panel-title">📊 Übersicht</div></div>
      <div id="v-stats" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>

  </div>

  <!-- MEMBER TABLE -->
  <div class="panel" style="margin-top:1rem;">
    <div class="panel-head">
      <div class="panel-title">👥 Mitgliederliste</div>
      <input class="search-input" id="v-search" placeholder="Suchen..." style="width:200px;">
    </div>
    <div id="v-list"></div>
  </div>

  <div class="panel" style="margin-top:1rem;">
    <div class="panel-head">
      <div class="panel-title">📝 Login-Anfragen</div>
      <div class="panel-sub" id="v-access-count">0 offen</div>
    </div>
    <div id="v-access-requests" class="v-access-list"></div>
  </div>

  <!-- SE AUSWERTUNG -->
  <div class="panel" style="margin-top:1rem;">
    <div class="panel-head">
      <div class="panel-title">🔍 Kein Spezialevent in letzten Wochen</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <label style="font-size:0.85em;color:var(--softer);">Wochen:</label>
        <select id="se-weeks-select" style="background:var(--card2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:0.85em;">
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4" selected>4</option>
          <option value="5">5</option>
          <option value="6">6</option>
        </select>
        <button class="save-btn" onclick="loadSeInactive()" style="padding:4px 12px;font-size:0.85em;">Laden</button>
      </div>
    </div>
    <div id="se-inactive-result" style="padding:8px 0;"></div>
  </div>
</div>
