// LWHub – Auswertungen (/stats): SE-Inaktiv und Ergebnis (Rang-Empfehlungen). Die Ansichts-Umschaltung (auView, auShow …) bleibt beim Router in index.html.
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Seiten herauslösen“).
// Normales Script, kein Modul: lädt nach dem großen <script> in index.html und vor assets/js/start.js.

// ── SE INAKTIV AUSWERTUNG ──
async function loadSeInactive() {
  const box = document.getElementById('se-inactive-result');
  const weeks = parseInt(document.getElementById('se-weeks-select')?.value || 4);
  box.innerHTML = '<div class="hint">' + escHtml(tr('Lade …')) + '</div>';
  try {
    const data = await fetchJson(`/se-inactive?weeks=${weeks}`);
    const kwLabel = (w) => `KW ${String(w).slice(2)}`;
    const tooNew = data.too_new || [];
    // Zu neu fuer die Auswertung: grau unter der Tabelle, nicht unter "verpasst"
    const tooNewHtml = tooNew.length
      ? `<div class="hint se-too-new">🆕 ${escHtml(trf('Noch zu neu für die Auswertung (weniger als {n} Wochen dabei):', { n: data.min_weeks || 2 }))} `
        + tooNew.map((p) => `<span data-action="openMemberMe" data-args="${lwArgs(p.name)}" class="se-name-link">${escHtml(p.name)}</span> (${escHtml(tr('seit'))} ${kwLabel(p.since)})`).join(', ')
        + '</div>'
      : '';

    if (!data.inactive || data.inactive.length === 0) {
      box.innerHTML = '<div class="hint se-ok">✓ ' + escHtml(tr('Alle aktiven Mitglieder waren mindestens einmal beim Spezialevent dabei!')) + '</div>' + tooNewHtml;
      return;
    }

    const weekLabels = (data.weeks || []).map(kwLabel);

    // Punkte je Spieler und Woche. Gezaehlt werden nur Wochen, in denen jemand Mitglied war: Schnitt pro
    // Woche statt Summe, damit Neue nicht schlechter dastehen als sie sind.
    const playerPoints = {}; // name → { [yw]: pts, total, count, avg }
    const weekTotals  = {};  // yw → Summe aller Spieler
    (data.weeks || []).forEach(w => { weekTotals[w] = 0; });

    for (const player of data.inactive) {
      let total = 0, count = 0;
      playerPoints[player.name] = {};
      for (const [yw, detail] of Object.entries(player.weeks)) {
        const flags = {};
        if (Array.isArray(detail.flags)) detail.flags.forEach(k => { flags[k] = true; });
        const counts = detail.status === 'se' || detail.status === 'no_se';
        const pts = counts ? calcPoints(flags) : null;
        playerPoints[player.name][yw] = pts;
        if (pts !== null) { total += pts; count++; weekTotals[yw] = (weekTotals[yw] || 0) + pts; }
      }
      Object.assign(playerPoints[player.name], { total, count, avg: count ? Math.round(total / count) : 0 });
    }

    // Aufsteigend nach Punkten pro Woche
    data.inactive.sort((a, b) => (playerPoints[a.name]?.avg ?? 0) - (playerPoints[b.name]?.avg ?? 0));

    let html = `<div class="se-intro">
      ${data.inactive.length} ${escHtml(tr('Spieler ohne Spezialevent-Teilnahme in den letzten'))} ${weeks} ${escHtml(tr('Wochen'))} (${weekLabels.join(', ')}):
    </div>`;
    html += `<table class="se-table">
      <thead><tr>
        <th class="se-cell se-cell-l">${escHtml(tr('Spieler'))}</th>
        ${(data.weeks||[]).map((w,i) => `<th class="se-cell se-cell-c">${weekLabels[i]}<br><span class="se-sub se-sub-normal">${weekTotals[w] ?? 0} Pkt</span></th>`).join('')}
        <th class="se-cell se-cell-c" title="${escHtml(tr('Punkte pro Woche, nur Wochen als Mitglied'))}">${escHtml(tr('Ø / Woche'))}</th>
      </tr></thead><tbody>`;

    const statusIcon = s => {
      if (s === 'se')      return '<span class="se-st-se">✓ SE</span>';
      if (s === 'afk')     return '<span class="se-st-muted">AFK</span>';
      if (s === 'no_se')   return '<span class="se-st-miss">–</span>';
      if (s === 'new')     return `<span class="se-st-muted" title="${escHtml(tr('Noch nicht in der Allianz'))}">${escHtml(tr('neu'))}</span>`;
      if (s === 'missing') return '<span class="se-st-muted">?</span>';
      return '?';
    };

    for (const player of data.inactive) {
      const pp = playerPoints[player.name] || { avg: 0, total: 0, count: 0 };
      // Farbe wie frueher bei 4 Wochen (unter 100 rot, unter 200 gelb), jetzt pro Woche
      const avgCls = pp.avg < 25 ? 'se-avg-low' : pp.avg < 50 ? 'se-avg-mid' : 'se-avg-high';
      const sinceTag = player.since ? ` <span class="se-sub">🆕 ${escHtml(tr('seit'))} ${kwLabel(player.since)}</span>` : '';
      html += `<tr>
        <td class="se-cell">
          <span class="se-player-link" data-action="openMemberMe" data-args="${lwArgs(player.name)}">${escHtml(player.name)}</span>${sinceTag}
        </td>
        ${(data.weeks||[]).map(w => {
          const detail = player.weeks[w] || { status: 'missing' };
          const pts = pp[w];
          const ptsStr = pts !== null && pts !== undefined
            ? `<br><span class="se-sub">${pts} Pkt</span>` : '';
          return `<td class="se-cell se-cell-c">${statusIcon(detail.status)}${ptsStr}</td>`;
        }).join('')}
        <td class="se-cell se-cell-c">
          <span class="se-avg ${avgCls}">${pp.avg}</span>
          <br><span class="se-sub">${escHtml(trf('{t} in {n} Wo.', { t: pp.total, n: pp.count }))}</span>
        </td>
      </tr>`;
    }

    html += '</tbody></table>' + tooNewHtml;
    box.innerHTML = html;
  } catch(e) {
    box.innerHTML = `<div class="hint se-err">${escHtml(tr('Fehler beim Laden:'))} ${escHtml(e?.message || String(e))}</div>`;
  }
}
window.loadSeInactive = loadSeInactive;

// ══════════════════════════════════════════════════════
//  ERGEBNIS-SHEET — Rang-Empfehlungen
// ══════════════════════════════════════════════════════

// Empfehlungslogik:
//   Beförderung: calcRanking(pts, realRank) > realRank in den letzten ≥2 Wochen (nicht AFK)
//   Herabstufung: calcRanking(pts, realRank) < realRank in den letzten >2 Wochen (nicht AFK)
//   AFK in einer relevanten Woche: sperrt die Empfehlung
//   Nur ±1 Schritt, R4/R5 unverändert

function ergebnisRecommend(playerData, weeks) {
  // weeks ist sortiert absteigend (neueste zuerst)
  const realRank = playerData.rank;
  if (realRank >= 4) return { type: 'fixed', label: 'Fixiert (R4/R5)' };

  // Wochenbewertungen: +1=besser, 0=gleich, -1=schlechter; null=missing
  const evals = weeks.map(yw => {
    const e = playerData.entries[yw];
    if (!e || e.missing) return null;
    if (e.afk) return 'afk';
    const pts = calcPoints(e.flags);
    const suggested = calcRanking(pts, realRank);
    if (suggested > realRank) return 'up';
    if (suggested < realRank) return 'down';
    return 'ok';
  });

  // Aufeinanderfolgende Wochen von der neuesten prüfen
  // Zähle, wie viele konsekutive Wochen (von der neuesten) den gleichen Trend haben
  // Ignoriere "missing" Wochen komplett (als wären sie nicht da)
  const meaningful = evals.filter(v => v !== null);

  // AFK-Check: wenn die letzte (neueste) nicht-missing Woche AFK ist → sperren
  const latestNonMissing = meaningful[0];
  if (latestNonMissing === 'afk') return { type: 'afk', label: '⏸ AFK (gesperrt)' };

  // Konsekutive Wochen von vorne (neueste) zählen für 'up' oder 'down'
  // AFK in der Sequenz unterbricht die Zählung
  let upCount = 0, downCount = 0;
  for (const v of meaningful) {
    if (v === 'up') { upCount++; downCount = 0; }
    else if (v === 'down') { downCount++; upCount = 0; }
    else if (v === 'afk') { break; } // AFK unterbricht
    else { upCount = 0; downCount = 0; } // 'ok' setzt zurück
  }

  if (upCount >= 2 && realRank < 3) {
    return { type: 'promote', label: `⬆ Befördern → R${realRank + 1}`, targetRank: realRank + 1 };
  }
  if (downCount > 2 && realRank > 1) {
    return { type: 'demote', label: `⬇ Herabstufen → R${realRank - 1}`, targetRank: realRank - 1 };
  }
  return { type: 'ok', label: '✔ Halten' };
}

function ergebnisWeekCell(entry, realRank, withRank = true) {
  if (!entry || entry.missing) return '<td class="erg-wk erg-wk-missing">—</td>';
  if (entry.afk) return '<td class="erg-wk erg-wk-afk">⏸ AFK</td>';
  const pts = calcPoints(entry.flags);
  if (!withRank) return `<td class="erg-wk">${pts} Pkt</td>`; // Rang nach Beruf: kein Punkte-Rang
  const sug = calcRanking(pts, realRank);
  let colorCls = 'erg-wk-same';
  if (sug > realRank) colorCls = 'erg-wk-up';
  else if (sug < realRank) colorCls = 'erg-wk-down';
  return `<td class="erg-wk ${colorCls}">${pts} Pkt<br><small>R${sug}</small></td>`;
}

async function loadErgebnis() {
  const weeksN = parseInt(document.getElementById('ergebnis-weeks').value, 10) || 4;
  const loading = document.getElementById('ergebnis-loading');
  const empty = document.getElementById('ergebnis-empty');
  const wrap = document.getElementById('ergebnis-table-wrap');
  loading.style.display = 'block';
  empty.style.display = 'none';
  wrap.innerHTML = '';

  let data;
  try {
    data = await api('ranking-history', { weeks: weeksN });
  } catch(err) {
    toast(tr('Fehler: ') + err.message);
    loading.style.display = 'none';
    return;
  }
  loading.style.display = 'none';

  if (!data || !data.players || data.players.length === 0) {
    empty.style.display = 'block';
    return;
  }

  // Hinweis wenn aktuelle KW noch nicht abgeschlossen (Mo–Sa)
  const infoEl = document.getElementById('ergebnis-info');
  if (data.currentKwFiltered) {
    infoEl.style.display = 'block';
    infoEl.textContent = `ℹ KW ${data.currentKw} ${tr('läuft noch und wird erst ab Sonntag in die Bewertung einbezogen.')}`;
  } else {
    infoEl.style.display = 'none';
  }

  const weeks = data.weeks; // absteigend sortiert (neueste zuerst)

  // Rang nach Beruf (oder Punkte-Rang aus): nur die Punkte je Woche, ohne Empfehlung, Farben und Knoepfe
  const withRec = rankByPoints();
  document.getElementById('ergebnis-title').textContent = tr(withRec ? 'Punkte & Rang-Empfehlungen' : 'Punkte-Übersicht');
  document.getElementById('ergebnis-legend').style.display = withRec ? 'flex' : 'none';
  const ptsOf = p => weeks.reduce((sum, yw) => { const e = p.entries[yw]; return sum + (e && !e.missing && !e.afk ? calcPoints(e.flags) : 0); }, 0);

  const rows = data.players.map(p => ({ player: p, rec: ergebnisRecommend(p, weeks), sum: ptsOf(p) }));
  ergebnisState = { rows, weeks, withRec };
  renderErgebnisTable();
}

// Sortierung der Punkte-Tabelle: Klick auf eine Spalte, nochmal = andersherum. 'default' = Empfehlungen
// (Befoerdern, Herabstufen, Rest) bzw. ohne Empfehlungen die meisten Punkte zuerst.
let ergebnisState = null;
let ergebnisSort = { key: 'default', dir: 1 };
function ergebnisSortBy(key) {
  ergebnisSort = ergebnisSort.key === key ? { key, dir: -ergebnisSort.dir } : { key, dir: key === 'name' || key === 'default' ? 1 : -1 };
  renderErgebnisTable();
}
window.ergebnisSortBy = ergebnisSortBy;

function renderErgebnisTable() {
  if (!ergebnisState) return;
  const { rows, weeks, withRec } = ergebnisState;
  const wrap = document.getElementById('ergebnis-table-wrap');
  const recOrder = { promote: 0, demote: 1, afk: 2, ok: 3, fixed: 4 };
  const weekPts = (r, yw) => { const e = r.player.entries[yw]; return e && !e.missing && !e.afk ? calcPoints(e.flags) : -1; };
  const byName = (a, b) => a.player.name.localeCompare(b.player.name, 'de', { sensitivity: 'base' });
  const { key, dir } = ergebnisSort;
  const cmp = key === 'name' ? byName
    : key === 'rank' ? (a, b) => a.player.rank - b.player.rank
    : key === 'sum' ? (a, b) => a.sum - b.sum
    : key === 'rec' ? (a, b) => (recOrder[a.rec.type] ?? 5) - (recOrder[b.rec.type] ?? 5)
    : key.startsWith('kw:') ? (a, b) => weekPts(a, key.slice(3)) - weekPts(b, key.slice(3))
    : withRec ? (a, b) => (recOrder[a.rec.type] ?? 5) - (recOrder[b.rec.type] ?? 5)
    : (a, b) => b.sum - a.sum;
  const sorted = [...rows].sort((a, b) => dir * cmp(a, b) || byName(a, b));

  const th = (k, label, align = 'center') => {
    const arrow = ergebnisSort.key === k ? (ergebnisSort.dir > 0 ? ' ▴' : ' ▾') : '';
    return `<th data-action="ergebnisSortBy" data-args="${lwArgs(k)}" title="${escHtml(tr('Sortieren'))}" class="erg-th erg-th-sort${align === 'left' ? ' erg-th-left' : ''}">${escHtml(label)}${arrow}</th>`;
  };
  let html = `<table class="ergebnis-table">
    <thead>
      <tr>
        ${th('name', tr('Spieler'), 'left')}
        ${th('rank', tr('Echter Rang'))}
        ${weeks.map(yw => th('kw:' + yw, 'KW ' + yw)).join('')}
        ${withRec ? th('rec', tr('Empfehlung')) + `<th class="erg-th">${escHtml(tr('Aktion'))}</th>`
          : th('sum', tr('Summe'))}
      </tr>
    </thead>
    <tbody>`;

  for (const { player, rec, sum } of sorted) {
    const rankCls = 'erg-rank-r' + (RC[player.rank] ? player.rank : 0);
    const recCls = rec.type === 'promote' ? 'erg-rec-promote' : rec.type === 'demote' ? 'erg-rec-demote' : rec.type === 'afk' ? 'erg-rec-afk' : 'erg-rec-other';
    const weekCells = weeks.map(yw => ergebnisWeekCell(player.entries[yw], player.rank, withRec)).join('');

    let actionCell = '<td></td>';
    if (rec.type === 'promote' || rec.type === 'demote') {
      const verb = rec.type === 'promote' ? tr('Befördern') : tr('Herabstufen');
      const btnCls = rec.type === 'promote' ? 'erg-apply-promote' : 'erg-apply-demote';
      const esc = player.name.replace(/'/g, "\\'");
      actionCell = `<td class="erg-td-c">
        <button data-action="ergebnisApply" data-args="${lwArgs(player.name, rec.targetRank)}"
          class="erg-apply-btn ${btnCls}">
          ${verb} → R${rec.targetRank}
        </button>
      </td>`;
    }

    html += `<tr class="erg-row">
      <td class="erg-name">${player.name}</td>
      <td class="erg-rank ${rankCls}">R${player.rank} · ${RL[player.rank]||''}</td>
      ${weekCells}
      ${withRec ? `<td class="erg-rec ${recCls}">${rec.label}</td>
      ${actionCell}` : `<td class="erg-sum">${sum} Pkt</td>`}
    </tr>`;
  }

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

async function ergebnisApply(name, targetRank) {
  const player = { name, realRank: PREV[name] || 3 };
  const rankLabel = RL[targetRank] || `R${targetRank}`;
  const direction = targetRank > (PREV[name] || 3) ? tr('befördern') : tr('herabstufen');

  const confirmed = window.confirm(
    `${tr('Bestätigung erforderlich:')}\n\n` +
    `${tr('Ich habe Spieler')} "${name}" ingame ${tr('auf Rang')} ${targetRank} (${rankLabel}) ${direction}.\n\n` +
    `${tr('Soll der Rang jetzt auch im Tool aktualisiert werden?')}`
  );
  if (!confirmed) return;

  const confirmation = `ingame-confirmed:${name}→R${targetRank}`;
  try {
    await fetchJson('/apply-rank-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, newRank: targetRank, confirmation })
    });
    toast(`${name} ${tr('wurde auf')} R${targetRank} (${rankLabel}) ${tr('gesetzt.')}`);
    PREV[name] = targetRank;
    await loadMembers();
    await loadErgebnis();
  } catch(err) {
    toast(tr('Fehler: ') + err.message);
  }
}
window.loadErgebnis = loadErgebnis;
window.ergebnisApply = ergebnisApply;
