<?php // Zug-Ansicht für alle (page-zv), JS: assets/js/pages/train.js ?>
<!-- ═══ ZUG LESEANSICHT (alle Mitglieder) ═══ -->
<div class="page" id="page-zv">
  <h2 style="margin:0 0 14px 2px;font-size:1.45rem;font-weight:700;color:var(--text);letter-spacing:0.01em;">Schaffner-Übersicht</h2>
  <div class="panel" id="zug-ro-cal-panel">
    <div class="panel-head">
      <div>
        <div class="panel-title" id="zug-ro-cal-title">Kalender</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="wt-btn" data-action="zugRoNavWeek" data-args="[-1]" style="padding:8px 14px;font-size:20px;min-width:44px;">‹</button>
        <button class="wt-btn" data-action="zugRoNavWeek" data-args="[1]" style="padding:8px 14px;font-size:20px;min-width:44px;">›</button>
        <button class="wt-btn" data-action="zugRoNavToday" style="padding:8px 14px;font-size:12px;">Heute</button>
      </div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;margin-bottom:12px;color:var(--soft);">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(74,158,255,0.6);margin-right:4px;vertical-align:middle;"></span>Geplant</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(46,203,122,0.7);margin-right:4px;vertical-align:middle;"></span>Abgeschlossen</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(224,85,69,0.7);margin-right:4px;vertical-align:middle;"></span>No-Show</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(100,100,100,0.5);margin-right:4px;vertical-align:middle;"></span>Abgesagt</span>
    </div>
    <div id="zug-ro-cal-grid"></div>
  </div>
</div>
