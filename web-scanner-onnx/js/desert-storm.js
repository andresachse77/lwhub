/*
 * Wuestensturm: wer war angemeldet und ist nicht erschienen?
 *
 * Liest zwei Ansichten aus dem Spiel (nur aus den OCR-Zeilen, ohne eigenes Modell):
 *   - Mail "[Wuestensturm]-Kampfergebnis!": unten das Kampfdatum, darunter "Individuelle Punkte"
 *     mit "[NxU1]Name" und den Punkten – das sind alle, die auf dem Schlachtfeld waren.
 *   - Events → Wuestensturm → "Protokolle": wer wann als Teilnehmer oder Stellvertreter in
 *     Einsatztruppe A/B geschickt oder daraus entfernt wurde.
 * Aus dem Protokoll wird die Aufstellung zum Kampfzeitpunkt nachgespielt (ab Montag der Kampfwoche)
 * und mit der Mail verglichen. Team B kaempft mittags, Team A abends.
 *
 *   const ds = DesertStorm.createCollector();
 *   ds.feed(result.raw_lines, result.width, result.height);   // 'result' | 'log' | null
 *   const report = DesertStorm.evaluate(ds, { match: (name) => ({ id, name }) | null });
 *   DesertStorm.reportText(report);
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesertStorm = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const despace = (s) => String(s || '').replace(/\s+/g, '');

  // "2026-11-621:30:02" (Tag und Uhrzeit ohne Leerzeichen gelesen) oder "2026-11-6 21:30:02".
  // Die Stunde ist immer zweistellig, damit ist die Trennung eindeutig.
  const TS_RE = /^(20\d\d)[-.](\d{1,2})[-.](\d{1,2})(\d\d)[:.-](\d\d)[:.-](\d\d)$/;
  const pad = (n) => String(n).padStart(2, '0');
  function parseTs(text) {
    const m = TS_RE.exec(despace(text));
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
    return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
  }

  // Vergleichsschluessel: ohne Akzente, Leerzeichen und Sonderzeichen; OCR-Verwechsler zusammengelegt
  function nameKey(name) {
    return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]/g, '').replace(/[il|]/g, '1').replace(/o/g, '0');
  }
  function similarity(a, b) {
    if (a === b) return 1;
    const m = a.length, n = b.length;
    if (!m || !n) return 0;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n);
  }

  // Auf dem Kopf stehende Namen (z. B. "ʞnsɥɯınz") liest die OCR als gedrehten Text ("zuiwysny"):
  // rueckwaerts lesen und die Buchstaben drehen, die sich dabei aendern.
  const FLIP = { b: 'q', q: 'b', d: 'p', p: 'd', n: 'u', u: 'n', m: 'w', w: 'm', h: 'y', y: 'h', a: 'e', e: 'a' };
  const flipName = (name) => [...String(name || '')].reverse().map((c) => FLIP[c] || c).join('');

  function detect(lines, height) {
    const top = lines.filter((l) => l.top < height * 0.2).map((l) => l.text).join(' ');
    if (/w[uü]s[tf]enstur.{0,3}kampfergebn/i.test(despace(top))) return 'result';
    const header = lines.find((l) => l.top < height * 0.25 && /^protokoll/i.test(despace(l.text)));
    if (header && lines.some((l) => /einsatztrup/i.test(despace(l.text)))) return 'log';
    return null;
  }

  // ── Kampfergebnis-Mail ────────────────────────────────────────────────────────────────
  const TAG_NAME_RE = /^[[(]([A-Za-z0-9]{2,5})[\]jJ|)](.+)$/;
  // Kuerzel auch verlesen abtrennen: "INxU1]shark", "[NxU1jshark", "NxU1]shark"
  const LOOSE_TAG_RE = /^[[(|Il1i]?\s*([A-Za-z0-9]{2,5})\s*[\]jJ|)]\s*(.+)$/;
  function stripTag(text, tagKey) {
    const t = text.trim();
    const m = LOOSE_TAG_RE.exec(t);
    if (m && (/^[[(]/.test(t) || (tagKey && similarity(nameKey(m[1]), tagKey) >= 0.5))) return m[2].trim();
    return t;
  }
  // Zeilen gehen von den Punkten aus (Ziffern in der Punktespalte); der Name steht direkt darueber.
  // So zaehlt jede Zeile, auch wenn das Kuerzel verlesen ist oder der Name gar nicht lesbar.
  function parseResult(lines, width, height) {
    const stamps = lines.map((l) => ({ l, at: parseTs(l.text) })).filter((x) => x.at).sort((a, b) => b.l.top - a.l.top);
    const at = stamps.length ? stamps[0].at : null;
    const strict = lines.filter((l) => l.left > width * 0.25).map((l) => ({ l, m: TAG_NAME_RE.exec(l.text.trim()) })).filter((x) => x.m);
    const tagCount = new Map();
    for (const x of strict) tagCount.set(nameKey(x.m[1]), (tagCount.get(nameKey(x.m[1])) || 0) + 1);
    const tagKey = [...tagCount].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const colLeft = strict.length ? strict.reduce((s, x) => s + x.l.left, 0) / strict.length : width * 0.405;
    const isNum = (l) => /^\d{3,9}$/.test(despace(l.text));
    const values = lines.filter((v) => isNum(v) && Math.abs(v.left - colLeft) < width * 0.04 && v.top > height * 0.25);
    const rows = [];
    const unnamed = [];
    const usedNames = new Set();
    for (const v of values) {
      const h = v.bottom - v.top;
      const above = lines
        .filter((l) => l !== v && !isNum(l) && !parseTs(l.text) && l.top < v.top && l.top > v.top - h * 2.6
          && Math.abs(l.left - v.left) < width * 0.06)
        .sort((a, b) => b.top - a.top)[0];
      const points = Number(despace(v.text));
      const box = { top: Math.max(0, Math.round(v.top - h * 2.8)), bottom: Math.round(v.bottom + h * 0.6) };
      const name = above ? stripTag(above.text, tagKey) : '';
      if (above && nameKey(name).length >= 2) { usedNames.add(above); rows.push({ name, points }); }
      else unnamed.push({ points, box });
    }
    // Name unten angeschnitten, Punkte schon ausserhalb des Bildes: Name ohne Punkte
    for (const x of strict) {
      if (usedNames.has(x.l)) continue;
      const name = x.m[2].trim();
      if (nameKey(name).length >= 2 && x.l.bottom > height * 0.6) rows.push({ name, points: null });
    }
    // Platznummern links (ab Platz 4, 1–3 sind Medaillen): der hoechste Platz = Zahl der Spieler auf dem Feld
    const ranks = lines.filter((l) => l.left > width * 0.06 && l.left < width * 0.2 && l.top > height * 0.25 && /^\d{1,2}$/.test(despace(l.text)))
      .map((l) => Number(despace(l.text))).filter((n) => n >= 4 && n <= 60);
    return { at, rows, unnamed, ranks };
  }

  // ── Protokoll ─────────────────────────────────────────────────────────────────────────
  const TEIL = 'Te[il1|]{1,3}nehmer';
  const TRUPPE = 'Einsatztrupp[eo]?([AB8])';
  const PATTERNS = [
    // "oooRowdyooo hat Timbo45 als Teilnehmer an die Einsatztruppe B gesendet."
    { re: new RegExp(`^(.+?)hat(.+)als${TEIL}(?:an)?(?:d[il1]e)?${TRUPPE}`, 'i'), action: 'add', role: 'member' },
    // "oooRowdyooo schickte Sprassel an die Einsatztruppe B als Stellvertreter."
    { re: new RegExp(`^(.+?)schickte(.+?)an(?:d[il1]e)?${TRUPPE}als(?:Stellvertreter|Stel)`, 'i'), action: 'add', role: 'sub' },
    // "oooRowdyooo entfernt SeanI aus der Einsatztruppe A."
    { re: new RegExp(`^(.+?)entfernt(.+)aus(?:der)?${TRUPPE}`, 'i'), action: 'remove' },
  ];
  function parseEntry(text, at) {
    const t = despace(text);
    const time = /Spielzeitf.r(?:die)?Einsatztrupp[eo]?([AB8])auf(\d\d:\d\d)/i.exec(t);
    if (time) return { at, action: 'time', team: time[1] === '8' ? 'B' : time[1].toUpperCase(), time: time[2], text };
    for (const p of PATTERNS) {
      const m = p.re.exec(t);
      if (!m) continue;
      const target = m[2].trim();
      if (nameKey(target).length < 2) return null;
      return { at, action: p.action, role: p.role || null, team: m[3] === '8' ? 'B' : m[3].toUpperCase(), actor: m[1], target, text };
    }
    return null; // Kommandant ernannt/widerrufen u. a. – fuer die Aufstellung ohne Bedeutung
  }
  function parseLog(lines, width, height) {
    const header = lines.find((l) => l.top < height * 0.25 && /^protokoll/i.test(despace(l.text)));
    const body = lines
      .filter((l) => l.top > header.bottom + 15 && l.top < height * 0.9 && l.left > width * 0.25)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const entries = [];
    let chunk = [];
    for (const l of body) {
      const at = parseTs(l.text);
      if (!at) { chunk.push(l.text); continue; }
      // Oben angeschnittene Eintraege ergeben kein vollstaendiges Muster und fallen hier heraus
      if (chunk.length) {
        const e = parseEntry(chunk.join(' '), at);
        if (e) entries.push(e);
      }
      chunk = [];
    }
    return entries; // Eintrag ohne Zeitstempel (unten angeschnitten) wird verworfen
  }

  // ── Sammeln ueber viele Ansichten ─────────────────────────────────────────────────────
  function createCollector() {
    const battles = new Map(); // at -> { at, players: [{ name, points }], unnamed: Map(Punkte -> Bildausschnitt) }
    let lastUnnamed = [];      // unlesbare Zeilen der zuletzt gelesenen Ansicht (fuer den Bildausschnitt im Cockpit)
    const log = new Map();     // Schluessel -> Eintrag
    let frames = 0;
    function addPlayer(battle, row) {
      const k = nameKey(row.name);
      // Gleiche Punkte und aehnlicher Name, oder gleicher Schluessel: derselbe Spieler aus einer anderen Ansicht
      const same = battle.players.find((p) => p.key === k
        || (row.points != null && p.points === row.points && similarity(p.key, k) >= 0.5));
      const target = same || { name: row.name, key: k, points: null, seen: 0, votes: new Map() };
      if (!same) battle.players.push(target);
      target.seen++;
      // Punkte: der am haeufigsten gelesene Wert gewinnt (einzelne Lesefehler fallen so heraus)
      if (row.points != null) {
        target.votes.set(row.points, (target.votes.get(row.points) || 0) + 1);
        target.points = [...target.votes].sort((a, b) => b[1] - a[1])[0][0];
      }
    }
    return {
      battles, log,
      get frames() { return frames; },
      get lastUnnamed() { return lastUnnamed; },
      feed(rawLines, width, height) {
        const lines = (rawLines || []).filter((l) => l && l.text);
        const kind = detect(lines, height);
        lastUnnamed = [];
        if (kind === 'result') {
          const { at, rows, unnamed, ranks } = parseResult(lines, width, height);
          if (!at) return null; // Datum nicht lesbar: Zeilen keinem Kampf zuzuordnen
          if (!battles.has(at)) battles.set(at, { at, players: [], unnamed: new Map() });
          for (const r of rows) addPlayer(battles.get(at), r);
          const rc = battles.get(at).ranks || (battles.get(at).ranks = new Map());
          for (const n of ranks) rc.set(n, (rc.get(n) || 0) + 1);
          lastUnnamed = unnamed.map((u) => ({ at, ...u }));
          for (const u of unnamed) {
            const known = battles.get(at).unnamed.get(u.points);
            battles.get(at).unnamed.set(u.points, { box: known?.box || u.box, seen: (known?.seen || 0) + 1 });
          }
        } else if (kind === 'log') {
          for (const e of parseLog(lines, width, height)) {
            const k = `${e.at}|${e.action}|${e.role || ''}|${e.team}|${nameKey(e.target || e.time)}`;
            if (!log.has(k)) log.set(k, e);
          }
        }
        if (kind) frames++;
        return kind;
      },
      clear() { battles.clear(); log.clear(); frames = 0; lastUnnamed = []; },
    };
  }

  // ── Auswertung ────────────────────────────────────────────────────────────────────────
  const dayOf = (at) => at.slice(0, 10);
  function mondayOf(at) {
    const d = new Date(`${dayOf(at)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return `${d.toISOString().slice(0, 10)} 00:00:00`;
  }

  function evaluate(collector, opts = {}) {
    const match = opts.match || (() => null);
    // "${at}|${name}" -> Punkte der unlesbaren Mail-Zeile, die dieser Spieler ist (oder null: einfach "war da")
    const present = opts.present || new Map();
    // Identitaet: Mitglied aus lwhub, sonst der Schluessel; nicht zugeordnete Namen fuzzy gegen schon bekannte
    const known = [];
    function identify(name) {
      const m = match(name) || match(flipName(name));
      if (m) return { id: `m:${m.id}`, name: m.name, member: true };
      const k = nameKey(name);
      const hit = known.find((x) => x.key === k || similarity(x.key, k) >= 0.8);
      if (hit) return hit;
      const neu = { id: `k:${k}`, key: k, name, member: false };
      known.push(neu);
      return neu;
    }

    const battles = [...collector.battles.values()].sort((a, b) => a.at.localeCompare(b.at));
    // Team: am selben Tag zuerst B (Mittag), dann A (Abend); ein einzelner Kampf nach der Uhrzeit
    const byDay = new Map();
    for (const b of battles) { if (!byDay.has(dayOf(b.at))) byDay.set(dayOf(b.at), []); byDay.get(dayOf(b.at)).push(b); }
    const entries = [...collector.log.values()].filter((e) => e.action !== 'time').sort((a, b) => a.at.localeCompare(b.at));

    const out = battles.map((b) => {
      const sameDay = byDay.get(dayOf(b.at));
      const team = sameDay.length > 1 ? (sameDay[0] === b ? 'B' : 'A') : (Number(b.at.slice(11, 13)) < 16 ? 'B' : 'A');
      const from = mondayOf(b.at);
      const window = entries.filter((e) => e.at >= from && e.at <= b.at);
      const roster = new Map(); // id -> { name, team, role }
      for (const e of window) {
        const who = identify(e.target);
        if (e.action === 'add') roster.set(who.id, { name: who.name, member: who.member, team: e.team, role: e.role });
        else if (e.action === 'remove' && roster.get(who.id)?.team === e.team) roster.delete(who.id);
      }
      const attended = new Map();
      for (const p of b.players) {
        const who = identify(p.name);
        attended.set(who.id, { name: who.name, member: who.member, points: p.points });
      }
      for (const [id, r] of roster) {
        const k = `${b.at}|${r.name}`;
        if (!attended.has(id) && present.has(k)) attended.set(id, { name: r.name, member: r.member, points: present.get(k) ?? null, manual: true });
      }
      const points = new Set(b.players.map((p) => p.points));
      for (const a of attended.values()) if (a.manual && a.points != null) points.add(a.points);
      // Erst ab zwei Ansichten: ein einmal verlesener Wert ("1026611" statt "4926641") ist keine eigene Zeile
      const unnamed = [...(b.unnamed || [])].filter(([p, u]) => u.seen >= 2 && !points.has(p)).map(([p]) => p).sort((x, y) => y - x);
      const inTeam = [...roster].filter(([, r]) => r.team === team);
      const byPoints = (a, c) => (c.points ?? -1) - (a.points ?? -1) || a.name.localeCompare(c.name);
      const byName = (a, c) => a.name.localeCompare(c.name);
      return {
        at: b.at, team,
        logFrom: window.length ? window[0].at : null,
        logCount: window.length,
        participants: inTeam.filter(([, r]) => r.role === 'member').map(([id, r]) => ({ ...r, attended: attended.has(id), points: attended.get(id)?.points ?? null })).sort(byName),
        substitutes: inTeam.filter(([, r]) => r.role === 'sub').map(([id, r]) => ({ ...r, attended: attended.has(id), points: attended.get(id)?.points ?? null })).sort(byName),
        noShow: inTeam.filter(([id, r]) => r.role === 'member' && !attended.has(id)).map(([, r]) => r).sort(byName),
        // Auf dem Schlachtfeld, aber laut Protokoll nicht (mehr) in diesem Team – meist fehlt Protokoll
        unregistered: [...attended].filter(([id]) => !inTeam.some(([rid]) => rid === id)).map(([, a]) => a).sort(byPoints),
        players: [...attended.values()].sort(byPoints),
        unnamed,
        // Hoechster in mindestens zwei Ansichten gelesener Platz; mehr als erfasst = Zeilen uebersprungen
        lastRank: Math.max(0, ...[...(b.ranks || [])].filter(([, n]) => n >= 2).map(([r]) => r)),
      };
    });
    const allLog = [...collector.log.values()].sort((a, b) => a.at.localeCompare(b.at));
    return { battles: out, logFrom: allLog[0]?.at || null, logTo: allLog[allLog.length - 1]?.at || null, logCount: allLog.length };
  }

  function fmtAt(at) {
    const d = new Date(`${at.slice(0, 10)}T12:00:00`);
    return `${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} ${at.slice(11, 16)}`;
  }

  function reportText(report, alliance = '') {
    const lines = [`🏜 Wüstensturm${alliance ? ` – ${alliance}` : ''}`];
    for (const b of report.battles) {
      const came = b.participants.filter((p) => p.attended).length;
      lines.push('', `⚔ Team ${b.team} (${b.team === 'B' ? 'Mittag' : 'Abend'}) · ${fmtAt(b.at)}`);
      lines.push(`Angemeldet: ${b.participants.length} · davon erschienen: ${came} · auf dem Feld: ${b.players.length + b.unnamed.length}`);
      lines.push(b.noShow.length ? '❌ Angemeldet, aber nicht erschienen:' : '✅ Alle Angemeldeten waren da.');
      for (const p of b.noShow) lines.push(`- ${p.name}`);
      const field = b.players.length + b.unnamed.length;
      if (b.lastRank > field) lines.push(`⚠️ Mail hat ${b.lastRank} Plätze, erfasst sind nur ${field}.`);
      if (b.unnamed.length) lines.push(`❔ Name in der Mail nicht lesbar (Punkte): ${b.unnamed.map((p) => p.toLocaleString('de-DE')).join(', ')}`);
      const subs = b.substitutes.filter((s) => s.attended);
      if (subs.length) lines.push(`🔄 Ersatz eingesprungen: ${subs.map((s) => s.name).join(', ')}`);
    }
    return lines.join('\n');
  }

  return { createCollector, evaluate, reportText, parseTs, parseEntry, nameKey, flipName, detect, fmtAt };
});
