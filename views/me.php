<?php // Mein Bereich (page-m), JS: assets/js/pages/me.js ?>
<!-- ═══ MEIN BEREICH ═══ -->
<div class="page active" id="page-m">
  <div class="me-shell">

    <article class="me-hero-card">
      <div class="me-member-head">
        <div id="member-avatar-wrap"></div>
        <div>
          <div class="me-member-name" id="member-name">-</div>
          <div class="me-member-meta" id="member-meta">-</div>
          <div class="me-badge-row" id="member-badges"></div>
        </div>
      </div>
      <div class="me-stats-grid">
        <div class="me-stat">
          <div class="me-stat-label">Punkte</div>
          <div class="me-stat-value me-big" id="stat-points">0</div>
          <div class="me-stat-sub" id="stat-rank-display">-</div>
        </div>
        <div class="me-stat">
          <div class="me-stat-label">Aktuelle Woche</div>
          <div class="me-stat-value" id="stat-week">-</div>
          <div class="me-stat-sub" id="stat-week-sub">letzter gespeicherter Stand</div>
        </div>
      </div>
    </article>

    <aside class="me-hero-card me-week-panel">
      <div class="me-week-panel-head">
        <div>
          <div class="me-panel-title">Wochenübersicht</div>
          <div class="me-panel-sub" id="week-sub">Woche wählen und Details sehen</div>
        </div>
        <div id="rank-change-badge" style="display:none"></div>
      </div>
      <div class="me-week-switch">
        <button class="me-kw-btn" type="button" id="week-prev" data-action="meStepWeek" data-args="[-1]">‹</button>
        <select class="me-week-select" id="week-select"></select>
        <button class="me-kw-btn" type="button" id="week-next" data-action="meStepWeek" data-args="[1]">›</button>
      </div>
      <div class="me-delta-display">
        <div class="me-delta-label" data-i18n="s_vergleich_zur_vorwoche">Vergleich zur Vorwoche</div>
        <div class="me-delta-value" id="week-delta">–</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="me-stat" style="padding:12px 14px;">
          <div class="me-stat-label">Positive Einträge</div>
          <div class="me-stat-value" style="font-size:26px;" id="week-good">0</div>
        </div>
        <div class="me-stat" style="padding:12px 14px;">
          <div class="me-stat-label">Warnungen</div>
          <div class="me-stat-value" style="font-size:26px;color:var(--red);" id="week-warn">0</div>
        </div>
      </div>
    </aside>

    <section class="me-activities-section">
      <div class="me-panel me-activities-panel">
        <div class="me-panel-head">
          <div>
            <div class="me-panel-title" id="acts-title">Aktivitäten dieser Woche</div>
            <div class="me-panel-sub" id="acts-sub">Was hat dir Punkte gebracht oder genommen?</div>
          </div>
        </div>
        <div class="me-activities-split">
          <div>
            <div class="me-act-col-head" style="color:var(--green)">
              <div class="me-dot me-dot-green"></div>Verdient
            </div>
            <div id="acts-positive"></div>
          </div>
          <div>
            <div class="me-act-col-head" style="color:var(--red)">
              <div class="me-dot me-dot-red"></div>Gekostet
            </div>
            <div id="acts-negative"></div>
          </div>
        </div>
      </div>
    </section>

    <section class="me-panel" id="potential-section" style="display:none">
      <div class="me-panel-head">
        <div>
          <div class="me-panel-title">Dein Potenzial</div>
          <div class="me-panel-sub">Diese Aktivitäten würden dir die meisten Punkte bringen</div>
        </div>
      </div>
      <div class="me-potential-grid" id="potential-grid"></div>
    </section>

    <section class="me-panel" style="margin-top:18px;">
      <div class="me-panel-head">
        <div>
          <div class="me-panel-title">Historie</div>
          <div class="me-panel-sub" id="timeline-sub">Punkteverlauf über alle gespeicherten Wochen</div>
        </div>
      </div>
      <div class="me-timeline" id="timeline"></div>
    </section>

    <details class="me-changelog-details" id="changelog-details" style="display:none">
      <summary>Rank-Änderungen</summary>
      <div class="me-changelog-body">
        <div class="me-change-log" id="change-log"></div>
      </div>
    </details>

    <section class="me-panel" id="me-berufe-section" style="display:none;margin-top:18px;">
      <div class="me-panel-head">
        <div>
          <div class="me-panel-title"><span aria-hidden="true">👷</span> <span>Beruf</span></div>
          <div class="me-panel-sub">Dein Beruf in der Allianz - von dir selbst oder R4 pflegbar</div>
        </div>
      </div>
      <div id="me-berufe-content"></div>
    </section>

  </div>
</div>
