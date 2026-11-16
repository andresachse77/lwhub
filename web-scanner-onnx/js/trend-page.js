// LWHub-Scanner – Seiten-Script für Kampfkraft-Trend (trend.html). Ausgelagert aus dem Inline-<script> (CSP ohne unsafe-inline).

let activeApiUrl = LwhubAccess.apiCandidates()[0];
let raw = null;          // Antwort von /scans/power-history
let result = null;       // PowerTrend.analyze(...)
let verdictFilter = 'all';
let sortKey = 'verdict', sortDir = 1;
const opts = { ...PowerTrend.DEFAULTS };

const VERDICTS = {
  sacrifice: { icon: '🔥', label: 'opfert am Samstag', order: 0 },
  growing: { icon: '📈', label: 'wächst', order: 1 },
  steady: { icon: '➖', label: 'normal', order: 2 },
  stagnant: { icon: '⚠️', label: 'stagniert', order: 3 },
  unknown: { icon: '❔', label: 'zu wenig Daten', order: 4 },
};
const THRESHOLDS = [
  ['sacrificeMinPct', 'Samstag-Opfer ab (%)', 0.1],
  ['growthPct', 'Wachstum ab (% je Woche)', 0.1],
  ['stagnantPct', 'Stagnation unter (% je Woche)', 0.1],
  ['stagnantVolatility', 'Kaum Schwankung unter (% je Tag)', 0.05],
  ['minSpanDays', 'Urteil ab (Tage Verlauf)', 1],
];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mio = (v) => v == null ? '—' : `${(v / 1e6).toFixed(1)}M`;
const pct = (v, digits = 1) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)} %`;
const signClass = (v) => v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '';
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function sparkline(p, firstT, lastT) {
  const W = 150, H = 30, P = 3;
  const days = p.daysSorted;
  if (!days.length) return '<span class="week-none">—</span>';
  const span = Math.max(1, lastT - firstT);
  const vs = days.map((x) => x.v);
  const lo = Math.min(...vs), hi = Math.max(...vs), range = hi - lo || 1;
  const x = (t) => P + (t - firstT) / span * (W - 2 * P);
  const y = (v) => H - P - (v - lo) / range * (H - 2 * P);
  let bands = '';
  const DAY = 86400000;
  for (let t = firstT; t <= lastT; t += DAY) {
    if (PowerTrend.weekday(t) === 5) bands += `<rect class="weekend" x="${x(t) - 2}" y="0" width="${Math.max(4, x(t + 2 * DAY) - x(t))}" height="${H}"></rect>`;
  }
  const pts = days.map((d) => `${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join(' ');
  const dots = days.length === 1 ? `<circle cx="${x(days[0].t)}" cy="${y(days[0].v)}" r="2"></circle>` : '';
  const title = days.map((d) => `${d.d}: ${mio(d.v)}`).join('\n');
  return `<svg class="spark" width="${W}" height="${H}" role="img" aria-label="Verlauf"><title>${esc(title)}</title>${bands}<polyline points="${pts}"></polyline>${dots}</svg>`;
}

function weekCell(w) {
  if (!w) return '<span class="week-none">—</span>';
  const parts = [`<span class="${signClass(w.changePct)}">${pct(w.changePct)}</span>`];
  if (w.sacrificePct != null && w.sacrificed) {
    const rec = w.recoveredPct == null ? 'Aufbau läuft' : `↻ ${Math.round(w.recoveredPct)} %`;
    parts.push(`<span class="week-sat" title="Samstag-Event: ${mio(w.pre.v)} → ${mio(w.post.v)}">Sa −${w.sacrificePct.toFixed(1)} % · ${rec}</span>`);
  }
  return `<div class="week-cell" title="${w.measurements} Messung(en)">${parts.join('')}</div>`;
}

function render() {
  if (!raw) return;
  result = PowerTrend.analyze(raw.players, opts);
  const players = result.players;

  // Zusammenfassung & Messtage
  const withData = players.filter((p) => p.daysSorted.length).length;
  document.getElementById('summary').innerHTML =
    `<span class="badge-stat">${players.length} Mitglieder</span>` +
    `<span class="badge-stat">${withData} mit Verlauf</span>` +
    `<span class="badge-stat">${result.measuredDays.length} Messtage</span>` +
    (result.measuredDays.length < 4 ? '<span class="muted">Noch wenig Verlauf – die Einstufung wird mit jedem Scan genauer.</span>' : '');
  document.getElementById('measuredDays').innerHTML = result.measuredDays.map((d) => {
    const t = PowerTrend.parseDay(d), wd = PowerTrend.weekday(t);
    return `<span class="day-chip ${wd >= 5 ? 'weekend' : ''}">${WEEKDAYS[wd]} ${d.slice(8, 10)}.${d.slice(5, 7)}.</span>`;
  }).join('');

  // Filter-Pills
  const counts = Object.fromEntries(Object.keys(VERDICTS).map((k) => [k, players.filter((p) => p.verdict === k).length]));
  document.getElementById('verdictPills').innerHTML =
    `<button class="pill-btn ${verdictFilter === 'all' ? 'active' : ''}" data-v="all">Alle (${players.length})</button>` +
    Object.entries(VERDICTS).map(([k, v]) =>
      `<button class="pill-btn ${verdictFilter === k ? 'active' : ''}" data-v="${k}">${v.icon} ${v.label} (${counts[k]})</button>`).join('');

  // Tabelle
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  let rows = players.filter((p) => (verdictFilter === 'all' || p.verdict === verdictFilter) && (!q || p.name.toLowerCase().includes(q)));
  const key = {
    verdict: (p) => VERDICTS[p.verdict].order * 1000 - (p.weeklyPct ?? 0),
    name: (p) => p.name.toLowerCase(),
    power: (p) => -(p.last?.v ?? p.current_power ?? 0),
    weekly: (p) => -(p.weeklyPct ?? -Infinity),
    volatility: (p) => p.volatility ?? Infinity,
    sacrifice: (p) => -p.sacrificeCount,
  }[sortKey];
  rows.sort((a, b) => { const ka = key(a), kb = key(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * sortDir; });

  const weeks = result.weeks.slice(-Number(document.getElementById('weeksSelect').value));
  const firstT = result.measuredDays.length ? PowerTrend.parseDay(result.measuredDays[0]) : 0;
  const lastT = result.measuredDays.length ? PowerTrend.parseDay(result.measuredDays[result.measuredDays.length - 1]) : 0;
  const th = (k, label, cls = '') => `<th class="${cls}" data-sort="${k}" title="Sortieren">${label}${sortKey === k ? (sortDir > 0 ? ' ▾' : ' ▴') : ''}</th>`;
  document.getElementById('trendTable').innerHTML =
    `<thead><tr>${th('name', 'Spieler')}${th('power', 'Kampfkraft', 'num')}<th>Verlauf</th>` +
    weeks.map((w) => `<th class="num" title="Woche ab ${w.monday}">${w.label}</th>`).join('') +
    `${th('weekly', 'Ø je Woche', 'num')}${th('volatility', 'Bewegung / Tag', 'num')}${th('sacrifice', 'Opfer', 'num')}${th('verdict', 'Einstufung')}</tr></thead><tbody>` +
    rows.map((p) => `<tr${p.former ? ' style="opacity:0.55"' : ''}>
      <td><span class="rank-badge r${p.rank}">R${p.rank}</span> ${esc(p.name)}${p.former
        ? ` <span class="badge-stat" title="Ehemaliges Mitglied – Werte aus seiner Zeit in dieser Allianz">${p.former === 'moved' && p.now_alliance ? 'jetzt ' + esc(p.now_alliance) : 'ausgetreten'}</span>`
        : ''}</td>
      <td class="num">${mio(p.last?.v ?? p.current_power)}</td>
      <td>${sparkline(p, firstT, lastT)}</td>
      ${weeks.map((w) => `<td class="num">${weekCell(p.weeks[w.key])}</td>`).join('')}
      <td class="num ${signClass(p.totalPct)}">${p.spanDays >= opts.minSpanDays
        ? pct(p.weeklyPct)
        : p.totalPct == null ? '—' : `<span class="muted" title="Hochrechnung erst ab ${opts.minSpanDays} Tagen Verlauf">${pct(p.totalPct)} in ${Math.round(p.spanDays)} T.</span>`}</td>
      <td class="num" title="mittlere Veränderung pro Tag (Wachstum und Verluste)">${p.volatility == null ? '—' : p.volatility.toFixed(2) + ' %'}</td>
      <td class="num">${p.sacrificeCount || '—'}</td>
      <td><span class="verdict ${p.verdict}">${VERDICTS[p.verdict].icon} ${esc(p.verdictText)}</span></td>
    </tr>`).join('') + '</tbody>';
}

async function loadHistory() {
  const alliance = document.getElementById('allianceSelect').value;
  const weeks = document.getElementById('weeksSelect').value;
  document.getElementById('linkScanner').href = `./`;
  const data = await LwhubAccess.check(activeApiUrl, alliance, 'Der Trend', { view: true });
  if (!data) return;
  const resp = await fetch(`${activeApiUrl}/scans/power-history?alliance=${encodeURIComponent(alliance)}&weeks=${weeks}`, {
    headers: LwhubAccess.authHeaders(),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body.ok) {
    document.getElementById('summary').innerHTML = `<span class="neg">Verlauf konnte nicht geladen werden: ${esc(body.error || resp.status)}</span>`;
    return;
  }
  raw = body;
  render();
}

// Bedienung
document.getElementById('verdictPills').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  verdictFilter = b.dataset.v;
  render();
});
document.getElementById('trendTable').addEventListener('click', (e) => {
  const h = e.target.closest('[data-sort]');
  if (!h) return;
  if (sortKey === h.dataset.sort) sortDir = -sortDir; else { sortKey = h.dataset.sort; sortDir = 1; }
  render();
});
document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('allianceSelect').addEventListener('change', loadHistory);
document.getElementById('weeksSelect').addEventListener('change', loadHistory);
document.getElementById('accessGateRetry').addEventListener('click', loadHistory);
document.getElementById('thresholds').innerHTML = THRESHOLDS.map(([k, label, step]) =>
  `<label>${label}<input type="number" step="${step}" min="0" data-k="${k}" value="${opts[k]}"></label>`).join('');
document.getElementById('thresholds').addEventListener('input', (e) => {
  const k = e.target.dataset.k;
  if (!k || e.target.value === '') return;
  opts[k] = Number(e.target.value);
  render();
});

(async () => {
  const { apiUrl, alliances } = await LwhubAccess.findApi();
  activeApiUrl = apiUrl;
  const wanted = new URLSearchParams(location.search).get('alliance') || LwhubAccess.preferredAlliance();
  try {
    await LwhubAccess.fillOwnAlliances(document.getElementById('allianceSelect'), apiUrl, alliances, wanted, { view: true });
    await loadHistory();
  } finally {
    LwhubAccess.reportReady();
  }
})();
