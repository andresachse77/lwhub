/*
 * Auswertung des Kampfkraft-Verlaufs (GET /scans/power-history) fuer die Trend-Seite.
 *
 * Idee: Wer aktiv spielt, waechst unter der Woche und opfert am Samstag beim grossen Event Truppen
 * (Kampfkraft faellt), die er in der Folgewoche wieder aufbaut. Wessen Kampfkraft kaum schwankt,
 * spielt eher wenig – Kandidat fuer ein Gespraech.
 *
 * Kennzahlen je Spieler:
 *   - Wochenzuwachs: letzter Wert der Woche gegen letzten Wert der Vorwoche (sonst ersten der Woche)
 *   - Samstag-Opfer: letzter Wert vor Samstag (Mo–Fr) gegen den Tiefstwert am Samstag/Sonntag
 *   - Wiederaufbau: wie viel des Opfers in der Folgewoche wieder aufgebaut wurde (100 % = alles)
 *   - Schwankung: mittlere Aenderung pro Tag zwischen zwei Messungen (Betrag, in %)
 * Pure Funktionen, laeuft im Browser und in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PowerTrend = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const DEFAULTS = {
    sacrificeMinPct: 1.0,   // Abfall Sa/So ab dem es als Opfer zaehlt
    growthPct: 2.0,         // Wochenzuwachs ab dem jemand "waechst"
    stagnantPct: 0.5,       // Wochenaenderung darunter = stagniert
    stagnantVolatility: 0.15, // mittlere Tagesaenderung (%) darunter = kaum Bewegung
    minSpanDays: 6,         // erst ab so vielen Tagen Messzeitraum gibt es ein Urteil
  };

  const DAY = 86400000;
  const parseDay = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const fmtDay = (t) => new Date(t).toISOString().slice(0, 10);
  const weekday = (t) => (new Date(t).getUTCDay() + 6) % 7; // 0 = Montag … 5 = Samstag, 6 = Sonntag
  const mondayOf = (t) => t - weekday(t) * DAY;

  /** ISO-Kalenderwoche als { key: '2026-W42', label: 'KW 42', monday: 'YYYY-MM-DD' } */
  function isoWeek(t) {
    const thursday = mondayOf(t) + 3 * DAY;
    const year = new Date(thursday).getUTCFullYear();
    const jan4 = Date.UTC(year, 0, 4);
    const week = 1 + Math.round((thursday - (mondayOf(jan4) + 3 * DAY)) / (7 * DAY));
    return { key: `${year}-W${String(week).padStart(2, '0')}`, label: `KW ${week}`, monday: fmtDay(mondayOf(t)) };
  }

  /** Alle Wochen zwischen erstem und letztem Messtag (auch Wochen ohne Messung, fuer die Tabelle). */
  function weeksBetween(firstDay, lastDay) {
    const out = [];
    for (let t = mondayOf(parseDay(firstDay)); t <= parseDay(lastDay); t += 7 * DAY) out.push(isoWeek(t));
    return out;
  }

  function analyzePlayer(player, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const days = (player.days || []).map((x) => ({ t: parseDay(x.d), d: x.d, v: x.v, exact: !!x.exact }))
      .sort((a, b) => a.t - b.t);
    const byWeek = new Map();
    for (const x of days) {
      const w = isoWeek(x.t);
      if (!byWeek.has(w.key)) byWeek.set(w.key, { ...w, days: [] });
      byWeek.get(w.key).days.push(x);
    }
    const weekKeys = [...byWeek.keys()].sort();

    const weeks = {};
    let prevLast = null;
    for (const key of weekKeys) {
      const w = byWeek.get(key);
      const first = w.days[0], last = w.days[w.days.length - 1];
      const base = prevLast || first;
      const change = base && last !== base ? last.v - base.v : null;
      // Samstag-Event: letzter Wert Mo–Fr gegen Tiefstwert Sa/So
      const pre = [...w.days].reverse().find((x) => weekday(x.t) <= 4) || null;
      const post = w.days.filter((x) => weekday(x.t) >= 5).sort((a, b) => a.v - b.v)[0] || null;
      const drop = pre && post ? (pre.v - post.v) / pre.v * 100 : null;
      weeks[key] = {
        ...w,
        measurements: w.days.length,
        change,
        changePct: change !== null ? change / base.v * 100 : null,
        sacrificePct: drop,
        sacrificed: drop !== null && drop >= o.sacrificeMinPct,
        pre, post,
        recoveredPct: null,
      };
      prevLast = last;
    }
    // Wiederaufbau: Hoechstwert der Folgewoche gegen das Opfer
    weekKeys.forEach((key, i) => {
      const w = weeks[key];
      if (!w.sacrificed) return;
      const next = weeks[weekKeys[i + 1]];
      if (!next) return; // Folgewoche noch nicht gemessen
      const max = Math.max(...byWeek.get(next.key).days.map((x) => x.v));
      w.recoveredPct = (max - w.post.v) / (w.pre.v - w.post.v) * 100;
    });

    // Schwankung: mittlere |Aenderung| pro Tag zwischen aufeinanderfolgenden Messungen
    let volSum = 0, volDays = 0;
    for (let i = 1; i < days.length; i++) {
      const gap = (days[i].t - days[i - 1].t) / DAY;
      volSum += Math.abs(days[i].v - days[i - 1].v) / days[i - 1].v * 100;
      volDays += gap;
    }
    const volatility = volDays ? volSum / volDays : null;
    const spanDays = days.length > 1 ? (days[days.length - 1].t - days[0].t) / DAY : 0;
    const first = days[0] || null, last = days[days.length - 1] || null;
    const totalPct = first && last && first !== last ? (last.v - first.v) / first.v * 100 : null;
    const weeklyPct = totalPct !== null && spanDays > 0 ? totalPct / spanDays * 7 : null;
    const sacrifices = Object.values(weeks).filter((w) => w.sacrificed);

    let verdict, verdictText;
    if (spanDays < o.minSpanDays) {
      verdict = 'unknown';
      verdictText = days.length < 2 ? 'zu wenig Daten' : `erst ${Math.round(spanDays)} Tag(e) Verlauf`;
    } else if (sacrifices.length > 0) {
      const recovered = sacrifices.filter((w) => w.recoveredPct !== null && w.recoveredPct >= 100).length;
      verdict = 'sacrifice';
      verdictText = recovered ? 'opfert & baut auf' : 'opfert am Samstag';
    } else if (weeklyPct !== null && weeklyPct >= o.growthPct) {
      verdict = 'growing';
      verdictText = 'wächst';
    } else if (Math.abs(weeklyPct ?? 0) < o.stagnantPct && (volatility ?? 0) < o.stagnantVolatility) {
      verdict = 'stagnant';
      verdictText = 'stagniert – Gespräch?';
    } else {
      verdict = 'steady';
      verdictText = 'normal';
    }

    return {
      ...player,
      daysSorted: days,
      weeks,
      first, last,
      spanDays,
      totalPct,
      weeklyPct,
      volatility,
      sacrificeCount: sacrifices.length,
      verdict,
      verdictText,
    };
  }

  /** Analysiert alle Spieler; liefert auch die Wochenspalten und Messtage der Allianz. */
  function analyze(players, opts = {}) {
    const all = players.flatMap((p) => (p.days || []).map((x) => x.d)).sort();
    const measuredDays = [...new Set(all)];
    const weeks = measuredDays.length ? weeksBetween(measuredDays[0], measuredDays[measuredDays.length - 1]) : [];
    return {
      weeks,
      measuredDays,
      players: players.map((p) => analyzePlayer(p, opts)),
    };
  }

  return { analyze, analyzePlayer, isoWeek, weekday, parseDay, DEFAULTS };
});
