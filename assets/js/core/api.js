// LWHub – API: Adresse, fetchJson, api(), apiPost(), abgelaufene Anmeldung
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Kern auslagern“).
// Normales Script, kein Modul: alles bleibt global wie vorher. Reihenfolge der <script>-Tags in index.html beachten.

// ══════════════════════════════════════════════════════
//  INY RANKING – Backend API (PHP /api)
// ══════════════════════════════════════════════════════

// ─── KONFIGURATION ───
// Optional: localStorage.setItem('iny_api_base', 'https://dein-api-host/api')
// Optional: ?api=https://dein-api-host/api (wird in localStorage gespeichert)
// Hauptadresse der App (aus <base href="/">). Nie location.pathname nehmen: unter /train/plan waere das falsch.
const LW_APP_BASE = new URL('.', document.baseURI);
window.getApiBase = () => (localStorage.getItem('iny_api_base') || '').replace(/\/$/, '') || new URL('api', LW_APP_BASE).href;
const IS_GITHUB_PAGES = window.location.hostname.endsWith('github.io');
const apiFromQuery = new URLSearchParams(window.location.search).get('api');
if (apiFromQuery) {
  localStorage.setItem('iny_api_base', apiFromQuery.replace(/\/$/, ''));
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ''}`;
  history.replaceState(null, '', cleanUrl);
}

const API_BASE_OVERRIDE = (localStorage.getItem('iny_api_base') || '').replace(/\/$/, '');

function buildApiBaseCandidates() {
  if (API_BASE_OVERRIDE) return [API_BASE_OVERRIDE];
  if (window.location.protocol === 'file:') return ['http://127.0.0.1:8080/api'];
  if (IS_GITHUB_PAGES) return [];
  return [new URL('api', LW_APP_BASE).href];
}

const API_BASE_CANDIDATES = buildApiBaseCandidates();
let activeApiBaseIndex = 0;


// ─── Anmeldung abgelaufen (A11) ───
// Unter LWHUB_AUTH_MODE 'enforce' antwortet der Server mit 401 (code no_token / invalid_token / no_caller).
// Statt eines rohen Fehlers: Hinweis mit "Neu anmelden" in einem neuen Fenster. Der neue Token landet im
// gemeinsamen localStorage, diese Seite behaelt ihre Eingaben; danach den letzten Schritt wiederholen.
const LWHUB_REAUTH_CODES = ['no_token', 'invalid_token', 'no_caller'];
function lwhubAuthProblem(status, bodyText) {
  if (status !== 401) return null;
  let data = null;
  try { data = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText; } catch (_) {}
  if (!LWHUB_REAUTH_CODES.includes(data?.code)) return null;
  lwhubShowReauth();
  const err = new Error(tr('s_reauth_error'));
  err.authExpired = true;
  return err;
}
function lwhubShowReauth() {
  if (!document.getElementById('modal-reauth')?.classList.contains('hidden')) return;
  openModal('modal-reauth');
}
window.lwhubReauthLogin = function() {
  const popup = window.open(DISCORD_AUTH_URL, 'lwhub-reauth', 'width=520,height=760');
  if (!popup) { lwRememberReturnTo(); window.location.href = DISCORD_AUTH_URL; return; } // Popup blockiert: wie bisher im selben Tab
  const note = document.getElementById('reauth-wait');
  if (note) note.hidden = false;
};
// Neuer Token aus dem Anmelde-Fenster: Hinweis schliessen
window.addEventListener('storage', (e) => {
  if (e.key !== 'discord_token' || !e.newValue) return;
  if (document.getElementById('modal-reauth')?.classList.contains('hidden')) return;
  closeModal('modal-reauth');
  const note = document.getElementById('reauth-wait');
  if (note) note.hidden = true;
  toast(tr('s_reauth_done'), 'ok');
});

function lwhubAuthHeaders() {
  const headers = {};
  try {
    const token = localStorage.getItem('discord_token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch (_) {}
  if (authMember?.discord_id) headers['X-Discord-Id'] = String(authMember.discord_id);
  return headers;
}

async function fetchJson(path, options = {}) {
  if (!API_BASE_CANDIDATES.length) {
    throw new Error('API nicht konfiguriert');
  }
  options = { ...options, headers: { ...lwhubAuthHeaders(), ...(options.headers || {}) } };
  try {
    const normalizedPath = String(path || '').toLowerCase();
    if (!normalizedPath.startsWith('/verify-discord')) {
      const hasAllianceQuery = /(?:\?|&)alliance=/.test(String(path || ''));
      const activeChar = JSON.parse(localStorage.getItem('iny_active_char_v1') || 'null');
      if (!hasAllianceQuery && activeChar?.alliance) {
        path = path + (path.includes('?') ? '&' : '?') + 'alliance=' + encodeURIComponent(activeChar.alliance);
      }
    }
  } catch (_) {}
  let lastError = null;

  for (let i = activeApiBaseIndex; i < API_BASE_CANDIDATES.length; i += 1) {
    const base = API_BASE_CANDIDATES[i];
    const url = `${base}${path}`;

    try {
      const r = await fetch(url, options);
      if (r.ok) {
        activeApiBaseIndex = i;
        return r.json();
      }

      const txt = await r.text();
      const authErr = lwhubAuthProblem(r.status, txt);
      if (authErr) throw authErr;
      lastError = new Error(`${r.status} ${r.statusText}${txt ? `: ${txt}` : ''}`);

      if ((r.status === 404 || r.status === 502 || r.status === 503) && i < API_BASE_CANDIDATES.length - 1) {
        continue;
      }
      throw lastError;
    } catch (err) {
      if (err.authExpired) throw err; // Anmeldung abgelaufen: nicht die naechste API-Adresse probieren
      lastError = err;
      if (i < API_BASE_CANDIDATES.length - 1) continue;
      throw err;
    }
  }

  throw lastError || new Error('API request failed');
}

function getEntryRankByName(name, fallback = 3) {
  const e = entries.find(x => x.name === name);
  if (e && e.rank != null) return e.rank;
  return PREV[name] || fallback;
}

async function api(action, params = {}) {
  switch ((action || '').toLowerCase()) {
    case 'members': {
      const data = await fetchJson('/members');
      return data.map(m => ({
        id: m.id || null,
        alliance: m.alliance || null,
        name: m.name,
        rank: m.default_rank,
        role: m.role,
        discord_id: m.discord_id || null,
        discord_username: m.discord_username || null,
        discord_avatar: m.discord_avatar || null,
        discord_connected: !!m.discord_connected,
        discord_avatar_url: m.discord_avatar_url || null,
        last_visit_at: m.last_visit_at || null,
        beruf: m.beruf || null,
        beruf_med_hilfe: !!m.beruf_med_hilfe,
        beruf_winwin: m.beruf_winwin || null,
        honor_role: m.honor_role || null,
        honor_home: m.honor_home || null,
        honor_home_alliance: m.honor_home_alliance || null,
        can_write: m.can_write !== false,
        read_only: !!m.read_only,
      }));
    }
    case 'entries': {
      const week = parseInt(params.kw, 10);
      if (!Number.isFinite(week)) return [];
      return fetchJson(`/entries/${week}?with_former=1`); // auch Ehemalige der Woche (former)
    }
    case 'weights':
      return W;
    case 'verify_discord':
      return fetchJson(`/verify-discord?discord_id=${encodeURIComponent(params.discord_id || '')}`);
    case 'access_requests':
      return fetchJson('/access-requests?status=pending');
    case 'ranking-history': {
      const w = parseInt(params.weeks, 10) || 4;
      return fetchJson(`/ranking-history?weeks=${w}`);
    }
    default:
      return { error: `Unknown action: ${action}` };
  }
}

async function apiPost(data) {
  const isHonorReadOnly = !!(authMember?.read_only || authMember?.honor_role);
  const action = (data?.action || '').toLowerCase();
  const blockedHonorActions = new Set([
    'save_entry', 'save_wache', 'save_wueste', 'save_spezial',
    'add_member', 'edit_member', 'update_member', 'swap_member_id_to_discord',
    'delete_member', 'archive_week', 'update_ergebnis', 'delete_entry',
    'save_beruf', 'resolve_access_request', 'set_member_language', 'cache_discord_profile'
  ]);
  if (isHonorReadOnly && blockedHonorActions.has(action)) {
    throw new Error(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.'));
  }
  switch (action) {
    case 'save_entry':
    case 'save_wache':
    case 'save_wueste':
    case 'save_spezial': {
      return fetchJson(`/entries/${kw}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          rank: data.rank != null ? data.rank : getEntryRankByName(data.name, 3),
          flags: data.flags || {},
          scan_lock: data.scanLock || undefined,     // 'vs' | 'spende': von Hand gesetzt, Upload laesst es stehen
          scan_unlock: data.scanUnlock || undefined, // aus dem Scanner uebernommen: Upload darf wieder setzen
          discord_id: authMember?.discord_id || ''
        })
      });
    }
    case 'add_member': {
      return fetchJson('/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          default_rank: data.rank,
          role: data.role,
          honor_role: data.honor_role || null,
          honor_home: data.honor_home || null,
          discord_id: data.discord_id || undefined
        })
      });
    }
    case 'edit_member':
    case 'update_member': {
      const oldName = encodeURIComponent(data.oldName || '');
      return fetchJson(`/members/${oldName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.newName,
          default_rank: data.rank,
          role: data.role,
          honor_role: data.honor_role || null,
          honor_home: data.honor_home || null,
          discord_id: data.discordId
        })
      });
    }
    case 'swap_member_id_to_discord': {
      const name = encodeURIComponent(data.name || '');
      return fetchJson(`/members/${name}/swap-id-to-discord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
    }
    case 'delete_member': {
      const name = encodeURIComponent(data.name || '');
      return fetchJson(`/members/${name}`, { method: 'DELETE' });
    }
    case 'submit_access_request': {
      return fetchJson('/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_id: data.discordId,
          discord_username: data.discordUsername,
          discord_avatar: data.discordAvatar,
          alliance: data.alliance,
          player_name: data.playerName,
          note: data.note
        })
      });
    }
    case 'resolve_access_request': {
      const requestId = encodeURIComponent(data.requestId || '');
      return fetchJson(`/access-requests/${requestId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: data.status || 'accepted' })
      });
    }
    case 'cache_discord_profile': {
      return fetchJson('/discord-profile-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_id: data.discordId,
          discord_username: data.discordUsername,
          discord_avatar: data.discordAvatar
        })
      });
    }
    case 'archive_week':
    case 'update_ergebnis':
      return { ok: true };
    case 'delete_entry': {
      const name = encodeURIComponent(data.name || '');
      return fetchJson(`/entries/${kw}/${name}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_id: authMember?.discord_id || '', scan_lock: data.scanLock || undefined })
      });
    }
    case 'save_beruf': {
      const name = encodeURIComponent(data.name || '');
      return fetchJson(`/members/${name}/beruf`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_id: authMember?.discord_id || '',
          beruf: data.beruf ?? null,
          med_hilfe: data.med_hilfe ? 1 : 0,
          winwin: data.winwin || null
        })
      });
    }
    case 'set_member_language': {
      const name = encodeURIComponent(data.name || '');
      return fetchJson(`/members/${name}/language`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_id: data.discordId || authMember?.discord_id || '',
          preferred_language: data.preferred_language || 'de'
        })
      });
    }
    default:
      return { error: `Unknown action: ${action}` };
  }
}

