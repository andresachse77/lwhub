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

  function getApiBase() {
    if (typeof window.getApiBase === 'function') return window.getApiBase();
    const override = (localStorage.getItem('iny_api_base') || '').replace(/\/$/, '');
    if (override) return override;
    const p = window.location.pathname;
    const base = p.endsWith('/') ? p : p.replace(/[^/]*$/, '');
    return `${window.location.origin}${base}api`;
  }

  async function apiGet(path) {
    const res = await fetch(getApiBase() + path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(getApiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  function rankLabel(r) {
    return { 1:'R1', 2:'R2', 3:'R3', 4:'R4', 5:'R5' }[+r] || 'R?';
  }

  function rankColor(r) {
    return { 1:'#f0a500', 2:'#2ecb7a', 3:'#4a9eff', 4:'#e05545', 5:'#9b6dff' }[+r] || '#7a8498';
  }

  function getSiblingUrl(fileName) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash   = '';
    if (url.pathname.endsWith('/')) url.pathname += fileName;
    else url.pathname = url.pathname.replace(/[^/]*$/, fileName);
    return url.toString();
  }

  // ── CSS ──────────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('cs-styles')) return;
    const style = document.createElement('style');
    style.id = 'cs-styles';
    style.textContent = `
      #cs-wrap {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }
      #cs-alliance-name {
        font-family: 'Rajdhani', sans-serif;
        font-size: 13px;
        letter-spacing: 1px;
        color: var(--gold, #f0a500);
        white-space: nowrap;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: default;
      }
      #cs-trigger {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px;
        padding: 5px 10px 5px 5px;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
        flex-shrink: 0;
      }
      #cs-trigger:hover { border-color: var(--gold, #f0a500); background: rgba(240,165,0,0.07); }
      #cs-avatar {
        width: 28px; height: 28px;
        border-radius: 50%;
        border: 1px solid rgba(255,255,255,0.15);
        object-fit: cover;
        background: rgba(255,255,255,0.07);
        flex-shrink: 0;
      }
      .cs-avatar-placeholder {
        width: 28px; height: 28px;
        border-radius: 50%;
        background: linear-gradient(135deg, rgba(240,165,0,0.3), rgba(74,158,255,0.3));
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 700; color: #fff;
        flex-shrink: 0;
        border: 1px solid rgba(255,255,255,0.1);
      }
      #cs-char-name {
        font-size: 12px;
        font-weight: 600;
        color: #dde1ec;
        max-width: 100px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 600px) { #cs-char-name { max-width: 72px; } }
      #cs-caret {
        font-size: 10px;
        color: #7a8498;
        transition: transform 0.15s;
      }
      #cs-trigger.open #cs-caret { transform: rotate(180deg); }
      #cs-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        min-width: 240px;
        background: rgba(13,18,30,0.97);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 12px;
        padding: 8px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.4);
        z-index: 9999;
        display: none;
      }
      #cs-dropdown.open { display: block; }
      .cs-section-label {
        font-size: 10px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: #3e4558;
        padding: 4px 8px 6px;
      }
      .cs-char-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.12s;
      }
      .cs-char-item:hover { background: rgba(255,255,255,0.06); }
      .cs-char-item.active { background: rgba(240,165,0,0.1); border: 1px solid rgba(240,165,0,0.2); }
      .cs-char-rank {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 999px;
        flex-shrink: 0;
      }
      .cs-char-info { flex: 1; min-width: 0; }
      .cs-char-info-name { font-size: 13px; font-weight: 600; color: #dde1ec; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cs-char-info-alliance { font-size: 11px; color: #7a8498; }
      .cs-char-active-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #f0a500; flex-shrink: 0;
      }
      .cs-divider { height: 1px; background: rgba(255,255,255,0.07); margin: 6px 0; }
      .cs-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        color: #7a8498;
        transition: all 0.12s;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
      }
      .cs-menu-item:hover { background: rgba(255,255,255,0.05); color: #dde1ec; }
      .cs-rename-form {
        padding: 8px;
        border-top: 1px solid rgba(255,255,255,0.07);
        margin-top: 4px;
        display: none;
      }
      .cs-rename-form.show { display: block; }
      .cs-rename-form input {
        width: 100%;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 7px;
        color: #dde1ec;
        font-size: 12px;
        padding: 7px 9px;
        outline: none;
        font-family: inherit;
        margin-bottom: 6px;
      }
      .cs-rename-form input:focus { border-color: #f0a500; }
      .cs-rename-row { display: flex; gap: 6px; }
      .cs-rename-row button {
        flex: 1; padding: 6px 8px; border-radius: 7px; border: none;
        font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
      }
      .cs-btn-confirm { background: rgba(240,165,0,0.2); color: #ffd060; border: 1px solid rgba(240,165,0,0.3) !important; }
      .cs-btn-confirm:hover { background: rgba(240,165,0,0.35); }
      .cs-btn-cancel { background: rgba(255,255,255,0.05); color: #7a8498; border: 1px solid rgba(255,255,255,0.1) !important; }
      .cs-btn-cancel:hover { background: rgba(255,255,255,0.1); color: #dde1ec; }
      .cs-mobile-only { display: none !important; }
      body.nav-compact .cs-mobile-only { display: flex !important; }
    `;
    document.head.appendChild(style);
  }

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
    dropdown.innerHTML = `<div class="cs-section-label">Charaktere</div><div id="cs-chars-list"></div>`;
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
      const list = document.getElementById('cs-chars-list');
      if (!list) return;
      // Remove existing nav section (divider + nav items)
      list.querySelectorAll('.cs-nav-divider, .cs-nav-item').forEach(el => el.remove());
      const navActions = window.csNavActions || [];
      const isMobile = window.innerWidth <= 720;
      const isCompact = document.body.classList.contains('nav-compact');
      const hiddenActions = navActions.filter(a =>
        isMobile || !a.btnRef || a.btnRef.style.display === 'none'
      );
      if (isCompact && hiddenActions.length) {
        const divider = document.createElement('div');
        divider.className = 'cs-divider cs-mobile-only cs-nav-divider';
        list.appendChild(divider);
        hiddenActions.forEach((a) => {
          const origIdx = navActions.indexOf(a);
          const btn = document.createElement('button');
          btn.className = 'cs-menu-item cs-mobile-only cs-nav-item';
          btn.dataset.navAction = origIdx;
          btn.textContent = a.label;
          btn.addEventListener('click', () => {
            dropdown.classList.remove('open');
            trigger.classList.remove('open');
            if (a.fn) a.fn();
          });
          list.appendChild(btn);
        });
        const syncEl = document.getElementById('btn-sync');
        if (syncEl) {
          const syncBtn = document.createElement('button');
          syncBtn.className = 'cs-menu-item cs-mobile-only cs-nav-item';
          syncBtn.id = 'cs-sync-btn';
          syncBtn.textContent = '🔄 Daten aktualisieren';
          syncBtn.addEventListener('click', () => {
            dropdown.classList.remove('open');
            trigger.classList.remove('open');
            syncEl.click();
          });
          list.appendChild(syncBtn);
        }
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

  // ── Render chars ──────────────────────────────────────────────────────────────
  function renderChars(chars, discordId, currentAllianceShort) {
    const list = document.getElementById('cs-chars-list');
    if (!list) return;

    const dropdown = document.getElementById('cs-dropdown');

    if (!chars || !chars.length) {
      list.innerHTML = '<div style="font-size:12px;color:#7a8498;padding:6px 10px">Keine Charaktere gefunden</div>';
      return;
    }

    // Group by alliance
    const byAlliance = {};
    for (const c of chars) {
      if (!byAlliance[c.alliance]) byAlliance[c.alliance] = [];
      byAlliance[c.alliance].push(c);
    }

    let html = '';
    for (const [ally, cs] of Object.entries(byAlliance)) {
      if (Object.keys(byAlliance).length > 1) {
        html += `<div class="cs-section-label" style="margin-top:4px">${escHtml(ally)}</div>`;
      }
      for (const c of cs) {
        const isActive = c.is_active;
        const rColor = rankColor(c.rank);
        html += `
          <div class="cs-char-item${isActive ? ' active' : ''}"
               data-player="${escHtml(c.player_id)}" data-alliance="${escHtml(c.alliance)}" data-name="${escHtml(c.name)}">
            <span class="cs-char-rank" style="background:${rColor}22;color:${rColor};border:1px solid ${rColor}44">${escHtml(rankLabel(c.rank))}</span>
            <div class="cs-char-info">
              <div class="cs-char-info-name">${escHtml(c.name)}</div>
            </div>
            ${isActive ? '<div class="cs-char-active-dot" title="Aktiver Charakter"></div>' : ''}
          </div>`;
      }
    }

    // Find current char (active one)
    const activeChar = chars.find(c => c.is_active) || chars[0];

    // Rename option (only for current alliance char)
    const myCurrentChar = chars.find(c => c.is_active && c.alliance === currentAllianceShort)
                       || chars.find(c => c.alliance === currentAllianceShort);

    html += `<div class="cs-divider"></div>`;
    if (myCurrentChar) {
      html += `<button class="cs-menu-item" id="cs-rename-btn">✎ Charakter umbenennen (${escHtml(myCurrentChar.name)})</button>
               <div class="cs-rename-form" id="cs-rename-form">
                 <input type="text" id="cs-rename-input" placeholder="${escHtml(myCurrentChar.name)}" maxlength="150">
                 <div class="cs-rename-row">
                   <button class="cs-btn-confirm" id="cs-rename-confirm">Speichern</button>
                   <button class="cs-btn-cancel" id="cs-rename-cancel">Abbrechen</button>
                 </div>
               </div>`;
    }
    const activeRank = chars.find(c => c.is_active)?.rank ?? myCurrentChar?.rank ?? 0;
    if (activeRank >= 4) {
      html += `<button class="cs-menu-item" id="cs-admin-btn" style="color:#f0a500">⚙ Allianz-Verwaltung</button>`;
    }
    html += `<button class="cs-menu-item" id="cs-logout-btn">⏻ Logout</button>`;

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
          // Save to local storage – include rank/role so page re-reads correct permissions
          const charData = chars.find(c => c.player_id === playerId && c.alliance === alliance);
          const newRank = charData ? charData.rank : null;
          const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
          auth.member_name = name;
          auth.active_alliance = alliance;
          auth.active_player_id = playerId;
          if (newRank !== null) {
            auth.rank       = newRank;
            auth.role       = newRank >= 5 ? 'r5' : newRank >= 4 ? 'r4' : 'normal';
            auth.can_manage = newRank >= 4;
          }
          localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
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
          dot.title = 'Aktiver Charakter';
          item.appendChild(dot);
          // Reload page to reflect new char
          window.location.reload();
        } catch (e) {
          alert('Fehler beim Wechseln: ' + e.message);
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
          alert('Fehler: ' + e.message);
        }
      });

      renameCancel?.addEventListener('click', () => renameForm.classList.remove('show'));
    }

    // Admin button
    document.getElementById('cs-admin-btn')?.addEventListener('click', () => {
      dropdown.classList.remove('open');
      document.getElementById('cs-trigger')?.classList.remove('open');
      if (typeof window.showPage === 'function') {
        window.showPage('a');
      }
    });

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

  // ── Update alliance title in page ─────────────────────────────────────────────
  function updateAllianceDisplay(shortName, title) {
    const allianceEl = document.getElementById('cs-alliance-name');
    if (allianceEl) {
      allianceEl.textContent = title ? `${shortName} – ${title}` : shortName;
      allianceEl.title = title || shortName;
    }

    // Update page <title>
    document.title = shortName + (title ? ` – ${title}` : '') + ' · Tool';

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
    injectStyles();

    const widget = buildWidget(discordUser, authMember);
    injectIntoTopbar(widget);

    const discordId = discordUser?.id || '';
    // Determine active alliance from localStorage
    let currentActiveAlliance = null;
    try {
      const ac = JSON.parse(localStorage.getItem(ACTIVE_CHAR_KEY) || 'null');
      currentActiveAlliance = ac?.alliance || null;
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

        // If no active char set, set to authMember's
        const hasActive = chars.some(c => c.is_active);
        if (!hasActive && authMember?.member_id && chars.length) {
          const mine = chars.find(c => c.name === authMember.member_name && c.alliance === short);
          if (mine) {
            try {
              await apiPost('/my-chars/active', { discord_id: discordId, alliance: mine.alliance, player_id: mine.player_id });
              mine.is_active = true;
              localStorage.setItem(ACTIVE_CHAR_KEY, JSON.stringify({ alliance: mine.alliance, player_id: mine.player_id, name: mine.name }));
              currentActiveAlliance = mine.alliance;
              window.getActiveAlliance = () => currentActiveAlliance;
            } catch (e) { /* ignore */ }
          }
        } else if (!hasActive && chars.length) {
          // Just use first char as active context
          const first = chars[0];
          localStorage.setItem(ACTIVE_CHAR_KEY, JSON.stringify({ alliance: first.alliance, player_id: first.player_id, name: first.name }));
          currentActiveAlliance = first.alliance;
          window.getActiveAlliance = () => currentActiveAlliance;
        } else {
          const activeChar = chars.find(c => c.is_active);
          if (activeChar) {
            currentActiveAlliance = activeChar.alliance;
            window.getActiveAlliance = () => currentActiveAlliance;
          }
        }

        renderChars(chars, discordId, short);
      }
    } catch (e) {
      console.warn('[char-switcher] Init error:', e);
    }
  };

}());
