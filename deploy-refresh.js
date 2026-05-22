(function () {
  'use strict';

  if (window.location.protocol === 'file:') return;

  const VERSION_URL = 'deploy-version.json';
  const STORAGE_KEY = 'lwhub_deploy_version_seen_v1';
  const DISABLE_KEY = 'lwhub_disable_auto_reload';
  const PARAM_KEY = '__deploy';
  const START_DELAY_MS = 15000;
  const POLL_MS = 60000;
  const RELOAD_DELAY_MS = 8000;

  let reloadTimerId = null;
  let countdownTimerId = null;
  let pendingVersion = '';

  function clearReloadTimers() {
    if (reloadTimerId) {
      clearTimeout(reloadTimerId);
      reloadTimerId = null;
    }
    if (countdownTimerId) {
      clearInterval(countdownTimerId);
      countdownTimerId = null;
    }
  }

  function ensureBanner() {
    let box = document.getElementById('deploy-update-banner');
    if (box) return box;

    const style = document.createElement('style');
    style.id = 'deploy-update-banner-style';
    style.textContent = [
      '#deploy-update-banner{position:fixed;right:14px;bottom:14px;z-index:2147483000;max-width:360px;',
      'background:#131a29;border:1px solid rgba(74,158,255,.4);box-shadow:0 8px 24px rgba(0,0,0,.35);',
      'border-radius:10px;padding:12px 12px 10px;color:#dfe8ff;font:500 13px/1.35 Inter,Segoe UI,Arial,sans-serif;}',
      '#deploy-update-banner strong{display:block;color:#9dc3ff;font-weight:700;margin-bottom:4px;}',
      '#deploy-update-banner .deploy-update-row{display:flex;gap:8px;align-items:center;margin-top:10px;}',
      '#deploy-update-banner .deploy-update-btn{border:1px solid rgba(74,158,255,.55);background:rgba(74,158,255,.16);',
      'color:#dfe8ff;border-radius:8px;padding:6px 10px;cursor:pointer;font:600 12px/1 Inter,Segoe UI,Arial,sans-serif;}',
      '#deploy-update-banner .deploy-update-btn:hover{background:rgba(74,158,255,.28);}',
      '#deploy-update-banner .deploy-update-note{font-size:11px;color:#9faecf;}'
    ].join('');
    document.head.appendChild(style);

    box = document.createElement('div');
    box.id = 'deploy-update-banner';
    box.innerHTML = [
      '<strong>Neue Version verfuegbar</strong>',
      '<div id="deploy-update-text">Die Seite wird gleich aktualisiert.</div>',
      '<div class="deploy-update-row">',
      '  <button id="deploy-update-now" class="deploy-update-btn" type="button">Jetzt neu laden</button>',
      '  <span id="deploy-update-countdown" class="deploy-update-note"></span>',
      '</div>'
    ].join('');

    document.body.appendChild(box);
    return box;
  }

  function showReloadNotice(version) {
    pendingVersion = version;
    clearReloadTimers();

    const box = ensureBanner();
    const textEl = document.getElementById('deploy-update-text');
    const countdownEl = document.getElementById('deploy-update-countdown');
    const button = document.getElementById('deploy-update-now');

    let remainingSeconds = Math.ceil(RELOAD_DELAY_MS / 1000);
    if (textEl) textEl.textContent = 'Ein Update wurde bereitgestellt. Offene Aenderungen koennen verloren gehen.';
    if (countdownEl) countdownEl.textContent = 'Neuladen in ' + remainingSeconds + 's';

    if (button) {
      button.onclick = function () {
        reloadWithVersion(version);
      };
    }

    countdownTimerId = setInterval(function () {
      remainingSeconds -= 1;
      if (!countdownEl) return;
      if (remainingSeconds > 0) {
        countdownEl.textContent = 'Neuladen in ' + remainingSeconds + 's';
      } else {
        countdownEl.textContent = '';
      }
    }, 1000);

    reloadTimerId = setTimeout(function () {
      reloadWithVersion(version);
    }, RELOAD_DELAY_MS);

    return box;
  }

  function normalizeVersion(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const raw = payload.version || payload.git_sha || payload.sha || '';
    return String(raw).trim();
  }

  async function fetchVersion() {
    const url = new URL(VERSION_URL, window.location.href);
    url.searchParams.set('_ts', String(Date.now()));

    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    return normalizeVersion(await response.json());
  }

  function reloadWithVersion(version) {
    clearReloadTimers();
    try {
      localStorage.setItem(STORAGE_KEY, version);
    } catch (_) {}

    const next = new URL(window.location.href);
    next.searchParams.set(PARAM_KEY, version.slice(0, 12));
    window.location.replace(next.toString());
  }

  async function checkForDeploy() {
    if (localStorage.getItem(DISABLE_KEY) === '1') return;

    const version = await fetchVersion();
    if (!version) return;

    const current = localStorage.getItem(STORAGE_KEY) || '';
    if (!current) {
      localStorage.setItem(STORAGE_KEY, version);
      return;
    }

    if (current !== version) {
      if (pendingVersion === version) return;
      showReloadNotice(version);
    }
  }

  setTimeout(function () {
    checkForDeploy().catch(function () {});
    setInterval(function () {
      checkForDeploy().catch(function () {});
    }, POLL_MS);
  }, START_DELAY_MS);
})();
