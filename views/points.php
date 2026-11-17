<?php // Punkte-Guide (page-p) ?>
<!-- ═══ PUNKTE-GUIDE ═══ -->
<div class="page" id="page-p">
  <div class="pg-shell">
    <section class="pg-hero">
      <article class="pg-hero-card">
        <div class="pg-eyebrow">Erklaerbaer</div>
        <h1 class="pg-h1">Punkte und Abzuege einfach erklaert</h1>
        <p class="pg-sub" data-i18n="s_punkte_guide_beschreibung">Hier sieht jedes Mitglied transparent, wie die Punktzahl entsteht. Einige Bereiche haben eine Gewichtung, daher sind hohe Werte wie 300 in Einzelfaellen moeglich.</p>
      </article>
      <article class="pg-grid">
        <div class="pg-kpi">
          <div class="pg-label">Theoretisches Maximum</div>
          <div class="pg-value pg-value-gold2">385</div>
          <div class="pg-note">Bei idealer Kombination ohne Strafpunkte</div>
        </div>
        <div class="pg-kpi">
          <div class="pg-label">Top VS-Gewichtung</div>
          <div class="pg-value pg-value-blue">140</div>
          <div class="pg-note">VS Gesamt wird mit Faktor 5 gerechnet (Deckel 140)</div>
        </div>
        <div class="pg-kpi" data-guide-features="strafe">
          <div class="pg-label">Strafpunkte</div>
          <div class="pg-value pg-value-red">bis -140</div>
          <div class="pg-note">Inaktiv + NAP + Verhalten extern etc.</div>
        </div>
      </article>
    </section>
    <section class="pg-layout">
      <article class="pg-panel">
        <h2 class="pg-h2">Pluspunkte</h2>
        <div class="pg-points-list">
          <div class="pg-row" data-guide-features="vs"><div class="pg-name">VS Top 30 / Top 10 (mit VS-Gewichtung)</div><div class="pg-badge pg-mix">+75 / +25</div></div>
          <div class="pg-row" data-guide-features="spende"><div class="pg-name">Spenden Top 20 (mit Spenden-Gewichtung)</div><div class="pg-badge pg-mix">+35</div></div>
          <div class="pg-row" data-guide-features="wache"><div class="pg-name">Wache Teilnahme je Slot</div><div class="pg-badge pg-plus">+10</div></div>
          <div class="pg-row" data-guide-features="wache"><div class="pg-name">Wache Bonus (pro 2 Teilnahmen)</div><div class="pg-badge pg-plus">+15</div></div>
          <div class="pg-row" data-guide-features="spezial"><div class="pg-name">Spezialevent Teilnahme / Top 50 / Top 20</div><div class="pg-badge pg-mix">+20 / +30 / +20</div></div>
          <div class="pg-row" data-guide-features="wueste"><div class="pg-name" data-i18n="s_wueste_anmeldung_teilnahme">Wueste Anmeldung / Teilnahme</div><div class="pg-badge pg-plus">+10 / +25</div></div>
          <div class="pg-row" data-guide-features="bonus"><div class="pg-name">Bonus: Umfragen / Support / Feedback</div><div class="pg-badge pg-plus">+10 / +10 / +5</div></div>
        </div>
        <div class="pg-tip">Hinweis: VS und Spenden haben Basiswerte und werden im Regelwerk gewichtet. Deshalb entstehen dort groessere Spruenge als bei normalen Features.</div>
      </article>
      <aside class="pg-panel">
        <div id="pg-abzuege-section">
          <h2 class="pg-h2">Abzuege</h2>
          <div class="pg-points-list">
            <div class="pg-row" data-guide-features="vs,spende" data-guide-requires="strafe"><div class="pg-name">VS unter Schwelle / Spende unter Schwelle</div><div class="pg-badge pg-minus">-25 / -35</div></div>
            <div class="pg-row" data-guide-features="wache" data-guide-requires="strafe"><div class="pg-name">Wache kein DMG</div><div class="pg-badge pg-minus">-5</div></div>
            <div class="pg-row" data-guide-features="wueste" data-guide-requires="strafe"><div class="pg-name" data-i18n="s_wueste_unentschuldigt_fehlen">Wueste unentschuldigt fehlen</div><div class="pg-badge pg-minus">-15</div></div>
            <div class="pg-row" data-guide-features="strafe"><div class="pg-name">Inaktiv / NAP / Verhalten extern</div><div class="pg-badge pg-minus">-30 / -30 / -30</div></div>
            <div class="pg-row" data-guide-features="strafe"><div class="pg-name">Schild / Falschparken</div><div class="pg-badge pg-minus">-10 / -10</div></div>
            <div class="pg-row" data-guide-features="strafe"><div class="pg-name">Ankuendigungs-Mails / Verhalten intern</div><div class="pg-badge pg-minus">-15 / -15</div></div>
          </div>
        </div>
        <div id="pg-beispiel-section" class="pg-example-section">
          <h2 class="pg-h2">Beispielrechnung</h2>
          <div class="pg-example">
            <div class="pg-ex-row" data-guide-features="vs"><span>VS Gewichtung</span><strong>+125</strong></div>
            <div class="pg-ex-row" data-guide-features="spende"><span>Spenden Gewichtung</span><strong>+35</strong></div>
            <div class="pg-ex-row" data-guide-features="wache"><span>Wache Gesamt</span><strong>+35</strong></div>
            <div class="pg-ex-row" data-guide-features="spezial"><span>Spezialevents Gesamt</span><strong>+70</strong></div>
            <div class="pg-ex-row" data-guide-features="wueste"><span data-i18n="s_wueste_gesamt">Wueste Gesamt</span><strong>+35</strong></div>
            <div class="pg-ex-row" data-guide-features="strafe"><span>Strafpunkte</span><strong>0</strong></div>
            <div class="pg-ex-total"><span>Gesamtpunkte</span><span>300</span></div>
          </div>
        </div>
        <div class="pg-footer-note">Rank-Logik für R1-R3: bis 84 Punkte = R1, ab 85 Punkte = R2, ab 180 Punkte = R3. R4/R5 bleiben fix.</div>
      </aside>
    </section>
  </div>
</div>
