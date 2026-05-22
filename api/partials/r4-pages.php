<?php // R4 Pages – nur nach verifiziertem Rank ≥4 ausgeliefert ?>

<!-- ═══ ZUG ═══ -->
<div class="page" id="page-z">

  <!-- Top controls -->
  <div class="panel" style="margin-bottom:1rem;">
    <div class="panel-head" style="flex-wrap:wrap;gap:8px;">
      <div class="panel-title" style="color:var(--text);"><svg xmlns="http://www.w3.org/2000/svg" width="30" height="16" viewBox="0 0 38 20" style="vertical-align:-2px;display:inline-block;"><circle cx="9" cy="2.2" r="2" fill="rgba(255,255,255,0.42)"/><circle cx="13.5" cy="0.9" r="1.2" fill="rgba(255,255,255,0.28)"/><rect x="6.5" y="3" width="4" height="4.5" rx="0.8" fill="#B87300"/><rect x="1" y="6.5" width="22" height="9" rx="4" fill="#F0A500"/><rect x="2" y="7.2" width="19" height="3.2" rx="2" fill="rgba(255,230,90,0.38)"/><rect x="19" y="3.5" width="10" height="12" rx="1.5" fill="#D4890A"/><rect x="18" y="2.2" width="12" height="2.5" rx="1" fill="#B87300"/><rect x="21" y="5" width="5" height="4" rx="1" fill="#87CEEB" opacity="0.88"/><rect x="0" y="10.8" width="2" height="2.5" rx="0.4" fill="#9A6200"/><circle cx="8.5" cy="17" r="3.4" fill="#9A6200" stroke="#F0C040" stroke-width="1.1"/><circle cx="8.5" cy="17" r="1.3" fill="#C8820A"/><line x1="8.5" y1="13.6" x2="8.5" y2="20.4" stroke="#C8820A" stroke-width="0.7"/><line x1="5.1" y1="15" x2="11.9" y2="19" stroke="#C8820A" stroke-width="0.7"/><line x1="5.1" y1="19" x2="11.9" y2="15" stroke="#C8820A" stroke-width="0.7"/><circle cx="3" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/><circle cx="21" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/><circle cx="27" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/><rect x="3" y="16.3" width="25" height="1.5" rx="0.5" fill="#9A6200" opacity="0.6"/></svg> Zugplan</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;">
        <button class="flt-toggle" id="zug-sync-btn" onclick="zugSyncQueue()" title="Mitgliederliste mit Warteschlange abgleichen">⟳ Queue sync</button>
      </div>
    </div>
  </div>

  <!-- Calendar + Queue side by side (wraps on narrow screens) -->
  <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:start;">

    <!-- Calendar panel -->
    <div class="panel" id="zug-cal-panel" style="flex:2 1 340px;min-width:0;">
      <div class="panel-head">
        <div>
          <div class="panel-title" id="zug-cal-title">Kalender</div>
          <div class="panel-sub">Woche wählen, Termin planen oder bearbeiten</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="wt-btn" onclick="zugNavWeek(-1)" style="padding:8px 14px;font-size:20px;min-width:44px;">‹</button>
          <button class="wt-btn" onclick="zugNavWeek(1)" style="padding:8px 14px;font-size:20px;min-width:44px;">›</button>
          <button class="wt-btn" onclick="zugNavToday()" style="padding:8px 14px;font-size:12px;">Heute</button>
        </div>
      </div>
      <!-- Legend -->
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;margin-bottom:12px;color:var(--soft);">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(74,158,255,0.6);margin-right:4px;vertical-align:middle;"></span>Geplant</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(46,203,122,0.7);margin-right:4px;vertical-align:middle;"></span>Abgeschlossen</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(224,85,69,0.7);margin-right:4px;vertical-align:middle;"></span>No-Show</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(100,100,100,0.5);margin-right:4px;vertical-align:middle;"></span>Abgesagt</span>
      </div>
      <div id="zug-cal-grid"></div>
    </div>

    <!-- Queue panel -->
    <div class="panel" id="zug-queue-panel" style="flex:1 1 260px;">
      <div class="panel-head">
        <div>
          <div class="panel-title">Warteschlange</div>
          <div class="panel-sub">Nächster oben</div>
        </div>
      </div>
      <div id="zug-queue-list" style="display:flex;flex-direction:column;gap:4px;min-height:40px;"></div>
    </div>

    <!-- Planned panel -->
    <div class="panel" id="zug-planned-panel" style="flex:2 1 340px;min-width:0;">
      <div class="panel-head">
        <div>
          <div class="panel-title">BEREITS GEPLANT</div>
          <div class="panel-sub">Zur schnellen Kontrolle</div>
        </div>
      </div>
      <div id="zug-planned-list" style="display:flex;flex-direction:column;gap:4px;min-height:40px;"></div>
    </div>
  </div>

  <!-- Event form dialog (shown on day click) -->
  <div id="zug-event-overlay" style="display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.55);align-items:center;justify-content:center;">
    <div style="background:var(--card);border:1px solid var(--line2);border-radius:16px;padding:22px;min-width:320px;max-width:440px;width:90%;position:relative;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="font-family:'Rajdhani',sans-serif;font-size:19px;letter-spacing:1px;" id="zug-ev-title">Termin</div>
        <button class="editor-close" onclick="zugCloseEventForm()">✕</button>
      </div>
      <div id="zug-ev-date-display" style="font-size:13px;color:var(--gold);margin-bottom:14px;"></div>

      <!-- existing entry controls -->
      <div id="zug-ev-existing" style="display:none;">
        <div style="margin-bottom:12px;">
          <div class="vlabel">Schaffner</div>
          <div id="zug-ev-info-schaffner" style="font-size:13px;font-weight:600;margin:4px 0 2px;"></div>
          <div class="vlabel" style="margin-top:8px;">VIP</div>
          <div id="zug-ev-info-vip" style="font-size:13px;margin:4px 0 2px;color:var(--soft);"></div>
          <div class="vlabel" style="margin-top:8px;">Status</div>
          <div id="zug-ev-info-status" style="margin:4px 0;"></div>
          <div id="zug-ev-info-notes" style="font-size:11px;color:var(--soft-2);margin-top:4px;"></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button class="save-btn" onclick="zugMarkCompleted()" style="background:rgba(46,203,122,0.2);color:#2ecb7a;border:1px solid rgba(46,203,122,0.35);padding:6px 14px;">✓ Abgeschlossen</button>
          <button class="save-btn" onclick="zugOpenNoShowForm()" style="background:rgba(224,85,69,0.2);color:#e05545;border:1px solid rgba(224,85,69,0.35);padding:6px 14px;">✗ No-Show</button>
          <button class="save-btn" onclick="zugEditExisting()" style="background:rgba(74,158,255,0.15);color:#4a9eff;border:1px solid rgba(74,158,255,0.3);padding:6px 14px;">✏ Bearbeiten</button>
          <button class="save-btn" onclick="zugDeleteEntry()" style="background:rgba(100,100,100,0.15);color:var(--soft);border:1px solid var(--line2);padding:6px 14px;">🗑 Löschen</button>
        </div>
      </div>

      <!-- no-show sub-form -->
      <div id="zug-ev-noshow" style="display:none;border-top:1px solid var(--line);padding-top:12px;margin-top:4px;">
        <div class="vlabel">Einspringer <span style="color:var(--soft-2);font-size:11px;">(optional)</span></div>
        <select class="vinput" id="zug-ev-sub-select" style="margin-bottom:8px;"></select>
        <div class="vlabel">Notiz</div>
        <input class="vinput" id="zug-ev-noshow-notes" placeholder="Begründung...">
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="save-btn" onclick="zugConfirmNoShow()" style="flex:1;width:auto;">Bestätigen</button>
          <button class="save-btn" onclick="zugCancelNoShow()" style="flex:0 0 auto;width:auto;padding-left:14px;padding-right:14px;background:var(--card2);color:var(--soft);border:1px solid var(--line2);">Abbrechen</button>
        </div>
      </div>

      <!-- create/edit form -->
      <div id="zug-ev-form" style="display:none;">
        <div style="margin-bottom:10px;">
          <div class="vlabel">Schaffner</div>
          <select class="vinput" id="zug-ev-schaffner"></select>
        </div>
        <div style="margin-bottom:10px;">
          <div class="vlabel">VIP <span style="color:var(--soft-2);font-size:11px;">(optional)</span></div>
          <select class="vinput" id="zug-ev-vip"></select>
        </div>
        <div style="margin-bottom:10px;">
          <div class="vlabel">Notiz <span style="color:var(--soft-2);font-size:11px;">(optional)</span></div>
          <input class="vinput" id="zug-ev-notes" placeholder="Kurze Notiz...">
        </div>
        <div style="display:flex;gap:8px;">
          <button class="save-btn" onclick="zugSaveEntry()" style="flex:1;width:auto;" id="zug-ev-save-btn">Speichern</button>
          <button class="save-btn" onclick="zugCancelEditForm()" style="flex:0 0 auto;width:auto;padding-left:14px;padding-right:14px;background:var(--card2);color:var(--soft);border:1px solid var(--line2);">Abbrechen</button>
        </div>
      </div>
    </div>
  </div>

</div>

<!-- ═══ BERUFEPLANNER ═══ -->
<div class="page" id="page-bp">
  <div class="panel" style="margin-bottom:1rem;">
    <div class="panel-head" style="flex-wrap:wrap;gap:8px;">
      <div>
        <div class="panel-title">⚗ <span data-i18n="s_bp_berufeplanner">Berufeplaner</span></div>
        <div class="panel-sub" data-i18n="s_bp_panel_sub">Kriegsherren und Ingenieure per Drag-and-drop zuordnen</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;">
        <label style="font-size:12px;color:var(--soft);" data-i18n="s_bp_sort_label">Sortierung:</label>
        <select id="bp-sort-select" onchange="berufePlannerSetSort(this.value)" style="background:var(--card2);color:var(--text);border:1px solid var(--line2);border-radius:6px;padding:4px 10px;font-size:12px;">
          <option value="asc" data-i18n="s_bp_sort_az">Kriegsherr A-Z</option>
          <option value="desc" data-i18n="s_bp_sort_za">Kriegsherr Z-A</option>
          <option value="count_desc" data-i18n="s_bp_sort_most">Meiste Ingenieure zuerst</option>
          <option value="count_asc" data-i18n="s_bp_sort_least">Wenigste Ingenieure zuerst</option>
        </select>
        <button class="wt-btn" onclick="berufePlannerLoadPage()" style="padding:6px 12px;font-size:12px;">↻ <span data-i18n="s_bp_reload">Neu laden</span></button>
        <button class="wt-btn" id="bp-mail-btn" onclick="berufePlannerCopyMail(this)" style="padding:6px 12px;font-size:12px;">✉ <span data-i18n="s_bp_alliance_mail">Allianzmail</span></button>
      </div>
    </div>
  </div>

  <div class="bp-layout">
    <div class="panel bp-queue-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title" data-i18n="s_bp_queue_title">Warteschlange</div>
          <div class="panel-sub" data-i18n="s_bp_queue_sub">Mitglieder ohne Zuordnung</div>
        </div>
      </div>
      <div id="bp-queue" class="bp-queue-list"></div>
    </div>

    <div class="panel bp-grid-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title" id="bp-grid-title" data-i18n="s_bp_kriegsherren_und_ingenieure">Kriegsherren und Ingenieure</div>
          <div class="panel-sub" id="bp-grid-sub" data-i18n="s_bp_grid_sub">Ziehe Mitglieder aus der Warteschlange in die linke Spalte (Kriegsherr) oder in Ingenieur-Slots.</div>
        </div>
      </div>
      <div id="bp-grid"></div>
    </div>
  </div>
</div>

<!-- ═══ DASHBOARD ═══ -->
<div class="page" id="page-d">

  <div class="kw-nav" style="margin-bottom:1rem;">
    <button class="kw-btn" type="button" onclick="changeYearWeek(-1)" title="Vorherige Woche">‹</button>
    <div class="kw-wrap"><label>KW</label><span class="kw-val">--</span></div>
    <button class="kw-btn" type="button" onclick="changeYearWeek(1)" title="Nächste Woche">›</button>
  </div>

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
        <thead><tr><th>#</th><th>Mitglied</th><th>Rank</th><th>Tendenz</th><th>Features</th><th>Status</th></tr></thead>
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
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="kw-nav">
          <button class="kw-btn" type="button" onclick="changeYearWeek(-1)" title="Vorherige Woche">‹</button>
          <div class="kw-wrap"><label>KW</label><span class="kw-val">--</span></div>
          <button class="kw-btn" type="button" onclick="changeYearWeek(1)" title="Nächste Woche">›</button>
        </div>
        <button class="flt-toggle" id="btn-done-bottom" title="Erfasste Mitglieder ans Ende sortieren (nochmal klicken: ausblenden)" onclick="toggleDoneMode()">↓ Erfasste ans Ende</button>
      </div>
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
      <div class="kw-nav" style="margin-left:auto;">
        <button class="kw-btn" type="button" onclick="changeYearWeek(-1)" title="Vorherige Woche">‹</button>
        <div class="kw-wrap"><label>KW</label><span class="kw-val">--</span></div>
        <button class="kw-btn" type="button" onclick="changeYearWeek(1)" title="Nächste Woche">›</button>
      </div>
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
        <span><span style="color:var(--red);">⚠</span> unter 43,2 Mio (Strafe)</span>
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
      <div class="panel-title">📊 <span>Rang-Empfehlungen</span></div>
      <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
        <label style="font-size:0.85rem;color:var(--muted);">Wochen:</label>
        <select id="ergebnis-weeks" style="background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:0.85rem;">
          <option value="3">3</option>
          <option value="4" selected>4</option>
          <option value="5">5</option>
          <option value="6">6</option>
        </select>
        <button class="wt-btn" onclick="loadErgebnis()" style="padding:5px 14px;">🔄 <span>Laden</span></button>
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
    <div id="ergebnis-empty" style="display:none;color:var(--muted);text-align:center;padding:24px;">Keine Daten vorhanden</div>
    <div id="ergebnis-table-wrap" style="overflow-x:auto;"></div>
  </div>
</div>

<!-- ═══ VERWALTUNG ═══ -->
<div class="page" id="page-v">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">

    <!-- ADD MEMBER -->
    <div class="panel">
      <div class="panel-head"><div class="panel-title">➕ <span data-i18n="s_mitglied_hinzufuegen">Mitglied hinzufügen</span></div></div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <div class="vlabel">Name</div>
          <input class="vinput" id="v-new-name" placeholder="Spielername..." type="text">
        </div>
        <div>
          <div class="vlabel"><span data-i18n="s_discord_id">Discord-ID</span> <span data-i18n="s_optional" style="color:var(--soft);font-size:11px;font-weight:400">(optional)</span></div>
          <input class="vinput" id="v-new-discord" placeholder="z.B. 123456789012345678" type="text" inputmode="numeric">
        </div>
        <div>
          <div class="vlabel" data-i18n="s_rang">Rang</div>
          <div style="display:flex;gap:6px;">
            <button class="vrank-btn" data-vr="1">1 · Rookie</button>
            <button class="vrank-btn" data-vr="2">2 · Pro</button>
            <button class="vrank-btn on" data-vr="3">3 · Elite</button>
            <button class="vrank-btn" data-vr="4">4 · Leader</button>
            <button class="vrank-btn" data-vr="5">5 · <span data-i18n="s_chef">Chef</span></button>
          </div>
        </div>
        <button class="save-btn" id="v-add-btn" style="margin-top:4px;">+ <span data-i18n="s_hinzufuegen">Hinzufügen</span></button>
      </div>
    </div>

    <!-- STATS -->
    <div class="panel">
      <div class="panel-head"><div class="panel-title">📊 <span data-i18n="s_uebersicht">Übersicht</span></div></div>
      <div id="v-stats" style="display:flex;flex-direction:column;gap:8px;"></div>
    </div>

  </div>

  <div class="panel" style="margin-top:1rem;">
    <div class="panel-head">
      <div class="panel-title">📝 <span data-i18n="s_login_anfragen">Login-Anfragen</span></div>
      <div class="panel-sub" id="v-access-count">0 offen</div>
    </div>
    <div id="v-access-requests" class="v-access-list"></div>
  </div>

  <!-- MEMBER TABLE -->
  <div class="panel" style="margin-top:1rem;">
    <div class="panel-head">
      <div class="panel-title">👥 <span data-i18n="s_mitgliederliste">Mitgliederliste</span></div>
      <div class="kw-nav" style="margin-left:auto;margin-right:8px;">
        <button class="kw-btn" type="button" onclick="changeYearWeek(-1)" title="Vorherige Woche">‹</button>
        <div class="kw-wrap"><label>KW</label><span class="kw-val">--</span></div>
        <button class="kw-btn" type="button" onclick="changeYearWeek(1)" title="Nächste Woche">›</button>
      </div>
      <input class="search-input" id="v-search" placeholder="Suchen..." style="width:200px;">
    </div>
    <div id="v-list"></div>
  </div>

  <!-- SE AUSWERTUNG -->
  <div class="panel" style="margin-top:1rem;">
    <div class="panel-head">
      <div class="panel-title">🔍 <span>Kein Spezialevent in letzten Wochen</span></div>
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

  <!-- FEATURE CONFIG -->
  <div class="panel" style="margin-top:1rem;">
    <div class="panel-head">
      <div class="panel-title">✨ <span>Feature-Konfiguration</span></div>
      <div class="panel-sub">Legt fest welche Features erfasst und ausgewertet werden</div>
    </div>
    <div id="v-flag-config"><div class="empty">Lade …</div></div>
  </div>

</div>
