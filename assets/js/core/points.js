// LWHub – Punkte: Gewichtungen, Formeln, Ränge, Kategorien/Flags, escHtml, Kalenderwochen
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Kern auslagern“).
// Normales Script, kein Modul: alles bleibt global wie vorher. Reihenfolge der <script>-Tags in index.html beachten.

// ─── Gewichtungen (identisch mit Excel Formeln-Sheet Zeile 103) ───
const W = {
  vsUnter50: 5, vsTop30: 15, vsTop10: 5, vsAlle: 10, vsSpar: 15, // vsSpar: Sparwoche eingehalten (wie Top 30)
  spendeUnter35k: 5, spendeTop20: 5, spendeAlle: 5,
  wachePkt: 10, wacheOffline: 5, wacheBonus: 15,
  seTeilnahme: 10, seTop50: 15, seTop20: 10,
  wuesteAnmeldung: 10, wuesteTeilnahme: 25, wuesteFehlen: 15,
  inaktiv: 30, schild: 10, mails: 15, falschparken: 10,
  nap: 30, verhIntern: 15, verhExtern: 30,
  umfragen: 10, support: 10, feedback: 5
};

// ─── Punkte-Berechnung (1:1 aus Excel Formeln-Sheet) ───
function calcPoints(flags) {
  const has = k => flags[k] ? 1 : 0;
  const vsGesamt = W.vsAlle - (has('vsUnter50') * W.vsUnter50) + (has('vsTop30') * W.vsTop30) + (has('vsTop10') * W.vsTop10) + (has('vsSpar') * W.vsSpar);
  const vsGew = Math.min(vsGesamt * 5, 140);
  const spGesamt = W.spendeAlle - (has('spendeUnter35k') * W.spendeUnter35k) + (has('spendeTop20') * W.spendeTop20);
  const spGew = spGesamt * 7;
  const wT = has('wache1') + has('wache2') + has('wache3');
  const wO = has('wache1dmg') + has('wache2dmg') + has('wache3dmg');
  const wache = (wT * W.wachePkt) + (Math.floor(wT / 2) * W.wacheBonus) - (wO * W.wacheOffline);
  const se = ((has('seTeilnahme') * W.seTeilnahme) + (has('seTop50') * W.seTop50) + (has('seTop20') * W.seTop20)) * 2;
  const wu = (has('wuesteAnmeldung') * W.wuesteAnmeldung) + (has('wuesteTeilnahme') * W.wuesteTeilnahme) - (has('wuesteFehlen') * W.wuesteFehlen);
  const st = (has('inaktiv') * W.inaktiv) + (has('schild') * W.schild) + (has('mails') * W.mails)
    + (has('falschparken') * W.falschparken) + (has('nap') * W.nap)
    + (has('verhIntern') * W.verhIntern) + (has('verhExtern') * W.verhExtern);
  const bo = (has('umfragen') * W.umfragen) + (has('support') * W.support) + (has('feedback') * W.feedback);
  return vsGew + spGew + wache + se + wu - st + bo;
}

// ─── Ranking (Excel IFS-Formel in Formeln!AL3) ───
function calcRanking(points, rank) {
  if (rank === 4 || rank === 5) return rank;
  if (points > 179) return 3;
  if (points > 84) return 2;
  return 1;
}

const RC = {1:'#f0a500',2:'#2ecb7a',3:'#4a9eff',4:'#e05545',5:'#9b6dff'};
const RL = {1:'Rookie',2:'Pro',3:'Elite',4:'Leader',5:'Chef'};
const DEFAULT_RL = { ...RL };

// Rangnamen je Allianz (alliance_config rank_name_1..5, leer = Standard). RL wird ueberschrieben, damit alle
// Anzeigen "R3 · Elite" automatisch den Namen der Allianz zeigen; Elemente mit data-rank-name werden nachgezogen.
function applyRankNames(config = flagConfig) {
  for (let r = 1; r <= 5; r++) {
    const custom = String(config?.['rank_name_' + r] ?? '').trim().slice(0, 30);
    RL[r] = custom || (r === 5 ? tr('s_chef') : DEFAULT_RL[r]);
  }
  document.querySelectorAll('[data-rank-name]').forEach(el => { el.textContent = RL[el.dataset.rankName] || el.textContent; });
}

const CATS = [
  { l:'⚔ VS', t:'b', bg:'rgba(74,158,255,0.06)', bc:'rgba(74,158,255,0.15)', lc:'#6aabff',
    f:[{k:'vsUnter50',l:'unter 43,2 Mio',t:'r'},{k:'vsTop30',l:'Top 30',t:'b'},{k:'vsTop10',l:'Top 10',t:'b'},{k:'vsSpar',l:'Sparwoche eingehalten',t:'b'}] },
  { l:'💰 Spenden', t:'b', bg:'rgba(74,158,255,0.06)', bc:'rgba(74,158,255,0.15)', lc:'#6aabff',
    f:[{k:'spendeUnter35k',l:'unter 35K',t:'r'},{k:'spendeTop20',l:'Top 20',t:'b'}] },
  { l:'🛡 Wache', t:'b', bg:'rgba(74,158,255,0.06)', bc:'rgba(74,158,255,0.15)', lc:'#6aabff',
    f:[{k:'wache1',l:'W1 Teilnahme',t:'b'},{k:'wache1dmg',l:'W1 wenig Schaden',t:'r'},{k:'wache2',l:'W2 Teilnahme',t:'b'},{k:'wache2dmg',l:'W2 wenig Schaden',t:'r'},{k:'wache3',l:'W3 Teilnahme',t:'b'},{k:'wache3dmg',l:'W3 wenig Schaden',t:'r'}] },
  { l:'🎯 Spezialevents', t:'b', bg:'rgba(74,158,255,0.06)', bc:'rgba(74,158,255,0.15)', lc:'#6aabff',
    f:[{k:'seTeilnahme',l:'Teilnahme',t:'b'},{k:'seTop50',l:'Top 50',t:'b'},{k:'seTop20',l:'Top 20',t:'b'}] },
  { l:'🏜 Wüste', t:'b', bg:'rgba(74,158,255,0.06)', bc:'rgba(74,158,255,0.15)', lc:'#6aabff',
    f:[{k:'wuesteAnmeldung',l:'Anmeldung',t:'b'},{k:'wuesteTeilnahme',l:'Teilnahme',t:'b'},{k:'wuesteFehlen',l:'Fehlen',t:'r'}] },
  { l:'❌ Strafpunkte', t:'r', bg:'rgba(224,85,69,0.06)', bc:'rgba(224,85,69,0.2)', lc:'#f09080',
    f:[{k:'inaktiv',l:'Inaktiv',t:'r'},{k:'schild',l:'Schild',t:'r'},{k:'falschparken',l:'Falschparken',t:'r'},{k:'nap',l:'NAP',t:'r'},{k:'mails',l:'Ankündigung',t:'r'},{k:'verhIntern',l:'Verh. Intern',t:'r'},{k:'verhExtern',l:'Verh. Extern',t:'r'}] },
  { l:'⭐ Bonus', t:'a', bg:'rgba(240,165,0,0.06)', bc:'rgba(240,165,0,0.2)', lc:'var(--gold)',
    f:[{k:'umfragen',l:'Umfragen',t:'a'},{k:'support',l:'Support',t:'a'},{k:'feedback',l:'Feedback',t:'a'}] },
  { l:'⏸ AFK', t:'n', bg:'rgba(155,109,255,0.06)', bc:'rgba(155,109,255,0.2)', lc:'var(--purple)',
    f:[{k:'afk',l:'AFK',t:'n'}] }
];
const FLAGS = CATS.flatMap(c=>c.f);
const FLAG_KEYS = FLAGS.map(f=>f.k);
// Config keys per category (matches CATS indices 0–7)
const CAT_KEYS = ['vs','spende','wache','spezial','wueste','strafe','bonus','afk'];
const LBL = Object.fromEntries(FLAGS.map(f=>[f.k,f.l]));
const DANGER  = new Set(FLAGS.filter(f=>f.t==='r').map(f=>f.k));
const AMBER   = new Set(FLAGS.filter(f=>f.t==='a').map(f=>f.k));
const NEUTRAL = new Set(FLAGS.filter(f=>f.t==='n').map(f=>f.k));

let PREV = {};
const R5 = new Set();
const R4 = new Set();

function isFixed(n){return R5.has(n)||R4.has(n);}
function fixedRank(n){return R5.has(n)?5:R4.has(n)?4:null;}
function rbClass(r){return 'rb'+r;}
function escHtml(v){
  return String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function getIsoYearWeekParts(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function isoWeeksInYear(year) {
  return getIsoYearWeekParts(new Date(Date.UTC(year, 11, 28))).week;
}

// Spielserverzeit (UTC-2): Woche und Tag wechseln mit dem Reset im Spiel um 00:00 Serverzeit
// (04:00 Sommerzeit, 03:00 Winterzeit), nicht nach der Uhr des Browsers. Wie scanGameTime() im Hub.
const GAME_UTC_OFFSET_H = -2;
function gameServerDate(now = Date.now()) {
  const g = new Date(now + GAME_UTC_OFFSET_H * 3600000);
  return new Date(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate());
}

function currentYearWeek() {
  const { year, week } = getIsoYearWeekParts(gameServerDate());
  return (year % 100) * 100 + week;
}

function parseYearWeek(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length !== 4) return null;
  const yy = parseInt(digits.slice(0, 2), 10);
  const ww = parseInt(digits.slice(2, 4), 10);
  const year = 2000 + yy;
  if (ww < 1 || ww > isoWeeksInYear(year)) return null;
  return yy * 100 + ww;
}

function formatYearWeek(yw) {
  const yy = String(Math.floor(yw / 100)).padStart(2, '0');
  const ww = String(yw % 100).padStart(2, '0');
  return `${yy}${ww}`;
}

function shiftYearWeek(yw, delta) {
  let year = 2000 + Math.floor(yw / 100);
  let week = yw % 100;
  let step = delta;

  while (step !== 0) {
    if (step > 0) {
      week += 1;
      if (week > isoWeeksInYear(year)) {
        week = 1;
        year += 1;
      }
      step -= 1;
    } else {
      week -= 1;
      if (week < 1) {
        year -= 1;
        week = isoWeeksInYear(year);
      }
      step += 1;
    }
  }

  return (year % 100) * 100 + week;
}

