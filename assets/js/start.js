// LWHub – Start: Sync, Presence-Ping, initApp(). Lädt als letztes App-Script, wenn alle Seiten-Dateien da sind.
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html). Normales Script, kein Modul:
// alles bleibt global wie vorher. Die Reihenfolge der <script>-Tags in index.html ist die Ladereihenfolge.

// ── SYNC ──
async function syncData(){
  const btn = document.getElementById('btn-sync');
  btn.classList.add('spinning');
  try {
    await loadMembers();
    await loadEntries();
    await loadAccessRequests();
    renderAll();
    if (document.getElementById('page-w')?.classList.contains('active')) selectEventView(activeEventView);
    toast('Daten synchronisiert!');
  } catch(e) {
    toast(tr('Sync-Fehler: ') + e.message);
  } finally {
    btn.classList.remove('spinning');
  }
}
window.syncData = syncData;

// ── PRESENCE PING (unabhängig vom Chat-Widget) ──
function startPresencePing(memberName, discordId, discordUsername) {
  async function ping() {
    try {
      await fetchJson('/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_name: memberName, discord_id: discordId, discord_username: discordUsername || '' })
      });
    } catch (_) {}
  }
  ping();
  setInterval(ping, 5 * 60 * 1000);
}

// ── INIT ──
async function initApp(){
  const loginBox = document.getElementById('login-box');
  if (loginBox && !defaultLoginBoxMarkup) {
    defaultLoginBoxMarkup = loginBox.innerHTML;
  }

  authMember = readAuthState();
  updateMeButton();

  if (typeof window.registerI18nPersistHandler === 'function') {
    window.registerI18nPersistHandler(async (lang) => {
      const memberName = authMember?.member_name || '';
      const discordId = authMember?.discord_id || '';
      if (!memberName || !discordId) return;
      await apiPost({
        action: 'set_member_language',
        name: memberName,
        discordId,
        preferred_language: lang
      });
      authMember.preferred_language = lang;
      writeAuthState(authMember);
      if (memberMeta[memberName]) memberMeta[memberName].preferredLanguage = lang;
    });
  }
  if (typeof window.initI18n === 'function') {
    await window.initI18n(authMember?.preferred_language || '');
  }

  if (!API_BASE_CANDIDATES.length) {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-box').innerHTML = `
      <div class="login-config-title">API nicht konfiguriert</div>
      <div class="login-config-text">
        Bitte setze einmalig die API-URL in der Browser-Konsole:
        <br><br>
        localStorage.setItem('iny_api_base','https://DEIN-API-HOST/api'); location.reload();
      </div>
    `;
    return;
  }

  if (!IS_LOCAL_PREVIEW) {
    const hasStoredToken = !!localStorage.getItem('discord_token');
    if (hasStoredToken) {
      renderLoginPending(authMember || readAuthState());
      document.getElementById('login-screen').style.display = 'flex';
    }

    // Discord Auth nur online prüfen
    const authResult = await checkDiscordAuth();
    if (!authResult) {
      document.getElementById('login-screen').style.display = 'flex';
      return;
    }

    document.getElementById('logout-btn').style.display = 'block';

    // Init char switcher
    if (typeof window.initCharSwitcher === 'function') {
      await window.initCharSwitcher(currentDiscordUser, authMember);
      authMember = readAuthState() || authMember;
      // Link einer anderen Allianz? Dann fragen; beim Wechsel laedt die Seite neu
      if (await lwCheckLinkAlliance()) return;
      if (typeof window.setAppLanguage === 'function' && authMember?.preferred_language) {
        await window.setAppLanguage(authMember.preferred_language, { persistLocal: true, persistServer: false });
      }
    }

    // Render role-protected navigation only after active char + language are finalized.
    resetRoleScopedUi();
    if (authMember?.can_manage) {
      await injectR4Tabs(authMember.discord_id);
      await injectAdminTabs(authMember.discord_id); // R5 oder Betreiber, das entscheidet der Server
    }

    // Nav actions for char-switcher dropdown (tabs hidden on mobile → show as menu items)
    buildNavActionsFromTabs();

    showBattleLoader();
    document.getElementById('login-screen').style.display = 'none';
    startPresencePing(authMember.member_name, authMember.discord_id, authMember.discord_username);
    await Promise.all([me_loadHistory(authMember.discord_id, authMember.member_name), loadFlagConfig()]);
    // Warm up core datasets right after login so Events/Zug are ready without manual sync.
    ensureCoreDataLoaded({ forceEntries: true }).catch(() => {});

    updateEventTabVisibility();
    // Erst die Seite aus dem Link (oder die zuletzt besuchte) fertig laden, dann die Animation ausblenden.
    // Sonst blitzt kurz "Mein Bereich" auf, bevor z. B. /stats/inactive erscheint.
    await lwShowInitialPage({ skipBattleLoader: true }).catch(() => {});
    const _initElapsed = Date.now() - battleLoaderShownAt;
    if (_initElapsed < 1800) await new Promise(r => setTimeout(r, 1800 - _initElapsed));
    await hideBattleLoader();
    return;
  }

  // ── Lokal / Local Preview ──
  document.getElementById('login-screen').style.display = 'none';
  showBattleLoader();
  try {
    await loadFlagConfig();
    await loadMembers();
    autoRefreshAvatars(); // Avatar-Cache im Hintergrund auffrischen (max. 1x pro 7 Tage)
    const localAuth = ensureLocalPreviewAuth();
    if (!localAuth) {
      document.getElementById('login-screen').style.display = 'flex';
      return;
    }
    const _lpDiscordId = localAuth?.discord_id || 'local-preview';
    if (typeof window.initCharSwitcher === 'function') {
      await window.initCharSwitcher({ id: _lpDiscordId, username: localAuth?.discord_username || 'Lokaler Admin', avatar: null }, localAuth);
      authMember = readAuthState() || localAuth;
      if (typeof window.setAppLanguage === 'function' && authMember?.preferred_language) {
        await window.setAppLanguage(authMember.preferred_language, { persistLocal: true, persistServer: false });
      }
    } else {
      window.addEventListener('load', () => {
        if (typeof window.initCharSwitcher === 'function')
          window.initCharSwitcher({ id: _lpDiscordId, username: localAuth?.discord_username || 'Lokaler Admin', avatar: null }, localAuth);
      });
    }
    resetRoleScopedUi();
    if (authMember?.can_manage) {
      await injectR4Tabs(authMember.discord_id || 'local-preview');
      await injectAdminTabs(authMember.discord_id || 'local-preview'); // R5 oder Betreiber, das entscheidet der Server
      updateEventTabVisibility();
      renderAll();
      hydrateEntriesFromCache(kw, { allowStale: true });
      renderAll();
      refreshEntriesIfNeeded({ force: !entries.length, background: true });
      loadAccessRequests().then(() => {
        if (document.getElementById('page-v')?.classList.contains('active')) {
          renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
        }
      });
    }
    // Nav actions for char-switcher dropdown (tabs hidden on mobile → show as menu items)
    buildNavActionsFromTabs();
    startPresencePing(localAuth.member_name || LOCAL_DEV_MEMBER_NAME, localAuth.discord_id || '', localAuth.discord_username || '');
    await me_loadHistory(localAuth.discord_id || '', localAuth.member_name || LOCAL_DEV_MEMBER_NAME);
    await lwShowInitialPage({ skipBattleLoader: true }).catch(() => {});
    const _initElapsed = Date.now() - battleLoaderShownAt;
    if (_initElapsed < 1800) await new Promise(r => setTimeout(r, 1800 - _initElapsed));
    await hideBattleLoader();
  } catch(e) {
    await hideBattleLoader();
    toast('Fehler beim Laden: ' + e.message);
  }
}

// ── Los geht's ──
applyInitialSavedPageSelection();
initApp();
