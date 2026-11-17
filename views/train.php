<?php // Zug-Ansicht für alle (page-zv), JS: assets/js/pages/train.js ?>
<!-- ═══ ZUG LESEANSICHT (alle Mitglieder) ═══ -->
<div class="page" id="page-zv">
  <h2 class="zug-ro-heading">Schaffner-Übersicht</h2>
  <div class="panel" id="zug-ro-cal-panel">
    <div class="panel-head">
      <div>
        <div class="panel-title" id="zug-ro-cal-title">Kalender</div>
      </div>
      <div class="zug-ro-nav">
        <button class="wt-btn zug-ro-nav-btn" data-action="zugRoNavWeek" data-args="[-1]">‹</button>
        <button class="wt-btn zug-ro-nav-btn" data-action="zugRoNavWeek" data-args="[1]">›</button>
        <button class="wt-btn zug-ro-today-btn" data-action="zugRoNavToday">Heute</button>
      </div>
    </div>
    <div class="zug-ro-legend">
      <span><span class="zug-ro-legend-dot zug-ro-legend-planned"></span>Geplant</span>
      <span><span class="zug-ro-legend-dot zug-ro-legend-done"></span>Abgeschlossen</span>
      <span><span class="zug-ro-legend-dot zug-ro-legend-noshow"></span>No-Show</span>
      <span><span class="zug-ro-legend-dot zug-ro-legend-cancelled"></span>Abgesagt</span>
    </div>
    <div id="zug-ro-cal-grid"></div>
  </div>
</div>
