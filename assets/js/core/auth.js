// LWHub – Discord-Login, Anmeldestatus, Zugangsanfrage
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Kern auslagern“).
// Normales Script, kein Modul: alles bleibt global wie vorher. Reihenfolge der <script>-Tags in index.html beachten.

// ─── DISCORD OAuth2 ───
const DISCORD_CLIENT_ID = '1494427568361967626';
// Immer die Hauptadresse (bei Discord so eingetragen). Wohin es danach geht, steht in lwhub_return_to.
const DISCORD_REDIRECT = LW_APP_BASE.href;
const DISCORD_AUTH_URL = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=token&scope=identify&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT)}`;
const IS_LOCAL_PREVIEW = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const AUTH_STATE_KEY = 'iny_auth_state_v1';
const AUTH_WAIT_MIN_MS = 700;
const LOCAL_DEV_MEMBER_NAME = 'Lion Tooth';
let currentDiscordUser = null;
let authMember = null;
let defaultLoginBoxMarkup = '';

function readAuthState() {
  try {
    const raw = localStorage.getItem(AUTH_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeAuthState(state) {
  authMember = state;
  localStorage.setItem(AUTH_STATE_KEY, JSON.stringify(state));
}

function clearAuthState() {
  authMember = null;
  localStorage.removeItem(AUTH_STATE_KEY);
}

function updateMeButton() { /* no-op: btn-me removed */ }

function goToMe() { showPage('m'); }
window.goToMe = goToMe;

function goToPointsGuide() { showPage('p'); }
window.goToPointsGuide = goToPointsGuide;

// Frueher Sprung auf me.html?member=… (die Datei gibt es nicht mehr): jetzt die Ansicht in der App
function openMemberMe(name) { return openMemberMeInApp(name); }
window.openMemberMe = openMemberMe;

async function openMemberMeInApp(name) {
  const targetName = String(name || '').trim();
  if (!targetName) return;
  meViewingOther = true;
  meHistoryLoaded = false;
  await me_loadHistory('', targetName);
  // Activate page-m directly – bypass showPage() to avoid triggering own-data reload
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-m')?.classList.add('active');
  document.querySelectorAll('#main-tabs .tab, #r4-tab-btns .tab, #admin-tab-btns .tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-m')?.classList.add('active');
}
window.openMemberMeInApp = openMemberMeInApp;

function renderLoginPending(cachedState) {
  const memberName = cachedState?.member_name || cachedState?.discord_username || 'dein Account';
  document.getElementById('login-box').innerHTML = `
    <div class="login-pending">
      <div class="logo">Alli<em>App</em></div>
      <div class="login-spinner"></div>
      <strong>Bekannte Anmeldung gefunden</strong>
      <span>Prüfe gerade ${escHtml(memberName)}. Wenn dein Discord-Login noch gültig ist, geht es automatisch weiter.</span>
    </div>
  `;
}

function restoreLoginBoxMarkup() {
  const loginBox = document.getElementById('login-box');
  if (!loginBox) return;
  if (!defaultLoginBoxMarkup) defaultLoginBoxMarkup = loginBox.innerHTML;
  loginBox.innerHTML = defaultLoginBoxMarkup;
}

function buildLocalAuthState(name) {
  const rank = R5.has(name) ? 5 : R4.has(name) ? 4 : (PREV[name] || 3);
  const meta = memberMeta[name] || {};
  return {
    discord_id: meta.discordId || null,
    discord_username: meta.discordUsername || 'local-dev',
    member_id: meta.id || null,
    member_name: name,
    rank,
    role: rank >= 5 ? 'r5' : rank >= 4 ? 'r4' : 'normal',
    honor_role: null,
    can_manage: rank >= 4,
    can_write: true,
    read_only: false,
    discord_avatar: null,
    discord_avatar_url: getEffectiveAvatarUrl(meta),
    checked_at: new Date().toISOString(),
    local_preview: true
  };
}

function ensureLocalPreviewAuth() {
  // Prefer the actively selected char from localStorage
  let preferredName = LOCAL_DEV_MEMBER_NAME;
  try {
    const ac = JSON.parse(localStorage.getItem('iny_active_char_v1') || 'null');
    if (ac?.name && members.some(m => m.toLowerCase() === ac.name.toLowerCase())) {
      preferredName = members.find(m => m.toLowerCase() === ac.name.toLowerCase());
    }
  } catch (_) {}

  const targetName = members.find((memberName) => memberName.toLowerCase() === preferredName.toLowerCase());
  if (!targetName) {
    clearAuthState();
    toast(`Lokaler Testnutzer nicht gefunden: ${LOCAL_DEV_MEMBER_NAME}`);
    return null;
  }
  const localState = buildLocalAuthState(targetName);
  writeAuthState(localState);
  updateMeButton();
  return localState;
}

// Ziel fuer nach dem Login merken: Discord schickt immer zur Hauptadresse zurueck
const LW_RETURN_KEY = 'lwhub_return_to';
function lwRememberReturnTo() {
  const here = window.location.pathname + window.location.search;
  try {
    if (here !== LW_APP_BASE.pathname) sessionStorage.setItem(LW_RETURN_KEY, here);
    else sessionStorage.removeItem(LW_RETURN_KEY);
  } catch (_) {}
}
function lwTakeReturnTo() {
  let target = '';
  try { target = sessionStorage.getItem(LW_RETURN_KEY) || ''; sessionStorage.removeItem(LW_RETURN_KEY); } catch (_) {}
  // Nur eigene Pfade, nie eine fremde Adresse (//evil.example)
  return target.startsWith(LW_APP_BASE.pathname) && !target.startsWith('//') ? target : '';
}

function discordLogin() {
  lwRememberReturnTo();
  window.location.href = DISCORD_AUTH_URL;
}

function discordLogout() {
  localStorage.removeItem('discord_token');
  localStorage.removeItem('discord_user');
  localStorage.removeItem('iny_active_char_v1');
  clearAuthState();
  window.location.href = LW_APP_BASE.href;
}

async function renderAccessDenied(user, reason = 'Kein Zugriff') {
  const safeUsername = escHtml(user.username || user.global_name || 'Discord User');
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';

  // Load alliances that currently accept login requests
  let allianceSelectHtml = '<input id="req-alliance" placeholder="Allianz">';
  try {
    const data = await adminApi('/alliances/open');
    const opts = data.alliances || [];
    if (opts.length > 0) {
      allianceSelectHtml = `<select id="req-alliance" style="width:100%;background:var(--card2);border:1px solid var(--line2);border-radius:8px;color:var(--text);font-size:13px;padding:8px 10px;outline:none;font-family:'Inter',sans-serif;">`
        + opts.map(a => `<option value="${escHtml(a.short_name)}">${escHtml(a.short_name)}${a.title ? ' \u2013 ' + escHtml(a.title) : ''}</option>`).join('')
        + '</select>';
    } else {
      allianceSelectHtml = '<div style="color:var(--soft);font-size:12px;padding:4px 0;">Aktuell nimmt keine Allianz Login-Anfragen an.</div>';
    }
  } catch (_) {}

  document.getElementById('login-box').innerHTML = `
    <div class="login-user">
      <img src="${avatarUrl}" alt="">
      <span>${safeUsername}</span>
    </div>
    <div style="color:var(--red);font-size:13px;margin-bottom:1rem;">${escHtml(tr(reason))} \u2013 ${escHtml(tr('dein Discord ist aktuell noch keinem aktiven Mitglied zugeordnet.'))}</div>
    <button class="discord-btn" style="background:var(--card2);font-size:13px;padding:8px 20px;" data-action="discordLogout">Anderer Account</button>
    <div class="login-request" id="login-request-box">
      <div class="title">Keinen Zugriff? Anfrage senden</div>
      <div class="hint">Schick uns Allianz + Spielername. Das landet direkt in der Verwaltung als Vorschlag.</div>
      <div class="row">${allianceSelectHtml}</div>
      <div class="row"><input id="req-player" placeholder="Dein Spielername" value="${escHtml(user.global_name || user.username || '')}"></div>
      <div class="row"><textarea id="req-note" placeholder="Optional: kurzer Hinweis (z. B. alter Name)"></textarea></div>
      <button class="send" data-action="submitAccessRequest">Anfrage senden</button>
    </div>
  `;
}

async function submitAccessRequest() {
  const user = currentDiscordUser || JSON.parse(localStorage.getItem('discord_user') || 'null');
  if (!user || !user.id) {
    toast('Bitte erneut mit Discord einloggen.');
    return;
  }

  const alliance = document.getElementById('req-alliance')?.value.trim() || '';
  const playerName = document.getElementById('req-player')?.value.trim() || '';
  const note = document.getElementById('req-note')?.value.trim() || '';
  if (!alliance) {
    toast('Bitte eine Allianz auswählen.');
    return;
  }
  if (!playerName) {
    toast('Bitte deinen Spielernamen eingeben.');
    return;
  }

  try {
    await apiPost({
      action: 'submit_access_request',
      discordId: user.id,
      discordUsername: user.username || user.global_name || null,
      discordAvatar: user.avatar || null,
      alliance,
      playerName,
      note
    });
    const box = document.getElementById('login-request-box');
    if (box) {
      box.innerHTML = '<div class="hint" style="color:var(--green);">Anfrage gesendet. Ein R4/R5 kann dich in der Verwaltung nun direkt zuordnen.</div>';
    }
  } catch (err) {
    toast(tr('Fehler: ') + err.message);
  }
}
window.submitAccessRequest = submitAccessRequest;

function renderAuthError(message) {
  const loginBox = document.getElementById('login-box');
  if (!loginBox) return;
  loginBox.innerHTML = `
    <div class="login-pending" style="gap:16px">
      <div class="logo">Alli<em>App</em></div>
      <div style="color:var(--red);font-size:14px;max-width:320px;text-align:center;line-height:1.5;">${escHtml(message)}</div>
      <button class="discord-btn" style="font-size:13px;padding:8px 20px;" data-action="lwReload">Neu laden</button>
    </div>
  `;
}

async function checkDiscordAuth() {
  const startedAt = Date.now();
  // 1. Token aus URL-Hash lesen (nach Redirect von Discord)
  const hash = window.location.hash;
  if (hash.includes('access_token')) {
    const params = new URLSearchParams(hash.substring(1));
    const token = params.get('access_token');
    localStorage.setItem('discord_token', token);
    // URL säubern und dorthin zurück, wo der Login gestartet wurde (geteilter Link, z. B. /train/plan)
    history.replaceState(null, '', lwTakeReturnTo() || window.location.pathname);
    // Neu-Anmeldung im eigenen Fenster (A11): Token ist gespeichert, das Fenster wird nicht mehr gebraucht
    if (window.name === 'lwhub-reauth') { try { window.close(); } catch (_) {} }
  }

  const token = localStorage.getItem('discord_token');
  if (!token) {
    clearAuthState();
    restoreLoginBoxMarkup();
    return false;
  }

  // 2. Discord User-Info holen
  let res;
  try {
    res = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (e) {
    // Netzwerkfehler beim Erreichen von Discord – Token behalten, Fehlermeldung zeigen
    console.error('[Auth] Discord API nicht erreichbar:', e);
    renderAuthError('Discord nicht erreichbar. Bitte Internetverbindung prüfen und Seite neu laden.');
    return false;
  }

  if (!res.ok) {
    // Token ungültig (z. B. 401) – Token entfernen, Login-Button zeigen
    localStorage.removeItem('discord_token');
    clearAuthState();
    restoreLoginBoxMarkup();
    return false;
  }

  let user;
  try {
    user = await res.json();
  } catch (e) {
    console.error('[Auth] Discord Antwort ungültig:', e);
    renderAuthError('Fehler beim Lesen der Discord-Daten. Bitte Seite neu laden.');
    return false;
  }

  currentDiscordUser = user;
  localStorage.setItem('discord_user', JSON.stringify(user));

  // 3. Serverseitig pruefen, ob Discord-ID einem aktiven Mitglied zugewiesen ist
  let verify;
  try {
    verify = await api('verify_discord', { discord_id: user.id });
  } catch (e) {
    // Serverfehler – Discord-Token ist gültig, daher NICHT entfernen
    console.error('[Auth] verify-discord Fehler:', e);
    renderAuthError('Server nicht erreichbar (' + e.message + '). Bitte kurz warten und Seite neu laden.');
    return false;
  }

  if (!verify || !verify.ok) {
    clearAuthState();
    renderAccessDenied(user, verify?.error || 'Kein Zugriff');
    return false;
  }

  const elapsed = Date.now() - startedAt;
  if (elapsed < AUTH_WAIT_MIN_MS) {
    await new Promise((resolve) => setTimeout(resolve, AUTH_WAIT_MIN_MS - elapsed));
  }

  writeAuthState({
    discord_id: user.id,
    discord_username: user.username || user.global_name || null,
    alliance: verify.alliance || null,
    active_alliance: verify.alliance || null,
    member_id: verify.member_id || null,
    member_name: verify.member_name || null,
    rank: verify.rank || null,
    role: verify.role || 'normal',
    honor_role: verify.honor_role || null,
    site_viewer: !!verify.site_viewer,
    can_set_features: !!verify.can_set_features,
    can_manage: !!verify.can_manage,
    can_write: verify.can_write !== false,
    read_only: !!verify.read_only,
    preferred_language: verify.preferred_language || 'de',
    discord_avatar: verify.discord_avatar || user.avatar || null,
    discord_avatar_url: verify.discord_avatar_url || null,
    checked_at: new Date().toISOString()
  });
  updateMeButton();

  // Avatar/Profil-Cache asynchron nachziehen, ohne den Login zu verzoegern.
  apiPost({
    action: 'cache_discord_profile',
    discordId: user.id,
    discordUsername: user.username || user.global_name || null,
    discordAvatar: user.avatar || null
  }).catch(() => {});

  return verify;
}

// Anmeldung fuer den Server (Konzept v2, A9): Discord-Token zum Pruefen und die eigene Discord-ID.
// Der Server liest die Rolle daraus selbst (Ehrenrollen und Zuschauer duerfen nichts aendern).
