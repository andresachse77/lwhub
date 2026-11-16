<?php // Kopfleiste mit Logo und Reitern; R4-/Admin-Reiter fügt die App ein ?>
<nav>
  <div class="nav-inner">
  <div class="logo"><span class="js-alliance-short">ALLY</span><em class="js-alliance-tagline">App</em></div>
  <div class="tabs" id="main-tabs">
    <button class="tab active" id="tab-m" data-action="showPage" data-args='["m"]'>Mein Bereich</button>
    <button class="tab" id="tab-t" data-action="showPage" data-args='["t"]'>Meine Teams</button>
    <button class="tab" id="tab-p" data-action="showPage" data-args='["p"]'>Punkte-Guide</button>
    <button class="tab" id="tab-zv" data-action="showPage" data-args='["zv"]'><svg xmlns="http://www.w3.org/2000/svg" width="27" height="14" viewBox="0 0 38 20" style="vertical-align:-1px;display:inline-block;"><circle cx="9" cy="2.2" r="2" fill="rgba(255,255,255,0.42)"/><circle cx="13.5" cy="0.9" r="1.2" fill="rgba(255,255,255,0.28)"/><rect x="6.5" y="3" width="4" height="4.5" rx="0.8" fill="#B87300"/><rect x="1" y="6.5" width="22" height="9" rx="4" fill="#F0A500"/><rect x="2" y="7.2" width="19" height="3.2" rx="2" fill="rgba(255,230,90,0.38)"/><rect x="19" y="3.5" width="10" height="12" rx="1.5" fill="#D4890A"/><rect x="18" y="2.2" width="12" height="2.5" rx="1" fill="#B87300"/><rect x="21" y="5" width="5" height="4" rx="1" fill="#87CEEB" opacity="0.88"/><rect x="0" y="10.8" width="2" height="2.5" rx="0.4" fill="#9A6200"/><circle cx="8.5" cy="17" r="3.4" fill="#9A6200" stroke="#F0C040" stroke-width="1.1"/><circle cx="8.5" cy="17" r="1.3" fill="#C8820A"/><line x1="8.5" y1="13.6" x2="8.5" y2="20.4" stroke="#C8820A" stroke-width="0.7"/><line x1="5.1" y1="15" x2="11.9" y2="19" stroke="#C8820A" stroke-width="0.7"/><line x1="5.1" y1="19" x2="11.9" y2="15" stroke="#C8820A" stroke-width="0.7"/><circle cx="3" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/><circle cx="21" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/><circle cx="27" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/><rect x="3" y="16.3" width="25" height="1.5" rx="0.5" fill="#9A6200" opacity="0.6"/></svg> Zug</button>
    <span id="r4-tab-btns"></span>
    <span id="admin-tab-btns"></span>
  </div>
  <div class="nav-actions">
    <select id="lang-switch" class="lang-select" title="Sprache">
      <option value="de">DE</option>
      <option value="en">EN</option>
      <option value="it">IT</option>
      <option value="fr">FR</option>
      <option value="pl">PL</option>
      <option value="es">ES</option>
      <option value="zh">ZH</option>
    </select>
    <button class="sync-btn" id="btn-share" data-action="lwShareLink" title="Link teilen">🔗</button>
    <button class="sync-btn" id="btn-sync" data-action="syncData" title="Daten neu laden">🔄</button>
  </div>
  <input type="number" id="kwInput" style="display:none" min="1" max="9953" value="2616">
  </div>
</nav>
