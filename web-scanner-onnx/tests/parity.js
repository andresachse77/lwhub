// Parity test: runs the browser OCR port (../js) under onnxruntime-node on the local captures and
// compares it with the Python server's output dumped by dump_reference.py.
//
//   py -3.12 dump_reference.py      (once, writes reference/*.json)
//   npm install && node parity.js [view-001.png ...]
//
// Captures live in web-scanner/images/ (gitignored), so this is a no-op on a fresh clone.
const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');
const { PNG } = require('pngjs');
const { OcrEngine, fromRGBA } = require('../js/ocr-engine.js');
const { processFrame } = require('../js/scanner-pipeline.js');

const IMAGES = path.resolve(__dirname, '../../web-scanner/images');
const REF = path.join(__dirname, 'reference');
const MODELS = path.resolve(__dirname, '../models');

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = ix * iy;
  const area = (l) => (l.right - l.left) * (l.bottom - l.top);
  return inter / (area(a) + area(b) - inter || 1);
};

const ROW_FIELDS = ['name', 'power', 'rank_code', 'level', 'status', 'rank_position'];

async function main() {
  if (!fs.existsSync(REF)) { console.log('no reference/ - run dump_reference.py first'); return; }
  const names = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readdirSync(REF).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

  const engine = await OcrEngine.create({
    ort,
    detModel: path.join(MODELS, 'ch_PP-OCRv4_det_infer.onnx'),
    recModel: path.join(MODELS, 'ch_PP-OCRv4_rec_infer.onnx'),
    keysText: fs.readFileSync(path.join(MODELS, 'ppocr_keys_v1.txt'), 'utf8'),
  });

  const tot = { refLines: 0, matched: 0, sameText: 0, extra: 0, rows: 0, rowDiffs: 0, rowCountDiff: 0, mode: 0, ms: 0 };
  for (const name of names) {
    const ref = JSON.parse(fs.readFileSync(path.join(REF, name + '.json'), 'utf8'));
    const png = PNG.sync.read(fs.readFileSync(path.join(IMAGES, name)));
    const img = fromRGBA(png.data, png.width, png.height);

    const t0 = Date.now();
    const result = await processFrame(engine, img);
    tot.ms += Date.now() - t0;

    // Line level: re-run the plain 1x OCR to compare raw detections/recognitions.
    const { ocrLines } = require('../js/scanner-pipeline.js');
    const lines = await ocrLines(engine, img);
    const used = new Set();
    const textDiffs = [];
    for (const r of ref.lines) {
      let best = -1, bestIou = 0.5;
      lines.forEach((l, i) => { const v = iou(r, l); if (!used.has(i) && v > bestIou) { best = i; bestIou = v; } });
      tot.refLines++;
      if (best < 0) { textDiffs.push(`  missing line: "${r.text}"`); continue; }
      used.add(best); tot.matched++;
      if (lines[best].text === r.text) tot.sameText++;
      else textDiffs.push(`  text: py "${r.text}" vs js "${lines[best].text}"`);
    }
    lines.forEach((l, i) => { if (!used.has(i)) { tot.extra++; textDiffs.push(`  extra line: "${l.text}"`); } });

    const rows = result.mode === 'ranking' ? result.rankings : result.cards;
    const rowDiffs = [];
    if (result.mode !== ref.mode) { tot.mode++; rowDiffs.push(`  mode: py ${ref.mode} vs js ${result.mode}`); }
    if (rows.length !== ref.rows.length) { tot.rowCountDiff++; rowDiffs.push(`  rows: py ${ref.rows.length} vs js ${rows.length}`); }
    ref.rows.forEach((r, i) => {
      tot.rows++;
      const j = rows[i];
      const d = j ? ROW_FIELDS.filter((f) => (r[f] ?? null) !== (j[f] ?? null)) : ROW_FIELDS;
      if (d.length) {
        tot.rowDiffs++;
        rowDiffs.push(`  row ${i}: ` + d.map((f) => `${f} py=${JSON.stringify(r[f])} js=${JSON.stringify(j?.[f])}`).join(', '));
      }
    });

    const flag = rowDiffs.length ? 'ROW-DIFF' : textDiffs.length ? 'text-diff' : 'ok';
    console.log(`${name}: ${flag}`);
    for (const d of [...rowDiffs, ...textDiffs]) console.log(d);
  }

  console.log('\n=== summary ===');
  console.log(`frames ${names.length}, mode mismatches ${tot.mode}`);
  console.log(`lines: ${tot.matched}/${tot.refLines} matched by box, ${tot.sameText}/${tot.refLines} identical text, ${tot.extra} extra in js`);
  console.log(`rows: ${tot.rows - tot.rowDiffs}/${tot.rows} identical (name/power/rank/level/status), ${tot.rowCountDiff} frames with different row count`);
  console.log(`avg processFrame ${(tot.ms / names.length / 1000).toFixed(2)} s (node, CPU)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
