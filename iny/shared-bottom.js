(function () {
  if (window.__inyBottomWidgetLoaded) return;
  window.__inyBottomWidgetLoaded = true;

  const AUTH_KEY = 'iny_auth_state_v1';

  function getAuth() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function isAuthenticated(auth) {
    if (!auth || typeof auth !== 'object') return false;
    const member = String(auth.member_name || '').trim();
    const discordId = String(auth.discord_id || '').trim();
    return member !== '' || discordId !== '' || auth.local_preview === true;
  }

  function getApiBase() {
    const override = (localStorage.getItem('iny_api_base') || '').replace(/\/$/, '');
    if (override) return override;
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:8080/iny/api';
    const p = window.location.pathname;
    const base = p.endsWith('/') ? p : p.replace(/[^/]*$/, '');
    return `${window.location.origin}${base}api`;
  }

  async function api(path, options) {
    const base = getApiBase();
    const res = await fetch(`${base}${path}`, options || {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function injectStyles() {
    const css = `
      .iny-bottom-wrap {
        position: fixed;
        right: 14px;
        bottom: 14px;
        width: min(360px, calc(100vw - 24px));
        z-index: 9999;
        font-family: Inter, Segoe UI, Arial, sans-serif;
      }
      .iny-bottom-card {
        border: 1px solid rgba(255,255,255,0.15);
        background: rgba(13,18,30,0.94);
        backdrop-filter: blur(8px);
        border-radius: 14px;
        box-shadow: 0 14px 34px rgba(0,0,0,0.35);
        overflow: hidden;
      }
      .iny-bottom-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.09);
      }
      .iny-bottom-head strong {
        color: #edf2ff;
        font-size: 12px;
        letter-spacing: 0.4px;
      }
      .iny-bottom-head .meta {
        color: #9fb0d6;
        font-size: 11px;
      }
      .iny-bottom-toggle {
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.06);
        color: #e7eeff;
        border-radius: 8px;
        cursor: pointer;
        font-size: 11px;
        padding: 4px 8px;
      }
      .iny-bottom-body { padding: 10px 10px 8px; }
      .iny-bottom-body.hidden { display: none; }

      .iny-online-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
        max-height: 62px;
        overflow: auto;
      }
      .iny-online-pill {
        border: 1px solid rgba(46,203,122,0.28);
        background: rgba(46,203,122,0.14);
        color: #9ff0c7;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 11px;
        white-space: nowrap;
      }
      .iny-empty {
        color: #93a0ba;
        font-size: 11px;
        margin-bottom: 8px;
      }

      .iny-chat-box {
        border: 1px solid rgba(255,255,255,0.09);
        border-radius: 10px;
        background: rgba(255,255,255,0.03);
        height: 150px;
        overflow: auto;
        padding: 8px;
      }
      .iny-msg {
        margin-bottom: 8px;
        line-height: 1.35;
      }
      .iny-msg .n {
        color: #7ec0ff;
        font-size: 11px;
        font-weight: 700;
      }
      .iny-msg .t {
        color: #8e9ab2;
        font-size: 10px;
        margin-left: 6px;
      }
      .iny-msg .m {
        color: #e8edfb;
        font-size: 12px;
        margin-top: 2px;
        word-break: break-word;
      }

      .iny-chat-send {
        margin-top: 8px;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px;
      }
      .iny-chat-send input {
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(8,12,20,0.7);
        color: #edf2ff;
        border-radius: 9px;
        font-size: 12px;
        padding: 9px 10px;
        outline: none;
      }
      .iny-chat-send button {
        border: 1px solid rgba(74,158,255,0.35);
        background: rgba(74,158,255,0.18);
        color: #cfe6ff;
        border-radius: 9px;
        font-size: 12px;
        font-weight: 700;
        padding: 0 10px;
        cursor: pointer;
      }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createUi() {
    const wrap = document.createElement('div');
    wrap.className = 'iny-bottom-wrap';
    wrap.innerHTML = `
      <div class="iny-bottom-card">
        <div class="iny-bottom-head">
          <div>
            <strong>Online & Chat</strong>
            <div class="meta" id="iny-meta">lade...</div>
          </div>
          <button class="iny-bottom-toggle" id="iny-toggle">−</button>
        </div>
        <div class="iny-bottom-body" id="iny-body">
          <div class="iny-online-list" id="iny-online"></div>
          <div class="iny-empty" id="iny-empty-online" style="display:none">Gerade niemand online.</div>
          <div class="iny-chat-box" id="iny-chat"></div>
          <div class="iny-chat-send">
            <input id="iny-input" maxlength="500" placeholder="Nachricht schreiben...">
            <button id="iny-send" type="button">Senden</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    return {
      body: wrap.querySelector('#iny-body'),
      online: wrap.querySelector('#iny-online'),
      emptyOnline: wrap.querySelector('#iny-empty-online'),
      chat: wrap.querySelector('#iny-chat'),
      input: wrap.querySelector('#iny-input'),
      send: wrap.querySelector('#iny-send'),
      meta: wrap.querySelector('#iny-meta'),
      toggle: wrap.querySelector('#iny-toggle'),
    };
  }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  function renderOnline(el, items) {
    el.online.innerHTML = '';
    if (!items || !items.length) {
      el.emptyOnline.style.display = 'block';
      return;
    }
    el.emptyOnline.style.display = 'none';
    items.forEach((row) => {
      const pill = document.createElement('span');
      pill.className = 'iny-online-pill';
      pill.textContent = row.member_name || row.discord_username || 'Unbekannt';
      el.online.appendChild(pill);
    });
  }

  function renderChat(el, messages) {
    const atBottom = el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight < 24;
    el.chat.innerHTML = '';
    (messages || []).forEach((msg) => {
      const row = document.createElement('div');
      row.className = 'iny-msg';

      const head = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'n';
      name.textContent = msg.member_name || 'Unbekannt';
      head.appendChild(name);

      const t = document.createElement('span');
      t.className = 't';
      t.textContent = fmtTime(msg.created_at);
      head.appendChild(t);

      const body = document.createElement('div');
      body.className = 'm';
      body.textContent = msg.message || '';

      row.appendChild(head);
      row.appendChild(body);
      el.chat.appendChild(row);
    });
    if (atBottom) el.chat.scrollTop = el.chat.scrollHeight;
  }

  function getSenderName() {
    const a = getAuth();
    return (a && (a.member_name || a.discord_username)) ? (a.member_name || a.discord_username) : '';
  }

  async function refresh(el) {
    const sender = getSenderName();
    try {
      if (sender) {
        const a = getAuth();
        await api('/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            member_name: sender,
            discord_id: a?.discord_id || '',
            discord_username: a?.discord_username || ''
          })
        });
      }

      const [onlineRes, chatRes] = await Promise.all([
        api('/presence'),
        api('/chat?limit=50')
      ]);

      renderOnline(el, onlineRes.online || []);
      renderChat(el, chatRes.messages || []);
      el.meta.textContent = `${(onlineRes.online || []).length} online`;
    } catch (e) {
      el.meta.textContent = 'nicht verbunden';
    }
  }

  async function sendMessage(el) {
    const sender = getSenderName();
    if (!sender) {
      el.meta.textContent = 'Bitte erst einloggen';
      return;
    }
    const text = (el.input.value || '').trim();
    if (!text) return;

    el.send.disabled = true;
    try {
      const res = await api('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_name: sender, message: text })
      });
      renderChat(el, res.messages || []);
      el.input.value = '';
    } catch {
      el.meta.textContent = 'Senden fehlgeschlagen';
    } finally {
      el.send.disabled = false;
      el.input.focus();
    }
  }

  function wire(el) {
    el.toggle.addEventListener('click', function () {
      const hidden = el.body.classList.toggle('hidden');
      el.toggle.textContent = hidden ? '+' : '−';
      localStorage.setItem('iny_bottom_widget_collapsed', hidden ? '1' : '0');
    });

    if (localStorage.getItem('iny_bottom_widget_collapsed') === '1') {
      el.body.classList.add('hidden');
      el.toggle.textContent = '+';
    }

    el.send.addEventListener('click', function () { sendMessage(el); });
    el.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        sendMessage(el);
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh(el);
    });
  }

  function mountWidget() {
    injectStyles();
    const el = createUi();
    wire(el);
    refresh(el);
    setInterval(function () { refresh(el); }, 20000);
  }

  if (isAuthenticated(getAuth())) {
    mountWidget();
    return;
  }

  // Wait for async login flow (Discord verification / local preview seed).
  const waitForAuth = setInterval(function () {
    if (!isAuthenticated(getAuth())) return;
    clearInterval(waitForAuth);
    mountWidget();
  }, 1000);
})();
