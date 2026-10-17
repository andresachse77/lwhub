// VS-Erkennung (Allianz-Duell) gegen die Soll-Werte aus Thomas' Last-War-Tracker-Testdaten.
//   node vs-test.js [Pfad zu Last-War-Tracker/testdaten]
// Prueft je Screenshot: Modus "vs", Tag-/Wochen-Rang, Namen, Punkte und Allianz-Kuerzel.
// "~"-Zeilen (Sonderschrift, z. B. kopfueber) werden nur ueber den Wert geprueft.
const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const { OcrEngine, fromRGBA } = require('../js/ocr-engine.js');
const { processFrame } = require('../js/scanner-pipeline.js');

const DATA = process.argv[2] || 'C:/Git/lwt/Last-War-Tracker/testdaten';
const MODELS = path.resolve(__dirname, '../models');
// Wie sameAllianceTag() im Cockpit und scanAllianceTagMatches() in der API: "Kuerzel richtig" = Zeile bleibt im Filter
const normTag = (t) => String(t || '').trim().toLowerCase().replace(/[il|]/g, '1').replace(/o/g, '0').replace(/[^a-z0-9]/g, '');
const normName = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

function loadImage(file) {
  const buf = fs.readFileSync(file);
  const img = file.endsWith('.png') ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return fromRGBA(img.data, img.width, img.height);
}

async function main() {
  if (!fs.existsSync(DATA)) { console.log(`keine Testdaten unter ${DATA}`); return; }
  const engine = await OcrEngine.create({
    ort,
    detModel: path.join(MODELS, 'ch_PP-OCRv4_det_infer.onnx'),
    recModel: path.join(MODELS, 'ch_PP-OCRv4_rec_infer.onnx'),
    keysText: fs.readFileSync(path.join(MODELS, 'ppocr_keys_v1.txt'), 'utf8'),
  });
  const folders = fs.readdirSync(DATA).filter((d) => d.startsWith('vs_'));
  const tot = { frames: 0, modeOk: 0, rows: 0, values: 0, names: 0, nameRows: 0, tags: 0, tagRows: 0 };
  for (const folder of folders) {
    const dir = path.join(DATA, folder);
    for (const exp of fs.readdirSync(dir).filter((f) => f.endsWith('.expected.txt'))) {
      const base = exp.replace('.expected.txt', '');
      const imgFile = ['.jpg', '.png'].map((e) => path.join(dir, base + e)).find((f) => fs.existsSync(f));
      if (!imgFile) continue;
      const expected = fs.readFileSync(path.join(dir, exp), 'utf8').split(/\r?\n/)
        .filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
          const [name, value, tag] = l.split('\t');
          return { special: name.startsWith('~'), name: name.replace(/^~/, '').replace(/\s*\(.*\)$/, ''), value: parseInt(value, 10), tag };
        });
      const r = await processFrame(engine, loadImage(imgFile));
      tot.frames++;
      const wantType = folder.includes('woche') ? 'VS_WEEK' : 'VS_DAY';
      const modeOk = r.mode === 'vs' && r.vs?.type === wantType;
      if (modeOk) tot.modeOk++;
      const issues = [];
      if (!modeOk) issues.push(`Modus ${r.mode}/${r.vs?.type} statt vs/${wantType}`);
      for (const e of expected) {
        tot.rows++;
        const row = (r.vs_rows || []).find((x) => x.points === e.value);
        if (!row) { issues.push(`fehlt: ${e.name} ${e.value}`); continue; }
        tot.values++;
        if (!e.special) {
          tot.nameRows++;
          if (normName(row.name) === normName(e.name)) tot.names++;
          else issues.push(`Name: "${row.name}" statt "${e.name}"`);
        }
        if (e.tag) {
          tot.tagRows++;
          if (normTag(row.alliance_tag) === normTag(e.tag)) tot.tags++;
          else issues.push(`Kuerzel: "${row.alliance_tag}" statt "${e.tag}" (${e.name})`);
        }
      }
      const extra = (r.vs_rows || []).filter((x) => !expected.some((e) => e.value === x.points));
      console.log(`${folder}/${base}: ${r.mode} ${r.vs?.type || ''} ${r.vs?.day || ''} – ${(r.vs_rows || []).length} Zeilen${extra.length ? `, zusaetzlich: ${extra.map((x) => `${x.name || '?'} ${x.points}`).join(', ')}` : ''}`);
      for (const i of issues) console.log('   ' + i);
    }
  }
  console.log('\n=== Zusammenfassung ===');
  console.log(`Seiten ${tot.frames}, Modus/Tag-Woche richtig ${tot.modeOk}/${tot.frames}`);
  console.log(`Werte gefunden ${tot.values}/${tot.rows}, Namen richtig ${tot.names}/${tot.nameRows}, Kuerzel richtig ${tot.tags}/${tot.tagRows}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
