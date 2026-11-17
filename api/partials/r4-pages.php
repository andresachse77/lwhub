<?php // R4 Pages – nur nach verifiziertem Rank ≥4 ausgeliefert
// Leiste der Auswertungen: oben im Dashboard (page-d) und in page-r, $active = aktive Ansicht
$auNav = function (string $active) use ($member): string {
    $items = [['dashboard', '📋', 's_dashboard', 'Dashboard'], ['punkte', '🏅', 's_punkte_uebersicht', 'Punkte-Übersicht'],
        ['se', '💤', 's_se_inactive_nav', 'Spezial verpasst']];
    if (scannerViewAllowed($member)) {
        $items[] = ['trend', '📈', 's_scanner_trend', 'Kampfkraft-Trend'];
        $items[] = ['events', '⚔', 's_server_events', 'Server-Events'];
    }
    $html = '<div class="filter-row au-nav au-mb-12">';
    foreach ($items as [$key, $icon, $i18n, $label]) {
        $html .= '<button class="flt' . ($key === $active ? ' on' : '') . '" data-au="' . $key . '" data-action="auOpen" data-args="' . htmlspecialchars(json_encode([$key]), ENT_QUOTES) . '">'
            . $icon . ' <span data-i18n="' . $i18n . '">' . $label . '</span></button>';
    }
    return $html . '</div>';
};
?>

<!-- ═══ ZUG ═══ -->
<div class="page" id="page-z">

  <!-- Top controls -->
  <div class="panel zug-mb-1rem">
    <div class="panel-head zug-head-wrap">
      <div class="panel-title zug-c-text"><svg class="zug-title-icon" xmlns="http://www.w3.org/2000/svg" width="30" height="16" viewBox="0 0 38 20"><circle cx="9" cy="2.2" r="2" fill="rgba(255,255,255,0.42)"/><circle cx="13.5" cy="0.9" r="1.2" fill="rgba(255,255,255,0.28)"/><rect x="6.5" y="3" width="4" height="4.5" rx="0.8" fill="#B87300"/><rect x="1" y="6.5" width="22" height="9" rx="4" fill="#F0A500"/><rect x="2" y="7.2" width="19" height="3.2" rx="2" fill="rgba(255,230,90,0.38)"/><rect x="19" y="3.5" width="10" height="12" rx="1.5" fill="#D4890A"/><rect x="18" y="2.2" width="12" height="2.5" rx="1" fill="#B87300"/><rect x="21" y="5" width="5" height="4" rx="1" fill="#87CEEB" opacity="0.88"/><rect x="0" y="10.8" width="2" height="2.5" rx="0.4" fill="#9A6200"/><circle cx="8.5" cy="17" r="3.4" fill="#9A6200" stroke="#F0C040" stroke-width="1.1"/><circle cx="8.5" cy="17" r="1.3" fill="#C8820A"/><line x1="8.5" y1="13.6" x2="8.5" y2="20.4" stroke="#C8820A" stroke-width="0.7"/><line x1="5.1" y1="15" x2="11.9" y2="19" stroke="#C8820A" stroke-width="0.7"/><line x1="5.1" y1="19" x2="11.9" y2="15" stroke="#C8820A" stroke-width="0.7"/><circle cx="3" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/><circle cx="21" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/><circle cx="27" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/><rect x="3" y="16.3" width="25" height="1.5" rx="0.5" fill="#9A6200" opacity="0.6"/></svg> Zugplan</div>
      <div class="zug-head-tools">
        <button class="flt-toggle" id="zug-sync-btn" data-action="zugSyncQueue" title="Mitgliederliste mit Warteschlange abgleichen">⟳ Queue sync</button>
      </div>
    </div>
  </div>

  <!-- Calendar + Queue side by side (wraps on narrow screens) -->
  <div class="zug-layout">

    <!-- Calendar panel -->
    <div class="panel zug-col-wide" id="zug-cal-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title" id="zug-cal-title">Kalender</div>
          <div class="panel-sub">Woche wählen, Termin planen oder bearbeiten</div>
        </div>
        <div class="zug-nav-group">
          <button class="wt-btn zug-nav-arrow" data-action="zugNavWeek" data-args="[-1]">‹</button>
          <button class="wt-btn zug-nav-arrow" data-action="zugNavWeek" data-args="[1]">›</button>
          <button class="wt-btn zug-nav-today" data-action="zugNavToday">Heute</button>
        </div>
      </div>
      <!-- Legend -->
      <div class="zug-legend">
        <span><span class="zug-dot zug-dot-planned"></span>Geplant</span>
        <span><span class="zug-dot zug-dot-done"></span>Abgeschlossen</span>
        <span><span class="zug-dot zug-dot-noshow"></span>No-Show</span>
        <span><span class="zug-dot zug-dot-cancelled"></span>Abgesagt</span>
      </div>
      <div id="zug-cal-grid"></div>
    </div>

    <!-- Queue panel -->
    <div class="panel zug-col-narrow" id="zug-queue-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">Warteschlange</div>
          <div class="panel-sub">Nächster oben</div>
        </div>
      </div>
      <div class="zug-list-col" id="zug-queue-list"></div>
    </div>

    <!-- Planned panel -->
    <div class="panel zug-col-wide" id="zug-planned-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">BEREITS GEPLANT</div>
          <div class="panel-sub">Zur schnellen Kontrolle</div>
        </div>
      </div>
      <div class="zug-list-col" id="zug-planned-list"></div>
    </div>
  </div>

  <!-- Event form dialog (shown on day click) -->
  <div class="zug-overlay" id="zug-event-overlay">
    <div class="zug-dialog">
      <div class="zug-dlg-head">
        <div class="zug-dlg-title" id="zug-ev-title">Termin</div>
        <button class="editor-close" data-action="zugCloseEventForm">✕</button>
      </div>
      <div class="zug-date-line" id="zug-ev-date-display"></div>

      <!-- existing entry controls -->
      <div class="zug-start-hidden" id="zug-ev-existing">
        <div class="zug-mb-12">
          <div class="vlabel">Schaffner</div>
          <div class="zug-info-name" id="zug-ev-info-schaffner"></div>
          <div class="vlabel zug-mt-8">VIP</div>
          <div class="zug-info-vip" id="zug-ev-info-vip"></div>
          <div class="vlabel zug-mt-8">Status</div>
          <div class="zug-info-status" id="zug-ev-info-status"></div>
          <div class="zug-info-notes" id="zug-ev-info-notes"></div>
        </div>
        <div class="zug-action-row">
          <button class="save-btn zug-btn-done" data-action="zugMarkCompleted">✓ Abgeschlossen</button>
          <button class="save-btn zug-btn-noshow" data-action="zugOpenNoShowForm">✗ No-Show</button>
          <button class="save-btn zug-btn-edit" data-action="zugEditExisting">✏ Bearbeiten</button>
          <button class="save-btn zug-btn-delete" data-action="zugDeleteEntry">🗑 Löschen</button>
        </div>
      </div>

      <!-- no-show sub-form -->
      <div class="zug-noshow-box" id="zug-ev-noshow">
        <div class="vlabel">Einspringer <span class="zug-optional">(optional)</span></div>
        <select class="vinput zug-mb-8" id="zug-ev-sub-select"></select>
        <div class="vlabel">Notiz</div>
        <input class="vinput" id="zug-ev-noshow-notes" placeholder="Begründung...">
        <div class="zug-btn-row-top">
          <button class="save-btn zug-btn-grow" data-action="zugConfirmNoShow">Bestätigen</button>
          <button class="save-btn zug-btn-cancel" data-action="zugCancelNoShow">Abbrechen</button>
        </div>
      </div>

      <!-- create/edit form -->
      <div class="zug-start-hidden" id="zug-ev-form">
        <div class="zug-mb-10">
          <div class="vlabel">Schaffner</div>
          <select class="vinput" id="zug-ev-schaffner"></select>
        </div>
        <div class="zug-mb-10">
          <div class="vlabel">VIP <span class="zug-optional">(optional)</span></div>
          <select class="vinput" id="zug-ev-vip"></select>
        </div>
        <div class="zug-mb-10">
          <div class="vlabel">Notiz <span class="zug-optional">(optional)</span></div>
          <input class="vinput" id="zug-ev-notes" placeholder="Kurze Notiz...">
        </div>
        <div class="zug-btn-row">
          <button class="save-btn zug-btn-grow" data-action="zugSaveEntry" id="zug-ev-save-btn">Speichern</button>
          <button class="save-btn zug-btn-cancel" data-action="zugCancelEditForm">Abbrechen</button>
        </div>
      </div>
    </div>
  </div>

</div>

<!-- ═══ BERUFEPLANNER ═══ -->
<div class="page" id="page-bp">
  <div class="panel bp-mb-1rem">
    <div class="panel-head bp-head-wrap">
      <div>
        <div class="panel-title">👷 <span data-i18n="s_bp_berufeplanner">Berufeplaner</span></div>
        <div class="panel-sub" data-i18n="s_bp_panel_sub">Kriegsanführer und Ingenieure per Drag-and-drop zuordnen</div>
      </div>
      <div class="bp-head-tools">
        <div class="bp-rc" id="bp-rc">
          <label><input type="checkbox" id="bp-rc-on" data-on-change="bpSaveRankCheck"> <span data-i18n="s_bp_rc_label">Rangcheck R2/R3</span></label>
          <select id="bp-rc-r2" data-on-change="bpSaveRankCheck">
            <option value="ingenieur" data-i18n="s_bp_rc_r2_ing">R2 = Ingenieur</option>
            <option value="kriegsherr" data-i18n="s_bp_rc_r2_kh">R2 = Kriegsanführer</option>
          </select>
          <button type="button" class="bp-wrong-count" id="bp-wrong-count" hidden data-action="bpJumpWrong"></button>
        </div>
        <div class="bp-view" id="bp-view" title="Ansicht">
          <button type="button" data-bpview="acc" data-action="bpSetView" data-args='["acc"]'>☰ <span data-i18n="s_bp_view_acc">Akkordeon</span></button>
          <button type="button" data-bpview="table" data-action="bpSetView" data-args='["table"]'>▦ <span data-i18n="s_bp_view_table">Tabelle</span></button>
        </div>
        <button class="wt-btn bp-tool-btn-nowrap" id="bp-acc-all" type="button" data-action="bpAccToggleAll"></button>
        <label class="bp-sort-label" data-i18n="s_bp_sort_label">Sortierung:</label>
        <select class="bp-sort-dropdown" id="bp-sort-select" data-on-change="berufePlannerSetSort" data-args-change='[{"$":"value"}]'>
          <option value="asc" data-i18n="s_bp_sort_az">Kriegsanführer A-Z</option>
          <option value="desc" data-i18n="s_bp_sort_za">Kriegsanführer Z-A</option>
          <option value="count_desc" data-i18n="s_bp_sort_most">Meiste Ingenieure zuerst</option>
          <option value="count_asc" data-i18n="s_bp_sort_least">Wenigste Ingenieure zuerst</option>
        </select>
        <button class="wt-btn bp-tool-btn-nowrap" data-action="berufePlannerLoadPage">↻ <span data-i18n="s_bp_reload">Neu laden</span></button>
        <button class="wt-btn bp-tool-btn-nowrap" id="bp-fill-btn" data-action="bpFillRest" data-args='[{"$":"el"}]'>🎲 <span data-i18n="s_bp_fill_btn">Automatisch aufteilen</span></button>
        <button class="wt-btn bp-tool-btn" id="bp-tpl-btn" data-action="bpOpenTemplates">✎ <span data-i18n="s_bp_tpl_btn">Fragetexte</span></button>
        <button class="wt-btn bp-tool-btn" id="bp-hist-btn" data-action="bpOpenHistory">🕘 <span data-i18n="s_bp_hist_btn">Verlauf</span></button>
        <button class="wt-btn bp-tool-btn" id="bp-mail-btn" data-action="berufePlannerCopyMail" data-args='[{"$":"el"}]'>✉ <span data-i18n="s_bp_alliance_mail">Allianzmail</span></button>
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
          <div class="panel-title" id="bp-grid-title" data-i18n="s_bp_kriegsherren_und_ingenieure">Kriegsanführer und Ingenieure</div>
          <div class="panel-sub" id="bp-grid-sub" data-i18n="s_bp_grid_sub">Ziehe Mitglieder aus der Warteschlange in die linke Spalte (Kriegsanführer) oder in Ingenieur-Slots.</div>
        </div>
      </div>
      <div id="bp-grid"></div>
    </div>
  </div>
</div>

<!-- ═══ DASHBOARD ═══ -->
<div class="page" id="page-d">
  <?= $auNav('dashboard') ?>

  <div class="kw-nav dash-mb-1rem">
    <button class="kw-btn" type="button" data-action="changeYearWeek" data-args="[-1]" title="Vorherige Woche">‹</button>
    <div class="kw-wrap"><label>KW</label><span class="kw-val">--</span></div>
    <button class="kw-btn" type="button" data-action="changeYearWeek" data-args="[1]" title="Nächste Woche">›</button>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-label">Erfasst</div><div class="stat-num g" id="s-count">0</div><div class="stat-sub" id="s-count-sub">von 100 Mitgliedern</div></div>
    <div class="stat"><div class="stat-label">Warnungen</div><div class="stat-num r" id="s-warn">0</div><div class="stat-sub">Strafpunkte aktiv</div></div>
    <div class="stat points-rank"><div class="stat-label">Aufsteiger</div><div class="stat-num gr" id="s-up">0</div><div class="stat-sub">Rank verbessert</div></div>
    <div class="stat points-rank"><div class="stat-label">Absteiger</div><div class="stat-num b" id="s-down">0</div><div class="stat-sub">Rank verschlechtert</div></div>
  </div>

  <div class="prog">
    <div class="prog-top"><span>Erfassungsfortschritt KW <span id="kw-d">15</span></span><span id="prog-pct">0%</span></div>
    <div class="prog-bar"><div class="prog-fill dash-prog-start" id="prog-fill"></div></div>
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
        <button class="flt points-rank" data-f="up">↑ Aufsteiger</button>
        <button class="flt points-rank" data-f="down">↓ Absteiger</button>
        <button class="flt" data-f="missing">○ Ausstehend</button>
      </div>
    </div>
    <div class="dash-scroll-x">
      <table class="rtable">
        <thead><tr><th>#</th><th>Mitglied</th><th>Rank</th><th class="points-rank">Tendenz</th><th>Features</th><th>Status</th></tr></thead>
        <tbody id="rankingBody"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ═══ EINGABE ═══ -->
<div class="page" id="page-e">

  <div class="search-bar">
    <div class="list-search-row">
      <input type="text" class="search-input" id="searchInput" placeholder="🔍  Mitglied suchen...">
      <span class="list-counter" id="listCounter"></span>
    </div>
    <div class="filter-row list-filter-bar">
      <div class="list-filter-group">
        <button class="flt on" data-lf="all">Alle</button>
        <button class="flt" data-lf="missing">○ Ausstehend</button>
        <button class="flt" data-lf="done">✓ Erfasst</button>
      </div>
      <div class="list-kw-tools">
        <div class="kw-nav">
          <button class="kw-btn" type="button" data-action="changeYearWeek" data-args="[-1]" title="Vorherige Woche">‹</button>
          <div class="kw-wrap"><label>KW</label><span class="kw-val">--</span></div>
          <button class="kw-btn" type="button" data-action="changeYearWeek" data-args="[1]" title="Nächste Woche">›</button>
        </div>
        <button class="flt-toggle" id="btn-done-bottom" title="Erfasste Mitglieder ans Ende sortieren (nochmal klicken: ausblenden)" data-action="toggleDoneMode">↓ Erfasste ans Ende</button>
      </div>
    </div>
  </div>

  <!-- EDITOR -->
  <div class="editor-wrap" id="editor">
    <div class="editor-header">
      <div class="editor-name" id="editorName"></div>
      <!-- Jede Aenderung speichert sofort (data.js, edScheduleSave), hier steht der Stand -->
      <span class="editor-save-state" id="editorSaveState" aria-live="polite"></span>
      <button class="editor-close" id="editorClose">✕</button>
    </div>

    <div class="list-rank-label">Rank</div>
    <div class="rank-selector" id="rankRow">
      <div class="rk-btn" data-r="1"><div class="rk-num">1</div><div class="rk-lbl" data-rank-name="1">Rookie</div></div>
      <div class="rk-btn" data-r="2"><div class="rk-num">2</div><div class="rk-lbl" data-rank-name="2">Pro</div></div>
      <div class="rk-btn on" data-r="3"><div class="rk-num">3</div><div class="rk-lbl" data-rank-name="3">Elite</div></div>
      <div class="rk-btn" data-r="4"><div class="rk-num">4</div><div class="rk-lbl" data-rank-name="4">Leader</div></div>
      <div class="rk-btn" data-r="5"><div class="rk-num">5</div><div class="rk-lbl" data-rank-name="5">Chef</div></div>
    </div>
    <div class="fixed-note" id="fixedNote"></div>

    <div class="flag-cats" id="flagCats"></div>
    <button class="save-btn" id="saveBtn" title="Änderungen sind schon gespeichert. Ohne Flags wird das Mitglied mit 0 Punkten erfasst.">✓ Fertig</button>
  </div>

  <div class="member-list" id="memberList"></div>
</div>

<!-- ═══ WACHE ═══ -->
<div class="page" id="page-w">
  <div class="panel">
    <div class="panel-head">
      <div class="panel-title">🧩 Events</div>
      <div class="kw-nav ev-push-right">
        <button class="kw-btn" type="button" data-action="changeYearWeek" data-args="[-1]" title="Vorherige Woche">‹</button>
        <div class="kw-wrap"><label>KW</label><span class="kw-val">--</span></div>
        <button class="kw-btn" type="button" data-action="changeYearWeek" data-args="[1]" title="Nächste Woche">›</button>
      </div>
    </div>

    <div class="ev-tab-bar">
      <div class="wache-tabs">
        <button class="wache-tab on" data-ev="w1" data-action="selectEventView" data-args='["w1",true]'>Wache 1</button>
        <button class="wache-tab" data-ev="w2" data-action="selectEventView" data-args='["w2",true]'>Wache 2</button>
        <button class="wache-tab" data-ev="w3" data-action="selectEventView" data-args='["w3",true]'>Wache 3</button>
        <button class="wache-tab" data-ev="wu" data-action="selectEventView" data-args='["wu",true]'>Wüste</button>
        <button class="wache-tab" data-ev="se" data-action="selectEventView" data-args='["se",true]'>Spezial</button>
        <button class="wache-tab" data-ev="vs" data-action="selectEventView" data-args='["vs",true]'>VS</button>
        <button class="wache-tab" data-ev="sp" data-action="selectEventView" data-args='["sp",true]'>Spenden</button>
      </div>
      <div class="ev-toggle-row">
        <button class="flt-toggle" id="btn-event-done-bottom" title="Erfasste ans Ende sortieren (nochmal: ausblenden)" data-action="toggleEventDoneMode">↓ Erfasste ans Ende</button>
        <button class="flt-toggle" id="btn-event-contrast" title="Hoeherer Kontrast fuer Event-Erfassung" data-action="toggleEventContrast">◐ High Contrast</button>
      </div>
    </div>

    <div class="event-section active" data-event="w">
      <div class="wache-legend">
        <span><span class="ev-c-red">⚠</span> <span data-i18n="s_ev_low_damage">wenig Schaden (&lt;2G)</span></span>
        <span><span class="ev-c-green">⚔</span> <span data-i18n="s_ev_good_damage">guter Schaden</span></span>
        <span><span class="ev-c-softer">○</span> <span data-i18n="s_ev_absent">nicht dabei</span></span>
        <span class="wache-counter ev-push-right" id="w-counter">0 / 0</span>
      </div>
      <div class="wache-grid" id="wache-grid"></div>
    </div>

    <div class="event-section" data-event="wu">
      <div class="wache-legend">
        <span><span class="ev-c-blue">📋</span> <span data-i18n="s_ev_signup">Anmeldung</span></span>
        <span><span class="ev-c-green">⚔</span> <span data-i18n="s_ev_participation">Teilnahme</span></span>
        <span><span class="ev-c-red">⚠</span> <span data-i18n="s_ev_missing_penalty">Fehlen (Strafe)</span></span>
        <span class="wache-counter ev-push-right" id="wu-counter">0 / 0</span>
      </div>
      <div class="wache-grid" id="wueste-grid"></div>
    </div>

    <div class="event-section" data-event="se">
      <!-- Spezialevent dieser KW: gilt fuer alle Allianzen desselben Servers (Server-Nr. im Feature-Fenster) -->
      <div class="se-plan" id="se-plan">
        <input type="text" id="se-ev-title" list="se-ev-titles" maxlength="100" placeholder="Welches Event?" title="Name des Spezialevents (wechselt wöchentlich)">
        <datalist id="se-ev-titles"></datalist>
        <input type="date" id="se-scan-date" title="Tag des Events">
        <input type="time" id="se-scan-start" value="16:00" title="Start des Events">
        <span>–</span>
        <input type="time" id="se-scan-end" value="20:00" title="Ende des Events">
        <span class="ev-server-time" id="se-server-time" title="Im Spiel gilt die Serverzeit (UTC−2); bei uns verschiebt sie sich mit der Zeitumstellung"></span>
        <button class="flt-toggle" data-action="spezialSaveEvent" title="Event für diese KW festlegen (für alle Allianzen des Servers)">💾 <span>Festlegen</span></button>
        <button class="flt-toggle" id="se-btn-none" data-action="spezialSetNoEvent" title="In dieser KW gibt es auf dem Server kein Spezialevent">🚫 <span>Kein Event</span></button>
        <button class="flt-toggle" id="se-btn-skip" data-action="spezialToggleSkip" title="Unsere Allianz wertet das Event dieser KW nicht aus (nur für diese Allianz)">⏸ <span>Nicht auswerten</span></button>
        <?php if (scannerTabAllowed($member)): ?>
        <button class="flt-toggle" id="se-btn-import" data-action="spezialImportFromScanner" title="Häkchen dieser KW aus der Vorher/Nachher-Auswertung setzen: Kills oder Kampfkraft-Verlust = Teilnahme, nach Kills Platz 1–50 Top 50, Platz 1–20 Top 20">📸 <span data-i18n="s_vs_from_scanner">Aus Scanner übernehmen</span></button>
        <button class="flt-toggle" id="se-scan-eval" data-action="auOpen" data-args='["events"]' title="Vorher/Nachher-Auswertung öffnen (Auswertungen → Server-Events)">🔍</button>
        <?php endif; ?>
        <span class="se-plan-status" id="se-plan-status"></span>
      </div>
      <div class="wache-legend">
        <span><span class="ev-c-blue">⚔</span> <span data-i18n="s_ev_participation">Teilnahme</span></span>
        <span><span class="ev-c-green">🏅</span> Top 50</span>
        <span><span class="ev-c-gold">🏆</span> Top 20</span>
        <span class="wache-counter ev-push-right" id="se-counter">0 / 0</span>
      </div>
      <div class="se-off-banner" id="se-off-banner" hidden></div>
      <div class="wache-grid" id="spezial-grid"></div>
    </div>

    <div class="event-section" data-event="vs">
      <div class="wache-legend">
        <span class="vs-legend-normal"><span class="ev-c-red">⚠</span> <span data-i18n="s_vs_legend_under">unter 43,2 Mio (Strafe)</span></span>
        <span class="vs-legend-normal"><span class="ev-c-blue">🥈</span> <span data-i18n="s_vs_legend_top30">Top 30 (Bonus)</span></span>
        <span class="vs-legend-normal"><span class="ev-c-gold">🏆</span> <span data-i18n="s_vs_legend_top10">Top 10 (Bonus)</span></span>
        <span class="vs-legend-spar" hidden>🐷 <strong data-i18n="s_vs_sparwoche">Sparwoche</strong>: <span data-i18n="s_vs_spar_rule">höchstens 10 Mio je VS-Tag (Ziel 7,2 Mio) → Bonus · darüber kein Bonus · keine Strafe</span></span>
        <?php if (scannerTabAllowed($member)): ?>
        <button class="flt-toggle ev-push-right" id="vs-spar-toggle" data-action="vsToggleSparwoche" title="Diese KW als Sparwoche festlegen bzw. aufheben">🐷 <span data-i18n="s_vs_sparwoche">Sparwoche</span></button>
        <button class="flt-toggle" data-action="vsImportFromScanner" title="Häkchen dieser KW aus den gescannten VS-Wochenpunkten setzen: Platz 1–10 Top 10, Platz 1–30 Top 30, unter 43,2 Mio Strafe">📸 <span data-i18n="s_vs_from_scanner">Aus Scanner übernehmen</span></button>
        <?php endif; ?>
        <span class="wache-counter ev-push-right" id="vs-counter">0 / 0</span>
      </div>
      <div class="wache-grid" id="vs-grid"></div>
    </div>

    <div class="event-section" data-event="sp">
      <div class="wache-legend">
        <span><span class="ev-c-red">⚠</span> <span data-i18n="s_ev_under35k">unter 35K (Strafe)</span></span>
        <span><span class="ev-c-blue">🏅</span> <span data-i18n="s_ev_top20_bonus">Top 20 (Bonus)</span></span>
        <?php if (scannerTabAllowed($member)): ?>
        <span id="sp-scan-stand" class="se-scan-form ev-scan-stand" title="Letzter Spenden-Scan der gewählten KW – übernommen wird immer dieser Stand"></span>
        <button class="flt-toggle" data-action="spendeImportFromScanner" title="Häkchen dieser KW aus den gescannten Wochenspenden setzen: Platz 1–20 Top 20, unter 35K Strafe">📸 <span data-i18n="s_vs_from_scanner">Aus Scanner übernehmen</span></button>
        <?php endif; ?>
        <span class="wache-counter ev-push-right" id="sp-counter">0 / 0</span>
      </div>
      <div class="wache-grid" id="spende-grid"></div>
    </div>
  </div>
</div>

<!-- ═══ ERGEBNIS ═══ -->
<!-- ═══ AUSWERTUNGEN: Punkte-Uebersicht (mit Rang-Empfehlungen nur bei Rang nach Punkten), Trend, Server-Events ═══ -->
<div class="page" id="page-r">
  <?= $auNav('punkte') ?>
  <?php if (scannerViewAllowed($member)): ?>
  <!-- Trend und Event-Auswertung aus dem Scanner, erst beim ersten Oeffnen geladen (auShow) -->
  <div id="au-trend" hidden>
    <iframe class="au-frame" data-src="web-scanner-onnx/trend.html" title="Kampfkraft-Trend"></iframe>
  </div>
  <div id="au-events" hidden>
    <iframe class="au-frame" data-src="web-scanner-onnx/event.html" title="Server-Events"></iframe>
  </div>
  <?php endif; ?>
  <!-- Kein Spezialevent in letzten Wochen (frueher in der Verwaltung), laedt beim Oeffnen (auShow) -->
  <div class="panel au-full-width" id="au-se" hidden>
    <div class="panel-head">
      <div class="panel-title">🔍 <span>Kein Spezialevent in letzten Wochen</span></div>
      <div class="au-head-ctrl">
        <label class="au-se-weeks-label">Wochen:</label>
        <select class="au-se-weeks-select" id="se-weeks-select" data-on-change="loadSeInactive">
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4" selected>4</option>
          <option value="5">5</option>
          <option value="6">6</option>
        </select>
        <button class="save-btn au-reload-btn" data-action="loadSeInactive" title="Neu laden">↻</button>
      </div>
    </div>
    <div class="au-result-pad" id="se-inactive-result"></div>
  </div>
  <div class="panel au-full-width" id="au-punkte">
    <div class="panel-head au-head-row">
      <div class="panel-title">🏅 <span id="ergebnis-title">Punkte-Übersicht</span></div>
      <div class="au-head-ctrl-right">
        <label class="au-weeks-label">Wochen:</label>
        <select class="au-weeks-select" id="ergebnis-weeks">
          <option value="3">3</option>
          <option value="4" selected>4</option>
          <option value="5">5</option>
          <option value="6">6</option>
        </select>
        <button class="wt-btn au-load-btn" data-action="loadErgebnis">🔄 <span>Laden</span></button>
      </div>
    </div>
    <div class="au-legend" id="ergebnis-legend">
      <span><span class="au-dot au-dot-promote"></span>Beförderung empfohlen (≥2 Wochen stabil)</span>
      <span><span class="au-dot au-dot-demote"></span>Herabstufung empfohlen (&gt;2 Wochen schlecht)</span>
      <span><span class="au-dot au-dot-afk"></span>AFK (sperrt Rang-Änderung)</span>
      <span><span class="au-dot au-dot-none"></span>Keine Daten vorhanden</span>
    </div>
    <div class="au-state-msg" id="ergebnis-loading">Lade Daten…</div>
    <div class="au-info-box" id="ergebnis-info"></div>
    <div class="au-state-msg" id="ergebnis-empty">Keine Daten vorhanden</div>
    <div class="au-scroll-x" id="ergebnis-table-wrap"></div>
  </div>
</div>

<!-- ═══ VERWALTUNG ═══ -->
<div class="page" id="page-v">
  <!-- MITGLIEDER: Liste + Mitglied (docs/konzept-verwaltung-ux.html, Variante B; members.js) -->
  <div class="panel v-member-panel">
    <div class="panel-head">
      <div class="panel-title">👥 <span data-i18n="s_mitgliederliste">Mitgliederliste</span></div>
      <div class="kw-nav v-kw-push">
        <button class="kw-btn" type="button" data-action="changeYearWeek" data-args="[-1]" title="Vorherige Woche">‹</button>
        <div class="kw-wrap"><label>KW</label><span class="kw-val">--</span></div>
        <button class="kw-btn" type="button" data-action="changeYearWeek" data-args="[1]" title="Nächste Woche">›</button>
      </div>
      <input class="search-input v-search-narrow vm-search" id="v-search" type="search" placeholder="Suchen (auch frühere Namen)">
    </div>
    <div class="vm-filters" id="v-filters"></div>
    <div class="vm-layout" id="v-layout">
      <div class="vm-list" id="v-list"></div>
      <div class="vm-detail" id="v-detail"></div>
    </div>
  </div>
  <div class="v-top-grid v-panel-gap">

    <!-- ADD MEMBER -->
    <div class="panel">
      <div class="panel-head"><div class="panel-title">➕ <span data-i18n="s_mitglied_hinzufuegen">Mitglied hinzufügen</span></div></div>
      <div class="v-add-form">
        <div>
          <div class="vlabel">Name</div>
          <input class="vinput" id="v-new-name" placeholder="Spielername..." type="text">
        </div>
        <div>
          <div class="vlabel"><span data-i18n="s_discord_id">Discord-ID</span> <span class="v-opt-note" data-i18n="s_optional">(optional)</span></div>
          <input class="vinput" id="v-new-discord" placeholder="z.B. 123456789012345678" type="text" inputmode="numeric">
        </div>
        <div>
          <div class="vlabel" data-i18n="s_rang">Rang</div>
          <div class="v-rank-row">
            <button class="vrank-btn" data-vr="1">1 · <span data-rank-name="1">Rookie</span></button>
            <button class="vrank-btn" data-vr="2">2 · <span data-rank-name="2">Pro</span></button>
            <button class="vrank-btn on" data-vr="3">3 · <span data-rank-name="3">Elite</span></button>
            <button class="vrank-btn" data-vr="4">4 · <span data-rank-name="4">Leader</span></button>
            <button class="vrank-btn" data-vr="5">5 · <span data-rank-name="5">Chef</span></button>
            <button class="vrank-btn" data-vr="honor" title="Gast aus einer anderen Allianz: sieht alles wie ein R4, ändert nichts, zählt nirgends mit">👁 <span data-i18n="s_ehren_r4">Ehren-R4</span></button>
          </div>
        </div>
        <div id="v-new-home-wrap" hidden>
          <div class="vlabel"><span data-i18n="s_heimat_allianz">Heimat-Allianz</span></div>
          <input class="vinput" id="v-new-home" list="v-alliance-list" placeholder="z. B. IvX" type="text" maxlength="50">
          <datalist id="v-alliance-list"></datalist>
          <div class="v-field-hint" data-i18n="s_ehren_r4_hint">Ehren-R4 sehen alles wie ein R4, können aber nichts ändern und zählen nirgends mit. Die Discord-ID ist Pflicht, damit sie sich anmelden können.</div>
        </div>
        <button class="save-btn v-mt-4" id="v-add-btn">+ <span data-i18n="s_hinzufuegen">Hinzufügen</span></button>
      </div>
    </div>

    <!-- STATS -->
    <div class="panel">
      <div class="panel-head"><div class="panel-title">📊 <span data-i18n="s_uebersicht">Übersicht</span></div></div>
      <div class="v-stats-col" id="v-stats"></div>
    </div>

  </div>

  <div class="panel v-panel-gap">
    <div class="panel-head">
      <div class="panel-title">📝 <span data-i18n="s_login_anfragen">Login-Anfragen</span></div>
      <div class="panel-sub" id="v-access-count">0 offen</div>
    </div>
    <div id="v-access-requests" class="v-access-list"></div>
  </div>




  <!-- DOKUMENTE: Planung API, Scanner und Android-App -->
  <div class="panel v-panel-gap">
    <div class="panel-head">
      <div class="panel-title">📄 <span data-i18n="s_docs_title">Konzept &amp; Aufgaben</span></div>
      <div class="panel-sub" data-i18n="s_docs_sub">API, Scanner, Android-App und Berufe-Rangcheck: Planung und Stand</div>
    </div>
    <div class="v-link-row">
      <a class="wt-btn v-doc-btn" href="docs/handbuch/" target="_blank" rel="noopener">📖 <span data-i18n="s_docs_handbook">Handbuch</span></a>
      <a class="wt-btn v-doc-btn" href="docs/konzept-api-scanner-v2.html" target="_blank" rel="noopener">📐 <span data-i18n="s_docs_concept">Konzept v2</span></a>
      <a class="wt-btn v-doc-btn" href="docs/konzept-api-scanner-v2-aufgaben.html" target="_blank" rel="noopener">✅ <span data-i18n="s_docs_tasks">Aufgabenliste</span></a>
      <a class="wt-btn v-doc-btn" href="docs/konzept-berufe-rangcheck.html" target="_blank" rel="noopener">👷 <span data-i18n="s_docs_bp_concept">Berufe-Rangcheck</span></a>
      <a class="wt-btn v-doc-btn" href="docs/konzept-berufe-rangcheck-aufgaben.html" target="_blank" rel="noopener">✅ <span data-i18n="s_docs_bp_tasks">Aufgaben Berufe</span></a>
      <a class="wt-btn v-doc-btn" href="docs/konzept-berufe-mobil.html" target="_blank" rel="noopener">📱 <span data-i18n="s_docs_bp_mobile">Berufeplaner mobil</span></a>
      <a class="wt-btn v-doc-btn" href="docs/konzept-frontend-umbau.html" target="_blank" rel="noopener">🧩 <span data-i18n="s_docs_frontend">Umbau Startseite</span></a>
      <a class="wt-btn v-doc-btn" href="docs/konzept-verwaltung-ux.html" target="_blank" rel="noopener">🧑‍💼 <span data-i18n="s_docs_admin_ux">Verwaltung neu</span></a>
    </div>
  </div>

</div>

<?php if (scannerViewAllowed($member)): $canScan = scannerTabAllowed($member); ?>
<!-- ═══ SCANNER (web-scanner-onnx, OCR im Browser) – iframe wird erst beim ersten Oeffnen geladen ═══ -->
<!-- Ehren-R4 und Betreiber-Zuschauer sehen nur den Kampfkraft-Trend, scannen und hochladen koennen sie nicht -->
<div class="page" id="page-sc">
  <iframe id="scanner-frame" data-src="web-scanner-onnx/<?= $canScan ? 'index.html' : 'trend.html' ?>" title="Scanner" allow="display-capture"></iframe>
</div>
<?php endif; ?>

<!-- ── Berufeplaner-Dialoge (pages/jobs.js) ── -->
<div class="modal-bg hidden" id="modal-bp-ask">
  <div class="modal">
    <div class="modal-title">✉ <span data-i18n="s_bp_ask_title">Spieler fragen</span>: <span id="bp-ask-name" data-i18n-skip="1"></span></div>
    <div class="hint bp-mb-10" data-i18n="s_bp_ask_hint">Der Text ist schon kopiert. Im Spiel als Mail einfügen und senden.</div>
    <div class="field" data-i18n-skip="1">
      <textarea id="bp-ask-text"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="bpAskCopyAgain" data-args='[{"$":"el"}]' data-i18n="s_bp_ask_copy_again">Nochmal kopieren</button>
      <button class="btn btn-gold" data-action="closeModal" data-args='["modal-bp-ask"]' data-i18n="s_bp_ask_close">Schließen</button>
    </div>
  </div>
</div>

<div class="modal-bg hidden" id="modal-bp-fill">
  <div class="modal bp-modal-wide">
    <div class="modal-title">🎲 <span data-i18n="s_bp_fill_modal_title">Automatisch aufteilen – Vorschau</span></div>
    <label class="bp-fill-opt"><input type="checkbox" id="bp-fill-move" checked data-on-change="bpFillReroll"> <span data-i18n="s_bp_fill_move_opt">Eingeteilte Ingenieure auch umsetzen: jedem Kriegsanführer einen aktiven geben und die Anzahl ausgleichen (♥-Paare bleiben)</span></label>
    <div id="bp-fill-body" class="bp-fill-body" data-i18n-skip="1"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="bpFillReroll" data-i18n="s_bp_fill_reroll">Neu würfeln</button>
      <button class="btn btn-ghost" data-action="closeModal" data-args='["modal-bp-fill"]' data-i18n="s_abbrechen">Abbrechen</button>
      <button class="btn btn-gold" id="bp-fill-apply" data-action="bpFillApply" data-args='[{"$":"el"}]' data-i18n="s_bp_fill_apply">Übernehmen</button>
    </div>
  </div>
</div>
<div class="modal-bg hidden" id="modal-bp-history">
  <div class="modal bp-modal-wide">
    <div class="modal-title">🕘 <span data-i18n="s_bp_hist_title">Berufe-Verlauf</span></div>
    <div class="hint bp-mb-10" id="bp-hist-hint" data-i18n="s_bp_hist_hint">Nach jeder Änderung merkt sich der LWHub den ganzen Stand. Tippe auf einen Zeitpunkt, um zu sehen, was sich zurückändern würde.</div>
    <div id="bp-hist-body" class="bp-fill-body" data-i18n-skip="1"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="bp-hist-back" hidden data-action="bpHistBack" data-i18n="s_bp_hist_back">Zurück</button>
      <button class="btn btn-ghost" data-action="closeModal" data-args='["modal-bp-history"]' data-i18n="s_bp_ask_close">Schließen</button>
      <button class="btn btn-gold" id="bp-hist-restore" hidden data-action="bpHistRestore" data-args='[{"$":"el"}]' data-i18n="s_bp_hist_restore">Ausgewählte wiederherstellen</button>
    </div>
  </div>
</div>
<div class="modal-bg hidden" id="modal-bp-templates">
  <div class="modal bp-modal-mid">
    <div class="modal-title">✎ <span data-i18n="s_bp_tpl_title">Fragetexte für „Spieler fragen“</span></div>
    <div class="hint bp-mb-10" data-i18n="s_bp_tpl_hint">Jeder Spieler bekommt den Text in seiner Sprache. Klick auf einen Platzhalter fügt ihn ein.</div>
    <div class="bp-view bp-mb-6" id="bp-tpl-variant">
      <button type="button" data-variant="r23" data-action="bpTplSwitchVariant" data-args='["r23"]' data-i18n="s_bp_tpl_var_r23">Für R2/R3</button>
      <button type="button" data-variant="r145" data-action="bpTplSwitchVariant" data-args='["r145"]' data-i18n="s_bp_tpl_var_r145">Für R1, R4, R5</button>
    </div>
    <div class="hint bp-mb-10" id="bp-tpl-variant-note" data-i18n-skip="1"></div>
    <div class="field">
      <select id="bp-tpl-lang" data-on-change="bpTplSwitchLang" data-args-change='[{"$":"value"}]' data-i18n-skip="1">
        <option value="de">Deutsch</option>
        <option value="en">English</option>
        <option value="fr">Français</option>
        <option value="es">Español</option>
        <option value="it">Italiano</option>
        <option value="pl">Polski</option>
        <option value="zh">中文</option>
      </select>
    </div>
    <div id="bp-tpl-chips" class="bp-tpl-chips" data-i18n-skip="1"></div>
    <div class="field" data-i18n-skip="1">
      <textarea id="bp-tpl-text" maxlength="1000" data-on-input="bpTplRenderPreview"></textarea>
    </div>
    <div class="bp-tpl-preview-label" data-i18n="s_bp_tpl_preview">Vorschau</div>
    <div id="bp-tpl-preview" class="bp-tpl-preview" data-i18n-skip="1"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="bpTplResetLang" data-i18n="s_bp_tpl_reset">Standard wiederherstellen</button>
      <button class="btn btn-ghost" data-action="closeModal" data-args='["modal-bp-templates"]' data-i18n="s_abbrechen">Abbrechen</button>
      <button class="btn btn-gold" data-action="bpTplSave" data-args='[{"$":"el"}]' data-i18n="s_bp_tpl_save">Speichern</button>
    </div>
  </div>
</div>
