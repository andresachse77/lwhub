// LWHub – Meine Teams (/teams): Helden, Team-Editor mit Ziehen und Ablegen
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html). Normales Script, kein Modul:
// alles bleibt global wie vorher. Die Reihenfolge der <script>-Tags in index.html ist die Ladereihenfolge.

let teamData = { member_name: '', teams: [], total_hero_power: null, has_data: false };
let teamEditOpen = false;
let teamEditTargetName = '';
let heroCatalogByType = { panzer: [], flugzeug: [], rakete: [] };
const OVERLORD_HERO = {
  id: 'overlord',
  name: 'Overlord',
  image: '/assets/heroes/monkey/overlord.png',
  thumb: '/assets/heroes/monkey/thumbs/overlord.png'
};

function normalizeHeroesArray(list) {
  const out = Array.from({ length: 6 }, () => null);
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < 6; i++) {
    const v = list[i];
    out[i] = (v == null || String(v).trim() === '') ? null : String(v).trim();
  }
  return out;
}

function ensureTeamDataShape() {
  if (!Array.isArray(teamData.teams)) teamData.teams = [];
  for (let slot = 1; slot <= 4; slot++) {
    let entry = teamData.teams.find(t => Number(t?.slot) === slot);
    if (!entry) {
      entry = { slot, team_type: null, combat_power: null, monkey_level: null, heroes: Array.from({ length: 6 }, () => null) };
      teamData.teams.push(entry);
    }
    entry.slot = slot;
    entry.heroes = normalizeHeroesArray(entry.heroes);
  }
  teamData.teams.sort((a, b) => Number(a.slot) - Number(b.slot));
}

function heroCatalogMapFor(type) {
  const items = heroCatalogByType[type] || [];
  const map = new Map();
  items.forEach((h) => map.set(String(h.id), h));
  return map;
}

function resolveAssetUrl(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  const normalized = raw.replace(/^\.\//, '');
  if (normalized.startsWith('/')) return normalized;
  return `/${normalized}`;
}

async function fetchFirstOkJson(urls) {
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      return await r.json();
    } catch (_) {
      // try next
    }
  }
  return null;
}

async function loadHeroCatalogs() {
  // Ordner unter assets/heroes/ (englisch). Frueher wurden auch flugzeug/air/rakete probiert:
  // die gibt es nicht, das gab bei jedem Laden 404-Meldungen in der Konsole.
  const folderCandidatesByType = {
    panzer: ['tank'],
    flugzeug: ['aircraft'],
    rakete: ['rocket'],
  };

  const loadOne = async (type) => {
    const folders = folderCandidatesByType[type] || [type];
    for (const folder of folders) {
      // relativ zu <base href="/">, also immer /assets/heroes/…
      const data = await fetchFirstOkJson([`assets/heroes/${folder}/manifest.json`]);
      if (!data) continue;
      const list = Array.isArray(data?.heroes) ? data.heroes : [];
      heroCatalogByType[type] = list.map((h) => ({
        id: String(h.id || '').trim(),
        name: String(h.name || h.id || 'Hero').trim(),
        image: resolveAssetUrl(String(h.image || '').trim()),
        thumb: resolveAssetUrl(String(h.thumb || h.image || '').trim()),
      })).filter((h) => h.id && h.thumb);
      return;
    }
    heroCatalogByType[type] = [];
  };
  await Promise.all([loadOne('panzer'), loadOne('flugzeug'), loadOne('rakete')]);
}

function getTeamEntry(slot) {
  ensureTeamDataShape();
  return teamData.teams.find(t => Number(t.slot) === Number(slot));
}

function getHeroById(heroId) {
  const id = String(heroId || '').trim();
  if (!id) return null;
  if (id === OVERLORD_HERO.id) return OVERLORD_HERO;
  for (const type of ['panzer', 'flugzeug', 'rakete']) {
    const item = (heroCatalogByType[type] || []).find((h) => String(h.id) === id);
    if (item) return item;
  }
  return null;
}

function findHeroPlacement(heroId) {
  const id = String(heroId || '').trim();
  if (!id) return null;
  ensureTeamDataShape();
  for (let slot = 1; slot <= 4; slot++) {
    const entry = getTeamEntry(slot);
    const heroes = normalizeHeroesArray(entry?.heroes || []);
    const pos = heroes.findIndex((x) => String(x || '') === id);
    if (pos >= 0) return { slot, pos };
  }
  return null;
}

function getMonkeyOwnerSlot() {
  ensureTeamDataShape();
  for (let slot = 1; slot <= 4; slot++) {
    const entry = getTeamEntry(slot);
    const heroes = normalizeHeroesArray(entry?.heroes || []);
    if (heroes[5]) return slot;
  }
  return null;
}

function lockMonkeyToSingleTeam(ownerSlot) {
  if (!ownerSlot) return;
  for (let slot = 1; slot <= 4; slot++) {
    if (slot === ownerSlot) continue;
    const entry = getTeamEntry(slot);
    if (!entry) continue;
    entry.heroes = normalizeHeroesArray(entry.heroes);
    entry.heroes[5] = null;
  }
}

function normalizeUniqueHeroes() {
  ensureTeamDataShape();
  const seen = new Set();
  for (let slot = 1; slot <= 4; slot++) {
    const entry = getTeamEntry(slot);
    entry.heroes = normalizeHeroesArray(entry.heroes);
    for (let pos = 0; pos < 6; pos++) {
      const id = String(entry.heroes[pos] || '').trim();
      if (!id) continue;
      if (seen.has(id)) {
        entry.heroes[pos] = null;
      } else {
        seen.add(id);
      }
    }
  }
  lockMonkeyToSingleTeam(getMonkeyOwnerSlot());
}

function setHeroAt(slot, pos, heroId) {
  const entry = getTeamEntry(slot);
  if (!entry) return;
  entry.heroes = normalizeHeroesArray(entry.heroes);
  entry.heroes[pos] = heroId ? String(heroId) : null;
}

function moveOrSwapHero(targetSlot, targetPos, heroId, sourceSlot = null, sourcePos = null) {
  const id = String(heroId || '').trim();
  if (!id) return;
  ensureTeamDataShape();

  if (id === OVERLORD_HERO.id && targetPos !== 5) return;
  if (targetPos === 5 && id !== OVERLORD_HERO.id) return;

  const targetEntry = getTeamEntry(targetSlot);
  targetEntry.heroes = normalizeHeroesArray(targetEntry.heroes);
  const targetCurrent = targetEntry.heroes[targetPos] || null;

  let src = null;
  if (sourceSlot != null && sourcePos != null) {
    src = { slot: Number(sourceSlot), pos: Number(sourcePos) };
  } else {
    src = findHeroPlacement(id);
  }

  if (src && src.slot === targetSlot && src.pos === targetPos) return;

  if (src) {
    const srcEntry = getTeamEntry(src.slot);
    srcEntry.heroes = normalizeHeroesArray(srcEntry.heroes);
    const srcHero = srcEntry.heroes[src.pos] || null;
    if (srcHero !== id) src = findHeroPlacement(id);
  }

  if (src) {
    if (targetCurrent && !(src.slot === targetSlot && src.pos === targetPos)) {
      setHeroAt(src.slot, src.pos, targetCurrent);
      setHeroAt(targetSlot, targetPos, id);
    } else {
      setHeroAt(src.slot, src.pos, null);
      setHeroAt(targetSlot, targetPos, id);
    }
  } else {
    setHeroAt(targetSlot, targetPos, id);
  }

  if (targetPos === 5) {
    lockMonkeyToSingleTeam(targetSlot);
  } else {
    lockMonkeyToSingleTeam(getMonkeyOwnerSlot());
  }
  normalizeUniqueHeroes();
}

function setTeamHero(slot, pos, heroId) {
  if (heroId == null || String(heroId).trim() === '') {
    const entry = getTeamEntry(slot);
    if (!entry) return;
    entry.heroes = normalizeHeroesArray(entry.heroes);
    entry.heroes[pos] = null;
    normalizeUniqueHeroes();
    return;
  }
  moveOrSwapHero(slot, pos, heroId, null, null);
}

function clearTeamHero(slot, pos) {
  setTeamHero(slot, pos, null);
  renderTeamEditorDnD();
}
window.clearTeamHero = clearTeamHero;

function onTeamSlotDragStart(event, slot, pos) {
  const entry = getTeamEntry(slot);
  const heroId = entry?.heroes?.[pos] || null;
  if (!heroId) return;
  event.dataTransfer?.setData('text/plain', heroId);
  event.dataTransfer?.setData('application/x-lwhub-hero', JSON.stringify({ heroId, sourceSlot: slot, sourcePos: pos }));
  event.dataTransfer.effectAllowed = 'copyMove';
}
window.onTeamSlotDragStart = onTeamSlotDragStart;

function onPoolHeroDragStart(event, heroId) {
  if (!heroId) return;
  event.dataTransfer?.setData('text/plain', String(heroId));
  event.dataTransfer?.setData('application/x-lwhub-hero', JSON.stringify({ heroId: String(heroId), sourceSlot: null, sourcePos: null }));
  event.dataTransfer.effectAllowed = 'copy';
}
window.onPoolHeroDragStart = onPoolHeroDragStart;

function allowHeroDrop(event) {
  event.preventDefault();
}
window.allowHeroDrop = allowHeroDrop;

function onTeamSlotDrop(event, slot, pos) {
  event.preventDefault();
  let dragMeta = null;
  try {
    dragMeta = JSON.parse(String(event.dataTransfer?.getData('application/x-lwhub-hero') || 'null'));
  } catch (_) {
    dragMeta = null;
  }
  const heroId = String((dragMeta?.heroId ?? event.dataTransfer?.getData('text/plain')) || '').trim();
  if (!heroId) return;
  const entry = getTeamEntry(slot);
  if (entry && !entry.team_type) {
    entry.team_type = 'panzer';
    const typeEl = document.getElementById(`team-editor-type-${slot}`);
    if (typeEl) typeEl.value = 'panzer';
  }
  moveOrSwapHero(slot, pos, heroId, dragMeta?.sourceSlot ?? null, dragMeta?.sourcePos ?? null);
  renderTeamEditorDnD();
}
window.onTeamSlotDrop = onTeamSlotDrop;

function collectVisibleHeroesForDnD() {
  ensureTeamDataShape();
  const activeTypes = new Set();
  for (let slot = 1; slot <= 4; slot++) {
    const typeEl = document.getElementById(`team-editor-type-${slot}`);
    const entry = getTeamEntry(slot);
    const t = String(typeEl?.value || entry?.team_type || '').trim() || 'panzer';
    activeTypes.add(t);
  }
  const all = [OVERLORD_HERO];
  for (const t of activeTypes) {
    for (const h of (heroCatalogByType[t] || [])) all.push(h);
  }
  const byId = new Map();
  all.forEach((h) => { if (!byId.has(h.id)) byId.set(h.id, h); });
  return Array.from(byId.values());
}

function renderTeamEditorDnD() {
  const mount = document.getElementById('team-editor-dnd');
  if (!mount) return;
  const editorModal = mount.closest('.modal');
  const modalScrollTop = editorModal?.scrollTop || 0;
  const heroPool = mount.querySelector('#team-editor-hero-pool');
  const heroPoolScrollTop = heroPool?.scrollTop || 0;
  ensureTeamDataShape();
  normalizeUniqueHeroes();

  const blockHtml = [];
  const monkeyOwner = getMonkeyOwnerSlot();
  for (let slot = 1; slot <= 4; slot++) {
    const entry = getTeamEntry(slot) || { heroes: Array.from({ length: 6 }, () => null), team_type: null };
    const typeEl = document.getElementById(`team-editor-type-${slot}`);
    const type = String(typeEl?.value || entry.team_type || '').trim();
    const effectiveType = type || 'panzer';
    const heroes = normalizeHeroesArray(entry.heroes);
    const catalog = heroCatalogByType[effectiveType] || [];
    const heroMap = heroCatalogMapFor(effectiveType);

    const displayPositions = [5, 0, 1, 2, 3, 4];
    const slotCells = displayPositions.map((dataPos, displayPos) => {
      const heroId = heroes[dataPos];
      const hero = heroId ? heroMap.get(String(heroId)) : null;
      const fallbackHero = !hero && heroId ? getHeroById(heroId) : null;
      const shownHero = hero || fallbackHero;
      const isLockedMonkeySlot = false;
      const content = hero
        ? `<img src="${escHtml(hero.thumb)}" alt="${escHtml(hero.name)}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.12);">`
        : shownHero
          ? `<img src="${escHtml(shownHero.thumb)}" alt="${escHtml(shownHero.name)}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.12);">`
          : `<div style="width:44px;height:44px;border-radius:8px;border:1px dashed ${isLockedMonkeySlot ? 'rgba(240,165,0,0.45)' : 'rgba(255,255,255,0.2)'};display:grid;place-items:center;color:${isLockedMonkeySlot ? 'var(--gold)' : 'var(--soft)'};font-size:11px;">${displayPos === 0 ? tr('s_affe') : tr('s_slot')}</div>`;
      const title = shownHero ? escHtml(shownHero.name) : (isLockedMonkeySlot ? tr('s_affe_slot_gesperrt') : tr('s_drop_hero'));
      const clearBtn = shownHero ? `<button type="button" data-action="clearTeamHero" data-args="${lwArgs(slot, dataPos)}" style="position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;border:1px solid rgba(224,85,69,0.5);background:rgba(224,85,69,0.2);color:#f4b1a8;font-size:10px;line-height:1;padding:0;">×</button>` : '';
      const lockBadge = isLockedMonkeySlot ? '<span style="position:absolute;bottom:-8px;right:-6px;font-size:10px;color:var(--gold);">🔒</span>' : '';
      return `<div style="position:relative;" draggable="${shownHero ? 'true' : 'false'}" data-on-dragstart="onTeamSlotDragStart" data-args-dragstart="${lwArgs(LW_EVENT, slot, dataPos)}" data-on-dragover="allowHeroDrop" data-args-dragover="${lwArgs(LW_EVENT)}" data-on-drop="onTeamSlotDrop" data-args-drop="${lwArgs(LW_EVENT, slot, dataPos)}" title="${title}">${content}${clearBtn}${lockBadge}</div>`;
    }).join('');

    const poolInfo = catalog.length
      ? `<div class="section-sub">${catalog.length} ${tr('s_helden_in')} ${escHtml(tr('s_' + effectiveType))}</div>`
      : `<div class="section-sub">${tr('s_kein_heldenbilder')}</div>`;

    blockHtml.push(`
      <div class="card" style="padding:10px 12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
          <strong>T${slot}</strong>
          <span class="section-sub">${tr('s_six_slots_monkey')} · ${escHtml(tr('s_' + effectiveType))} · ${catalog.length} ${tr('s_helden')}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(44px,1fr));gap:8px;margin-bottom:8px;">${slotCells}</div>
        ${poolInfo}
      </div>
    `);
  }

  const overallHeroes = collectVisibleHeroesForDnD();
  const rightPanel = overallHeroes.length
    ? overallHeroes.map((hero) => {
      const used = findHeroPlacement(hero.id);
      const usedLabel = used ? `T${used.slot} · S${used.pos + 1}` : tr('s_frei');
      const usedColor = used ? 'var(--gold)' : 'var(--green)';
      return `<div draggable="true" data-on-dragstart="onPoolHeroDragStart" data-args-dragstart="${lwArgs(LW_EVENT, hero.id)}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:rgba(255,255,255,0.02);cursor:grab;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <img src="${escHtml(hero.thumb)}" alt="${escHtml(hero.name)}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;">
          <span style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(hero.name)}</span>
        </div>
        <span style="font-size:11px;color:${usedColor};white-space:nowrap;">${usedLabel}</span>
      </div>`;
    }).join('')
    : `<div class="section-sub">${tr('s_kein_helden_verfuegbar')}</div>`;

  const responsiveCols = 'minmax(0,1fr) 220px';
  const rightPanelCardStyle = 'padding:10px 12px;position:sticky;top:12px;align-self:start;height:min(520px,calc(100vh - 56px));display:flex;flex-direction:column;overflow:hidden;';
  mount.innerHTML = `
    <div style="display:grid;grid-template-columns:${responsiveCols};gap:12px;align-items:start;">
      <div style="display:grid;gap:10px;min-width:0;">${blockHtml.join('')}</div>
      <div class="card" style="${rightPanelCardStyle}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
          <strong>${tr('s_alle_helden')}</strong>
          <span class="section-sub">${tr('s_global_eindeutig')}</span>
        </div>
        <div id="team-editor-hero-pool" style="display:grid;gap:6px;min-height:0;flex:1 1 auto;overflow-y:auto;overflow-x:hidden;">${rightPanel}</div>
      </div>
    </div>
  `;
  if (editorModal) editorModal.scrollTop = modalScrollTop;
  const newHeroPool = mount.querySelector('#team-editor-hero-pool');
  if (newHeroPool) newHeroPool.scrollTop = heroPoolScrollTop;
}

function bindTeamEditorTypeListeners() {
  for (let slot = 1; slot <= 4; slot++) {
    const typeEl = document.getElementById(`team-editor-type-${slot}`);
    if (!typeEl || typeEl.dataset.bound === '1') continue;
    typeEl.dataset.bound = '1';
    typeEl.addEventListener('change', () => {
      const entry = getTeamEntry(slot);
      if (entry) entry.team_type = typeEl.value || null;
      renderTeamEditorDnD();
    });
  }
}

function renderTeamHeroStrip(team) {
  const teamType = String(team?.team_type || '').trim() || 'panzer';
  const heroes = normalizeHeroesArray(team?.heroes || []);
  const map = heroCatalogMapFor(teamType);
  const displayHeroes = [heroes[5], ...heroes.slice(0, 5)];
  if (!displayHeroes.some(Boolean)) return '';
  const html = displayHeroes.map((id, index) => {
    const hero = id ? (map.get(String(id)) || getHeroById(id)) : null;
    if (!hero) return `<div aria-hidden="true" style="width:100%;aspect-ratio:1;"></div>`;
    return `<img src="${escHtml(hero.thumb)}" alt="${escHtml(hero.name)}" title="${escHtml(hero.name)}" style="width:100%;aspect-ratio:1;border-radius:6px;object-fit:cover;border:1px solid rgba(255,255,255,0.12);">`;
  }).join('');
  return `<div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:8px;width:100%;">${html}</div>`;
}

async function openTeamEditor(targetName = null) {
  const modal = document.getElementById('modal-team-editor');
  if (!modal) return;
  const effectiveName = String(targetName || authMember?.member_name || '').trim();
  if (!effectiveName) {
    toast('Bitte erst ein Mitglied auswählen.');
    return;
  }
  const isOwnProfile = effectiveName === (authMember?.member_name || '');
  if (!isOwnProfile && !authMember?.can_manage) {
    toast('Nur R4/R5 können die Teams anderer Mitglieder pflegen.');
    return;
  }
  teamEditTargetName = effectiveName;
  await loadHeroCatalogs();
  const form = document.getElementById('team-editor-form');
  if (form) {
    form.reset();
    if (form.dataset.boundSubmit !== '1') {
      form.dataset.boundSubmit = '1';
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        saveTeams(ev);
      });
    }
  }
  try {
    const endpoint = isOwnProfile ? `/my-teams/${encodeURIComponent(effectiveName)}` : `/teams/${encodeURIComponent(effectiveName)}`;
    const data = await fetchJson(endpoint);
    teamData = data;
  } catch (err) {
    teamData = { member_name: effectiveName, teams: [], total_hero_power: null, has_data: false };
  }
  ensureTeamDataShape();
  populateTeamEditor();
  bindTeamEditorTypeListeners();
  bindTeamPowerListeners();
  modal.classList.remove('hidden');
  teamEditOpen = true;
}
window.openTeamEditor = openTeamEditor;

function closeTeamEditor() {
  const modal = document.getElementById('modal-team-editor');
  if (modal) modal.classList.add('hidden');
  teamEditOpen = false;
}
window.closeTeamEditor = closeTeamEditor;

function populateTeamEditor() {
  const currentName = authMember?.member_name || '';
  const nameEl = document.getElementById('team-editor-member-name');
  if (nameEl) nameEl.textContent = teamData.member_name || currentName;
  const totalEl = document.getElementById('team-editor-total');
  if (totalEl) totalEl.value = teamData.total_hero_power ?? '';
  const overlordOwner = getMonkeyOwnerSlot();
  const legacyMonkeyLevel = teamData.teams.map(team => team.monkey_level).find(value => value != null && value !== '');
  const monkeyLevelEl = document.getElementById('team-editor-monkey-level');
  if (monkeyLevelEl) monkeyLevelEl.value = teamData.teams.find(team => Number(team.slot) === overlordOwner)?.monkey_level ?? legacyMonkeyLevel ?? '';
  ensureTeamDataShape();
  for (let slot = 1; slot <= 4; slot++) {
    const entry = teamData.teams.find(t => t.slot === slot) || { team_type: null, combat_power: null, monkey_level: null, heroes: Array.from({ length: 6 }, () => null) };
    const typeEl = document.getElementById(`team-editor-type-${slot}`);
    const powerEl = document.getElementById(`team-editor-power-${slot}`);
    if (typeEl) typeEl.value = entry.team_type || '';
    if (powerEl) powerEl.value = entry.combat_power ?? '';
  }
  updateTeamPowerConstraint();
  renderTeamEditorDnD();
}

function updateTeamPowerConstraint() {
  const correction = Math.max(0, Math.min(998, Number.parseInt(String(flagConfig.combat_power_correction_value ?? ''), 10) || 40));
  for (let slot = 1; slot <= 4; slot++) {
    const powerEl = document.getElementById(`team-editor-power-${slot}`);
    if (powerEl && Number(powerEl.value) >= 999) powerEl.value = String(correction);
  }
  // Heldenkampfkraft zaehlt alle Helden, nicht nur die in T1–T4: keine Grenze aus der Team-Summe (bis 15.11. max. 120 %)
}

function bindTeamPowerListeners() {
  for (let slot = 1; slot <= 4; slot++) {
    const powerEl = document.getElementById(`team-editor-power-${slot}`);
    if (!powerEl || powerEl.dataset.boundPower === '1') continue;
    powerEl.dataset.boundPower = '1';
    powerEl.addEventListener('input', () => {
      const correction = Math.max(0, Math.min(998, Number.parseInt(String(flagConfig.combat_power_correction_value ?? ''), 10) || 40));
      if (Number(powerEl.value) >= 999) powerEl.value = String(correction);
      updateTeamPowerConstraint();
    });
  }
}

async function saveTeams(event = null) {
  try {
    event?.preventDefault?.();
    event?.stopPropagation?.();
  } catch (_) {}

  const targetName = teamEditTargetName || authMember?.member_name || '';
  if (!targetName) {
    toast('Bitte erst ein Mitglied auswählen.');
    return;
  }
  const isOwnProfile = targetName === (authMember?.member_name || '');
  if (!isOwnProfile && !authMember?.can_manage) {
    toast('Nur R4/R5 können die Teams anderer Mitglieder pflegen.');
    return;
  }
  updateTeamPowerConstraint();
  const monkeyLevel = document.getElementById('team-editor-monkey-level')?.value || '';
  const monkeyOwner = getMonkeyOwnerSlot();
  const payload = {
    member_name: targetName,
    teams: Array.from({ length: 4 }, (_, i) => {
      const slot = i + 1;
      const entry = getTeamEntry(slot) || {};
      const typeEl = document.getElementById(`team-editor-type-${slot}`);
      const powerEl = document.getElementById(`team-editor-power-${slot}`);
      return {
        slot,
        team_type: typeEl?.value || '',
        combat_power: powerEl?.value || '',
        monkey_level: monkeyOwner === slot ? monkeyLevel : '',
        heroes: normalizeHeroesArray(entry.heroes || [])
      };
    }),
    total_hero_power: document.getElementById('team-editor-total')?.value || ''
  };
  try {
    const endpoint = isOwnProfile ? `/my-teams/${encodeURIComponent(targetName)}` : `/teams/${encodeURIComponent(targetName)}`;
    const data = await fetchJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    teamData = data;
    await renderTeamsPage();
    closeTeamEditor();
    toast(tr('s_teams_gespeichert'));
  } catch (err) {
    const msg = (err && (err.message || err.error)) ? (err.message || err.error) : 'Unbekannter Fehler beim Speichern';
    console.error('[Teams][Save] failed', err);
    toast('Fehler: ' + msg);
  }
}
window.saveTeams = saveTeams;

async function renderTeamsPage() {
  const summaryEl = document.getElementById('teams-summary');
  const listEl = document.getElementById('alliance-teams-list');
  if (!summaryEl || !listEl) return;
  const currentName = authMember?.member_name || '';
  if (!currentName) {
    summaryEl.innerHTML = '<div class="empty">Bitte erst ein Mitglied auswählen.</div>';
    listEl.innerHTML = '<div class="empty">Keine Daten.</div>';
    return;
  }
  try {
    await loadHeroCatalogs();
    const data = await fetchJson(`/my-teams/${encodeURIComponent(currentName)}`);
    teamData = data;
    ensureTeamDataShape();
    const formatPower = (value) => {
      if (value == null || value === '') return '—';
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      return n.toLocaleString('de-DE');
    };
    const rows = teamData.teams.map((team) => {
      const typeLabel = team.team_type ? tr(`s_${team.team_type}`) : '—';
      const power = formatPower(team.combat_power);
      const hasOverlord = normalizeHeroesArray(team.heroes || [])[5] === OVERLORD_HERO.id;
      const monkey = hasOverlord && team.monkey_level != null && team.monkey_level !== ''
        ? ` · ${tr('s_affe_lv')} ${team.monkey_level}`
        : '';
      const heroesHtml = renderTeamHeroStrip(team);
      return `<div class="card" style="margin-bottom:8px;padding:12px 14px;">T${team.slot}: <strong>${typeLabel}</strong> · ${tr('s_combat_power')} ${power}${monkey}${heroesHtml}</div>`;
    }).join('');
    const updatedAt = teamData.updated_at ? new Date(teamData.updated_at) : null;
    const stale = updatedAt && (Date.now() - updatedAt.getTime()) > 28 * 24 * 60 * 60 * 1000;
    const staleBanner = stale ? `<div class="card" style="margin-top:10px;padding:10px 12px;border-color:rgba(224,85,69,0.35);background:rgba(224,85,69,0.1);color:#f09080;">⚠ ${escHtml(tr('s_teams_aelter_als_4_wochen'))}</div>` : '';
    summaryEl.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;">
        <div><strong>${escHtml(teamData.member_name || currentName)}</strong><div class="section-sub" style="margin-top:4px;">${teamData.has_data ? tr('s_teams_aktueller_stand') : tr('s_teams_noch_keine_daten')}</div></div>
        <div class="card" style="margin:0;padding:10px 12px;min-width:180px;">${tr('s_total_hero_power')}: <strong>${formatPower(teamData.total_hero_power)}</strong></div>
      </div>
      ${staleBanner}
      <div style="margin-top:12px;">${rows || '<div class="empty">Keine Team-Daten vorhanden.</div>'}</div>`;
  } catch (err) {
    summaryEl.innerHTML = '<div class="empty">Fehler beim Laden der Teams.</div>';
  }

  try {
    const allianceData = await fetchJson('/alliance-teams');
    const members = allianceData.members || [];
    const formatPower = (value) => {
      if (value == null || value === '') return '—';
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      return n.toLocaleString('de-DE');
    };
    listEl.innerHTML = members.length ? `
      <div style="overflow-x:auto;">
        <table class="archive-table" style="width:100%;">
          <thead>
            <tr>
              <th>${escHtml(tr('s_spieler'))}</th>
              <th>${escHtml(tr('s_total_hero_power'))}</th>
              <th>T1</th>
              <th>T2</th>
              <th>T3</th>
              <th>T4</th>
              <th>${escHtml(tr('s_letzter_gespeicherter_stand'))}</th>
            </tr>
          </thead>
          <tbody>
            ${members.map((row) => {
      const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
      const stale = updatedAt && (Date.now() - updatedAt.getTime()) > 28 * 24 * 60 * 60 * 1000;
      const staleBadge = stale ? '<span style="color:#f09080;font-weight:700;">⚠</span>' : '';
      const teamCell = (slot) => {
        const power = formatPower(row[`t${slot}_power`]);
        const typeRaw = String(row[`t${slot}_type`] || '').trim();
        const monkeyLevel = row[`t${slot}_monkey_level`];
        const monkey = (monkeyLevel != null && monkeyLevel !== '') ? ` · ${tr('s_affe_lv')} ${monkeyLevel}` : '';
        const type = typeRaw ? `${tr(`s_${typeRaw}`)} · ` : '';
        return `${type}${power}${monkey}`;
      };
      return `
            <tr>
              <td><strong>${escHtml(row.current_name || 'Unbekannt')}</strong></td>
              <td>${formatPower(row.total_hero_power)}</td>
              <td>${teamCell(1)}</td>
              <td>${teamCell(2)}</td>
              <td>${teamCell(3)}</td>
              <td>${teamCell(4)}</td>
              <td style="white-space:nowrap;">${staleBadge}${row.updated_at ? new Date(row.updated_at).toLocaleString('de-DE') : '—'}</td>
            </tr>`;
    }).join('')}
          </tbody>
        </table>
      </div>` : '<div class="empty">Noch keine Teams gespeichert.</div>';
  } catch (err) {
    listEl.innerHTML = '<div class="empty">Übersicht konnte nicht geladen werden.</div>';
  }
}
window.renderTeamsPage = renderTeamsPage;

async function loadTeamsForCurrentUser() {
  if (!authMember?.member_name) return;
  await renderTeamsPage();
}
window.loadTeamsForCurrentUser = loadTeamsForCurrentUser;
