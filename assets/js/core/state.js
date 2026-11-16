// LWHub – State: Woche, Mitglieder, Einträge, Avatar-Cache
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Kern auslagern“).
// Normales Script, kein Modul: alles bleibt global wie vorher. Reihenfolge der <script>-Tags in index.html beachten.

// ── STATE ──
const ENTRIES_CACHE_PREFIX = 'iny_entries_cache_v2_'; // v2: mit Ehemaligen (with_former)
const ENTRIES_REFRESH_MS = 60 * 60 * 1000;

let kw=currentYearWeek(), entries=[], activeFilter='all', listFilter='all', search='', edName=null, edFlags={}, edRank=3;
let doneMode=0; // 0=normal, 1=ans Ende, 2=ausblenden
let members = [];
let honorMembers = [];
let memberMeta = {};
let accessRequests = [];
let entriesLoading = false;
let entriesLoadedAt = 0;
let coreDataInitPromise = null;
let avatarCache = {};
const AVATAR_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 Tage
try {
  avatarCache = JSON.parse(localStorage.getItem('iny_avatar_cache') || '{}') || {};
} catch (err) {
  avatarCache = {};
}

function getEffectiveAvatarUrl(meta) {
  if (!meta) return null;
  if (meta.discordAvatarUrl) return meta.discordAvatarUrl;
  if (meta.discordId) {
    const entry = avatarCache[meta.discordId];
    if (entry) {
      // Altes Format (plain string) und neues Format ({url, savedAt})
      const url = typeof entry === 'string' ? entry : entry.url;
      if (url) return url;
    }
  }
  return null;
}

function isAvatarCacheStale(discordId) {
  if (!discordId) return true;
  const entry = avatarCache[discordId];
  if (!entry) return true;
  if (typeof entry === 'string') return true; // altes Format → neu laden
  return (Date.now() - (entry.savedAt || 0)) > AVATAR_CACHE_TTL;
}

function setAvatarCache(discordId, url) {
  avatarCache[discordId] = { url, savedAt: Date.now() };
  try { localStorage.setItem('iny_avatar_cache', JSON.stringify(avatarCache)); } catch {}
}

function getEntriesCacheKey(yearWeek) {
  return `${ENTRIES_CACHE_PREFIX}${yearWeek}`;
}

function readEntriesCache(yearWeek) {
  try {
    const raw = localStorage.getItem(getEntriesCacheKey(yearWeek));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !Array.isArray(parsed.data) || !Number.isFinite(parsed.savedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEntriesCache(yearWeek, data) {
  try {
    localStorage.setItem(getEntriesCacheKey(yearWeek), JSON.stringify({
      savedAt: Date.now(),
      data: Array.isArray(data) ? data : []
    }));
  } catch {}
}

function applyEntriesData(data) {
  entries = [];
  if (!data || data.error) return;
  data.forEach(e => {
    const flags = (e.flags && !Array.isArray(e.flags)) ? e.flags : {}; // alter Cache: [] bei leeren Eintraegen
    const pts = e.points != null ? e.points : calcPoints(flags);
    const baseRank = e.rank || PREV[e.name] || 3;
    const nr = e.newRank != null ? e.newRank : calcRanking(pts, baseRank);
    entries.push({
      name: e.name,
      rank: nr,
      baseRank: baseRank,
      flags: flags,
      points: pts,
      afk: e.afk || !!flags.afk,
      former: e.former || null,            // 'archived' | 'moved': in dieser Woche dabei, heute nicht mehr
      nowAlliance: e.now_alliance || null,
    });
  });
}

// Mitglieder der gewaehlten KW (GET /week-roster): wer damals in der Allianz war – Neue erst ab ihrer
// Beitrittswoche, Ausgetretene und Gewechselte grau und nur lesen. Bis die Liste da ist: heutige Mitglieder.
let weekRoster = { kw: null, names: [], former: new Map() };
async function loadWeekRoster(forKw) {
  try {
    const data = await fetchJson(`/week-roster?year_week=${forKw}`);
    const former = new Map();
    const names = (data.members || []).map(m => {
      if (m.former) former.set(m.name, { type: m.former, now: m.now_alliance || null });
      if (PREV[m.name] == null) PREV[m.name] = m.rank || 3;
      return m.name;
    });
    weekRoster = { kw: forKw, names, former };
  } catch (_) {
    weekRoster = { kw: null, names: [], former: new Map() };
  }
}
function weekMembers() { return weekRoster.kw === kw ? weekRoster.names : members; }
function formerInfo(name) {
  if (weekRoster.kw === kw && weekRoster.former.has(name)) return weekRoster.former.get(name);
  const e = entries.find(x => x.name === name);
  return e?.former ? { type: e.former, now: e.nowAlliance } : null;
}
function isFormer(name) { return !!formerInfo(name); }
function activeWeekMembers() { return weekMembers().filter(n => !isFormer(n)); }
function formerCls(name) { return isFormer(name) ? ' former' : ''; }
function formerTag(name) {
  const f = formerInfo(name);
  if (!f) return '';
  const label = f.type === 'moved' && f.now ? trf('jetzt {a}', { a: f.now }) : tr('ausgetreten');
  return ` <span class="former-tag" title="${escHtml(tr('Ehemaliges Mitglied – nur lesen'))}">${escHtml(label)}</span>`;
}
// Ehemalige lassen sich nicht bearbeiten: Speichern wuerde sie sonst als Mitglied neu anlegen
function guardFormer(name) {
  if (!isFormer(name)) return false;
  toast(tr('Ehemaliges Mitglied – in dieser Woche nur lesen'));
  return true;
}

async function loadMemberDiscordAvatar(name) {
  const meta = memberMeta[name] || {};
  if (!meta.discordId) {
    toast('Keine Discord-ID vorhanden.');
    return;
  }

  const probeUrl = `https://unavatar.io/discord/${encodeURIComponent(meta.discordId)}?fallback=false&t=${Date.now()}`;
  let ok = false;
  try {
    const resp = await fetch(probeUrl, { method: 'HEAD' });
    ok = resp.ok;
  } catch {}

  if (!ok) {
    toast('Kein Discord-Bild gefunden.');
    return;
  }

  setAvatarCache(meta.discordId, probeUrl);
  meta.discordAvatarUrl = probeUrl;
  memberMeta[name] = meta;
  renderVerwaltung(document.getElementById('v-search').value.toLowerCase());
  toast('Discord-Bild geladen.');
}
window.loadMemberDiscordAvatar = loadMemberDiscordAvatar;

async function autoRefreshAvatars() {
  // Im lokalen Modus oder ohne Discord-Token keine externen Anfragen
  if (IS_LOCAL_PREVIEW || !localStorage.getItem('discord_token')) return;
  const stale = Object.values(memberMeta).filter(m => m.discordId && isAvatarCacheStale(m.discordId));
  if (!stale.length) return;
  for (const meta of stale) {
    const probeUrl = `https://unavatar.io/discord/${encodeURIComponent(meta.discordId)}?fallback=false&t=${Date.now()}`;
    let ok = false;
    try {
      const resp = await fetch(probeUrl, { method: 'HEAD' });
      ok = resp.ok;
    } catch {}
    // Cache both hits and misses (null url) to prevent re-probing within TTL
    setAvatarCache(meta.discordId, ok ? probeUrl.split('&t=')[0] : null);
  }
}

