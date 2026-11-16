// LWHub-Scanner – Seiten-Script für Server-Events (event.html). Ausgelagert aus dem Inline-<script> (CSP ohne unsafe-inline).

// ─── Sprache wie im lwhub-Portal: localStorage iny_lang_v1 (gleiche Domain), ?lang= ueberschreibt.
// Texte aus denselben Sprachdateien wie das Portal (locales/<lang>.json, Schluessel ev_*), Deutsch als Rueckfall.
const LANG = (() => {
  let l = new URLSearchParams(location.search).get('lang');
  if (!l) { try { l = localStorage.getItem('iny_lang_v1'); } catch {} }
  l = String(l || 'de').trim().toLowerCase();
  return ['de', 'en', 'it', 'fr', 'pl', 'es', 'zh'].includes(l) ? l : 'de';
})();
const NUM_LOCALE = { de: 'de-DE', en: 'en-GB', it: 'it-IT', fr: 'fr-FR', pl: 'pl-PL', es: 'es-ES', zh: 'zh-CN' }[LANG];
let STR = {}, STR_DE = {};
async function loadStrings() {
  const get = (l) => fetch(`../locales/${l}.json`, { cache: 'no-store' }).then((r) => r.ok ? r.json() : {}).then((j) => j.strings || {}).catch(() => ({}));
  [STR_DE, STR] = await Promise.all([get('de'), LANG === 'de' ? Promise.resolve(null) : get(LANG)]);
  STR = STR || STR_DE;
}
const t = (k, vars = {}) => String(STR[k] ?? STR_DE[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  document.title = `LWHub ${t('ev_title')}`;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}

let activeApiUrl = LwhubAccess.apiCandidates()[0];
let raw = null;
let rows = [];
let verdictFilter = 'all';
let sortKey = 'kills', sortDir = 1;

// Bezeichnungen erst nach loadStrings() lesen (label ist ein Getter)
const VERDICTS = Object.fromEntries([['both', '🔥'], ['kills', '⚔'], ['losses', '🩸'], ['none', '⚠️'], ['unknown', '❔']]
  .map(([k, icon], order) => [k, { icon, order, get label() { return t(`ev_v_${k}`); } }]));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mio = (v) => v == null ? '—' : `${(v / 1e6).toFixed(1)}M`;
const num = (v) => v == null ? '—' : Math.round(v).toLocaleString(NUM_LOCALE);
const signed = (v, f) => v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${f(Math.abs(v))}`;
const signClass = (v) => v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '';
const hhmm = (at) => at ? at.slice(11, 16) : '—';
const pad = (n) => String(n).padStart(2, '0');
// Serverzeit (Spielserver UTC−2) einer Ortszeit, wie im Hub (localToGameTime)
const gameTime = (date, time) => {
  const d = new Date(`${date}T${time}`);
  const m = (((d.getUTCHours() * 60 + d.getUTCMinutes() - 120) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

// Gespeicherte Events (GET /special-events), neueste zuerst: Spezialevents des Servers (🌐, je KW) und eigene
// Events der Allianz (🛡, z. B. ein Chaos-Event nur fuer NxU1, im Scanner angelegt)
let savedEvents = [];
async function loadSavedEvents(alliance) {
  try {
    const r = await fetch(`${activeApiUrl}/special-events?alliance=${encodeURIComponent(alliance)}`);
    const d = await r.json();
    const server = (d.events || []).filter((e) => !e.no_event && e.event_date && e.start && e.end)
      .map((e) => ({ ...e, kind: 'server' }));
    const own = (d.alliance_events || []).map((e) => ({ ...e, kind: 'alliance', alliance }));
    savedEvents = [...server, ...own].sort((a, b) => `${b.event_date}T${b.start}`.localeCompare(`${a.event_date}T${a.start}`));
  } catch { savedEvents = []; }
}
const formVal = (id) => document.getElementById(id).value;
// Index des Events, das gerade im Formular steht (-1 = eigenes Zeitfenster)
const currentEventIndex = () => savedEvents.findIndex((e) => e.event_date === formVal('evDate') && e.start === formVal('evStart') && e.end === formVal('evEnd'));
// ‹ = frueher (weiter hinten in der Liste), › = spaeter
const olderEvent = () => { const i = currentEventIndex(); return i >= 0 ? savedEvents[i + 1] : savedEvents.find((e) => e.event_date < formVal('evDate')); };
const newerEvent = () => { const i = currentEventIndex(); return i >= 0 ? savedEvents[i - 1] : [...savedEvents].reverse().find((e) => e.event_date > formVal('evDate')); };
function renderEventNav() {
  const nav = document.getElementById('evNav');
  nav.hidden = !savedEvents.length;
  if (!savedEvents.length) return;
  const ev = savedEvents[currentEventIndex()];
  const date = formVal('evDate'), start = formVal('evStart'), end = formVal('evEnd');
  const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit' });
  const server = `(${t('ev_server_time')} ${gameTime(date, start)}–${gameTime(date, end)})`;
  const where = ev?.kind === 'alliance' ? `🛡 ${ev.alliance}` : ev ? `🌐 KW ${ev.year_week % 100}` : '';
  document.getElementById('evNavLabel').textContent = ev
    ? `${where} · ${ev.title || t('ev_nav_untitled')} · ${day(date)} ${start}–${end} ${server}`
    : `${t('ev_nav_custom')} · ${day(date)} ${start}–${end} ${server}`;
  document.getElementById('evPrev').disabled = !olderEvent();
  document.getElementById('evNext').disabled = !newerEvent();
}
function showSavedEvent(ev) {
  if (!ev) return;
  document.getElementById('evDate').value = ev.event_date;
  document.getElementById('evStart').value = ev.start;
  document.getElementById('evEnd').value = ev.end;
  load();
}
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function evaluate(p) {
  const th = { kills: Number(document.getElementById('thKills').value) || 0, loss: Number(document.getElementById('thLoss').value) || 0 };
  const dk = p.kills.before && p.kills.after ? p.kills.after.v - p.kills.before.v : null;
  const dp = p.power.before && p.power.after ? p.power.after.v - p.power.before.v : null;
  const dpPct = dp != null && p.power.before.v ? dp / p.power.before.v * 100 : null;
  const fought = dk != null && dk >= Math.max(1, th.kills);
  const lost = dpPct != null && -dpPct >= th.loss;
  let verdict;
  if (fought && lost) verdict = 'both';
  else if (fought) verdict = 'kills';
  else if (lost) verdict = 'losses';
  else if (dk == null && dp == null) verdict = 'unknown';
  else verdict = 'none';
  return { ...p, dk, dp, dpPct, verdict, participated: fought || lost };
}

function render() {
  if (!raw) return;
  rows = raw.players.map(evaluate);
  const counted = rows.filter((r) => !r.honor_role);

  const scans = raw.scans;
  const chip = (t, kind) => `<span class="scan-chip ${t >= raw.start.slice(0, 16) ? 'after' : ''}">${kind} ${t.slice(11)}</span>`;
  document.getElementById('scanTimes').innerHTML =
    `<span class="muted">${t('ev_scans_in_window')}</span>` +
    (scans.power.map((x) => chip(x, t('ev_kk'))).join('') + scans.kills.map((x) => chip(x, t('ev_kills'))).join('') || `<span class="muted">${t('ev_none')}</span>`) +
    (scans.power.concat(scans.kills).some((x) => x >= raw.start.slice(0, 16)) ? '' : `<span class="muted">${t('ev_no_after')}</span>`);

  const part = counted.filter((r) => r.participated).length;
  const known = counted.filter((r) => r.verdict !== 'unknown').length;
  const killsSum = counted.reduce((s, r) => s + (r.dk > 0 ? r.dk : 0), 0);
  const lossSum = counted.reduce((s, r) => s + (r.dp < 0 ? -r.dp : 0), 0);
  document.getElementById('summary').innerHTML =
    `<span class="badge-stat">${t('ev_members', { n: counted.length })}</span>` +
    `<span class="badge-stat">${t('ev_evaluated', { n: known })}</span>` +
    `<span class="badge-stat">${t('ev_joined', { n: part })}</span>` +
    `<span class="badge-stat">${t('ev_kills_sum', { v: mio(killsSum) })}</span>` +
    `<span class="badge-stat">${t('ev_loss_sum', { v: mio(lossSum) })}</span>` +
    (rows.length > counted.length ? `<span class="muted">${t('ev_honor_note', { n: rows.length - counted.length })}</span>` : '');

  const counts = Object.fromEntries(Object.keys(VERDICTS).map((k) => [k, counted.filter((r) => r.verdict === k).length]));
  document.getElementById('verdictPills').innerHTML =
    `<button class="pill-btn ${verdictFilter === 'all' ? 'active' : ''}" data-v="all">${t('ev_all')} (${counted.length})</button>` +
    `<button class="pill-btn ${verdictFilter === 'yes' ? 'active' : ''}" data-v="yes">${t('ev_yes')} (${part})</button>` +
    Object.entries(VERDICTS).map(([k, v]) =>
      `<button class="pill-btn ${verdictFilter === k ? 'active' : ''}" data-v="${k}">${v.icon} ${v.label} (${counts[k]})</button>`).join('');

  const list = filtered();
  const key = {
    name: (r) => r.name.toLowerCase(),
    kills: (r) => -(r.dk ?? -Infinity),
    loss: (r) => r.dpPct ?? Infinity,
    power: (r) => -(r.power.before?.v ?? 0),
    verdict: (r) => VERDICTS[r.verdict].order * 1e12 - (r.dk ?? 0),
  }[sortKey];
  list.sort((a, b) => { const ka = key(a), kb = key(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * sortDir; });

  const th = (k, label, cls = '') => `<th class="${cls}" data-sort="${k}" title="${t('ev_sort')}">${label}${sortKey === k ? (sortDir > 0 ? ' ▾' : ' ▴') : ''}</th>`;
  document.getElementById('evTable').innerHTML =
    `<thead><tr>${th('name', t('ev_th_player'))}${th('kills', t('ev_th_kills'), 'num')}<th class="num">${t('ev_th_kills_ba')}</th>` +
    `${th('loss', t('ev_th_power_d'), 'num')}${th('power', t('ev_th_power_ba'), 'num')}${th('verdict', t('ev_th_verdict'))}</tr></thead><tbody>` +
    list.map((r) => `<tr class="${r.honor_role ? 'honor' : ''}">
      <td><span class="rank-badge r${r.rank}">R${r.rank}</span> ${esc(r.name)}${r.honor_role ? ` <span class="muted">(${t('ev_honor')})</span>` : ''}</td>
      <td class="num ${signClass(r.dk)}">${signed(r.dk, num)}</td>
      <td class="num"><span title="${esc(r.kills.before?.at || '')}">${num(r.kills.before?.v)}</span> <span class="dim">→</span> <span title="${esc(r.kills.after?.at || '')}">${num(r.kills.after?.v)}</span> <span class="dim">${hhmm(r.kills.after?.at)}</span></td>
      <td class="num ${signClass(r.dp)}">${signed(r.dp, mio)}${r.dpPct != null ? ` <span class="dim">(${r.dpPct > 0 ? '+' : ''}${r.dpPct.toFixed(1)} %)</span>` : ''}</td>
      <td class="num"><span title="${esc(r.power.before?.at || '')}">${mio(r.power.before?.v)}</span> <span class="dim">→</span> <span title="${esc(r.power.after?.at || '')}">${mio(r.power.after?.v)}</span> <span class="dim">${hhmm(r.power.after?.at)}</span></td>
      <td><span class="verdict ${r.verdict}">${VERDICTS[r.verdict].icon} ${VERDICTS[r.verdict].label}</span></td>
    </tr>`).join('') + '</tbody>';
}

function filtered() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  return rows.filter((r) => (verdictFilter === 'all' || (verdictFilter === 'yes' ? r.participated && !r.honor_role : r.verdict === verdictFilter && !r.honor_role))
    && (!q || r.name.toLowerCase().includes(q)));
}

function saveForm() {
  const params = new URLSearchParams({
    alliance: document.getElementById('allianceSelect').value,
    date: document.getElementById('evDate').value,
    start: document.getElementById('evStart').value,
    end: document.getElementById('evEnd').value,
  });
  const langParam = new URLSearchParams(location.search).get('lang');
  if (langParam) params.set('lang', langParam);
  history.replaceState(null, '', `?${params}`);
  try { localStorage.setItem('lwhub_event_form_v1', JSON.stringify(Object.fromEntries(params))); } catch {}
  LwhubAccess.reportState(params);
}

async function load() {
  saveForm();
  renderEventNav();
  const alliance = document.getElementById('allianceSelect').value;
  document.getElementById('linkScanner').href = `./`;
  document.getElementById('linkTrend').href = `trend.html?alliance=${encodeURIComponent(alliance)}`;
  const data = await LwhubAccess.check(activeApiUrl, alliance, t('ev_gate_what'), { view: true });
  if (!data) return;
  const date = document.getElementById('evDate').value;
  let endDate = date;
  // Ende vor dem Start (z. B. 22:00–02:00): Ende am Folgetag
  if (document.getElementById('evEnd').value <= document.getElementById('evStart').value) {
    const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + 1);
    endDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const qs = new URLSearchParams({
    alliance,
    start: `${date}T${document.getElementById('evStart').value}`,
    end: `${endDate}T${document.getElementById('evEnd').value}`,
    after_min: document.getElementById('evAfter').value || '90',
  });
  const resp = await fetch(`${activeApiUrl}/scans/event-compare?${qs}`, { headers: LwhubAccess.authHeaders() });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body.ok) {
    document.getElementById('summary').innerHTML = `<span class="neg">${t('ev_load_error', { e: esc(body.error || resp.status) })}</span>`;
    return;
  }
  raw = body;
  render();
}

document.getElementById('verdictPills').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  verdictFilter = b.dataset.v;
  render();
});
document.getElementById('evTable').addEventListener('click', (e) => {
  const h = e.target.closest('[data-sort]');
  if (!h) return;
  if (sortKey === h.dataset.sort) sortDir = -sortDir; else { sortKey = h.dataset.sort; sortDir = 1; }
  render();
});
document.getElementById('searchInput').addEventListener('input', render);
for (const id of ['thKills', 'thLoss']) document.getElementById(id).addEventListener('input', render);
for (const id of ['evDate', 'evStart', 'evEnd', 'evAfter']) document.getElementById(id).addEventListener('change', load);
document.getElementById('allianceSelect').addEventListener('change', async () => { await loadSavedEvents(document.getElementById('allianceSelect').value); load(); });
document.getElementById('evPrev').addEventListener('click', () => showSavedEvent(olderEvent()));
document.getElementById('evNext').addEventListener('click', () => showSavedEvent(newerEvent()));
document.getElementById('btnReload').addEventListener('click', load);
document.getElementById('accessGateRetry').addEventListener('click', load);
document.getElementById('btnCopy').addEventListener('click', async () => {
  const names = filtered().map((r) => r.name).join('\n');
  try { await navigator.clipboard.writeText(names); document.getElementById('btnCopy').textContent = `✅ ${t('ev_copied')}`; }
  catch { prompt(t('ev_copy_prompt'), names.replace(/\n/g, ', ')); }
  setTimeout(() => { document.getElementById('btnCopy').textContent = `📋 ${t('ev_copy')}`; }, 1500);
});

// Allianzmail: Eventname, Zeitfenster und Rangliste der Teilnehmer nach Killpunkten
// (nur Teilnehmer mit Killpunkten > 0, ohne Ehrenrollen, unabhaengig von Filter/Suche; gleiche Kills = gleicher Platz)
function buildMailText() {
  if (!raw) return '';
  const date = formVal('evDate'), start = formVal('evStart'), end = formVal('evEnd');
  const ev = savedEvents[currentEventIndex()];
  const title = ev?.title || t('ev_title');
  const alliance = document.getElementById('allianceSelect').value;
  const day = new Date(`${date}T12:00:00`).toLocaleDateString(NUM_LOCALE, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const lines = [`🎯 ${title} – ${alliance}`, `${day} · ${t('ev_server_time')} ${gameTime(date, start)}–${gameTime(date, end)}`, '', t('ev_mail_ranking')];
  const list = rows.filter((r) => r.participated && !r.honor_role && r.dk > 0).sort((a, b) => b.dk - a.dk);
  if (!list.length) lines.push(t('ev_mail_none'));
  let place = 0;
  list.forEach((r, i) => {
    if (i === 0 || r.dk !== list[i - 1].dk) place = i + 1;
    lines.push(`${place}. ${r.name} – ${num(r.dk)}`);
  });
  const killsSum = list.reduce((s, r) => s + r.dk, 0);
  lines.push('', t('ev_mail_footer', { n: list.length, v: num(killsSum) }));
  return lines.join('\n');
}
document.getElementById('btnMail').addEventListener('click', async () => {
  const text = buildMailText();
  if (!text) return;
  const btn = document.getElementById('btnMail');
  try { await navigator.clipboard.writeText(text); btn.textContent = `✅ ${t('ev_copied')}`; }
  catch { prompt(t('ev_mail_prompt'), text); }
  setTimeout(() => { btn.textContent = `✉ ${t('ev_mail')}`; }, 1500);
});

(async () => {
  await loadStrings();
  applyStaticI18n();
  const url = new URLSearchParams(location.search);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('lwhub_event_form_v1') || '{}') || {}; } catch {}
  document.getElementById('evDate').value = url.get('date') || (saved.date === todayIso() ? saved.date : todayIso());
  if (url.get('start') || saved.date === todayIso()) document.getElementById('evStart').value = url.get('start') || saved.start || '16:00';
  if (url.get('end') || saved.date === todayIso()) document.getElementById('evEnd').value = url.get('end') || saved.end || '20:00';
  const { apiUrl, alliances } = await LwhubAccess.findApi();
  activeApiUrl = apiUrl;
  const wanted = url.get('alliance') || LwhubAccess.preferredAlliance();
  await LwhubAccess.fillOwnAlliances(document.getElementById('allianceSelect'), apiUrl, alliances, wanted, { view: true });
  await loadSavedEvents(document.getElementById('allianceSelect').value);
  // Ohne Vorgabe in der Adresse: das letzte gespeicherte Event, das schon begonnen hat
  if (!url.get('date')) {
    const now = new Date();
    const nowKey = `${todayIso()}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const started = savedEvents.find((e) => `${e.event_date}T${e.start}` <= nowKey);
    if (started) {
      document.getElementById('evDate').value = started.event_date;
      document.getElementById('evStart').value = started.start;
      document.getElementById('evEnd').value = started.end;
    }
  }
  try { await load(); } finally { LwhubAccess.reportReady(); }
})();
