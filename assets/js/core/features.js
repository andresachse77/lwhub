// LWHub – Feature-Schalter je Allianz (flagConfig, Kategorien, Einstellungen-Dialog)
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Kern auslagern“).
// Normales Script, kein Modul: alles bleibt global wie vorher. Reihenfolge der <script>-Tags in index.html beachten.

// ── FEATURE CONFIG (per alliance, stored server-side) ──
let flagConfig = {}; // in-memory cache populated by loadFlagConfig()
// Erst true, wenn die Schalter der Allianz einmal geladen sind. Vorher gilt jedes Feature als aus; die
// Sichtbarkeits-Funktionen duerfen dann nicht von der Seite aus dem Link (z. B. /train) wegspringen.
let flagConfigLoaded = false;
let allianceFeatureModalAlliance = '';
let adminFlagConfigCache = {}; // { allianceName: {key: bool, ...} }, Schalter fremder Allianzen (Admin, Einstellungen)

const FEATURE_CAT_DEFS = [
  { key:'my_area', icon:'👤', label:'s_mein_bereich', sub:'s_mein_bereich_feature_sub' },
  { key:'my_teams', icon:'🛡', label:'s_meine_teams', sub:'s_meine_teams_feature_sub' },
  { key:'events',  icon:'🎉', label:'s_events_label',       sub:'s_hauptschalter_fuer_den_events_bereich' },
  { key:'wache',   icon:'🛡', label:'s_wache',              sub:'s_events_w1_w3_kacheln_tabs' },
  { key:'wueste',  icon:'🏜', label:'s_wueste_label',       sub:'s_wuesten_event_tab_kacheln' },
  { key:'spezial', icon:'🎯', label:'s_spezialevents_label', sub:'s_spezial_event_tab_kacheln' },
  { key:'vs',      icon:'⚔', label:'VS',                    sub:'s_vs_event_tab_kacheln' },
  { key:'spende',  icon:'💰', label:'s_spenden_label',      sub:'s_spenden_event_tab_kacheln' },
  { key:'zug',     icon:'🚂', label:'s_zug_label',          sub:'s_zug_zugplan_leseansicht_bearbeiten' },
  { key:'strafe',  icon:'❌', label:'s_strafpunkte_label',   sub:'s_in_der_verwaltung_pflegbar' },
  { key:'bonus',   icon:'⭐', label:'s_pluspunkte',         sub:'s_in_der_verwaltung_pflegbar' },
  { key:'afk',     icon:'⏸', label:'AFK',                   sub:'s_afk_sperrt_rang_aenderung' },
  { key:'berufe',  icon:'👷', label:'s_berufe_label',        sub:'s_ingenieur_kriegsherr_von_mitgliedern_und_r4_pflegbar' },
  { key:'scanner', icon:'📸', label:'s_scanner',             sub:'s_scanner_feature_sub' },
  { key:'ergebnis', icon:'📊', label:'s_ergebnis',           sub:'s_ergebnis_feature_sub' },
];

function isFeatureEnabled(key) {
  if (key === 'my_area' || key === 'my_teams') return flagConfig[key] !== false;
  return flagConfig[key] === true || (key === 'zug' && flagConfig.zugplan === true);
}

function isConfiguredFeatureEnabled(key, config) {
  if (key === 'my_area' || key === 'my_teams') return config[key] !== false;
  return config[key] === true || (key === 'zug' && config.zugplan === true);
}

function getBerufeMaxEngineers(config = flagConfig) {
  const raw = config?.berufe_max_ingenieure;
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(10, parsed));
}

function isBerufRankCheckOn(config = flagConfig) {
  return config?.berufe_rangcheck === true;
}

function getBerufRankCheckR2(config = flagConfig) {
  return config?.berufe_rangcheck_r2 === 'kriegsherr' ? 'kriegsherr' : 'ingenieur';
}

function hasEventFeaturesEnabled(config = flagConfig) {
  return ['wache', 'wueste', 'spezial', 'vs', 'spende'].some(key => config[key] === true);
}

function isEventPageVisible() {
  return flagConfig.events === true || hasEventFeaturesEnabled();
}

function setElementVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

function setTabVisible(id, visible) {
  const tab = document.getElementById(id);
  if (!tab) return;
  tab.dataset.featureHidden = visible ? '0' : '1';
  tab.style.display = visible ? '' : 'none';
}

function renderFeatureToggles(containerId, alliance, config) {
  const el = document.getElementById(containerId);
  if (!el || !alliance) return;
  const maxIng = getBerufeMaxEngineers(config);
  const combatCorrection = Number.parseInt(String(config?.combat_power_correction_value ?? ''), 10) || 40;
  const inputId = `${containerId}-berufe-max`;
  const correctionInputId = `${containerId}-combat-correction`;
  const historyWeeks = Math.max(1, Math.min(8, Number.parseInt(String(config?.history_weeks ?? ''), 10) || 4));
  el.innerHTML = `<div style="display:flex;flex-direction:column;">` +
    FEATURE_CAT_DEFS.map(({ key, icon, label, sub }) => {
      const on = isConfiguredFeatureEnabled(key, config);
      return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);">
        <div style="flex:1;"><div style="font-size:13px;font-weight:500;">${escHtml(icon)} ${escHtml(tr(label))}</div><div style="font-size:11px;color:var(--soft);">${escHtml(tr(sub))}</div></div>
        <button data-action="toggleCatConfig" data-args="${lwArgs(key, alliance)}" class="v-btn ${on ? 'save' : 'del'}" style="min-width:88px;">${on ? '✓ ' + escHtml(tr('Aktiv')) : '✗ ' + escHtml(tr('Inaktiv'))}</button>
      </div>`;
    }).join('') +
    `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;">⚙ ${escHtml(tr('s_max_ingenieure_kriegsherr'))}</div>
        <div style="font-size:11px;color:var(--soft);">${escHtml(tr('s_berufe_grenze_default'))}</div>
      </div>
      <input id="${escHtml(inputId)}" type="number" min="1" max="10" value="${maxIng}" style="width:70px;background:var(--card2);color:var(--text);border:1px solid var(--line2);border-radius:6px;padding:6px 8px;font-size:12px;">
    </div>` +
    `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;">⚙ ${escHtml(tr('s_combat_power_correction'))}</div>
        <div style="font-size:11px;color:var(--soft);">${escHtml(tr('s_combat_power_correction_sub'))}</div>
      </div>
      <input id="${escHtml(correctionInputId)}" type="number" min="0" max="998" value="${combatCorrection}" style="width:70px;background:var(--card2);color:var(--text);border:1px solid var(--line2);border-radius:6px;padding:6px 8px;font-size:12px;">
    </div>` +
    `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;">⚙ ${escHtml(tr('s_history_weeks'))}</div>
        <div style="font-size:11px;color:var(--soft);">${escHtml(tr('s_history_weeks_sub'))}</div>
      </div>
      <input id="${escHtml(containerId)}-history-weeks" type="number" min="1" max="8" value="${historyWeeks}" style="width:70px;background:var(--card2);color:var(--text);border:1px solid var(--line2);border-radius:6px;padding:6px 8px;font-size:12px;">
    </div>` +
    `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);flex-wrap:wrap;">
      <div style="flex:1;min-width:180px;">
        <div style="font-size:13px;font-weight:500;">🏷 ${escHtml(tr('s_rank_names'))}</div>
        <div style="font-size:11px;color:var(--soft);">${escHtml(tr('s_rank_names_sub'))}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">` +
      [1, 2, 3, 4, 5].map(r => {
        const fallback = r === 5 ? tr('s_chef') : DEFAULT_RL[r];
        const value = String(config?.['rank_name_' + r] ?? '').trim();
        return `<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--soft);">R${r}
          <input id="${escHtml(containerId)}-rank-name-${r}" type="text" maxlength="30" value="${escHtml(value)}" placeholder="${escHtml(fallback)}" style="width:96px;background:var(--card2);color:var(--text);border:1px solid var(--line2);border-radius:6px;padding:6px 8px;font-size:12px;"></label>`;
      }).join('') +
      `</div>
    </div>` +
    `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;">🌐 ${escHtml(tr('Server-Nummer'))}</div>
        <div style="font-size:11px;color:var(--soft);">${escHtml(tr('Allianzen mit derselben Server-Nummer teilen sich die Spezialevent-Termine.'))}</div>
      </div>
      <input id="${escHtml(containerId)}-server" type="text" inputmode="numeric" maxlength="6" value="${escHtml(String(config?.server ?? ''))}" placeholder="—" style="width:70px;background:var(--card2);color:var(--text);border:1px solid var(--line2);border-radius:6px;padding:6px 8px;font-size:12px;">
    </div>` +
    `</div>`;
  el.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => allianceSettingsDirty(true)));
  allianceSettingsDirty(false);
}


// Allianz-Einstellungen: EIN Speichern-Knopf unten im Fenster fuer alle Eingabefelder
// (Max. Ingenieure, Kampfkraft-Korrektur, Wertewochen, Rangnamen, Server-Nummer). Die Feature-Schalter wirken weiter sofort.
function allianceSettingsDirty(dirty = true) {
  const btn = document.getElementById('alliance-features-save');
  if (!btn) return;
  btn.disabled = !dirty;
  btn.classList.toggle('pulse-dirty', dirty);
}
window.allianceSettingsDirty = allianceSettingsDirty;

async function saveAllianceSettings(btn) {
  const alliance = allianceFeatureModalAlliance;
  const containerId = 'alliance-features-body';
  if (!alliance) return;
  const val = id => String(document.getElementById(`${containerId}-${id}`)?.value ?? '');
  const config = {
    berufe_max_ingenieure: Math.max(1, Math.min(10, Number.parseInt(val('berufe-max'), 10) || 3)),
    combat_power_correction_value: Math.max(0, Math.min(998, Number.parseInt(val('combat-correction'), 10) || 40)),
    history_weeks: Math.max(1, Math.min(8, Number.parseInt(val('history-weeks'), 10) || 4)),
    server: val('server').replace(/\D/g, '').slice(0, 6),
  };
  for (let r = 1; r <= 5; r++) config['rank_name_' + r] = val('rank-name-' + r).trim().slice(0, 30);
  if (btn) btn.disabled = true;
  try {
    await adminApi(`/alliance-config?alliance=${encodeURIComponent(alliance)}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ discord_id: authMember?.discord_id || '', config })
    });
    adminFlagConfigCache[alliance] = await loadFlagConfig(alliance);
    if (isCurrentAllianceTarget(alliance)) {
      flagConfig = { ...adminFlagConfigCache[alliance] };
      seEvents.loaded = false; // Spezialevents kommen ggf. vom Server (Server-Nummer)
      applyRankNames();
      updateFeatureTabVisibility();
      renderFlagsAdmin();
      if (document.getElementById('page-bp')?.classList.contains('active')) window.berufePlannerRender?.();
      renderMeBerufe();
      if (document.getElementById('page-v')?.classList.contains('active')) {
        renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
      }
    }
    renderAllianceFeaturesModal();
    toast(tr('s_alliance_settings_saved'), 'ok');
  } catch (err) {
    toast(tr('Fehler: ') + err.message, 'err');
    if (btn) btn.disabled = false;
  }
}
window.saveAllianceSettings = saveAllianceSettings;

async function loadAllianceFeatureConfig(alliance) {
  if (!alliance) return {};
  const config = await loadFlagConfig(alliance);
  adminFlagConfigCache[alliance] = config;
  return config;
}

async function openAllianceFeatures(alliance) {
  allianceFeatureModalAlliance = alliance;
  const title = document.getElementById('alliance-features-title');
  const sub = document.getElementById('alliance-features-sub');
  if (title) title.textContent = `${tr('Features')}: ${alliance}`;
  if (sub) sub.textContent = tr('Steuere hier direkt, welche Bereiche diese Allianz nutzen darf.');
  const body = document.getElementById('alliance-features-body');
  if (body) body.innerHTML = '<div class="empty">' + escHtml(tr('Lade …')) + '</div>';
  openModal('modal-alliance-features');
  try {
    const config = await loadAllianceFeatureConfig(alliance);
    renderFeatureToggles('alliance-features-body', alliance, config);
  } catch (e) {
    if (body) body.innerHTML = `<div class="empty"></div>`;
  }
}

function renderAllianceFeaturesModal() {
  if (!allianceFeatureModalAlliance) return;
  const config = adminFlagConfigCache[allianceFeatureModalAlliance] || {};
  renderFeatureToggles('alliance-features-body', allianceFeatureModalAlliance, config);
}

window.openAllianceFeatures = openAllianceFeatures;

function getEffectiveAllianceForApi() {
  const fromAuth = String(authMember?.active_alliance || authMember?.alliance || '').trim();
  if (fromAuth) return fromAuth;
  try {
    const fromGetter = typeof window.getActiveAlliance === 'function' ? String(window.getActiveAlliance() || '').trim() : '';
    if (fromGetter) return fromGetter;
  } catch (_) {}
  try {
    const ac = JSON.parse(localStorage.getItem('iny_active_char_v1') || 'null');
    const fromStorage = String(ac?.alliance || '').trim();
    if (fromStorage) return fromStorage;
  } catch (_) {}
  return '';
}

async function loadFlagConfig(allianceOverride) {
  try {
    if (allianceOverride) {
      // admin page: fetch for a specific alliance without active-char interference
      const data = await adminApi(`/alliance-config?alliance=${encodeURIComponent(allianceOverride)}`);
      const config = data.config || {};
      if (config.zugplan === true && config.zug !== true) config.zug = true;
      return config;
    }
    const alliance = getEffectiveAllianceForApi();
    const path = alliance
      ? `/alliance-config?alliance=${encodeURIComponent(alliance)}`
      : '/alliance-config';
    const data = await fetchJson(path);
    flagConfig = data.config || {};
    if (flagConfig.zugplan === true && flagConfig.zug !== true) flagConfig.zug = true;
    flagConfigLoaded = true;
    updateEventTabVisibility();
    updateFeatureTabVisibility();
    updatePointsGuideVisibility();
    applyRankNames();
  } catch (_) {
    if (allianceOverride) return {};
    // keep current feature config (empty object means everything is disabled)
  }
}
window.loadFlagConfig = loadFlagConfig;

function isCatEnabled(catKey) {
  return flagConfig[catKey] === true;
}

function isCurrentAllianceTarget(targetAlliance) {
  const currentAlliance = String(authMember?.active_alliance || authMember?.alliance || '').trim().toLowerCase();
  const target = String(targetAlliance || '').trim().toLowerCase();
  return !!currentAlliance && !!target && currentAlliance === target;
}

async function toggleCatConfig(key, allianceOverride) {
  const targetAlliance = allianceOverride || null;
  const discordId = authMember?.discord_id || '';
  const newVal = targetAlliance
    ? !(adminFlagConfigCache[targetAlliance]?.[key] === true)
    : !isCatEnabled(key);
  const payloadConfig = key === 'zug' ? { zug: newVal, zugplan: newVal } : { [key]: newVal };
  // optimistic update
  if (targetAlliance) {
    if (!adminFlagConfigCache[targetAlliance]) adminFlagConfigCache[targetAlliance] = {};
    adminFlagConfigCache[targetAlliance][key] = newVal;
    if (key === 'zug') adminFlagConfigCache[targetAlliance].zugplan = newVal;
    if (isCurrentAllianceTarget(targetAlliance)) {
      flagConfig = { ...adminFlagConfigCache[targetAlliance] };
      updateEventTabVisibility();
      updateFeatureTabVisibility();
      updatePointsGuideVisibility();
      renderFlagsAdmin();
    }
    renderAllianceFeaturesModal();
  } else {
    flagConfig[key] = newVal;
    if (key === 'zug') flagConfig.zugplan = newVal;
    renderFlagsAdmin();
    updateEventTabVisibility();
    updateFeatureTabVisibility();
    updatePointsGuideVisibility();
    if (document.getElementById('page-v')?.classList.contains('active'))
      renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
  }
  try {
    const qs = `?alliance=${encodeURIComponent(targetAlliance || '')}`;
    if (targetAlliance) {
      // admin page: use adminApi to avoid active-char alliance interference
      await adminApi(`/alliance-config${qs}`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ discord_id: discordId, config: payloadConfig })
      });
      adminFlagConfigCache[targetAlliance] = await loadFlagConfig(targetAlliance);
      if (isCurrentAllianceTarget(targetAlliance)) {
        flagConfig = { ...adminFlagConfigCache[targetAlliance] };
        updateEventTabVisibility();
        updateFeatureTabVisibility();
        updatePointsGuideVisibility();
        renderFlagsAdmin();
      }
      renderAllianceFeaturesModal();
    } else {
      await fetchJson('/alliance-config', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ discord_id: discordId, config: payloadConfig })
      });
      await loadFlagConfig();
      renderFlagsAdmin();
    }
  } catch(err) {
    toast(tr('Fehler: ') + err.message);
    // revert
    if (targetAlliance) {
      adminFlagConfigCache[targetAlliance] = await loadFlagConfig(targetAlliance);
      if (isCurrentAllianceTarget(targetAlliance)) {
        flagConfig = { ...adminFlagConfigCache[targetAlliance] };
        updateEventTabVisibility();
        updateFeatureTabVisibility();
        updatePointsGuideVisibility();
        renderFlagsAdmin();
      }
      renderAllianceFeaturesModal();
    } else {
      await loadFlagConfig();
      renderFlagsAdmin();
    }
  }
}
window.toggleCatConfig = toggleCatConfig;




function renderFlagsAdmin() {
  const el = document.getElementById('v-flag-config');
  if (!el) return;
  el.innerHTML = `<div style="display:flex;flex-direction:column;">` +
    FEATURE_CAT_DEFS.map(({ key, label, sub }) => {
      const on = isCatEnabled(key);
      return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);">
        <div style="flex:1;"><div style="font-size:13px;font-weight:500;">${escHtml(tr(label))}</div><div style="font-size:11px;color:var(--soft);">${escHtml(tr(sub))}</div></div>
        <span class="rank-badge ${on?'r4':'r3'}" style="min-width:80px;text-align:center;">${on?'✓ '+escHtml(tr('s_aktiv')):'✗ '+escHtml(tr('s_inaktiv'))}</span>
      </div>`;
    }).join('') +
    `</div><div style="font-size:11px;color:var(--softer);margin-top:8px;">Editierbar unter <strong>Admin → Allianzen → Features</strong> (nur R5).</div>`;
}
window.renderFlagsAdmin = renderFlagsAdmin;

// Re-render dynamic content when language changes
document.addEventListener('i18n:language-changed', () => {
  if (typeof buildNavActionsFromTabs === 'function') {
    buildNavActionsFromTabs();
  }
  // Mein Bereich (start page) – all me_render* functions use tr() inline
  if (typeof me_renderOverview === 'function' && typeof meHistoryBundle !== 'undefined' && meHistoryBundle) {
    me_renderOverview();
  }
  // Dashboard / R4 pages / member list
  if (typeof renderAll === 'function' && typeof members !== 'undefined' && members.length) {
    renderAll();
  }
  // Verwaltung (re-render even if renderAll already called it, to pass search filter)
  if (typeof renderVerwaltung === 'function' && typeof members !== 'undefined' && members.length) {
    renderVerwaltung(document.getElementById('v-search')?.value?.toLowerCase() || '');
  }
  if (typeof renderAccessRequests === 'function' && typeof accessRequests !== 'undefined') {
    renderAccessRequests();
  }
  if (document.getElementById('page-t')?.classList.contains('active')) {
    if (typeof renderTeamsPage === 'function') renderTeamsPage();
    if (typeof teamEditOpen !== 'undefined' && teamEditOpen && typeof renderTeamEditorDnD === 'function') {
      renderTeamEditorDnD();
    }
  }
  if (typeof renderFlagsAdmin === 'function') {
    renderFlagsAdmin();
  }
});

// ── Sichtbarkeit der Reiter und des Punkte-Guides (fuer alle, nicht nur R4; frueher in pages/members.js) ──
function updateEventTabVisibility() {
  const catMap = { w1:'wache',w2:'wache',w3:'wache',wu:'wueste',se:'spezial',vs:'vs',sp:'spende' };
  const eventVisible = isEventPageVisible();
  document.querySelectorAll('.wache-tab').forEach(btn => {
    const key = catMap[btn.dataset.ev];
    if (key) btn.style.display = eventVisible && isFeatureEnabled(key) ? '' : 'none';
  });
  setTabVisible('tab-w', eventVisible);
  setElementVisible('page-w', eventVisible);
  if (flagConfigLoaded && !eventVisible && document.getElementById('page-w')?.classList.contains('active')) {
    showPage(startPageId(), { remember: false });
  }
  // Keep mobile dropdown navigation in sync with current tab visibility.
  if (typeof buildNavActionsFromTabs === 'function') buildNavActionsFromTabs();
  if (typeof updateNavCompact === 'function') updateNavCompact();
}
window.updateEventTabVisibility = updateEventTabVisibility;

function updateFeatureTabVisibility() {
  const myAreaVisible = isFeatureEnabled('my_area');
  const myTeamsVisible = isFeatureEnabled('my_teams');
  setTabVisible('tab-m', myAreaVisible);
  setTabVisible('tab-t', myTeamsVisible);
  setElementVisible('page-m', myAreaVisible);
  setElementVisible('page-t', myTeamsVisible);

  if (flagConfigLoaded && ((!myAreaVisible && document.getElementById('page-m')?.classList.contains('active')) ||
      (!myTeamsVisible && document.getElementById('page-t')?.classList.contains('active')))) {
    showPage(startPageId(), { remember: false });
  }

  const zugTab = document.getElementById('tab-z');
  if (zugTab) setTabVisible('tab-z', isFeatureEnabled('zug'));

  const zugPlanTab = document.getElementById('tab-zv');
  if (zugPlanTab) {
    setTabVisible('tab-zv', isFeatureEnabled('zug'));
  }

  const berufeTab = document.getElementById('tab-bp');
  if (berufeTab) {
    setTabVisible('tab-bp', isFeatureEnabled('berufe'));
  }

  if (document.getElementById('tab-sc')) setTabVisible('tab-sc', isFeatureEnabled('scanner'));
  // Ergebnis (Rang-Empfehlungen aus Punkten): veraltet, seit R2/R3 dem Beruf folgen – nur noch per Schalter
  // Auswertungen (Punkte-Uebersicht, Trend, Server-Events) immer; die Rang-Empfehlungen darin nur bei
  // Rang nach Punkten (rankByPoints, loadErgebnis)
  if (document.getElementById('tab-r')) setTabVisible('tab-r', true);
  setElementVisible('page-r', true);

  setElementVisible('page-z', isFeatureEnabled('zug'));
  setElementVisible('page-zv', isFeatureEnabled('zug'));
  setElementVisible('page-bp', isFeatureEnabled('berufe'));
  setElementVisible('page-sc', isFeatureEnabled('scanner'));
  if (flagConfigLoaded && ((!isFeatureEnabled('zug') && document.getElementById('page-z')?.classList.contains('active')) ||
      (!isFeatureEnabled('zug') && document.getElementById('page-zv')?.classList.contains('active')) ||
      (!isFeatureEnabled('berufe') && document.getElementById('page-bp')?.classList.contains('active')) ||
      (!isFeatureEnabled('scanner') && document.getElementById('page-sc')?.classList.contains('active')))) {
    showPage(startPageId(), { remember: false });
  }
  // Keep mobile dropdown navigation in sync with current tab visibility.
  if (typeof buildNavActionsFromTabs === 'function') buildNavActionsFromTabs();
  if (typeof updateNavCompact === 'function') updateNavCompact();
}
window.updateFeatureTabVisibility = updateFeatureTabVisibility;

function isPointsGuideVisible() {
  return ['vs', 'spende', 'wache', 'spezial', 'wueste', 'bonus', 'strafe']
    .some(feature => isFeatureEnabled(feature));
}

function updatePointsGuideVisibility() {
  const guideEl = document.getElementById('page-p');
  if (!guideEl) return;

  // non-row, non-ex-row elements with feature gates (e.g. KPI cards)
  guideEl.querySelectorAll('[data-guide-features]:not(.pg-row):not(.pg-ex-row)').forEach(el => {
    const features = (el.dataset.guideFeatures || '').split(',').map(s => s.trim()).filter(Boolean);
    const required = (el.dataset.guideRequires || '').split(',').map(s => s.trim()).filter(Boolean);
    const visibleByFeatures = features.length ? features.some(feature => isFeatureEnabled(feature)) : true;
    const visibleByRequired = required.every(feature => isFeatureEnabled(feature));
    const visible = visibleByFeatures && visibleByRequired;
    el.style.display = visible ? '' : 'none';
  });

  let anyVisible = false;

  // Abzüge rows
  const rows = guideEl.querySelectorAll('.pg-row[data-guide-features]');
  rows.forEach(row => {
    const features = (row.dataset.guideFeatures || '').split(',').map(s => s.trim()).filter(Boolean);
    const required = (row.dataset.guideRequires || '').split(',').map(s => s.trim()).filter(Boolean);
    const visibleByFeatures = features.length ? features.some(feature => isFeatureEnabled(feature)) : true;
    const visibleByRequired = required.every(feature => isFeatureEnabled(feature));
    const visible = visibleByFeatures && visibleByRequired;
    row.style.display = visible ? '' : 'none';
    if (visible) anyVisible = true;
  });

  // Abzüge section wrapper
  const abzuegeSection = guideEl.querySelector('#pg-abzuege-section');
  if (abzuegeSection) {
    const hasVisible = Array.from(abzuegeSection.querySelectorAll('.pg-row')).some(r => r.style.display !== 'none');
    abzuegeSection.style.display = hasVisible ? '' : 'none';
  }

  // Beispielrechnung ex-rows
  guideEl.querySelectorAll('.pg-ex-row[data-guide-features]').forEach(row => {
    const features = (row.dataset.guideFeatures || '').split(',').map(s => s.trim()).filter(Boolean);
    const visible = features.some(feature => isFeatureEnabled(feature));
    row.style.display = visible ? '' : 'none';
  });

  // Beispielrechnung section wrapper
  const beispielSection = guideEl.querySelector('#pg-beispiel-section');
  if (beispielSection) {
    const hasVisibleEx = Array.from(beispielSection.querySelectorAll('.pg-ex-row')).some(r => r.style.display !== 'none');
    beispielSection.style.display = hasVisibleEx ? '' : 'none';
    if (hasVisibleEx) anyVisible = true;
    // pg-ex-total only if at least one ex-row is visible
    const total = beispielSection.querySelector('.pg-ex-total');
    if (total) total.style.display = hasVisibleEx ? '' : 'none';
  }

  // Panel-level visibility: visible if either Abzüge or Beispiel has content
  guideEl.querySelectorAll('.pg-panel').forEach(panel => {
    const visibleRows = Array.from(panel.querySelectorAll('.pg-row')).filter(r => r.style.display !== 'none').length;
    const visibleExRows = Array.from(panel.querySelectorAll('.pg-ex-row')).filter(r => r.style.display !== 'none').length;
    if (panel.querySelector('.pg-row[data-guide-features]') || panel.querySelector('.pg-ex-row[data-guide-features]')) {
      const panelVisible = visibleRows > 0 || visibleExRows > 0;
      panel.style.display = panelVisible ? '' : 'none';
      if (panelVisible) anyVisible = true;
    }
  });

  guideEl.style.display = anyVisible ? '' : 'none';
  setTabVisible('tab-p', anyVisible);
  if (flagConfigLoaded && !anyVisible && document.getElementById('page-p')?.classList.contains('active')) {
    showPage(startPageId(), { remember: false });
  }
}
window.updatePointsGuideVisibility = updatePointsGuideVisibility;
