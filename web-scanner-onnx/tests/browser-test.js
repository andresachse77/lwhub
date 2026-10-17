// End-to-end test in a real browser (headless Edge/Chrome via puppeteer-core): loads the cockpit,
// waits for the in-browser OCR to come up, runs local captures through it and prints the recognised
// rows (--verbose), then drives the screenshot upload UI.
//
//   node browser-test.js [--backend=wasm|webgpu] [--frames=10] [--throughput=N] [--workers=N] [--threads=N] [--no-coi] [--headful] [--verbose]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));
const IMAGES = path.resolve(__dirname, '../../web-scanner/images');

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(PORT)], { stdio: 'ignore', env: { ...process.env, ...(args['no-coi'] ? { NO_COI: '1' } : {}) } });
  await new Promise((r) => setTimeout(r, 500));
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: !args.headful,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
  });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (args.verbose) console.log('  [page]', m.text()); });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    if (args.backend) {
      await page.evaluateOnNewDocument((b) => localStorage.setItem('lwhub.scanner.ocrBackend', b), args.backend);
    }

    // Access gate: without a lwhub login the page must stay locked.
    await page.goto(`${BASE}/web-scanner-onnx/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('accessGateTitle').textContent !== 'Zugang wird geprüft…', { timeout: 30000 });
    const gate = await page.evaluate(() => ({
      visible: !document.getElementById('accessGate').hidden,
      title: document.getElementById('accessGateTitle').textContent,
      login: !document.getElementById('accessGateLogin').hidden,
      sync: document.getElementById('btnSyncToLwHub').disabled,
    }));
    console.log(`gate without login: visible=${gate.visible}, "${gate.title}", login link=${gate.login}, sync disabled=${gate.sync}`);
    if (!gate.visible || !gate.sync) process.exitCode = 1;

    // For the OCR tests: a fake login, and the server's R4 check answered with "ok" (the real check
    // needs a Discord token and runs in api/src/caller-auth.php).
    // (A page-level fetch wrapper, not request interception: interception also stalls the OCR worker's downloads.)
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('discord_token', 'test-token');
      const realFetch = window.fetch.bind(window);
      window.fetch = (url, opts) => (String(url).includes('/scans/access')
        ? Promise.resolve(new Response(JSON.stringify({ ok: true, name: 'Test', rank: 4, site_admin: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        : realFetch(url, opts));
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/web-scanner-onnx/?${args.threads ? 'threads=' + args.threads + '&' : ''}${args.workers ? 'workers=' + args.workers : ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /OCR bereit|OCR-Fehler/.test(document.getElementById('ocrStatusBadge').textContent), { timeout: 180000 });
    const badge = await page.$eval('#ocrStatusBadge', (e) => e.textContent);
    const isolated = await page.evaluate(() => self.crossOriginIsolated);
    console.log(`engine: "${badge}" after ${((Date.now() - t0) / 1000).toFixed(1)} s, crossOriginIsolated=${isolated}`);
    if (!/OCR bereit/.test(badge)) {
      console.log(await page.$eval('#logBox', (e) => e.innerText));
      process.exitCode = 1;
      return;
    }

    // 0) Throughput: N screenshots through the upload UI (uses the whole worker pool), wall-clock time
    if (args.throughput) {
      const all = fs.readdirSync(path.resolve(__dirname, '../../web-scanner/images')).filter((f) => f.endsWith('.png')).sort();
      const n = Math.min(Number(args.throughput), all.length);
      const input = await page.$('#screenshotInput');
      const t1 = Date.now();
      await input.uploadFile(...all.slice(0, n).map((f) => path.resolve(__dirname, '../../web-scanner/images', f)));
      await page.waitForFunction((k) => document.getElementById('processingProgressText').textContent.includes(`${k}/${k} Bilder verarbeitet`), { timeout: 600000 }, n);
      const s = (Date.now() - t1) / 1000;
      console.log(`throughput: ${n} frames in ${s.toFixed(1)} s = ${(s / n).toFixed(2)} s/frame, ${await page.$eval('#statPoolCount', (e) => e.textContent)}`);
      return;
    }

    // 1) OCR on local captures
    const names = fs.existsSync(IMAGES) ? fs.readdirSync(IMAGES).filter((f) => f.endsWith('.png')).sort() : [];
    const step = Math.max(1, Math.floor(names.length / (Number(args.frames) || 10)));
    const picked = names.filter((_, i) => i % step === 0).slice(0, Number(args.frames) || 10);
    let rows = 0, frameMs = 0;
    for (const name of picked) {
      const res = await page.evaluate(async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        return ocr.process(img);
      }, `${BASE}/web-scanner/images/${name}`);
      const got = res.mode === 'ranking' ? res.rankings : res.cards;
      rows += got.length;
      frameMs += res.elapsed_ms;
      console.log(`${name}: ${(res.elapsed_ms / 1000).toFixed(2)} s, ${res.mode}, ${got.length} rows`);
      if (args.verbose) got.forEach((r) => console.log(`    ${r.rank_position ?? ''} ${r.name} | ${r.power} | ${r.rank_code ?? ''} ${r.level ?? ''} | ${r.status ?? ''}`));
    }
    if (picked.length) {
      console.log(`ocr: ${rows} rows in ${picked.length} frames, avg ${(frameMs / picked.length / 1000).toFixed(2)} s/frame`);
    }

    // 2) UI path: screenshot upload -> cards in the pool
    if (picked.length) {
      const input = await page.$('#screenshotInput');
      await input.uploadFile(...picked.slice(0, 2).map((n) => path.join(IMAGES, n)));
      await page.waitForFunction(() => /2\/2 Bilder verarbeitet/.test(document.getElementById('processingProgressText').textContent), { timeout: 120000 });
      const pool = await page.$eval('#statPoolCount', (e) => e.textContent);
      console.log(`upload UI: ${pool}`);
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
