// LWHub – Meldungen (toast), Übersetzen (tr), Ladeanimation (Carlie & Kim)
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html). Normales Script, kein Modul:
// alles bleibt global wie vorher. Die Reihenfolge der <script>-Tags in index.html ist die Ladereihenfolge.

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = typeof window.trText === 'function' ? window.trText(msg) : msg;
  t.className = `toast show${type ? ' ' + type : ''}`;
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function tr(msg) {
  return typeof window.trText === 'function' ? window.trText(msg) : msg;
}
// Uebersetzung mit Platzhaltern: trf('KW {kw} …', { kw: 42 })
function trf(de, vars = {}) {
  return Object.entries(vars).reduce((t, [k, v]) => t.split(`{${k}}`).join(String(v)), tr(de));
}

// Dialoge (.modal mit Klasse hidden) auf- und zumachen
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
function openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }

let battleLoaderDepth = 0;
let battleLoaderShowTimer = null;
let battleLoaderShownAt = 0;
let battleLoaderTransitionToken = 0;

function updateBattleLoaderMediaState() {
  const loader = document.getElementById('battle-loader');
  if (!loader) return;
  const imgs = Array.from(loader.querySelectorAll('.battle-loader-media, .battle-loader-portrait-img'));
  if (!imgs.length) {
    loader.classList.add('img-missing');
    return;
  }
  const anyReady = imgs.some((img) => img.complete && img.naturalWidth > 0);
  loader.classList.toggle('img-missing', !anyReady);
}
window.updateBattleLoaderMediaState = updateBattleLoaderMediaState;
document.querySelectorAll('#battle-loader .battle-loader-media').forEach((img) => {
  img.addEventListener('load', updateBattleLoaderMediaState);
  img.addEventListener('error', updateBattleLoaderMediaState);
});
updateBattleLoaderMediaState();

function showBattleLoader() {
  const el = document.getElementById('battle-loader');
  if (!el) return;
  battleLoaderTransitionToken += 1;
  el.classList.remove('ending');
  updateBattleLoaderMediaState();
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
  battleLoaderShownAt = Date.now();
}

async function hideBattleLoader(endFrameMs = 600) {
  const el = document.getElementById('battle-loader');
  if (!el) return;
  const transitionToken = ++battleLoaderTransitionToken;
  const finalImg = el.querySelector('.battle-loader-final-img');
  const finalReady = !!(finalImg && finalImg.complete && finalImg.naturalWidth > 0);
  if (finalReady) {
    el.classList.add('ending');
    await new Promise((resolve) => setTimeout(resolve, endFrameMs));
    if (transitionToken !== battleLoaderTransitionToken) return;
  }
  el.classList.remove('ending');
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  battleLoaderShownAt = 0;
}

// endFrameMs: wie lange das Schlussbild steht (0 = sofort weg). Wurde die Animation gar nicht gezeigt
// (Aufgabe schneller als showDelayMs), wird auch nicht auf das Schlussbild gewartet.
async function runWithBattleLoader(task, minVisibleMs = 1800, showDelayMs = 120, endFrameMs = 600) {
  battleLoaderDepth += 1;
  let loaderShown = false;
  let loaderTimer = null;
  if (battleLoaderDepth === 1) {
    loaderTimer = setTimeout(() => {
      loaderShown = true;
      showBattleLoader();
    }, showDelayMs);
    battleLoaderShowTimer = loaderTimer;
  }
  try {
    return await task();
  } finally {
    if (loaderTimer) {
      clearTimeout(loaderTimer);
      if (battleLoaderShowTimer === loaderTimer) battleLoaderShowTimer = null;
    }
    if (loaderShown && battleLoaderShownAt) {
      const elapsed = Date.now() - battleLoaderShownAt;
      if (elapsed < minVisibleMs) {
        await new Promise((resolve) => setTimeout(resolve, minVisibleMs - elapsed));
      }
    }
    battleLoaderDepth = Math.max(0, battleLoaderDepth - 1);
    if (battleLoaderDepth === 0 && document.getElementById('battle-loader')?.classList.contains('show')) {
      await hideBattleLoader(endFrameMs);
    }
  }
}

// ── Berechnete Styles ohne style-Attribut ──
// Die CSP soll style-src ohne 'unsafe-inline' werden: dann wirkt kein style="…" mehr, weder im HTML noch in
// innerHTML-Vorlagen. Feste Styles gehören als Klasse nach assets/css/app.css. Nur für Werte, die erst im JS
// entstehen (Breite in %, Farbe aus Daten), schreibt die Vorlage data-css="width:42%" (Wert mit escHtml).
// Das hier setzt sie per CSSOM (el.style, von der CSP erlaubt), sobald das Element im DOM ist, und zwar noch
// vor dem nächsten Zeichnen. Danach ist data-css weg, das Element hat nur noch ganz normale el.style-Werte.
function lwApplyDataCss(root) {
  if (!root || root.nodeType !== 1) return;
  const els = root.hasAttribute('data-css') ? [root] : [];
  els.push(...root.querySelectorAll('[data-css]'));
  for (const el of els) {
    const css = el.getAttribute('data-css');
    el.removeAttribute('data-css');
    if (css) el.style.cssText += ';' + css;
  }
}
new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.type === 'attributes') lwApplyDataCss(m.target);
    else m.addedNodes.forEach(lwApplyDataCss);
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-css'] });
lwApplyDataCss(document.body);
