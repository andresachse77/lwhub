/**
 * char-switcher.js – Shared Character Switcher & Alliance Title Component
 *
 * Fügt oben rechts in der Navbar ein Discord-Profilbild mit Charakter-Dropdown ein.
 * Mehrere Charaktere (auch alliance-übergreifend) können gewechselt werden.
 * Der zuletzt genutzte Charakter wird serverseitig und lokal gespeichert.
 *
 * Nutzung: <script src="char-switcher.js"></script>
 * Voraussetzungen:
 *   - window.getApiBase() oder localStorage('iny_api_base') verfügbar
 *   - window.currentDiscordUser nach Discord-Auth gesetzt (mit: { id, username, avatar })
 *   - window.authMember gesetzt (aus verify-discord)
 *   - Öffentliche Funktion: window.initCharSwitcher(discordUser, authMember)
 */
(function () {
  'use strict';

  const AUTH_KEY        = 'iny_auth_state_v1';
  const ACTIVE_CHAR_KEY = 'iny_active_char_v1';
  const tr = (text) => (typeof window.trText === 'function' ? window.trText(text) : text);
  let csCachedChars = [];
  let csCachedDiscordId = '';
  let csCachedAlliance = '';

  function getApiBase() {
    if (typeof window.getApiBase === 'function') return window.getApiBase();
    const override = (localStorage.getItem('iny_api_base') || '').replace(/\/$/, '');
    if (override) return override;
    return new URL('api', document.baseURI).href; // <base href="/"> in index.html
  }

  // Discord-Token und eigene Discord-ID mitsenden, damit der Server die Rolle selbst prueft (wie fetchJson)
  function authHeaders() {
    const headers = {};
    try {
      const token = localStorage.getItem('discord_token');
      if (token) headers.Authorization = `Bearer ${token}`;
      const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      if (auth?.discord_id) headers['X-Discord-Id'] = String(auth.discord_id);
    } catch (_) {}
    return headers;
  }

  async function apiGet(path) {
    const res = await fetch(getApiBase() + path, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(getApiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function escHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function rankLabel(r, honorRole) {
    if (honorRole === 'honor_r4') return 'E-R4';
    if (honorRole === 'honor_member') return 'Ehre';
    return { 1:'R1', 2:'R2', 3:'R3', 4:'R4', 5:'R5' }[+r] || 'R?';
  }

  // ── CSS ──────────────────────────────────────────────────────────────────────
  // Die Styles stehen in assets/css/app.css (Block „CHAR-SWITCHER“), nicht mehr per <style> eingefügt (CSP style-src).

  // ── Build DOM ─────────────────────────────────────────────────────────────────
  function buildWidget(discordUser, authMember) {
    const wrap = document.createElement('div');
    wrap.id = 'cs-wrap';

    // Trigger button
    const trigger = document.createElement('div');
    trigger.id = 'cs-trigger';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');

    // Avatar
    const avatarUrl = discordUser?.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=64`
      : (authMember?.discord_avatar_url || null);

    if (avatarUrl) {
      const img = document.createElement('img');
      img.id  = 'cs-avatar';
      img.src = avatarUrl;
      img.alt = '';
      trigger.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'cs-avatar-placeholder';
      ph.textContent = (authMember?.member_name || discordUser?.username || '?')[0].toUpperCase();
      trigger.appendChild(ph);
    }

    const charName = document.createElement('div');
    charName.id = 'cs-char-name';
    charName.textContent = authMember?.member_name || discordUser?.username || '–';
    trigger.appendChild(charName);

    const caret = document.createElement('span');
    caret.id = 'cs-caret';
    caret.textContent = '▼';
    trigger.appendChild(caret);

    wrap.appendChild(trigger);

    // Dropdown
    const dropdown = document.createElement('div');
    dropdown.id = 'cs-dropdown';
    dropdown.innerHTML = `<div id="cs-nav-section"></div><div class="cs-section-label" id="cs-chars-label">${escHtml(tr('Charaktere'))}</div><div id="cs-chars-list"></div>`;
    wrap.appendChild(dropdown);

    // Toggle – rebuild nav section on open so it reflects current compact state
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !trigger.classList.contains('open');
      trigger.classList.toggle('open');
      dropdown.classList.toggle('open');
      if (opening) rebuildNavSection();
    });
    document.addEventListener('click', () => {
      trigger.classList.remove('open');
      dropdown.classList.remove('open');
    });
    dropdown.addEventListener('click', e => e.stopPropagation());

    // Rebuild only the nav-actions divider + buttons at bottom of list
    function rebuildNavSection() {
      const navSection = document.getElementById('cs-nav-section');
      if (!navSection) return;
      navSection.innerHTML = '';
      const navActions = window.csNavActions || [];
      const isMobile = window.innerWidth <= 720;
      const isCompact = document.body.classList.contains('nav-compact');
      const hiddenActions = navActions.filter(a =>
        isMobile || !a.btnRef || a.btnRef.style.display === 'none'
      );
      if (isCompact && hiddenActions.length) {
        hiddenActions.forEach((a) => {
          const origIdx = navActions.indexOf(a);
          const btn = document.createElement('button');
          btn.className = 'cs-menu-item cs-nav-item';
          btn.dataset.navAction = origIdx;
          btn.textContent = a.label;
          btn.addEventListener('click', () => {
            dropdown.classList.remove('open');
            trigger.classList.remove('open');
            if (a.fn) a.fn();
          });
          navSection.appendChild(btn);
        });
        const syncEl = document.getElementById('btn-sync');
        if (syncEl) {
          const syncBtn = document.createElement('button');
          syncBtn.className = 'cs-menu-item cs-nav-item';
          syncBtn.id = 'cs-sync-btn';
          syncBtn.textContent = `🔄 ${tr('Daten aktualisieren')}`;
          syncBtn.addEventListener('click', () => {
            dropdown.classList.remove('open');
            trigger.classList.remove('open');
            syncEl.click();
          });
          navSection.appendChild(syncBtn);
        }
        const divider = document.createElement('div');
        divider.className = 'cs-divider cs-nav-divider';
        navSection.appendChild(divider);
      }

      // Language switcher – always show in dropdown when navbar lang-select is hidden
      const langEl = document.getElementById('lang-switch');
      if (langEl && (isCompact || isMobile)) {
        const langRow = document.createElement('div');
        langRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px 2px 6px;';
        const langLabel = document.createElement('span');
        langLabel.style.cssText = 'font-size:12px;color:#7a8498;flex-shrink:0;';
        langLabel.textContent = '🌐 ' + tr('Sprache');
        const langSel = document.createElement('select');
        langSel.style.cssText = 'flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#dde1ec;font-size:12px;padding:4px 6px;outline:none;cursor:pointer;font-family:inherit;';
        for (const opt of langEl.options) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.textContent;
          if (opt.selected) o.selected = true;
          langSel.appendChild(o);
        }
        langSel.addEventListener('change', () => {
          langEl.value = langSel.value;
          langEl.dispatchEvent(new Event('change'));
          dropdown.classList.remove('open');
          trigger.classList.remove('open');
        });
        langRow.appendChild(langLabel);
        langRow.appendChild(langSel);
        navSection.appendChild(langRow);
        const langDivider = document.createElement('div');
        langDivider.className = 'cs-divider';
        langDivider.style.marginTop = '8px';
        navSection.appendChild(langDivider);
      }
    }

    return wrap;
  }

  // ── Inject into topbar ────────────────────────────────────────────────────────
  function injectIntoTopbar(widget) {
    // Prevent double-injection
    if (document.getElementById('cs-wrap')) {
      document.getElementById('cs-wrap').replaceWith(widget);
      return true;
    }
    // Try common topbar selectors – always append (not prepend) to avoid fighting existing buttons
    const selectors = ['.nav-actions', '.topbar-actions', '.nav-right', '.topbar', 'nav'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.appendChild(widget);
        return true;
      }
    }
    document.body.appendChild(widget);
    return false;
  }

  function syncTriggerCharName(activeChar, fallbackName) {
    const charNameEl = document.getElementById('cs-char-name');
    if (!charNameEl) return;
    const nextName = (activeChar && activeChar.name) || fallbackName || charNameEl.textContent || '–';
    charNameEl.textContent = nextName;

    if (activeChar && window.authMember && typeof window.authMember === 'object') {
      window.authMember.member_name = activeChar.name;
    }
  }

  // ── Render chars ──────────────────────────────────────────────────────────────
  function renderChars(chars, discordId, currentAllianceShort, viewerAlliances = []) {
    const list = document.getElementById('cs-chars-list');
    if (!list) return;

    csCachedChars = Array.isArray(chars) ? chars : [];
    csCachedDiscordId = discordId || '';
    csCachedAlliance = currentAllianceShort || '';

    const dropdown = document.getElementById('cs-dropdown');

    if ((!chars || !chars.length) && !viewerAlliances.length) {
      list.innerHTML = `<div class="cs-empty">${escHtml(tr('Keine Charaktere gefunden'))}</div>`;
      return;
    }
    chars = chars || [];

    // Group by alliance
    const byAlliance = {};
    for (const c of chars) {
      if (!byAlliance[c.alliance]) byAlliance[c.alliance] = [];
      byAlliance[c.alliance].push(c);
    }

    let html = '';
    for (const [ally, cs] of Object.entries(byAlliance)) {
      if (Object.keys(byAlliance).length > 1) {
        html += `<div class="cs-section-label cs-section-label-spaced">${escHtml(ally)}</div>`;
      }
      for (const c of cs) {
        const isActive = c.is_active;
        const rankKey = [1, 2, 3, 4, 5].includes(+c.rank) ? +c.rank : 'x'; // Farbe: .cs-char-rank-1..5/x in app.css
        html += `
          <div class="cs-char-item${isActive ? ' active' : ''}"
               data-player="${escHtml(c.player_id)}" data-alliance="${escHtml(c.alliance)}" data-name="${escHtml(c.name)}">
            <span class="cs-char-rank cs-char-rank-${rankKey}" title="${c.honor_role === 'honor_r4' ? escHtml(tr('Ehren-R4: nur ansehen')) : ''}">${escHtml(rankLabel(c.rank, c.honor_role))}</span>
            <div class="cs-char-info">
              <div class="cs-char-info-name">${escHtml(c.name)}</div>
            </div>
            ${isActive ? `<div class="cs-char-active-dot" title="${escHtml(tr('Aktiver Charakter'))}"></div>` : ''}
          </div>`;
      }
    }

    // Betreiber: Allianzen ohne eigenen Char nur ansehen (aendern kann er dort nur die Feature-Schalter)
    if (viewerAlliances.length) {
      html += `<div class="cs-section-label cs-section-label-spaced">${escHtml(tr('Ansehen (Betreiber)'))}</div>`;
      for (const a of viewerAlliances) {
        html += `
          <div class="cs-char-item${a.is_active ? ' active' : ''}" data-player="" data-alliance="${escHtml(a.alliance)}" data-name="${escHtml(a.alliance)}" data-viewer="1">
            <span class="cs-char-rank cs-char-rank-viewer">👁</span>
            <div class="cs-char-info">
              <div class="cs-char-info-name">${escHtml(a.alliance)}</div>
              ${a.title ? `<div class="cs-char-info-alliance">${escHtml(a.title)}</div>` : ''}
            </div>
            ${a.is_active ? `<div class="cs-char-active-dot" title="${escHtml(tr('Aktiver Charakter'))}"></div>` : ''}
          </div>`;
      }
    }

    // Find current char (active one)
    const activeChar = chars.find(c => c.is_active) || chars[0];
    syncTriggerCharName(activeChar, null);

    // Rename option (only for current alliance char)
    const myCurrentChar = chars.find(c => c.is_active && c.alliance === currentAllianceShort)
                       || chars.find(c => c.alliance === currentAllianceShort);

    html += `<div class="cs-divider"></div>`;
    if (myCurrentChar) {
      html += `<button class="cs-menu-item" id="cs-rename-btn">✎ ${escHtml(tr('Charakter umbenennen'))} (${escHtml(myCurrentChar.name)})</button>
               <div class="cs-rename-form" id="cs-rename-form">
                 <input type="text" id="cs-rename-input" placeholder="${escHtml(myCurrentChar.name)}" maxlength="150">
                 <div class="cs-rename-row">
                   <button class="cs-btn-confirm" id="cs-rename-confirm">${escHtml(tr('Speichern'))}</button>
                   <button class="cs-btn-cancel" id="cs-rename-cancel">${escHtml(tr('Abbrechen'))}</button>
                 </div>
               </div>`;
    }
    // Kein eigener Admin-Punkt mehr: Admin ist ein Reiter (⚙ Admin) und steht bei eingeklappter
    // Leiste ohnehin unten in diesem Menue (rebuildNavSection).
    html += `<button class="cs-menu-item" id="cs-logout-btn">⏻ ${escHtml(tr('Logout'))}</button>`;

    // Nav actions section is rebuilt dynamically on dropdown open – see rebuildNavSection()

    list.innerHTML = html;

    // Char click handlers
    list.querySelectorAll('.cs-char-item').forEach(item => {
      item.addEventListener('click', async () => {
        const playerId = item.dataset.player;
        const alliance = item.dataset.alliance;
        const name     = item.dataset.name;
        if (item.classList.contains('active')) return;
        try {
          await apiPost('/my-chars/active', { discord_id: discordId, alliance, player_id: playerId });
          if (item.dataset.viewer) {
            // Zuschauer-Modus: Rolle und Rechte liefert verify-discord nach dem Neuladen
            const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
            Object.assign(auth, { alliance, active_alliance: alliance, active_player_id: null, member_name: null,
              rank: 5, role: 'site_viewer', site_viewer: true, can_manage: true, can_write: false, read_only: true, honor_role: null });
            localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
            localStorage.setItem(ACTIVE_CHAR_KEY, JSON.stringify({ alliance, player_id: '', name: null }));
            window.location.reload();
            return;
          }
          // Save to local storage – include rank/role so page re-reads correct permissions
          const charData = chars.find(c => c.player_id === playerId && c.alliance === alliance);
          const newRank = charData ? charData.rank : null;
          const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
          auth.member_name = name;
          auth.alliance = alliance;
          auth.active_alliance = alliance;
          auth.active_player_id = playerId;
          if (charData?.preferred_language) {
            auth.preferred_language = String(charData.preferred_language || 'de').toLowerCase();
          }
          if (newRank !== null) {
            auth.rank       = newRank;
            auth.role       = charData?.role || (newRank >= 5 ? 'r5' : newRank >= 4 ? 'r4' : 'normal');
            auth.can_manage = charData?.can_manage ?? newRank >= 4;
          }
          // Rolle gilt je Allianz: in der Gast-Allianz Ehren-R4 (nur lesen), daheim der echte Rang
          auth.honor_role  = charData?.honor_role || null;
          auth.can_write   = charData ? charData.can_write !== false : true;
          auth.read_only   = !auth.can_write;
          auth.site_viewer = false;
          localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
          if (typeof window.setAppLanguage === 'function' && auth.preferred_language) {
            await window.setAppLanguage(auth.preferred_language, { persistLocal: true, persistServer: false });
          }
          localStorage.setItem(ACTIVE_CHAR_KEY, JSON.stringify({ alliance, player_id: playerId, name }));
          // Update display
          const charNameEl = document.getElementById('cs-char-name');
          if (charNameEl) charNameEl.textContent = name;
          // Navigate to the alliance's view if different
          if (alliance !== currentAllianceShort) {
            // Build URL for other alliance (can't simply navigate without knowing URL structure)
            // Just refresh
          }
          // Mark active
          list.querySelectorAll('.cs-char-item').forEach(i => {
            i.classList.remove('active');
            const dot = i.querySelector('.cs-char-active-dot');
            if (dot) dot.remove();
          });
          item.classList.add('active');
          const dot = document.createElement('div');
          dot.className = 'cs-char-active-dot';
          dot.title = tr('Aktiver Charakter');
          item.appendChild(dot);
          // Reload page to reflect new char
          window.location.reload();
        } catch (e) {
          alert(tr('Fehler beim Wechseln: ') + e.message);
        }
      });
    });

    // Rename
    const renameBtn = document.getElementById('cs-rename-btn');
    const renameForm = document.getElementById('cs-rename-form');
    const renameInput = document.getElementById('cs-rename-input');
    const renameConfirm = document.getElementById('cs-rename-confirm');
    const renameCancel = document.getElementById('cs-rename-cancel');

    if (renameBtn && myCurrentChar) {
      renameBtn.addEventListener('click', () => {
        renameForm.classList.toggle('show');
        if (renameForm.classList.contains('show')) {
          renameInput.value = myCurrentChar.name;
          renameInput.focus();
        }
      });

      renameConfirm?.addEventListener('click', async () => {
        const newName = renameInput.value.trim();
        if (!newName || newName === myCurrentChar.name) { renameForm.classList.remove('show'); return; }
        try {
          await apiPost(`/members/${encodeURIComponent(myCurrentChar.name)}/self-rename`, {
            discord_id: discordId,
            new_name: newName,
          });
          // Update auth
          const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
          if (auth.member_name === myCurrentChar.name) { auth.member_name = newName; localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }
          const activeChar = JSON.parse(localStorage.getItem(ACTIVE_CHAR_KEY) || 'null');
          if (activeChar && activeChar.name === myCurrentChar.name) { activeChar.name = newName; localStorage.setItem(ACTIVE_CHAR_KEY, JSON.stringify(activeChar)); }
          renameForm.classList.remove('show');
          dropdown.classList.remove('open');
          document.getElementById('cs-trigger')?.classList.remove('open');
          window.location.reload();
        } catch (e) {
          alert(tr('Fehler: ') + e.message);
        }
      });

      renameCancel?.addEventListener('click', () => renameForm.classList.remove('show'));
    }

    // Logout
    document.getElementById('cs-logout-btn')?.addEventListener('click', () => {
      if (typeof window.discordLogout === 'function') {
        window.discordLogout();
      } else {
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem(ACTIVE_CHAR_KEY);
        window.location.reload();
      }
    });

    // Mobile nav actions – now handled by rebuildNavSection() on open
  }

  function refreshCharSwitcherI18n() {
    const charsLabel = document.getElementById('cs-chars-label');
    if (charsLabel) charsLabel.textContent = tr('Charaktere');
    if (csCachedChars.length) {
      renderChars(csCachedChars, csCachedDiscordId, csCachedAlliance);
    }
  }

  // ── Update alliance title in page ─────────────────────────────────────────────
  function updateAllianceDisplay(shortName, title) {
    const allianceEl = document.getElementById('cs-alliance-name');
    if (allianceEl) {
      allianceEl.textContent = title ? `${shortName} – ${title}` : shortName;
      allianceEl.title = title || shortName;
    }

    // Update page <title>
    document.title = 'Alli App';

    // Update any element with class js-alliance-short / js-alliance-title
    document.querySelectorAll('.js-alliance-short').forEach(el => { el.textContent = shortName; });
    document.querySelectorAll('.js-alliance-title').forEach(el => { el.textContent = title || shortName; });

    // Update visible .logo/.title text nodes that contain "INY"
    document.querySelectorAll('.logo, .nav-logo, [data-alliance-name]').forEach(el => {
      if (el.dataset.allianceName !== undefined) {
        el.textContent = shortName;
      }
    });
  }

  // ── Public init ───────────────────────────────────────────────────────────────
  window.initCharSwitcher = async function (discordUser, authMember) {
    const widget = buildWidget(discordUser, authMember);
    injectIntoTopbar(widget);

    const discordId = discordUser?.id || '';
    // Prefer the verified/server-side alliance before falling back to local client state.
    let currentActiveAlliance = authMember?.active_alliance || authMember?.alliance || null;
    try {
      const ac = JSON.parse(localStorage.getItem(ACTIVE_CHAR_KEY) || 'null');
      if (!currentActiveAlliance) currentActiveAlliance = ac?.alliance || null;
    } catch (_) {}
    window.getActiveAlliance = () => currentActiveAlliance;

    // Fetch alliance info
    try {
      const healthPath = currentActiveAlliance
        ? `/health?alliance=${encodeURIComponent(currentActiveAlliance)}`
        : '/health';
      const health = await apiGet(healthPath);
      const short  = health.alliance || currentActiveAlliance || 'INY';
      const title  = health.alliance_title || null;
      currentActiveAlliance = short;
      window.getActiveAlliance = () => currentActiveAlliance;
      updateAllianceDisplay(short, title);

      // Fetch chars
      if (discordId) {
        const charsData = await apiGet(`/my-chars?discord_id=${encodeURIComponent(discordId)}`);
        const chars = charsData.chars || [];
        let effectiveActiveChar = chars.find(c => c.is_active) || null;

        // If no active char set, set to authMember's
        // Betreiber im Zuschauer-Modus (aktiver Eintrag ohne player_id): keinen eigenen Char automatisch aktivieren
        const viewerActive = !!(charsData.active && charsData.active.player_id === '');
        if (viewerActive) {
          currentActiveAlliance = charsData.active.alliance;
          window.getActiveAlliance = () => currentActiveAlliance;
        }
        const hasActive = viewerActive || chars.some(c => c.is_active);
        if (!hasActive && authMember?.member_id && chars.length) {
          const mine = chars.find(c => c.name === authMember.member_name && c.alliance === short);
          if (mine) {
            try {
              await apiPost('/my-chars/active', { discord_id: discordId, alliance: mine.alliance, player_id: mine.player_id });
              mine.is_active = true;
              localStorage.setItem(ACTIVE_CHAR_KEY, JSON.stringify({ alliance: mine.alliance, player_id: mine.player_id, name: mine.name }));
              currentActiveAlliance = mine.alliance;
              window.getActiveAlliance = () => currentActiveAlliance;
              effectiveActiveChar = mine;
            } catch (e) { /* ignore */ }
          }
        } else if (!hasActive && chars.length) {
          // Persist first char as active context so future verify calls are deterministic.
          const first = chars[0];
          try {
            await apiPost('/my-chars/active', { discord_id: discordId, alliance: first.alliance, player_id: first.player_id });
            first.is_active = true;
          } catch (e) { /* ignore */ }
          localStorage.setItem(ACTIVE_CHAR_KEY, JSON.stringify({ alliance: first.alliance, player_id: first.player_id, name: first.name }));
          currentActiveAlliance = first.alliance;
          window.getActiveAlliance = () => currentActiveAlliance;
          effectiveActiveChar = first;
        } else {
          const activeChar = chars.find(c => c.is_active);
          if (activeChar) {
            currentActiveAlliance = activeChar.alliance;
            window.getActiveAlliance = () => currentActiveAlliance;
            localStorage.setItem(ACTIVE_CHAR_KEY, JSON.stringify({
              alliance: activeChar.alliance,
              player_id: activeChar.player_id,
              name: activeChar.name,
            }));
            effectiveActiveChar = activeChar;
          }
        }

        if (effectiveActiveChar) {
          const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
          if (auth && typeof auth === 'object') {
            auth.member_name = effectiveActiveChar.name;
            auth.alliance = effectiveActiveChar.alliance;
            auth.active_alliance = effectiveActiveChar.alliance;
            auth.active_player_id = effectiveActiveChar.player_id;
            if (effectiveActiveChar.preferred_language) {
              auth.preferred_language = String(effectiveActiveChar.preferred_language || 'de').toLowerCase();
            }
            auth.rank = effectiveActiveChar.rank;
            auth.role = effectiveActiveChar.role || (effectiveActiveChar.rank >= 5 ? 'r5' : effectiveActiveChar.rank >= 4 ? 'r4' : 'normal');
            auth.can_manage = effectiveActiveChar.can_manage ?? (effectiveActiveChar.rank >= 4);
            auth.honor_role = effectiveActiveChar.honor_role || null;
            auth.can_write = effectiveActiveChar.can_write !== false;
            auth.read_only = !auth.can_write;
            auth.site_viewer = false;
            localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
          }
          syncTriggerCharName(effectiveActiveChar, authMember?.member_name || discordUser?.username || null);
        }

        renderChars(chars, discordId, currentActiveAlliance || short, charsData.viewer_alliances || []);
      }
    } catch (e) {
      console.warn('[char-switcher] Init error:', e);
    }
  };

  window.refreshCharSwitcherI18n = refreshCharSwitcherI18n;

  // Fuer Links einer anderen Allianz (lwCheckLinkAlliance in assets/js/core/router.js): eigene Charaktere
  // abfragen und wie per Klick wechseln (laedt die Seite neu). false, wenn es den Charakter nicht gibt.
  window.csGetChars = () => csCachedChars.slice();
  window.csSwitchTo = (alliance, playerId) => {
    const item = [...document.querySelectorAll('#cs-chars-list .cs-char-item')]
      .find((i) => i.dataset.alliance === alliance && i.dataset.player === playerId);
    if (!item || item.classList.contains('active')) return false;
    item.click();
    return true;
  };

  document.addEventListener('i18n:language-changed', () => {
    refreshCharSwitcherI18n();
  });

}());
