// End-to-end test in a real browser (headless Edge/Chrome via puppeteer-core): loads the cockpit,
// waits for the in-browser OCR to come up, runs local captures through it and compares the rows with
// the Python reference (reference/*.json from dump_reference.py), then drives the screenshot upload UI.
//
//   node browser-test.js [--backend=webgpu] [--frames=10] [--no-coi] [--headful]
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
const REF = path.join(__dirname, 'reference');
const FIELDS = ['name', 'power', 'rank_code', 'level', 'status', 'rank_position'];

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
    const t0 = Date.now();
    await page.goto(`${BASE}/web-scanner-onnx/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /OCR bereit|OCR-Fehler/.test(document.getElementById('ocrStatusBadge').textContent), { timeout: 180000 });
    const badge = await page.$eval('#ocrStatusBadge', (e) => e.textContent);
    const isolated = await page.evaluate(() => self.crossOriginIsolated);
    console.log(`engine: "${badge}" after ${((Date.now() - t0) / 1000).toFixed(1)} s, crossOriginIsolated=${isolated}`);
    if (!/OCR bereit/.test(badge)) {
      console.log(await page.$eval('#logBox', (e) => e.innerText));
      process.exitCode = 1;
      return;
    }

    // 1) Result parity on local captures
    const names = fs.existsSync(REF) ? fs.readdirSync(REF).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
    const step = Math.max(1, Math.floor(names.length / (Number(args.frames) || 10)));
    const picked = names.filter((_, i) => i % step === 0).slice(0, Number(args.frames) || 10);
    let rows = 0, same = 0, frameMs = 0;
    for (const name of picked) {
      const ref = JSON.parse(fs.readFileSync(path.join(REF, name + '.json'), 'utf8'));
      const res = await page.evaluate(async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        return ocr.process(img);
      }, `${BASE}/web-scanner/images/${name}`);
      const got = res.mode === 'ranking' ? res.rankings : res.cards;
      const diffs = [];
      if (res.mode !== ref.mode) diffs.push(`mode ${ref.mode}->${res.mode}`);
      if (got.length !== ref.rows.length) diffs.push(`rows ${ref.rows.length}->${got.length}`);
      ref.rows.forEach((r, i) => {
        rows++;
        const d = FIELDS.filter((f) => (r[f] ?? null) !== (got[i]?.[f] ?? null));
        if (d.length) diffs.push(`row ${i}: ` + d.map((f) => `${f} ${JSON.stringify(r[f])}->${JSON.stringify(got[i]?.[f])}`).join(', '));
        else same++;
      });
      frameMs += res.elapsed_ms;
      console.log(`${name}: ${(res.elapsed_ms / 1000).toFixed(2)} s, ${res.mode}, ${got.length} rows${diffs.length ? '\n    ' + diffs.join('\n    ') : ''}`);
    }
    if (picked.length) {
      console.log(`parity: ${same}/${rows} rows identical to Python, avg ${(frameMs / picked.length / 1000).toFixed(2)} s/frame`);
    }

    // 2) UI path: screenshot upload -> cards in the pool
    if (picked.length) {
      const input = await page.$('#screenshotInput');
      await input.uploadFile(...picked.slice(0, 2).map((n) => path.resolve(__dirname, '../../web-scanner/images', n)));
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
