// LWHub – Events (/events): Wache, Wüste, Spezialevents, VS mit Sparwoche, Spenden
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Seiten herauslösen“).
// Normales Script, kein Modul: lädt nach dem großen <script> in index.html und vor assets/js/start.js.

// ══════════════════════════════════════════════════════
//  WACHE-VERWALTUNG
// ══════════════════════════════════════════════════════
let activeWache = 1;
let activeEventView = 'w1';
let eventDoneMode = 0; // 0=normal, 1=ans Ende, 2=ausblenden
const EVENT_CONTRAST_KEY = 'iny_event_high_contrast_v1';
let eventHighContrast = localStorage.getItem(EVENT_CONTRAST_KEY) === '1';

function applyEventContrastState(){
  document.body.classList.toggle('event-high-contrast', eventHighContrast);
  const btn = document.getElementById('btn-event-contrast');
  if (!btn) return;
  btn.classList.toggle('hc-on', eventHighContrast);
  btn.textContent = eventHighContrast ? '◑ High Contrast' : '◐ High Contrast';
}

function toggleEventContrast(){
  eventHighContrast = !eventHighContrast;
  localStorage.setItem(EVENT_CONTRAST_KEY, eventHighContrast ? '1' : '0');
  applyEventContrastState();
  if (document.getElementById('page-w').classList.contains('active')) selectEventView(activeEventView);
}
window.toggleEventContrast = toggleEventContrast;
applyEventContrastState();

function toggleEventDoneMode(){
  eventDoneMode=(eventDoneMode+1)%3;
  const btn=document.getElementById('btn-event-done-bottom');
  if(eventDoneMode===0){btn.classList.remove('on');btn.textContent='↓ '+tr('Erfasste ans Ende');}
  else if(eventDoneMode===1){btn.classList.add('on');btn.textContent='↓ '+tr('Erfasste ans Ende');}
  else{btn.classList.add('on');btn.textContent='○ '+tr('Erfasste ausblenden');}
  selectEventView(activeEventView);
}
window.toggleEventDoneMode=toggleEventDoneMode;

const EVENT_NAME_COLLATOR = new Intl.Collator('de', {
  sensitivity: 'base',
  ignorePunctuation: true,
  numeric: true
});

function normalizeEventSortToken(token){
  return String(token || '')
    .toLowerCase()
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't');
}

function buildEventSortKey(name){
  const raw = String(name || '').toLowerCase().trim();
  if (!raw) return '';

  const normalized = raw
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = normalized ? normalized.split(' ').filter(Boolean) : [];
  while (tokens.length > 1 && tokens[0].length <= 2) tokens.shift();
  while (tokens.length > 1 && tokens[tokens.length - 1].length <= 2) tokens.pop();

  const effective = (tokens.length ? tokens : [normalized || raw]).map(normalizeEventSortToken);
  return effective.join(' ');
}

function getEventSortedMembers(memberList){
  return [...memberList].sort((a, b) => {
    const keyA = buildEventSortKey(a);
    const keyB = buildEventSortKey(b);
    const byKey = EVENT_NAME_COLLATOR.compare(keyA, keyB);
    if (byKey !== 0) return byKey;
    return EVENT_NAME_COLLATOR.compare(String(a || ''), String(b || ''));
  });
}

function applyEventDoneSort(memberList, isDoneFn){
  const sortedMembers = getEventSortedMembers(memberList);
  if(eventDoneMode===0) return {list:sortedMembers,splitAt:-1};
  const undone=sortedMembers.filter(n=>!isDoneFn(n));
  const done=sortedMembers.filter(n=>isDoneFn(n));
  if(eventDoneMode===2) return {list:undone,splitAt:-1};
  const splitAt=undone.length>0&&done.length>0?undone.length:-1;
  return {list:[...undone,...done],splitAt};
}

function selectWache(n) {
  activeWache = n;
  selectEventView('w' + n);
}

// Welche Event-Kategorie beim Oeffnen aufgeht: die selbst gewaehlte, solange sichtbar; sonst die erste sichtbare
// mit Haekchen in dieser KW; sonst die erste sichtbare (bisher immer "Wache 1", auch wenn leer oder ausgeschaltet)
const EVENT_VIEW_FLAGS = {
  w1: ['wache1', 'wache1dmg'], w2: ['wache2', 'wache2dmg'], w3: ['wache3', 'wache3dmg'],
  wu: ['wuesteAnmeldung', 'wuesteTeilnahme', 'wuesteFehlen'], se: ['seTeilnahme', 'seTop50', 'seTop20'],
  vs: ['vsTop10', 'vsTop30', 'vsUnter50', 'vsSpar'], sp: ['spendeTop20', 'spendeUnter35k'],
};
let eventViewPicked = false;
function pickEventView() {
  updateEventTabVisibility();
  const visible = [...document.querySelectorAll('.wache-tab')].filter(b => b.style.display !== 'none').map(b => b.dataset.ev);
  if (eventViewPicked && visible.includes(activeEventView)) return activeEventView;
  const withValues = visible.find(v => entries.some(e => (EVENT_VIEW_FLAGS[v] || []).some(k => e.flags[k])));
  return withValues || (visible.includes(activeEventView) ? activeEventView : visible[0] || activeEventView);
}

function selectEventView(view, byUser = false) {
  if (byUser) eventViewPicked = true;
  activeEventView = view;
  lwSubChanged('w', !byUser); // automatisch gewaehlt: Adresse nur ersetzen, kein neuer Verlaufseintrag
  updateEventTabVisibility();
  document.querySelectorAll('.wache-tab').forEach(b => b.classList.toggle('on', b.dataset.ev === view));

  const mode = view === 'wu' ? 'wu' : (view === 'se' ? 'se' : view === 'vs' ? 'vs' : view === 'sp' ? 'sp' : 'w');
  document.querySelectorAll('.event-section').forEach(sec => {
    sec.classList.toggle('active', sec.dataset.event === mode);
  });

  if (mode === 'w') {
    activeWache = parseInt(view.slice(1), 10) || 1;
    renderWache();
    return;
  }
  if (mode === 'wu') { renderWueste(); return; }
  if (mode === 'vs') { renderVS(); return; }
  if (mode === 'sp') { renderSpende(); return; }
  renderSpezial();
}

function renderWache() {
  const grid = document.getElementById('wache-grid');
  const wKey = 'wache' + activeWache;
  const wDmgKey = 'wache' + activeWache + 'dmg';

  const isDone = name => { const e=entries.find(x=>x.name===name); const f=e?e.flags:{}; return !!(f[wKey]||f[wDmgKey]); };
  const {list,splitAt} = applyEventDoneSort(weekMembers(), isDone);

  let teilCount = 0;
  grid.innerHTML = list.map((name,i) => {
    const e = entries.find(x => x.name === name);
    const flags = e ? e.flags : {};
    const teil = !!flags[wKey];
    const dmg = !!flags[wDmgKey];
    if (teil) teilCount++;

    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    const cls = dmg ? 'w-dmg' : teil ? 'w-ok' : 'w-none';
    const esc = name.replace(/'/g,"\\'");
    const dimCls = (eventDoneMode===1 && isDone(name)) ? ' done-dim' : '';

    const btnBad = `<button class="wt-btn ${dmg?'on-bad':''}" data-action="wacheSet" data-args="${lwArgs(name, 'bad')}" title="wenig Schaden < 2G">${dmg?'⚠ &lt;2G':'💤'}</button>`;
    const btnGood = `<button class="wt-btn ${(teil&&!dmg)?'on-good':''}" data-action="wacheSet" data-args="${lwArgs(name, 'good')}" title="guter Schaden">${(teil&&!dmg)?'⚔ gut':'⚔'}</button>`;

    const divider = i===splitAt ? '<div class="wt-done-divider">✓ Bereits erfasst</div>' : '';
    return divider+`<div class="wache-tile${dimCls} ${cls}${formerCls(name)}">
      <div class="wt-top">
        <div class="wt-name">${name}${formerTag(name)}</div>
        <div class="wt-rank" style="color:${RC[rank]||'#888'}">R${rank} · ${RL[rank]||''}</div>
      </div>
      <div class="wt-btns">${btnBad}${btnGood}</div>
    </div>`;
  }).join('');

  document.getElementById('w-counter').textContent = `${teilCount} / ${weekMembers().length}`;
}

// Kachel-Button: 'bad' = Teilnahme + kein DMG, 'good' = nur Teilnahme
async function wacheSet(name, type) {
  if (guardFormer(name)) return;
  const wKey = 'wache' + activeWache;
  const wDmgKey = 'wache' + activeWache + 'dmg';
  let e = entries.find(x => x.name === name);
  if (!e) {
    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    e = { name, rank, baseRank: rank, flags: {}, points: 0, afk: false };
    entries.push(e);
  }
  const flags = e.flags;

  if (type === 'bad') {
    if (flags[wDmgKey]) { delete flags[wKey]; delete flags[wDmgKey]; }
    else { flags[wKey] = true; flags[wDmgKey] = true; }
  } else {
    if (flags[wKey] && !flags[wDmgKey]) { delete flags[wKey]; }
    else { flags[wKey] = true; delete flags[wDmgKey]; }
  }

  e.points = calcPoints(flags);
  e.rank = calcRanking(e.points, e.baseRank || PREV[name] || 3);
  renderWache();

  try {
    if (Object.keys(flags).length === 0) {
      entries = entries.filter(x => x.name !== name);
      await apiPost({ action: 'delete_entry', name });
    } else {
      await apiPost({ action: 'save_wache', name, rank: PREV[name] || e.baseRank || 3, flags: { ...flags } });
    }
    await loadEntries();
    renderWache();
  } catch(err) { toast(tr('Fehler: ') + err.message); }
}
window.wacheSet = wacheSet;
window.selectWache = selectWache;
window.selectEventView = selectEventView;

// ══════════════════════════════════════════════════════
//  WÜSTE-VERWALTUNG
// ══════════════════════════════════════════════════════
function renderWueste() {
  const grid = document.getElementById('wueste-grid');

  const isDone = name => { const e=entries.find(x=>x.name===name); const f=e?e.flags:{}; return !!(f.wuesteAnmeldung||f.wuesteTeilnahme||f.wuesteFehlen); };
  const {list,splitAt} = applyEventDoneSort(weekMembers(), isDone);

  let teilCount = 0;
  grid.innerHTML = list.map((name,i) => {
    const e = entries.find(x => x.name === name);
    const flags = e ? e.flags : {};
    const anm = !!flags.wuesteAnmeldung;
    const teil = !!flags.wuesteTeilnahme;
    const fehl = !!flags.wuesteFehlen;
    if (teil) teilCount++;

    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    const cls = fehl ? 'w-dmg' : teil ? 'w-ok' : anm ? 'w-anm' : 'w-none';
    const esc = name.replace(/'/g,"\\'");
    const dimCls = (eventDoneMode===1 && isDone(name)) ? ' done-dim' : '';

    const btnAnm  = `<button class="wt-btn ${anm?'on-anm':''}" data-action="wuesteSet" data-args="${lwArgs(name, 'anm')}" title="Anmeldung">${anm?'📋 an':'📋'}</button>`;
    const btnTeil = `<button class="wt-btn ${teil?'on-good':''}" data-action="wuesteSet" data-args="${lwArgs(name, 'teil')}" title="Teilnahme">${teil?'⚔ teil':'⚔'}</button>`;
    const btnFehl = `<button class="wt-btn ${fehl?'on-bad':''}" data-action="wuesteSet" data-args="${lwArgs(name, 'fehl')}" title="Fehlen (Strafe)">${fehl?'⚠ fehlt':'💀'}</button>`;

    const divider = i===splitAt ? '<div class="wt-done-divider">✓ Bereits erfasst</div>' : '';
    return divider+`<div class="wache-tile${dimCls} ${cls}${formerCls(name)}">
      <div class="wt-top">
        <div class="wt-name">${name}${formerTag(name)}</div>
        <div class="wt-rank" style="color:${RC[rank]||'#888'}">R${rank} · ${RL[rank]||''}</div>
      </div>
      <div class="wt-btns">${btnAnm}${btnTeil}${btnFehl}</div>
    </div>`;
  }).join('');

  document.getElementById('wu-counter').textContent = `${teilCount} / ${weekMembers().length}`;
}

// Kachel-Button: Teilnahme/Fehlen sind gegenseitig exklusiv, Anmeldung unabhängig
async function wuesteSet(name, type) {
  if (guardFormer(name)) return;
  let e = entries.find(x => x.name === name);
  if (!e) {
    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    e = { name, rank, baseRank: rank, flags: {}, points: 0, afk: false };
    entries.push(e);
  }
  const flags = e.flags;

  if (type === 'anm') {
    if (flags.wuesteAnmeldung) delete flags.wuesteAnmeldung;
    else flags.wuesteAnmeldung = true;
  } else if (type === 'teil') {
    if (flags.wuesteTeilnahme) { delete flags.wuesteTeilnahme; }
    else { flags.wuesteTeilnahme = true; delete flags.wuesteFehlen; }
  } else if (type === 'fehl') {
    if (flags.wuesteFehlen) { delete flags.wuesteFehlen; }
    else { flags.wuesteFehlen = true; delete flags.wuesteTeilnahme; }
  }

  e.points = calcPoints(flags);
  e.rank = calcRanking(e.points, e.baseRank || PREV[name] || 3);
  renderWueste();

  try {
    if (Object.keys(flags).length === 0) {
      entries = entries.filter(x => x.name !== name);
      await apiPost({ action: 'delete_entry', name });
    } else {
      await apiPost({ action: 'save_wueste', name, rank: PREV[name] || e.baseRank || 3, flags: { ...flags } });
    }
    await loadEntries();
    renderWueste();
  } catch(err) { toast(tr('Fehler: ') + err.message); }
}
window.wuesteSet = wuesteSet;

// ══════════════════════════════════════════════════════
//  SPEZIALEVENTS
// ══════════════════════════════════════════════════════
function renderSpezial() {
  const grid = document.getElementById('spezial-grid');
  initSpezialScanForm();

  const isDone = name => { const e=entries.find(x=>x.name===name); const f=e?e.flags:{}; return !!(f.seTeilnahme||f.seTop50||f.seTop20); };
  const {list,splitAt} = applyEventDoneSort(weekMembers(), isDone);

  let teilCount = 0;
  grid.innerHTML = list.map((name,i) => {
    const e = entries.find(x => x.name === name);
    const flags = e ? e.flags : {};
    const teil = !!flags.seTeilnahme;
    const t50 = !!flags.seTop50;
    const t20 = !!flags.seTop20;
    if (teil) teilCount++;

    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    const cls = t20 ? 'w-top20' : t50 ? 'w-top50' : teil ? 'w-anm' : 'w-none';
    const esc = name.replace(/'/g,"\\'");
    const dimCls = (eventDoneMode===1 && isDone(name)) ? ' done-dim' : '';

    const btnTeil = `<button class="wt-btn ${teil?'on-anm':''}" data-action="spezialSet" data-args="${lwArgs(name, 'teil')}" title="Teilnahme">${teil?'⚔ teil':'⚔'}</button>`;
    const btn50  = `<button class="wt-btn ${t50?'on-good':''}" data-action="spezialSet" data-args="${lwArgs(name, 't50')}" title="Top 50">${t50?'🏅 T50':'🏅'}</button>`;
    const btn20  = `<button class="wt-btn ${t20?'on-gold':''}" data-action="spezialSet" data-args="${lwArgs(name, 't20')}" title="Top 20">${t20?'🏆 T20':'🏆'}</button>`;

    const divider = i===splitAt ? '<div class="wt-done-divider">✓ Bereits erfasst</div>' : '';
    return divider+`<div class="wache-tile${dimCls} ${cls}${formerCls(name)}">
      <div class="wt-top">
        <div class="wt-name">${name}${formerTag(name)}</div>
        <div class="wt-rank" style="color:${RC[rank]||'#888'}">R${rank} · ${RL[rank]||''}</div>
      </div>
      <div class="wt-btns">${btnTeil}${btn50}${btn20}</div>
    </div>`;
  }).join('');

  document.getElementById('se-counter').textContent = `${teilCount} / ${weekMembers().length}`;
}

// Hierarchie: Top 20 impliziert Top 50 impliziert Teilnahme (beim Einschalten)
async function spezialSet(name, type) {
  if (guardFormer(name)) return;
  let e = entries.find(x => x.name === name);
  if (!e) {
    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    e = { name, rank, baseRank: rank, flags: {}, points: 0, afk: false };
    entries.push(e);
  }
  const flags = e.flags;

  if (type === 'teil') {
    if (flags.seTeilnahme) {
      // Aus → alles weg
      delete flags.seTeilnahme;
      delete flags.seTop50;
      delete flags.seTop20;
    } else {
      flags.seTeilnahme = true;
    }
  } else if (type === 't50') {
    if (flags.seTop50) {
      delete flags.seTop50;
      delete flags.seTop20;
    } else {
      flags.seTeilnahme = true;
      flags.seTop50 = true;
    }
  } else if (type === 't20') {
    if (flags.seTop20) {
      delete flags.seTop20;
    } else {
      flags.seTeilnahme = true;
      flags.seTop50 = true;
      flags.seTop20 = true;
    }
  }

  e.points = calcPoints(flags);
  e.rank = calcRanking(e.points, e.baseRank || PREV[name] || 3);
  renderSpezial();

  try {
    if (Object.keys(flags).length === 0) {
      entries = entries.filter(x => x.name !== name);
      await apiPost({ action: 'delete_entry', name });
    } else {
      await apiPost({ action: 'save_spezial', name, rank: PREV[name] || e.baseRank || 3, flags: { ...flags } });
    }
    await loadEntries();
    renderSpezial();
  } catch(err) {
    toast(tr('Fehler: ') + err.message);
  }
}
window.spezialSet = spezialSet;

// Spezialevent-Haekchen aus der Vorher/Nachher-Auswertung (Scanner, GET /scans/event-compare – dieselben
// Daten wie web-scanner-onnx/event.html). Teilnahme: Kills gestiegen oder Kampfkraft um mind. 0,3 % gesunken
// (Standard der Auswertung). Top 50/Top 20 nach Kills-Zuwachs unter den Teilnehmern. Spieler ohne
// Vorher- und Nachher-Scan bleiben unberuehrt, ebenso andere Haekchen der Woche.
const SE_SCANNER_LOSS_PCT = 0.3;
const SE_EVENT_FORM_KEY = 'lwhub_event_form_v1'; // gemeinsam mit event.html (gleiche Domain)
const pad2 = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// ISO-Woche eines Datums im Format von kw (2642 = 2026 KW 42)
function yearWeekOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const week = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return (d.getUTCFullYear() % 100) * 100 + week;
}
// Samstag einer Woche im Format von kw (2642 -> 2026-10-17)
function saturdayOfYearWeek(yw) {
  const year = 2000 + Math.floor(Number(yw) / 100), week = Number(yw) % 100;
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(year, 0, 4 - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
  return isoDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 5));
}
// Ortszeit <-> Serverzeit (Spielserver UTC−2, wie scanGameTime). Events liegen im Spiel zu fester Serverzeit,
// bei uns verschiebt sich die Uhrzeit mit der Zeitumstellung: 12:00 Server = 16:00 im Sommer, 15:00 im Winter.
const GAME_UTC_OFFSET_MIN = -120;
function localToGameTime(date, time) {
  const d = new Date(`${date}T${time}`);
  const m = (((d.getUTCHours() * 60 + d.getUTCMinutes() + GAME_UTC_OFFSET_MIN) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
function gameToLocalTime(date, gameTime) {
  const [y, mo, da] = date.split('-').map(Number);
  const [h, mi] = gameTime.split(':').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, da, h, mi) - GAME_UTC_OFFSET_MIN * 60000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
// Uhrzeit eines frueheren Events auf einen anderen Tag uebertragen – gleiche Serverzeit, nicht gleiche Ortszeit
const carryEventTime = (fromDate, time, toDate) => gameToLocalTime(toDate, localToGameTime(fromDate, time));

// Spezialevents je KW (GET/POST /special-events): Name, Tag und Zeitfenster gelten fuer alle Allianzen
// desselben Servers, "kein Event" ebenso; "nicht auswerten" legt jede Allianz fuer sich fest.
let seEvents = { loaded: false, loading: false, byKw: new Map(), skipped: new Set(), titles: [], server: null };
const seEventOf = (yw = kw) => seEvents.byKw.get(Number(yw)) || null;
const seSkipped = (yw = kw) => seEvents.skipped.has(Number(yw));
function applySpecialEvents(data) {
  seEvents = {
    loaded: true, loading: false,
    byKw: new Map((data.events || []).map(e => [Number(e.year_week), e])),
    skipped: new Set((data.skipped_weeks || []).map(Number)),
    titles: data.titles || [],
    server: data.server || null,
  };
  const list = document.getElementById('se-ev-titles');
  if (list) list.innerHTML = seEvents.titles.map(t => `<option value="${escHtml(t)}"></option>`).join('');
}
async function loadSpecialEvents() {
  if (seEvents.loading) return;
  seEvents.loading = true;
  try { applySpecialEvents(await fetchJson('/special-events')); }
  catch (_) { seEvents = { ...seEvents, loaded: true, loading: false }; }
  seFormKw = null; // Formular mit den geladenen Werten neu fuellen
  if (document.querySelector('.event-section[data-event="se"].active')) renderSpezial();
}
async function postSpecialEvent(payload) {
  const data = await fetchJson('/special-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year_week: Number(kw), discord_id: authMember?.discord_id || '', ...payload }),
  });
  applySpecialEvents(data);
  return seEventOf();
}

const seForm = () => ({
  title: document.getElementById('se-ev-title')?.value.trim() || '',
  date: document.getElementById('se-scan-date')?.value || '',
  start: document.getElementById('se-scan-start')?.value || '',
  end: document.getElementById('se-scan-end')?.value || '',
});
const seFormMatches = (ev, f = seForm()) => !!ev && !ev.no_event
  && (ev.title || '') === f.title && ev.event_date === f.date && (ev.start || '') === f.start && (ev.end || '') === f.end;

// Formular gehoert zur KW: beim KW-Wechsel das festgelegte Event, sonst Samstag der Woche mit den
// Zeiten des letzten Events. Eigene Aenderungen bleiben, solange die KW gleich bleibt.
let seFormKw = null;
let seFormBound = false;
function fillSpezialForm() {
  const ev = seEventOf();
  const last = [...seEvents.byKw.values()].find(e => !e.no_event && e.start && e.end);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SE_EVENT_FORM_KEY) || '{}') || {}; } catch (_) {}
  const useEv = ev && !ev.no_event;
  const date = useEv ? ev.event_date : saturdayOfYearWeek(kw);
  // Zeiten des letzten Events ueber die Serverzeit uebernehmen (Zeitumstellung, siehe carryEventTime)
  const carry = t => (last?.event_date && t ? carryEventTime(last.event_date, t, date) : null);
  document.getElementById('se-ev-title').value = useEv ? (ev.title || '') : '';
  document.getElementById('se-scan-date').value = date;
  document.getElementById('se-scan-start').value = (useEv && ev.start) || carry(last?.start) || saved.start || '16:00';
  document.getElementById('se-scan-end').value = (useEv && ev.end) || carry(last?.end) || saved.end || '20:00';
}
function syncSpezialEvalLink() {
  const f = seForm();
  const st = document.getElementById('se-server-time');
  if (st) st.textContent = f.date && f.start && f.end
    ? trf('Serverzeit {s}–{e}', { s: localToGameTime(f.date, f.start), e: localToGameTime(f.date, f.end) }) : '';
  const form = { date: f.date, start: f.start, end: f.end };
  try {
    const saved = JSON.parse(localStorage.getItem(SE_EVENT_FORM_KEY) || '{}') || {};
    localStorage.setItem(SE_EVENT_FORM_KEY, JSON.stringify({ ...saved, ...form }));
  } catch (_) {}
  const link = document.getElementById('se-scan-eval');
  if (link) link.href = `web-scanner-onnx/event.html?${new URLSearchParams(form)}`;
}
function updateSpezialPlanStatus() {
  const ev = seEventOf();
  const skipped = seSkipped();
  const noEvent = !!ev?.no_event;
  const kwNo = kw % 100;
  const where = seEvents.server ? trf('Server {s}', { s: seEvents.server }) : tr('nur diese Allianz (keine Server-Nummer)');
  const status = document.getElementById('se-plan-status');
  if (status) {
    const unsaved = !noEvent && ev && !seFormMatches(ev);
    status.classList.toggle('unsaved', !ev || unsaved);
    status.textContent = !seEvents.loaded ? '…'
      : noEvent ? `🚫 ${trf('kein Spezialevent in KW {kw}', { kw: kwNo })} · ${where}`
      : !ev ? `○ ${tr('noch nicht festgelegt')} · ${where}`
      : unsaved ? `● ${tr('Änderungen nicht gespeichert')}`
      : `✓ ${trf('festgelegt von {by}', { by: [ev.updated_by, ev.updated_alliance].filter(Boolean).join(' · ') || '?' })} · ${where}`;
  }
  document.getElementById('se-btn-none')?.classList.toggle('on', noEvent);
  document.getElementById('se-btn-skip')?.classList.toggle('on', skipped);
  const importBtn = document.getElementById('se-btn-import');
  if (importBtn) importBtn.disabled = noEvent || skipped;
  const banner = document.getElementById('se-off-banner');
  if (banner) {
    banner.hidden = !(noEvent || skipped);
    banner.textContent = noEvent
      ? trf('🚫 In KW {kw} gibt es kein Spezialevent – die Woche zählt bei „Kein Spezialevent in letzten Wochen“ nicht mit.', { kw: kwNo })
      : skipped ? trf('⏸ KW {kw} wird von unserer Allianz nicht ausgewertet – die Woche zählt bei „Kein Spezialevent in letzten Wochen“ nicht mit.', { kw: kwNo }) : '';
  }
  document.getElementById('spezial-grid')?.classList.toggle('se-off', noEvent || skipped);
}
function initSpezialScanForm() {
  if (!document.getElementById('se-scan-date')) return;
  if (!seEvents.loaded) loadSpecialEvents();
  if (!seFormBound) {
    ['se-ev-title', 'se-scan-date', 'se-scan-start', 'se-scan-end'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', updateSpezialPlanStatus);
      el.addEventListener('change', () => { syncSpezialEvalLink(); updateSpezialPlanStatus(); });
    });
    seFormBound = true;
  }
  if (seFormKw !== Number(kw)) {
    fillSpezialForm();
    if (seEvents.loaded) seFormKw = Number(kw);
  }
  syncSpezialEvalLink();
  updateSpezialPlanStatus();
}

async function spezialSaveEvent({ silent = false } = {}) {
  const f = seForm();
  if (!f.date || !f.start || !f.end) { toast(tr('Bitte Tag, Start und Ende des Events angeben.')); return null; }
  if (yearWeekOf(f.date) !== Number(kw)) {
    const ask = trf('Das Event am {date} liegt in KW {ew}, gewählt ist KW {kw}. Trotzdem in KW {kw} eintragen?', { date: new Date(`${f.date}T12:00:00`).toLocaleDateString(uiLang()), ew: yearWeekOf(f.date) % 100, kw: kw % 100 });
    if (!confirm(ask)) return null;
  }
  try {
    const ev = await postSpecialEvent({ title: f.title, event_date: f.date, start: f.start, end: f.end });
    updateSpezialPlanStatus();
    if (!silent) toast(seEvents.server ? trf('Spezialevent für KW {kw} festgelegt (Server {s})', { kw: kw % 100, s: seEvents.server }) : trf('Spezialevent für KW {kw} festgelegt', { kw: kw % 100 }), 'ok');
    return ev;
  } catch (err) {
    toast(tr('Fehler: ') + err.message);
    return null;
  }
}
window.spezialSaveEvent = spezialSaveEvent;

async function spezialSetNoEvent() {
  const noEvent = !!seEventOf()?.no_event;
  const where = seEvents.server ? trf('für alle Allianzen auf Server {s}', { s: seEvents.server }) : tr('für diese Allianz');
  const ask = noEvent
    ? trf('„Kein Spezialevent“ für KW {kw} aufheben ({where})?', { kw: kw % 100, where })
    : trf('KW {kw} ohne Spezialevent festlegen ({where})?', { kw: kw % 100, where });
  if (!confirm(ask)) return;
  try {
    await postSpecialEvent(noEvent ? { clear: true } : { no_event: true });
    seFormKw = null;
    renderSpezial();
  } catch (err) { toast(tr('Fehler: ') + err.message); }
}
window.spezialSetNoEvent = spezialSetNoEvent;

async function spezialToggleSkip() {
  try {
    await postSpecialEvent({ skip: !seSkipped() });
    renderSpezial();
  } catch (err) { toast(tr('Fehler: ') + err.message); }
}
window.spezialToggleSkip = spezialToggleSkip;

async function spezialImportFromScanner() {
  if (seEventOf()?.no_event || seSkipped()) return;
  // Zeitfenster erst festlegen, damit die anderen Allianzen des Servers es auch haben
  let ev = seEventOf();
  if (!seFormMatches(ev)) {
    ev = await spezialSaveEvent({ silent: true });
    if (!ev) return;
  }
  const date = ev.event_date, start = ev.start, end = ev.end;
  // Ende vor dem Start (z. B. 22:00–02:00): Ende am Folgetag, wie in event.html
  let endDate = date;
  if (end <= start) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + 1); endDate = isoDate(d); }
  const token = (() => { try { return localStorage.getItem('discord_token'); } catch (_) { return null; } })();
  let data;
  try {
    const qs = new URLSearchParams({ start: `${date}T${start}`, end: `${endDate}T${end}` });
    data = await fetchJson(`/scans/event-compare?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch (err) {
    toast(tr('Scanner-Daten nicht verfügbar: ') + err.message);
    return;
  }
  const startKey = data.start.slice(0, 16);
  const scans = [...(data.scans?.power || []), ...(data.scans?.kills || [])];
  if (!scans.some(t => t < startKey) || !scans.some(t => t >= startKey)) {
    toast(tr('Für dieses Zeitfenster fehlt ein Scan vorher oder nachher.'));
    return;
  }

  // Bewertung wie event.html: nur Spieler mit Vorher- und Nachher-Wert sind bewertbar
  const rated = (data.players || []).filter(p => !p.honor_role).map(p => {
    const dk = p.kills.before && p.kills.after ? p.kills.after.v - p.kills.before.v : null;
    const dpPct = p.power.before && p.power.after && p.power.before.v ? (p.power.after.v - p.power.before.v) / p.power.before.v * 100 : null;
    return { name: p.name, dk, dpPct, participated: (dk != null && dk >= 1) || (dpPct != null && -dpPct >= SE_SCANNER_LOSS_PCT), known: dk != null || dpPct != null };
  }).filter(r => r.known);
  const byKills = rated.filter(r => r.participated && r.dk > 0).sort((a, b) => b.dk - a.dk);
  const placeOf = new Map(byKills.map((r, i) => [r.name, i + 1]));

  const plan = [];
  for (const r of rated) {
    if (!activeWeekMembers().includes(r.name)) continue;
    const current = entries.find(x => x.name === r.name)?.flags || {};
    const flags = { ...current };
    // Teilnahme wird nur gesetzt, nie entfernt (ohne Kills/Verlust kein sicherer Beleg fuers Fehlen)
    delete flags.seTop50; delete flags.seTop20;
    const place = placeOf.get(r.name);
    if (r.participated) flags.seTeilnahme = true;
    if (place && place <= 50) flags.seTop50 = true;
    if (place && place <= 20) flags.seTop20 = true;
    const same = ['seTeilnahme', 'seTop50', 'seTop20'].every(k => !!current[k] === !!flags[k]);
    if (!same) plan.push({ name: r.name, flags });
  }
  if (!plan.length) { toast(tr('Spezialevent-Häkchen sind bereits auf dem Stand der Scanner-Daten.')); return; }
  const count = (k) => plan.filter(x => x.flags[k]).length;
  const fmtDay = new Date(`${date}T12:00:00`).toLocaleDateString(uiLang());
  const msg = [
    trf('Spezialevent {date}, {start}–{end}', { date: fmtDay, start, end }),
    trf('{n} Spieler bewertbar, davon {p} dabei (Kills oder ≥ 0,3 % Kampfkraft-Verlust)', { n: rated.length, p: rated.filter(r => r.participated).length }),
    trf('Scans vorher: {b} · nachher: {a}', { b: scans.filter(t => t < startKey).map(t => t.slice(11)).join(', '), a: scans.filter(t => t >= startKey).map(t => t.slice(11)).join(', ') }),
    tr('Top 50/Top 20 nach Kills-Zuwachs.'),
    '',
    trf('Änderungen bei {n} Spielern:', { n: plan.length }),
    trf('• ⚔ Teilnahme: {n}', { n: count('seTeilnahme') }),
    `• 🏅 Top 50: ${count('seTop50')}`,
    `• 🏆 Top 20: ${count('seTop20')}`,
    '',
    tr('Teilnahme wird nur ergänzt, nie entfernt.'),
    tr('Spezialevent-Häkchen dieser KW werden ersetzt, andere Häkchen bleiben. Übernehmen?'),
  ].join(String.fromCharCode(10));
  if (!confirm(msg)) return;
  let done = 0;
  for (const item of plan) {
    try {
      const empty = Object.keys(item.flags).length === 0;
      await apiPost(empty
        ? { action: 'delete_entry', name: item.name }
        : { action: 'save_spezial', name: item.name, rank: PREV[item.name] || 3, flags: item.flags });
      done++;
    } catch (err) {
      toast(`${item.name}: ${err.message}`);
    }
  }
  await loadEntries();
  renderSpezial();
  toast(trf('{done} / {n} Spieler aus dem Scanner übernommen', { done, n: plan.length }), 'ok');
}
window.spezialImportFromScanner = spezialImportFromScanner;

// ══════════════════════════════════════════════════════
//  VS-VERWALTUNG
// ══════════════════════════════════════════════════════
// ─── Sparwoche: in dieser KW halten alle ihre VS-Punkte bewusst niedrig. Ziel 7,2 Mio je VS-Tag, bis
// 10 Mio ist ok, darueber gibt es keinen Bonus. Keine Top-10/Top-30-Boni, keine Strafe unter 43,2 Mio.
// Festgelegt je Allianz und KW (alliance_config "vs_sparwochen", R4/R5 ueber POST /scans/sparwoche).
const VS_SPAR_MAX_PER_DAY = 10000000;
// Zahlen und Wochentage in der UI-Sprache (trf steht in core/ui.js)
const uiLang = () => document.documentElement.lang || 'de';
const fmtMio = v => (v / 1e6).toLocaleString(uiLang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const vsDayName = d => new Date(Date.UTC(2024, 0, d)).toLocaleDateString(uiLang(), { weekday: 'short', timeZone: 'UTC' }); // 1.1.2024 = Montag
function isSparwoche(yw = kw) {
  return String(flagConfig.vs_sparwochen ?? '').split(',').map(Number).includes(Number(yw));
}
async function vsToggleSparwoche() {
  const active = !isSparwoche();
  const ask = active
    ? [trf('KW {kw} als Sparwoche festlegen?', { kw: kw % 100 }), '', tr('Dann gilt: höchstens 10 Mio je VS-Tag → Bonus, keine Top 10/Top 30, keine Strafe.'), tr('Danach „Aus Scanner übernehmen“ drücken, damit die Häkchen neu gesetzt werden.')]
    : [trf('Sparwoche für KW {kw} aufheben?', { kw: kw % 100 }), '', tr('Danach „Aus Scanner übernehmen“ drücken, damit die normalen Häkchen gesetzt werden.')];
  if (!confirm(ask.join(String.fromCharCode(10)))) return;
  const token = (() => { try { return localStorage.getItem('discord_token'); } catch (_) { return null; } })();
  try {
    const res = await fetchJson('/scans/sparwoche', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ year_week: kw, active }),
    });
    flagConfig.vs_sparwochen = res.vs_sparwochen;
    renderVS();
    toast(active ? tr('Sparwoche festgelegt') : tr('Sparwoche aufgehoben'), 'ok');
  } catch (err) {
    toast(tr('Fehler: ') + err.message);
  }
}
window.vsToggleSparwoche = vsToggleSparwoche;

// Gescannte VS-Wochenpunkte (Scanner) je KW – zeigt auf jeder Kachel Punkte und Platz und zaehlt
// Spieler mit Scan-Daten als erfasst (Platz 31+ ueber 43,2 Mio hat bewusst kein Haekchen).
let vsScanData = { kw: null, byName: new Map(), loading: false };
async function loadVsScanData() {
  if (!document.querySelector('[data-action="vsImportFromScanner"]')) return; // nur mit Scanner-Feature
  if (vsScanData.loading || vsScanData.kw === kw) return;
  vsScanData.loading = true;
  const forKw = kw;
  try {
    const token = (() => { try { return localStorage.getItem('discord_token'); } catch (_) { return null; } })();
    const data = await fetchJson(`/scans/vs-week?year_week=${forKw}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    vsScanData = { kw: forKw, byName: new Map((data.players || []).map(p => [p.name, p])), total: (data.players || []).length, loading: false };
  } catch (_) {
    vsScanData = { kw: forKw, byName: new Map(), loading: false };
  }
  if (forKw === kw) renderVS();
}

function renderVS() {
  const grid = document.getElementById('vs-grid');
  if (vsScanData.kw !== kw) { loadVsScanData(); }
  const scanOf = name => (vsScanData.kw === kw ? vsScanData.byName.get(name) : null);

  const spar = isSparwoche();
  document.querySelectorAll('.vs-legend-normal').forEach(el => { el.hidden = spar; });
  document.querySelectorAll('.vs-legend-spar').forEach(el => { el.hidden = !spar; });
  const sparBtn = document.getElementById('vs-spar-toggle');
  if (sparBtn) sparBtn.classList.toggle('on', spar);
  const maxDayOf = scan => Math.max(0, ...Object.values(scan?.days || {}));

  const isDone = name => { const e=entries.find(x=>x.name===name); const f=e?e.flags:{}; return !!(f.vsUnter50||f.vsTop30||f.vsTop10||f.vsSpar) || !!scanOf(name); };
  const {list,splitAt} = applyEventDoneSort(weekMembers(), isDone);

  let doneCount = 0;
  grid.innerHTML = list.map((name,i) => {
    const e = entries.find(x => x.name === name);
    const flags = e ? e.flags : {};
    const unter = !!flags.vsUnter50;
    const t30 = !!flags.vsTop30;
    const t10 = !!flags.vsTop10;
    const scan = scanOf(name);
    const sparOk = !!flags.vsSpar;
    if (unter||t30||t10||sparOk||scan) doneCount++;

    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    const cls = spar ? (sparOk ? 'w-anm' : 'w-none') : unter ? 'w-dmg' : t10 ? 'w-top20' : t30 ? 'w-anm' : 'w-none';
    const esc = name.replace(/'/g,"\\'");
    const dimCls = (eventDoneMode===1 && isDone(name)) ? ' done-dim' : '';

    const btnSpar  = `<button class="wt-btn ${sparOk?'on-anm':''}" data-action="vsSet" data-args="${lwArgs(name, 'spar')}" title="${escHtml(tr('Sparwoche eingehalten (höchstens 10 Mio je VS-Tag)'))}">${sparOk ? '🐷 ' + escHtml(tr('eingehalten')) : '🐷'}</button>`;
    const maxDay = maxDayOf(scan);
    const scanInfo = !scan ? '' : spar
      ? `📸 ${escHtml(trf('max {v} Mio/Tag', { v: fmtMio(maxDay) }))} ${maxDay > VS_SPAR_MAX_PER_DAY ? '✗' : '✓'}`
      : scan.place == null ? `📸 Σ ${escHtml(trf('{v} Mio', { v: fmtMio(scan.week_points) }))}`
      : `📸 ${escHtml(trf('{v} Mio · Platz {p}', { v: fmtMio(scan.week_points), p: scan.place }))}${scan.from_days ? ' Σ' : ''}`; // Σ: Summe der Tage, nicht in der Wochenliste
    const scanCls = spar && scan ? (maxDay > VS_SPAR_MAX_PER_DAY ? ' spar-over' : ' spar-ok') : '';
    const btnUnter = `<button class="wt-btn ${unter?'on-bad':''}" data-action="vsSet" data-args="${lwArgs(name, 'unter')}" title="unter 43,2 Mio Punkte (Strafe)">${unter?'⚠ &lt;43,2M':'🟥'}</button>`;
    const btnT30   = `<button class="wt-btn ${t30?'on-anm':''}" data-action="vsSet" data-args="${lwArgs(name, 't30')}" title="Top 30">${t30?'🥈 T30':'🥈'}</button>`;
    const btnT10   = `<button class="wt-btn ${t10?'on-gold':''}" data-action="vsSet" data-args="${lwArgs(name, 't10')}" title="Top 10">${t10?'🏆 T10':'🏆'}</button>`;

    const divider = i===splitAt ? '<div class="wt-done-divider">✓ Bereits erfasst</div>' : '';
    return divider+`<div class="wache-tile${dimCls} ${cls}${formerCls(name)}">
      <div class="wt-top">
        <div class="wt-name">${name}${formerTag(name)}</div>
        <div class="wt-rank" style="color:${RC[rank]||'#888'}">R${rank} · ${RL[rank]||''}</div>
        <div class="wt-scan${scanCls}" title="${escHtml(tr(spar ? 'Höchster gescannter VS-Tageswert (Sparziel: höchstens 10 Mio)' : 'Gescannte VS-Wochenpunkte'))}">${scan ? scanInfo : '&nbsp;'}</div>
      </div>
      <div class="wt-btns">${spar ? btnSpar : btnUnter + btnT30 + btnT10}</div>
    </div>`;
  }).join('');

  document.getElementById('vs-counter').textContent = `${doneCount} / ${weekMembers().length}`;
}

async function vsSet(name, type) {
  if (guardFormer(name)) return;
  let e = entries.find(x => x.name === name);
  if (!e) {
    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    e = { name, rank, baseRank: rank, flags: {}, points: 0, afk: false };
    entries.push(e);
  }
  const flags = e.flags;

  if (type === 'unter') {
    if (flags.vsUnter50) { delete flags.vsUnter50; }
    else { flags.vsUnter50 = true; delete flags.vsTop30; delete flags.vsTop10; }
  } else if (type === 't30') {
    if (flags.vsTop30) { delete flags.vsTop30; }
    else { flags.vsTop30 = true; delete flags.vsUnter50; }
  } else if (type === 't10') {
    if (flags.vsTop10) { delete flags.vsTop10; }
    else { flags.vsTop10 = true; delete flags.vsUnter50; }
  } else if (type === 'spar') {
    if (flags.vsSpar) { delete flags.vsSpar; }
    else { flags.vsSpar = true; delete flags.vsUnter50; delete flags.vsTop30; delete flags.vsTop10; }
  }

  e.points = calcPoints(flags);
  e.rank = calcRanking(e.points, e.baseRank || PREV[name] || 3);
  renderVS();

  try {
    if (Object.keys(flags).length === 0) {
      entries = entries.filter(x => x.name !== name);
      await apiPost({ action: 'delete_entry', name, scanLock: 'vs' });
    } else {
      // scanLock: von Hand gesetzt – der naechste Scanner-Upload ueberschreibt die VS-Haekchen dann nicht
      await apiPost({ action: 'save_wache', name, rank: PREV[name] || e.baseRank || 3, flags: { ...flags }, scanLock: 'vs' });
    }
    await loadEntries();
    renderVS();
  } catch(err) { toast(tr('Fehler: ') + err.message); }
}
window.vsSet = vsSet;

// VS-Haekchen der gewaehlten KW aus den gescannten Wochenpunkten (Scanner, GET /scans/vs-week) setzen.
// Platz 1–10: Top 10 + Top 30, Platz 11–30: Top 30, unter 43,2 Mio: Strafe. Andere Haekchen der Woche
// (Wache, Wueste, …) bleiben unveraendert; Spieler ohne gescannten Wochenwert werden nicht angefasst.
const VS_SCANNER_MIN_POINTS = 43200000;
// Hilfsaccounts von Thomas: nie Event-Haekchen aus dem Scanner (wie SCAN_FLAG_SKIP_NAMES in api/src/scan-flags.php)
const SCAN_FLAG_SKIP_NAMES = ['Thomas1', 'Thomas2'];
async function vsImportFromScanner() {
  const token = (() => { try { return localStorage.getItem('discord_token'); } catch (_) { return null; } })();
  let data;
  try {
    data = await fetchJson(`/scans/vs-week?year_week=${kw}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch (err) {
    toast(tr('Scanner-Daten nicht verfügbar: ') + err.message);
    return;
  }
  const byName = new Map((data.players || []).map(p => [p.name, p]));
  const spar = isSparwoche();
  const plan = [];
  for (const name of activeWeekMembers()) {
    const p = byName.get(name);
    if (!p || SCAN_FLAG_SKIP_NAMES.includes(name)) continue;
    const entry = entries.find(x => x.name === name);
    const current = entry?.flags || {};
    const flags = { ...current };
    if (spar) {
      // Sparwoche: Bonus, wenn an keinem gescannten VS-Tag mehr als 10 Mio – ohne Tageswerte keine Aussage
      const dayValues = Object.values(p.days || {});
      if (!dayValues.length) continue;
      delete flags.vsTop10; delete flags.vsTop30; delete flags.vsUnter50; delete flags.vsSpar;
      if (Math.max(...dayValues) <= VS_SPAR_MAX_PER_DAY) flags.vsSpar = true;
    } else if (p.place != null) { // Platz auch aus der Summe der Tage (from_days, Untergrenze); Strafe nur mit week_final
      delete flags.vsTop10; delete flags.vsTop30; delete flags.vsUnter50; delete flags.vsSpar;
      if (p.place <= 10) flags.vsTop10 = true;
      if (p.place <= 30) flags.vsTop30 = true;
      if (p.week_points < VS_SCANNER_MIN_POINTS && p.week_final) flags.vsUnter50 = true; // Strafe erst ab Samstags-Scan (isFinalWeekScan)
    }
    const same = ['vsTop10', 'vsTop30', 'vsUnter50', 'vsSpar'].every(k => !!current[k] === !!flags[k]);
    // Mittelfeld ohne Haekchen: trotzdem einen (leeren) Eintrag anlegen, sonst gilt der Spieler im
    // Dashboard als "Ausstehend" und die Woche fehlt in seinem Verlauf (Grundpunkte VS/Spenden zaehlen ja)
    if (!same || !entry) plan.push({ name, flags, p });
  }
  if (!data.players?.length) { toast(tr('Für diese KW gibt es keine gescannten VS-Wochenpunkte.')); return; }
  const days = (data.days_scanned || []).map(vsDayName).join(', ') || '—';
  const missingSat = !(data.days_scanned || []).includes(6);
  const count = (k) => plan.filter(x => x.flags[k]).length;
  const unknown = (data.players || []).filter(p => !weekMembers().includes(p.name)).length;
  const lastScan = data.last_scan ? new Date(data.last_scan.replace(' ', 'T')).toLocaleString(uiLang(), { dateStyle: 'short', timeStyle: 'short' }) : '?';
  const msg = [
    trf('KW {kw}: {n} Spieler mit gescannten Wochenpunkten', { kw: kw % 100, n: data.players.filter(p => p.place != null).length }),
    trf('Gescannte Tage: {days} · Stand {time}', { days, time: lastScan }),
    missingSat ? tr('⚠ Samstag ist noch nicht gescannt – die Wochenpunkte sind evtl. noch nicht final.') : null,
    (() => { const n = (data.players || []).filter(p => p.place != null && !p.week_final && p.week_points < VS_SCANNER_MIN_POINTS).length;
      return n && !spar ? trf('⚠ {n} Spieler unter 43,2 Mio ohne Samstags-Scan der Wochenliste – noch keine Strafe.', { n }) : null; })(),
    '',
    spar ? tr('🐷 Sparwoche: höchstens 10 Mio je VS-Tag → Bonus, keine Top 10/Top 30, keine Strafe') : null,
    trf('Änderungen bei {n} Spielern:', { n: plan.length }),
    ...(spar ? (() => {
      const withDays = (data.players || []).filter(p => Object.keys(p.days || {}).length);
      const ok = withDays.filter(p => Math.max(...Object.values(p.days)) <= VS_SPAR_MAX_PER_DAY).length;
      return [
        trf('• 🐷 eingehalten (alle Tage ≤ 10 Mio): {ok} von {n}', { ok, n: withDays.length }),
        trf('• über 10 Mio an mindestens einem Tag (kein Bonus): {n}', { n: withDays.length - ok }),
      ];
    })() : [
      `• 🏆 Top 10: ${count('vsTop10')}`,
      `• 🥈 Top 30: ${count('vsTop30')}`,
      trf('• 🟥 unter 43,2 Mio: {n}', { n: count('vsUnter50') }),
    ]),
    unknown ? trf('({n} gescannte Namen stehen nicht in der Mitgliederliste und werden übersprungen.)', { n: unknown }) : null,
    '',
    tr('VS-Häkchen dieser KW werden ersetzt, andere Häkchen bleiben. Übernehmen?'),
  ].filter(l => l !== null).join(String.fromCharCode(10));
  if (!plan.length) { toast(tr('VS-Häkchen sind bereits auf dem Stand der Scanner-Daten.')); return; }
  if (!confirm(msg)) return;
  let done = 0;
  for (const item of plan) {
    try {
      await apiPost({ action: 'save_wache', name: item.name, rank: PREV[item.name] || 3, flags: item.flags, scanUnlock: 'vs' });
      done++;
    } catch (err) {
      toast(`${item.name}: ${err.message}`);
    }
  }
  vsScanData.kw = null; // neu laden
  await loadEntries();
  renderVS();
  toast(trf('{done} / {n} Spieler aus dem Scanner übernommen', { done, n: plan.length }), 'ok');
}
window.vsImportFromScanner = vsImportFromScanner;

// ══════════════════════════════════════════════════════
//  SPENDEN-VERWALTUNG
// ══════════════════════════════════════════════════════
// Gescannte Wochenspenden (Scanner, GET /scans/donation-week) je KW – Wert und Platz auf jeder Kachel,
// Spieler mit Scan-Daten zaehlen als erfasst (Platz 21+ ueber 35K hat bewusst kein Haekchen).
const SP_SCANNER_MIN_POINTS = 35000;
const SP_SCANNER_TOP = 20;
let spScanData = { kw: null, byName: new Map(), loading: false };
async function loadSpScanData() {
  if (!document.querySelector('[data-action="spendeImportFromScanner"]')) return; // nur mit Scanner-Feature
  if (spScanData.loading || spScanData.kw === kw) return;
  spScanData.loading = true;
  const forKw = kw;
  try {
    const token = (() => { try { return localStorage.getItem('discord_token'); } catch (_) { return null; } })();
    const data = await fetchJson(`/scans/donation-week?year_week=${forKw}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    spScanData = { kw: forKw, byName: new Map((data.players || []).map(p => [p.name, p])), lastScan: data.last_week_scan || data.last_scan || null, fromDays: !data.last_week_scan, loading: false };
  } catch (_) {
    spScanData = { kw: forKw, byName: new Map(), lastScan: null, loading: false };
  }
  if (forKw === kw) renderSpende();
}
const fmtK = v => (v / 1e3).toLocaleString(uiLang(), { maximumFractionDigits: 1 }) + 'K';

function renderSpende() {
  const grid = document.getElementById('spende-grid');
  if (spScanData.kw !== kw) { loadSpScanData(); }
  const scanOf = name => (spScanData.kw === kw ? spScanData.byName.get(name) : null);
  const standEl = document.getElementById('sp-scan-stand');
  if (standEl) {
    const last = spScanData.kw === kw ? spScanData.lastScan : null;
    standEl.textContent = spScanData.kw !== kw ? '…'
      : !last ? tr('📸 keine Spenden-Scans in dieser KW')
      : trf('📸 Stand {time}', { time: new Date(last.replace(' ', 'T')).toLocaleString(uiLang(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })
        + (spScanData.fromDays ? ' Σ' : '');
  }

  const isDone = name => { const e=entries.find(x=>x.name===name); const f=e?e.flags:{}; return !!(f.spendeUnter35k||f.spendeTop20) || !!scanOf(name); };
  const {list,splitAt} = applyEventDoneSort(weekMembers(), isDone);

  let doneCount = 0;
  grid.innerHTML = list.map((name,i) => {
    const e = entries.find(x => x.name === name);
    const flags = e ? e.flags : {};
    const unter = !!flags.spendeUnter35k;
    const top20 = !!flags.spendeTop20;
    const scan = scanOf(name);
    if (unter||top20||scan) doneCount++;
    const scanInfo = scan ? `📸 ${escHtml(trf('{v} · Platz {p}', { v: fmtK(scan.week_points), p: scan.place }))}${scan.from_days ? ' Σ' : ''}` : '&nbsp;';

    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    const cls = unter ? 'w-dmg' : top20 ? 'w-anm' : 'w-none';
    const esc = name.replace(/'/g,"\\'");
    const dimCls = (eventDoneMode===1 && isDone(name)) ? ' done-dim' : '';

    const btnUnter = `<button class="wt-btn ${unter?'on-bad':''}" data-action="spendeSet" data-args="${lwArgs(name, 'unter')}" title="unter 35K gespendet (Strafe)">${unter?'⚠ &lt;35K':'🟥'}</button>`;
    const btnTop20 = `<button class="wt-btn ${top20?'on-anm':''}" data-action="spendeSet" data-args="${lwArgs(name, 'top20')}" title="Top 20 Spender (Bonus)">${top20?'🏅 T20':'🏅'}</button>`;

    const divider = i===splitAt ? '<div class="wt-done-divider">✓ Bereits erfasst</div>' : '';
    return divider+`<div class="wache-tile${dimCls} ${cls}${formerCls(name)}">
      <div class="wt-top">
        <div class="wt-name">${name}${formerTag(name)}</div>
        <div class="wt-rank" style="color:${RC[rank]||'#888'}">R${rank} · ${RL[rank]||''}</div>
        <div class="wt-scan" title="${escHtml(tr(scan?.from_days ? 'Gescannte Spenden (Summe der Tageswerte, keine Wochen-Rangliste)' : 'Gescannte Wochenspenden'))}">${scanInfo}</div>
      </div>
      <div class="wt-btns">${btnUnter}${btnTop20}</div>
    </div>`;
  }).join('');

  document.getElementById('sp-counter').textContent = `${doneCount} / ${weekMembers().length}`;
}

async function spendeSet(name, type) {
  if (guardFormer(name)) return;
  let e = entries.find(x => x.name === name);
  if (!e) {
    const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
    e = { name, rank, baseRank: rank, flags: {}, points: 0, afk: false };
    entries.push(e);
  }
  const flags = e.flags;

  if (type === 'unter') {
    if (flags.spendeUnter35k) { delete flags.spendeUnter35k; }
    else { flags.spendeUnter35k = true; delete flags.spendeTop20; }
  } else if (type === 'top20') {
    if (flags.spendeTop20) { delete flags.spendeTop20; }
    else { flags.spendeTop20 = true; delete flags.spendeUnter35k; }
  }

  e.points = calcPoints(flags);
  e.rank = calcRanking(e.points, e.baseRank || PREV[name] || 3);
  renderSpende();

  try {
    if (Object.keys(flags).length === 0) {
      entries = entries.filter(x => x.name !== name);
      await apiPost({ action: 'delete_entry', name, scanLock: 'spende' });
    } else {
      await apiPost({ action: 'save_wache', name, rank: PREV[name] || e.baseRank || 3, flags: { ...flags }, scanLock: 'spende' });
    }
    await loadEntries();
    renderSpende();
  } catch(err) { toast(tr('Fehler: ') + err.message); }
}
window.spendeSet = spendeSet;

// Spenden-Haekchen der gewaehlten KW aus den gescannten Wochenspenden (Scanner, GET /scans/donation-week).
// Platz 1–20: Top 20, unter 35K: Strafe. Andere Haekchen der Woche bleiben; Spieler ohne Scan-Wert bleiben unberuehrt.
async function spendeImportFromScanner() {
  const token = (() => { try { return localStorage.getItem('discord_token'); } catch (_) { return null; } })();
  let data;
  try {
    data = await fetchJson(`/scans/donation-week?year_week=${kw}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch (err) {
    toast(tr('Scanner-Daten nicht verfügbar: ') + err.message);
    return;
  }
  if (!data.players?.length) { toast(tr('Für diese KW gibt es keine gescannten Spenden.')); return; }
  const byName = new Map(data.players.map(p => [p.name, p]));
  const plan = [];
  for (const name of activeWeekMembers()) {
    const p = byName.get(name);
    if (!p || SCAN_FLAG_SKIP_NAMES.includes(name)) continue;
    const entry = entries.find(x => x.name === name);
    const current = entry?.flags || {};
    const flags = { ...current };
    delete flags.spendeTop20; delete flags.spendeUnter35k;
    if (p.place <= SP_SCANNER_TOP) flags.spendeTop20 = true;
    if (p.week_points < SP_SCANNER_MIN_POINTS && p.week_final) flags.spendeUnter35k = true; // erst ab Samstags-Scan
    const same = ['spendeTop20', 'spendeUnter35k'].every(k => !!current[k] === !!flags[k]);
    if (!same || !entry) plan.push({ name, flags }); // leerer Eintrag fuers Mittelfeld, siehe vsImportFromScanner
  }
  if (!plan.length) { toast(tr('Spenden-Häkchen sind bereits auf dem Stand der Scanner-Daten.')); return; }
  const count = (k) => plan.filter(x => x.flags[k]).length;
  const unknown = data.players.filter(p => !weekMembers().includes(p.name)).length;
  const fromDays = data.players.filter(p => p.from_days).length;
  const fmtTime = s => s ? new Date(s.replace(' ', 'T')).toLocaleString(uiLang(), { dateStyle: 'short', timeStyle: 'short' }) : '?';
  const msg = [
    trf('KW {kw}: {n} Spieler mit gescannten Spenden', { kw: kw % 100, n: data.players.length }),
    trf('Stand {time}', { time: fmtTime(data.last_week_scan || data.last_scan) }),
    !data.last_week_scan ? tr('⚠ Keine Wochen-Rangliste gescannt – Werte sind die Summe der gescannten Tage.') : null,
    fromDays && data.last_week_scan ? trf('⚠ {n} Spieler nur aus Tageswerten (nicht in der Wochen-Rangliste).', { n: fromDays }) : null,
    (() => { const n = data.players.filter(p => !p.week_final && p.week_points < SP_SCANNER_MIN_POINTS).length;
      return n ? trf('⚠ {n} Spieler unter 35K ohne Samstags-Scan der Wochenliste – noch keine Strafe.', { n }) : null; })(),
    '',
    trf('Änderungen bei {n} Spielern:', { n: plan.length }),
    `• 🏅 Top 20: ${count('spendeTop20')}`,
    trf('• 🟥 unter 35K: {n}', { n: count('spendeUnter35k') }),
    unknown ? trf('({n} gescannte Namen stehen nicht in der Mitgliederliste und werden übersprungen.)', { n: unknown }) : null,
    '',
    tr('Spenden-Häkchen dieser KW werden ersetzt, andere Häkchen bleiben. Übernehmen?'),
  ].filter(l => l !== null).join(String.fromCharCode(10));
  if (!confirm(msg)) return;
  let done = 0;
  for (const item of plan) {
    try {
      // auch ohne Haekchen speichern (nicht loeschen): gescannt = erfasst
      await apiPost({ action: 'save_wache', name: item.name, rank: PREV[item.name] || 3, flags: item.flags, scanUnlock: 'spende' });
      done++;
    } catch (err) {
      toast(`${item.name}: ${err.message}`);
    }
  }
  spScanData.kw = null; // neu laden
  await loadEntries();
  renderSpende();
  toast(trf('{done} / {n} Spieler aus dem Scanner übernommen', { done, n: plan.length }), 'ok');
}
window.spendeImportFromScanner = spendeImportFromScanner;
