// LWHub – Navigation, R4-/Admin-Reiter, Router (/<bereich>/<ansicht>), showPage, renderAll, Ansichten der Auswertungen
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html). Normales Script, kein Modul:
// alles bleibt global wie vorher. Die Reihenfolge der <script>-Tags in index.html ist die Ladereihenfolge.

function buildNavActionsFromTabs() {
  const actions = [];
  document.querySelectorAll('#main-tabs .tab, #r4-tab-btns .tab, #admin-tab-btns .tab').forEach(btn => {
    const hiddenByFeature = btn.dataset.featureHidden === '1';
    const hiddenByRole = btn.dataset.forceHide === 'r4';
    if (hiddenByFeature || hiddenByRole) return;
    const label = btn.textContent.trim();
    if (!label) return;
    // Parse showPage id directly so we never rely on .click() of a hidden element
    const navArgs = btn.dataset.action === 'showPage' ? lwParseArgs(btn.dataset.args) : null;
    const pageId = navArgs && navArgs[0];
    const fn = pageId ? () => showPage(pageId) : () => btn.click();
    actions.push({ label, fn, btnRef: btn });
  });
  window.csNavActions = actions;
}

function updateNavCompact() {
  const inner = document.querySelector('.nav-inner');
  const tabs  = document.getElementById('main-tabs');
  if (!inner || !tabs) return;

  // On mobile the nav is single-row — tabs always hidden via CSS, skip
  if (window.innerWidth <= 720) {
    document.body.classList.add('nav-compact');
    return;
  }

  const allBtns = Array.from(
    inner.querySelectorAll('#main-tabs .tab, #r4-tab-btns .tab, #admin-tab-btns .tab')
  );
  if (!allBtns.length) return;

  // Step 1: Hide tabs so fixed elements report their true widths
  tabs.style.display = 'none';

  const logo    = inner.querySelector('.logo');
  const actions = inner.querySelector('.nav-actions');

  // nav padding (2×24px=48px) + 2 gaps (2×10px=20px) + tabs internal padding (6px)
  const fixedW = 74
    + (logo    ? logo.offsetWidth    : 0)
    + (actions ? actions.offsetWidth : 0);

  const availW = inner.clientWidth - fixedW;

  // Step 2: Show tabs + all buttons to measure
  tabs.style.display = 'flex';
  allBtns.forEach(b => {
    const hiddenByFeature = b.dataset.featureHidden === '1';
    const hiddenByRole = b.dataset.forceHide === 'r4';
    b.style.display = (hiddenByFeature || hiddenByRole) ? 'none' : '';
  });

  const candidateBtns = allBtns.filter(b => b.style.display !== 'none');

  // Step 3: All-or-nothing — if not all tabs fit, hide ALL and let char-switcher show them
  const totalNeeded = candidateBtns.reduce((sum, btn) => sum + btn.offsetWidth + 4, 0);
  const anyHidden = totalNeeded > availW;
  if (anyHidden) {
    candidateBtns.forEach(btn => { btn.style.display = 'none'; });
    tabs.style.display = 'none';
  }
  document.body.classList.toggle('nav-compact', anyHidden);
}

(function initNavResize() {
  const ro = new ResizeObserver(() => updateNavCompact());
  function attach() { const n = document.querySelector('nav'); if (n) ro.observe(n); updateNavCompact(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();
// Seiten-Dateien fuer R4/R5 (Dashboard, Liste, Verwaltung, Auswertungen, Events, Admin, Berufe) nachladen.
// Die Adressen samt Hash-Version stehen im <template id="lw-r4-scripts"> in index.php. async = false: Der Browser
// laedt parallel, fuehrt aber in der Reihenfolge aus. Einmal je Seitenaufruf, danach dasselbe Promise.
let lwR4ScriptsPromise = null;
function lwLoadR4Scripts() {
  if (lwR4ScriptsPromise) return lwR4ScriptsPromise;
  const tpl = document.getElementById('lw-r4-scripts');
  const srcs = tpl ? [...tpl.content.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')) : [];
  lwR4ScriptsPromise = Promise.all(srcs.map((src) => new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.addEventListener('load', resolve);
    el.addEventListener('error', () => { console.error('[lwhub] Seiten-Datei nicht geladen:', src); resolve(); });
    document.body.appendChild(el);
  })));
  return lwR4ScriptsPromise;
}

async function injectR4Tabs(discordId) {
  try {
    // Scripts und Seiten-HTML gleichzeitig holen; eingesetzt wird erst, wenn beides da ist
    const scriptsReady = lwLoadR4Scripts();
    const data = await fetchJson(`/tab-html?section=r4&discord_id=${encodeURIComponent(discordId)}`);
    await scriptsReady;
    if (!data.ok) return;
    document.getElementById('r4-tab-btns').innerHTML = data.tabBtns;
    document.getElementById('r4-pages-container').innerHTML = data.pages;
    // R4 tabs injected
    if (typeof window.applyI18n === 'function') {
      window.applyI18n(document.getElementById('r4-tab-btns'));
      window.applyI18n(document.getElementById('r4-pages-container'));
    }
    applyRankNames();
    initR4Listeners();
    updateFeatureTabVisibility();
    updatePointsGuideVisibility();
    updateNavCompact();
  } catch(e) { /* silent fail */ }
}

async function injectAdminTabs(discordId) {
  try {
    const data = await fetchJson(`/tab-html?section=admin&discord_id=${encodeURIComponent(discordId)}`);
    if (!data.ok) return;
    document.getElementById('admin-tab-btns').innerHTML = data.tabBtns;
    // Admin-Seite und -Dialoge kommen nur fuer R5 vom Server (api/partials/admin-pages.php)
    const adminPages = document.getElementById('admin-pages-container');
    if (adminPages) {
      adminPages.innerHTML = data.pages || '';
      if (typeof window.applyI18n === 'function') window.applyI18n(adminPages);
    }
  } catch(e) { /* silent fail */ }
}

function resetRoleScopedUi() {
  const r4Btns = document.getElementById('r4-tab-btns');
  const adminBtns = document.getElementById('admin-tab-btns');
  const r4Pages = document.getElementById('r4-pages-container');
  if (r4Btns) r4Btns.innerHTML = '';
  if (adminBtns) adminBtns.innerHTML = '';
  if (r4Pages) r4Pages.innerHTML = '';
  const adminPages = document.getElementById('admin-pages-container');
  if (adminPages) adminPages.innerHTML = '';
}

// ── ROUTER: eigene Adresse je Seite (docs/konzept-frontend-umbau.html, Schritt 2) ──
// Schema ueberall gleich: /<bereich> oder /<bereich>/<ansicht>. Englisch und kurz, damit Links in Discord
// lesbar bleiben. Neue Seite → hier eintragen und in /.htaccess (RewriteRule) ergaenzen.
const LW_ROUTES = {
  m: 'me', t: 'teams', p: 'points', zv: 'train', z: 'train/plan', w: 'events', bp: 'jobs',
  r: 'stats', d: 'stats/dash', e: 'list', v: 'members', sc: 'scan', a: 'admin'
};
// Ansichten innerhalb einer Seite: Name in der Adresse → interner Name. Jede Ansicht hat so ihren eigenen Link.
const LW_SUBVIEWS = {
  r: { points: 'punkte', inactive: 'se', trend: 'trend', events: 'events' },
  w: { guard1: 'w1', guard2: 'w2', guard3: 'w3', desert: 'wu', special: 'se', vs: 'vs', donations: 'sp' },
  a: { alliances: 'alliances', archive: 'archive', transfer: 'transfer', merge: 'merge', admins: 'admins', tokens: 'tokens' }
};
// Seiten, die nur R4/R5 sehen (fuer den Hinweis, wenn ein Link ins Leere geht)
const LW_R4_PAGES = new Set(['z', 'w', 'bp', 'r', 'd', 'e', 'v', 'sc', 'a']);
// Alte Links: #zv, #m … und die frueheren Seiten me.html / punkte.html
const LW_LEGACY_HASH = { me: 'm', me2: 'm', me3: 'm', punkte: 'p', zug: 'zv' };
const LW_ROUTES_LONGEST_FIRST = Object.entries(LW_ROUTES).sort((a, b) => b[1].length - a[1].length);
let lwApplyingRoute = false; // true, solange der Router selbst eine Ansicht umschaltet (dann kein neuer Verlaufseintrag)

// Unteradressen: ein Teil hinter der Seite, der etwas Bestimmtes oeffnet.
//   /train/2026-11-12        → Zug, dieser Tag ist markiert
//   /members/lion%20tooth    → Verwaltung, dieses Mitglied aufgeklappt (Gross/Klein egal, alte Namen gehen auch)
//   ?w=2646 (oder ?w=46)     → Dashboard, Eintragen-Liste und Events in dieser KW
const LW_DETAIL_PAGES = new Set(['zv', 'v']);
const LW_KW_PAGES = new Set(['d', 'e', 'w']);
let lwPendingDetail = null; // { id, value }: Mitglied aus dem Link, bis die Verwaltung geladen ist

// ?w= aus der Adresse: 2646 (JahrWoche wie in der App) oder nur 46 (dann dieses Jahr). null wenn keins/ungueltig.
function lwKwFromSearch(search) {
  const raw = String(new URLSearchParams(search || '').get('w') || '').trim();
  if (!/^\d{1,4}$/.test(raw)) return null;
  if (raw.length === 4) return parseYearWeek(raw);
  const yy = Math.floor(currentYearWeek() / 100);
  return parseYearWeek(String(yy).padStart(2, '0') + raw.padStart(2, '0'));
}

// Aktuell geoeffneter Teil einer Seite (Tag, Mitglied) oder ''
function lwCurrentDetail(id) {
  if (id === 'zv') return window.zugRoGetFocusDate?.() || '';
  if (id === 'v') {
    if (lwPendingDetail?.id === 'v') return lwPendingDetail.value;
    return typeof vDetailOpen === 'string' && vDetailOpen ? vDetailOpen.toLowerCase() : '';
  }
  return '';
}

// Teil aus dem Link vormerken bzw. setzen ('' = nichts geoeffnet)
function lwApplyDetail(id, detail) {
  if (id === 'zv') window.zugRoSetFocusDate?.(detail || '');
  if (id === 'v') lwPendingDetail = { id, value: detail || '' };
}

// KW aus dem Link setzen. true, wenn sie sich geaendert hat (dann muessen die Eintraege neu geladen werden).
function lwApplyKw(id, yw) {
  if (!LW_KW_PAGES.has(id) || !yw || yw === kw) return false;
  kw = yw;
  updateKwDisplays();
  return true;
}

// KW per ‹ › gewechselt: Adresse mitziehen
function lwKwChanged() {
  const active = [...LW_KW_PAGES].find((id) => document.getElementById('page-' + id)?.classList.contains('active'));
  if (active) lwSyncUrl(active, { replaceUrl: true });
}

// Tag oder Mitglied geoeffnet/geschlossen: Adresse mitziehen
function lwDetailChanged(id, replace = false) {
  if (lwApplyingRoute) return;
  lwSyncUrl(id, { replaceUrl: replace });
}

// Aktuell gezeigte Ansicht einer Seite (interner Name)
function lwCurrentSub(id) {
  if (id === 'r') return auView;
  if (id === 'w') return activeEventView;
  if (id === 'a') return (document.querySelector('#page-a .admin-page.active')?.id || '').replace('admin-section-', '');
  return '';
}

function lwPathForPage(id) {
  const sub = lwCurrentSub(id);
  const slug = sub ? Object.keys(LW_SUBVIEWS[id] || {}).find((k) => LW_SUBVIEWS[id][k] === sub) : '';
  const detail = lwCurrentDetail(id);
  return LW_APP_BASE.pathname + (LW_ROUTES[id] || '') + (slug ? '/' + slug : '') + (detail ? '/' + encodeURIComponent(detail) : '');
}

// Seite und Ansicht aus der Adresse: { id, sub } oder null (Hauptadresse / unbekannt)
function lwRouteFromLocation() {
  const hash = String(window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
  if (hash && !hash.includes('=')) {
    if (LW_ROUTES[hash]) return { id: hash };
    if (LW_LEGACY_HASH[hash]) return { id: LW_LEGACY_HASH[hash] };
  }
  let rest = window.location.pathname;
  if (!rest.startsWith(LW_APP_BASE.pathname)) return null;
  rest = rest.slice(LW_APP_BASE.pathname.length);
  try { rest = decodeURIComponent(rest); } catch (_) {}
  rest = rest.replace(/\/+$/, '').toLowerCase();
  if (rest === 'me.html' || rest === 'me2.html' || rest === 'me3.html') return { id: 'm' };
  if (rest === 'punkte.html') return { id: 'p' };
  if (!rest || rest === 'index.html') return null;
  const hit = LW_ROUTES_LONGEST_FIRST.find(([, path]) => rest === path || rest.startsWith(path + '/'));
  if (!hit) return null;
  const [id, path] = hit;
  const tail = rest.slice(path.length + 1);
  const sub = LW_SUBVIEWS[id]?.[tail.split('/')[0]];
  // ?w= gilt nur fuer Seiten mit KW-Wahl; ohne ?w= die aktuelle Woche (wichtig fuer Zurueck/Vor)
  const kwOf = (pageId) => LW_KW_PAGES.has(pageId) ? (lwKwFromSearch(window.location.search) || currentYearWeek()) : null;
  // /stats ohne Ansicht: wie der Reiter „Auswertungen“ das Dashboard
  if (id === 'r' && !sub) return { id: 'd', kw: kwOf('d') };
  let detail = '';
  if (id === 'zv' && /^\d{4}-\d{2}-\d{2}$/.test(tail)) detail = tail;
  if (id === 'v') detail = tail.trim();
  return { id, sub, detail, kw: kwOf(id) };
}
function lwPageFromLocation() { return lwRouteFromLocation()?.id || null; }

// Welche Seite beim Start? Erst die Adresse (geteilter Link), sonst die zuletzt gewaehlte
function lwInitialPage() {
  const fromUrl = lwRouteFromLocation();
  if (fromUrl) return { ...fromUrl, fromUrl: true };
  let saved = '';
  try { saved = localStorage.getItem('lwhub_last_page') || ''; } catch (_) {}
  return { id: saved || 'm', fromUrl: false };
}

function lwShowInitialPage(options = {}) {
  const start = lwInitialPage();
  const fromLink = start.fromUrl ? { detail: start.detail || '', kw: start.kw } : {};
  return showPage(start.id, { ...options, sub: start.sub, ...fromLink, fromUrl: start.fromUrl, replaceUrl: true });
}

// KW aus dem Link schon jetzt setzen: die ersten Eintraege werden beim Start geladen, bevor die Seite aufgeht
(function lwApplyKwFromUrlAtStart() {
  const route = lwRouteFromLocation();
  if (route?.kw && LW_KW_PAGES.has(route.id)) kw = route.kw;
})();

// Ansicht aus der Adresse einstellen. render = true: Seite ist schon offen, also gleich neu zeichnen.
function lwApplySub(id, sub, render = false) {
  if (!sub) return;
  lwApplyingRoute = true;
  try {
    if (id === 'r' && document.getElementById('au-' + sub)) {
      const changed = auView !== sub;
      auShow(sub);
      if (render && changed) auLoadView(sub);
    }
    if (id === 'w') {
      activeEventView = sub;
      eventViewPicked = true;
      if (render) selectEventView(sub);
    }
    if (id === 'a') {
      const btn = [...document.querySelectorAll('#page-a .admin-nav-tab')].find((b) => (b.dataset.args || '').includes(`"${sub}"`));
      if (btn) adminShowTab(sub, btn);
    }
  } finally {
    lwApplyingRoute = false;
  }
}

// Adresse an die gezeigte Seite, Ansicht, Tag/Mitglied und KW anpassen.
function lwSyncUrl(id, options = {}) {
  if (options.fromHistory || !LW_ROUTES[id]) return;
  if (!document.getElementById('page-' + id)?.classList.contains('active')) return;
  const target = lwPathForPage(id);
  const query = lwQueryForPage(id);
  const path = window.location.pathname;
  const hasOldHash = /^#[a-z0-9]+$/i.test(window.location.hash || '');
  // Nur eine schon saubere Adresse stehen lassen; /TRAIN, /me.html oder /#zv werden umgeschrieben.
  // ?date=… aus einem geteilten Link bleibt stehen, bis die Auswertung ihren Stand meldet.
  const sameQuery = window.location.search === query || (!query && id === 'r');
  // Pfad vergleichen wie ihn der Browser liefert (%20 bleibt %20, aber Gross/Klein in %C3%A4 kann abweichen)
  let samePath = path === target;
  try { samePath = samePath || decodeURIComponent(path) === decodeURIComponent(target); } catch (_) {}
  if (lwPageFromLocation() === id && !hasOldHash && samePath && sameQuery) return;
  const replace = options.replaceUrl || options.remember === false;
  try {
    if (replace) history.replaceState({ page: id }, '', target + query);
    else history.pushState({ page: id }, '', target + query);
  } catch (_) {}
}

// Eingebettete Auswertungen (Server-Events) melden ihren Stand, z. B. welches Event offen ist. Der kommt als
// ?date=…&start=…&end=… in die LWHub-Adresse, damit „Link teilen“ genau diese Auswertung verschickt.
const LW_FRAME_PARAMS = ['alliance', 'date', 'start', 'end'];
const lwFrameQuery = {}; // Ansicht → letzter gemeldeter Stand ('date=…&start=…')
// options.share: fuer „Link teilen“ steht die KW immer drin, in der Adresszeile nur, wenn es nicht die aktuelle ist
// (sonst zeigt ein Lesezeichen auf /stats/dash fuer immer dieselbe alte Woche).
function lwQueryForPage(id, options = {}) {
  const parts = [];
  if (id === 'r' && lwFrameQuery[auView]) parts.push(lwFrameQuery[auView]);
  if (LW_KW_PAGES.has(id) && (options.share || kw !== currentYearWeek())) parts.push('w=' + formatYearWeek(kw));
  return parts.length ? '?' + parts.join('&') : '';
}
// Stand aus der LWHub-Adresse fuer den Rahmen (nur wenn die Adresse genau diese Ansicht meint)
function lwFrameParamsFromUrl(view) {
  const route = lwRouteFromLocation();
  if (route?.id !== 'r' || route.sub !== view) return {};
  const url = new URLSearchParams(window.location.search);
  const out = {};
  for (const k of LW_FRAME_PARAMS) if (url.get(k)) out[k] = url.get(k);
  return out;
}
window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin || e.data?.type !== 'lwhub:frame-state') return;
  const view = ['trend', 'events'].find((v) => document.querySelector(`#au-${v} iframe`)?.contentWindow === e.source);
  if (!view) return;
  const q = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(String(e.data.query || ''))) if (LW_FRAME_PARAMS.includes(k) && v) q.set(k, v);
  lwFrameQuery[view] = q.toString().replace(/%3A/gi, ':'); // 19:02 statt 19%3A02, im Link besser lesbar
  if (auView !== view || !document.getElementById('page-r')?.classList.contains('active')) return;
  const url = window.location.pathname + lwQueryForPage('r');
  if (url !== window.location.pathname + window.location.search) {
    try { history.replaceState(history.state, '', url); } catch (_) {}
  }
});

// Ansicht innerhalb einer Seite gewechselt (Knopf geklickt): Adresse mitziehen
function lwSubChanged(id, replace = false) {
  if (lwApplyingRoute) return;
  lwSyncUrl(id, { replaceUrl: replace });
}

// Link aus einer anderen Allianz (?a=… setzt „Link teilen“): fragen, ob zum eigenen Charakter dort gewechselt
// werden soll, statt still die Daten der falschen Allianz zu zeigen. ?a= verschwindet danach aus der Adresse.
// true: Wechsel laeuft, die Seite laedt gleich neu (dann ist ?a= gleich der aktiven Allianz und es kommt keine Frage).
async function lwCheckLinkAlliance() {
  const params = new URLSearchParams(window.location.search);
  const want = String(params.get('a') || '').trim();
  if (!want) return false;
  params.delete('a');
  const rest = params.toString().replace(/%3A/gi, ':');
  const dropParam = () => {
    try { history.replaceState(history.state, '', window.location.pathname + (rest ? '?' + rest : '')); } catch (_) {}
  };
  const current = getEffectiveAllianceForApi();
  if (want.toLowerCase() === current.toLowerCase()) { dropParam(); return false; }
  const target = (window.csGetChars?.() || []).find((c) => String(c.alliance || '').toLowerCase() === want.toLowerCase());
  if (!target) {
    dropParam();
    toast(tr('s_link_other_alliance_none').replace('{a}', want));
    return false;
  }
  const ask = tr('s_link_other_alliance_switch').replace('{a}', target.alliance).replace('{c}', target.name);
  if (window.confirm(ask) && window.csSwitchTo?.(target.alliance, target.player_id)) return true;
  dropParam();
  return false;
}

// Link fuehrt auf eine Seite, die diese Person nicht sehen kann: kurz sagen warum
function lwNotifyUnavailable(id) {
  const r4 = LW_R4_PAGES.has(id) && !authMember?.can_manage;
  toast(tr(r4 ? 's_page_r4_only' : 's_page_unavailable'));
}

// Zurueck/Vor im Browser
window.addEventListener('popstate', () => {
  if (!authMember || document.getElementById('login-screen')?.style.display === 'flex') return;
  const route = lwRouteFromLocation() || { id: startPageId() };
  const active = document.getElementById('page-' + route.id)?.classList.contains('active');
  const sameDetail = !LW_DETAIL_PAGES.has(route.id) || (route.detail || '') === lwCurrentDetail(route.id);
  const sameKw = !route.kw || route.kw === kw;
  // Nur die Ansicht wechselt (z. B. /events/vs → /events/guard1): Seite nicht neu laden
  if (route.sub && active && sameDetail && sameKw) {
    lwApplySub(route.id, route.sub, true);
    return;
  }
  showPage(route.id, { fromHistory: true, sub: route.sub, detail: route.detail || '', kw: route.kw });
});

// „Link teilen“: Handy → Teilen-Menue, PC → Zwischenablage
async function lwShareLink() {
  // Link mit KW (falls die Seite eine hat) und Allianz: so sieht der Empfaenger genau diese Woche, und wer
  // mehrere Charaktere hat, wird gefragt, ob er zur passenden Allianz wechseln will (lwCheckLinkAlliance).
  const id = lwPageFromLocation();
  const params = new URLSearchParams(window.location.search);
  if (id && LW_KW_PAGES.has(id)) params.set('w', formatYearWeek(kw));
  const alliance = getEffectiveAllianceForApi();
  if (alliance) params.set('a', alliance);
  const query = params.toString().replace(/%3A/gi, ':');
  const url = window.location.origin + window.location.pathname + (query ? '?' + query : '');
  const title = document.querySelector('#main-tabs .tab.active, #r4-tab-btns .tab.active, #admin-tab-btns .tab.active')?.textContent?.trim();
  const isTouch = window.matchMedia?.('(pointer: coarse)').matches;
  if (isTouch && navigator.share) {
    try { await navigator.share({ title: title ? `LWHub · ${title}` : 'LWHub', url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(tr('s_link_copied'), 'ok');
  } catch (_) {
    window.prompt(tr('s_link_copy_manual'), url);
  }
}
window.lwShareLink = lwShareLink;

// ── NAV ──
// Startseite, wenn die gewuenschte Seite nicht sichtbar ist: Mein Bereich, sonst Meine Teams, sonst Punkte
function startPageId() {
  return isFeatureEnabled('my_area') ? 'm' : isFeatureEnabled('my_teams') ? 't' : 'p';
}

// options.remember = false: automatischer Rueckfall (Seite gerade ausgeblendet, R4-Tabs noch nicht da) –
// dann bleibt die zuletzt selbst gewaehlte Seite gespeichert und wird beim Neuladen wieder geoeffnet.
async function showPage(id, options = {}) {
  const skipBattleLoader = options?.skipBattleLoader === true;
  const safeId = (() => {
    if (id === 'm' && !isFeatureEnabled('my_area')) return startPageId();
    if (id === 't' && !isFeatureEnabled('my_teams')) return startPageId();
    if (id === 'w' && !isEventPageVisible()) return startPageId();
    if (id === 'z' && !isFeatureEnabled('zug')) return startPageId();
    if (id === 'zv' && !isFeatureEnabled('zug')) return startPageId();
    if (id === 'bp' && !isFeatureEnabled('berufe')) return startPageId();
    if (id === 'p' && !isPointsGuideVisible()) return isFeatureEnabled('my_area') ? 'm' : 't';
    if (id === 'sc' && (!document.getElementById('tab-sc') || !isFeatureEnabled('scanner'))) return startPageId();
    if (!document.getElementById('page-' + id)) return startPageId();
    return id;
  })();

  if (options?.remember !== false && safeId === id) {
    try { localStorage.setItem('lwhub_last_page', safeId); } catch(e) {}
  }
  if (options?.fromUrl && safeId !== id) lwNotifyUnavailable(id);
  if (safeId === id) lwApplySub(safeId, options?.sub);
  // Tag/Mitglied und KW aus Link oder Zurueck/Vor; ein normaler Klick auf den Reiter laesst beides, wie es ist
  if (safeId === id && options?.detail !== undefined) lwApplyDetail(safeId, options.detail);
  const kwFromLink = safeId === id && lwApplyKw(safeId, options?.kw);

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById('page-' + safeId);
  if (pageEl) pageEl.classList.add('active');
  lwSyncUrl(safeId, { ...options, replaceUrl: options?.replaceUrl || safeId !== id });
  // Update active tab (search all tab containers since R4 ones are injected later)
  document.querySelectorAll('#main-tabs .tab, #r4-tab-btns .tab, #admin-tab-btns .tab').forEach(t => t.classList.remove('active'));
  // Dashboard gehoert zum Reiter "Auswertungen" (tab-r)
  const tabEl = document.getElementById('tab-' + (safeId === 'd' ? 'r' : safeId));
  if (tabEl) tabEl.classList.add('active');
  if (kwFromLink) await runWithBattleLoader(async () => { try { await loadEntries(); } catch (_) {} }, 0);
  if (safeId === 'sc') {
    // Scanner erst beim ersten Oeffnen laden (OCR-Modelle ~30 MB)
    const frame = document.getElementById('scanner-frame');
    // Zeitstempel in der Adresse: eingebettete Seiten laedt Strg+F5 nicht zuverlaessig neu
    if (frame && !frame.getAttribute('src')) frame.src = frame.dataset.src + '?t=' + Date.now();
  }

  const isBattleView = safeId === 'w' || safeId === 'z' || safeId === 'zv' || safeId === 'bp';

  if (isBattleView) {
    const loadBattleView = async () => {
      const waitForBattleDomReady = async () => {
        const started = Date.now();
        const timeoutMs = 4000;
        while (Date.now() - started < timeoutMs) {
          if (safeId === 'z') {
            const calReady = !!document.querySelector('#zug-cal-grid table');
            const queueReady = !!document.querySelector('#zug-queue-list > *');
            if (calReady && queueReady) break;
          } else if (safeId === 'zv') {
            const calReady = !!document.querySelector('#zug-ro-cal-grid table');
            if (calReady) break;
          } else if (safeId === 'bp') {
            const gridReady = !!document.querySelector('#bp-grid > *');
            const queueReady = !!document.querySelector('#bp-queue > *');
            if (gridReady && queueReady) break;
          } else {
            break;
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      };

      await ensureCoreDataLoaded({ forceEntries: !entries.length });
      if (safeId === 'w') selectEventView(pickEventView());
      if (safeId === 'z') await zugLoadPage();
      if (safeId === 'zv') await window.zugRoLoadPage?.();
      if (safeId === 'bp') await window.berufePlannerLoadPage?.();
      await waitForBattleDomReady();
      // Ensure one full paint cycle after DOM is ready before hiding loader.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    if (skipBattleLoader) {
      await loadBattleView();
    } else {
      await runWithBattleLoader(loadBattleView, 0);
    }
    return;
  }

  // Ensure base member/entry data exists before rendering data-heavy views.
  // Dashboard gehoert zu den Auswertungen: dieselbe Ladeanimation wie dort
  if (id === 'd' && !skipBattleLoader) {
    await runWithBattleLoader(async () => {
      await ensureCoreDataLoaded({ forceEntries: !entries.length });
      renderDashboard();
    }, 0, 120, 0);
  } else if (id === 'd' || id === 'e') {
    await ensureCoreDataLoaded({ forceEntries: !entries.length });
  }

  // Lazy load Mein Bereich – always reload own data when navigating to tab directly
  if (id === 'm' && authMember) {
    if (!meHistoryLoaded || meViewingOther) {
      meViewingOther = false;
      meHistoryLoaded = false;
      await runWithBattleLoader(async () => {
        await me_loadHistory(authMember.discord_id, authMember.member_name);
      });
    }
  }
  if (id === 'd') renderDashboard();
  if (id === 'e') renderList();
  if (id === 't') await renderTeamsPage();
  if (id === 'r') await auLoadView(auView, { skipBattleLoader });
  if (id === 'v') {
    await loadMembers(); await refreshEntriesIfNeeded({background:true}); await loadAccessRequests();
    // Mitglied aus dem Link aufklappen (zeichnet die Liste selbst), sonst nur zeichnen
    const pending = lwPendingDetail?.id === 'v' ? lwPendingDetail : null;
    lwPendingDetail = null;
    if (pending) { vOpenMemberFromLink(pending.value); lwSyncUrl('v', { replaceUrl: true }); }
    else renderVerwaltung();
    renderFlagsAdmin();
  }
  if (id === 'a') adminInitPage();
  if (id !== 'v' && id !== 'm' && id !== 'p' && id !== 't' && id !== 'a' && id !== 'w' && id !== 'z' && id !== 'zv' && id !== 'bp' && id !== 'sc') {
    refreshEntriesIfNeeded({ background: true });
  }
}

function applyInitialSavedPageSelection() {
  const saved = lwInitialPage().id;

  const hasStoredTarget = !!document.getElementById('page-' + saved);
  // R4-Seite aus dem Link (noch nicht geladen): nichts aufdecken statt ersatzweise "Mein Bereich"
  const safeInitial = hasStoredTarget ? saved : (LW_R4_PAGES.has(saved) ? '' : 'm');

  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.getElementById('page-' + safeInitial)?.classList.add('active');

  document.querySelectorAll('#main-tabs .tab, #r4-tab-btns .tab, #admin-tab-btns .tab').forEach((t) => t.classList.remove('active'));
  document.getElementById('tab-' + safeInitial)?.classList.add('active');
}

// ── RENDER ALL ──
function renderAll(){
  if (!document.getElementById('page-d')) return; // R4 pages not yet injected
  renderDashboard();
  if(document.getElementById('page-e')?.classList.contains('active')) renderList();
  if(document.getElementById('page-w')?.classList.contains('active')) selectEventView(pickEventView());
  if(document.getElementById('page-v')?.classList.contains('active')) renderVerwaltung();
  if(document.getElementById('page-bp')?.classList.contains('active')) window.berufePlannerRender?.();
}

// Auswertungen: Unteransicht waehlen. Trend und Server-Events (Scanner-Seiten) erst beim ersten Oeffnen laden,
// mit der Allianz des Hubs.
var auView = 'punkte'; // var: showPage liest es evtl. schon vor dieser Zeile – aktive Ansicht in page-r (Dashboard ist eine eigene Seite, page-d)
function auShow(view) {
  auView = view;
  lwSubChanged('r');
  document.querySelectorAll('#page-r [data-au]').forEach(b => b.classList.toggle('on', b.dataset.au === view));
  for (const v of ['punkte', 'se', 'trend', 'events']) {
    const el = document.getElementById('au-' + v);
    if (el) el.hidden = v !== view;
  }
  const frame = document.querySelector(`#au-${view} iframe[data-src]`);
  if (frame && !frame.getAttribute('src')) {
    const alliance = getEffectiveAllianceForApi();
    frame.src = frame.dataset.src + '?' + new URLSearchParams({ ...(alliance ? { alliance } : {}), ...lwFrameParamsFromUrl(view), t: Date.now() });
  }
}
window.auShow = auShow;

// Leiste der Auswertungen (Dashboard, Punkte, Trend, Server-Events): das Dashboard ist page-d, der Rest page-r
async function auOpen(view) {
  if (view === 'dashboard') return showPage('d');
  const wasOther = auView !== view;
  auShow(view);
  if (!document.getElementById('page-r')?.classList.contains('active')) await showPage('r');
  else if (wasOther) await auLoadView(view);
}
window.auOpen = auOpen;

// Jede Ansicht der Auswertungen laedt mit derselben Ladeanimation (Carlie & Kim). Trend und Server-Events
// sind eingebettete Seiten: die Animation laeuft, bis sie „fertig“ melden (lwhub:frame-ready), hoechstens 12 s.
const auFrameReady = {};   // Ansicht → true, sobald der Rahmen einmal fertig geladen hat
const auFrameWaiters = {}; // Ansicht → [resolve]
function auWaitForFrame(view) {
  const frame = document.querySelector(`#au-${view} iframe`);
  if (!frame || auFrameReady[view]) return Promise.resolve();
  return new Promise((resolve) => {
    (auFrameWaiters[view] ||= []).push(resolve);
    setTimeout(resolve, 12000);
  });
}
window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin || e.data?.type !== 'lwhub:frame-ready') return;
  const view = ['trend', 'events'].find((v) => document.querySelector(`#au-${v} iframe`)?.contentWindow === e.source);
  if (!view) return;
  auFrameReady[view] = true;
  (auFrameWaiters[view] || []).splice(0).forEach((r) => r());
});
async function auLoadViewData(view) {
  if (view === 'punkte') await loadErgebnis();
  else if (view === 'se') await loadSeInactive();
  else await auWaitForFrame(view);
}
// Animation nur, solange wirklich geladen wird: keine Mindestzeit, kein Schlussbild. Ist die Ansicht in
// unter 120 ms fertig, erscheint sie gar nicht erst.
function auLoadView(view, { skipBattleLoader = false } = {}) {
  if (skipBattleLoader) return auLoadViewData(view);
  return runWithBattleLoader(() => auLoadViewData(view), 0, 120, 0);
}
