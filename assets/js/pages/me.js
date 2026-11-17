// LWHub – Mein Bereich (/me) mit Verlauf, Potenzial und eigenem Beruf
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html). Normales Script, kein Modul:
// alles bleibt global wie vorher. Die Reihenfolge der <script>-Tags in index.html ist die Ladereihenfolge.

// ── MEIN BEREICH ──
let meHistoryBundle = null;
let meSelectedWeekIndex = 0;
let meActiveMemberName = '';
let meHistoryLoaded = false;
let meViewingOther = false; // true when viewing another member via Verwaltung

function me_buildAvatarMarkup() {
  const avatarUrl = meHistoryBundle?.member?.discord_avatar_url || null;
  if (avatarUrl) return `<img src="${escHtml(avatarUrl)}" alt="Discord Avatar">`; // Maße/Rahmen über #member-avatar-wrap img in app.css
  const initials = String(meHistoryBundle?.member?.name || meHistoryBundle?.member?.member_name || meActiveMemberName || '?').trim().slice(0, 2).toUpperCase();
  return `<div class="me-placeholder">${escHtml(initials || '?')}</div>`;
}
function me_getSelectedWeek() { return meHistoryBundle?.weeks?.[meSelectedWeekIndex] || null; }
function me_getPreviousWeek() { return meHistoryBundle?.weeks?.[meSelectedWeekIndex + 1] || null; }

function computeFlagImpact(key, flags) {
  const base = calcPoints(flags);
  const without = { ...flags, [key]: false };
  return base - calcPoints(without);
}
function computeFlagPotential(key, flags) {
  const base = calcPoints(flags);
  const with_ = { ...flags, [key]: true };
  return calcPoints(with_) - base;
}
function formatWeek(yearWeek) {
  if (!yearWeek) return '----';
  const yy = String(Math.floor(yearWeek / 100)).padStart(2, '0');
  const ww = String(yearWeek % 100).padStart(2, '0');
  return `KW ${ww}/${yy}`;
}
function formatWhen(value) {
  if (!value) return 'unbekannt';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('de-DE');
}

async function me_loadHistory(discordId, memberName) {
  meActiveMemberName = memberName || authMember?.member_name || '';
  meBerufPending = null;
  try {
    await ensureCoreDataLoaded({ forceEntries: !entries.length });
    const params = new URLSearchParams(); // Anzahl Wochen: Allianz-Einstellung history_weeks (Server)
    if (discordId) params.set('discord_id', discordId);
    if (meActiveMemberName) params.set('name', meActiveMemberName);
    meHistoryBundle = await fetchJson(`/member-history?${params.toString()}`);
    meHistoryLoaded = true;
    me_renderOverview();
  } catch(e) {
    meHistoryLoaded = true; // don't retry on error
  }
}

function me_renderOverview() {
  if (!meHistoryBundle) return;
  const member = meHistoryBundle.member;
  const memberName = member.name || member.member_name || 'Unbekannt';
  const weeks = meHistoryBundle.weeks || [];
  const selected = me_getSelectedWeek();
  const latest = weeks[0] || null;
  const selectedPoints = selected ? calcPoints(selected.flags || {}) : 0;

  document.getElementById('member-avatar-wrap').innerHTML = me_buildAvatarMarkup();
  document.getElementById('member-name').textContent = memberName;
  const discordName = member.discord_username || (meViewingOther ? null : authMember?.discord_username) || null;
  const checkedAt = meViewingOther ? (meHistoryBundle?.weeks?.[0]?.updated_at || null) : authMember?.checked_at;
  document.getElementById('member-meta').textContent =
    (discordName ? discordName + ' · ' : '') + tr('letzter Abgleich') + ' ' + formatWhen(checkedAt);

  document.getElementById('member-badges').innerHTML =
    `<span class="me-badge me-badge-rank-${RC[member.rank] ? member.rank : 'x'}">R${member.rank} · ${RL[member.rank] || 'Member'}</span>`;

  document.getElementById('stat-points').textContent = String(selectedPoints);
  document.getElementById('stat-rank-display').textContent = `R${member.rank} · ${RL[member.rank] || 'Member'}`;
  document.getElementById('stat-week').textContent = selected ? formatWeek(selected.year_week).replace('KW ', '') : '-';
  document.getElementById('timeline-sub').textContent = `${weeks.length} ${tr('Wochen gespeichert - Woche anklicken zum Wechsel')}`;

  me_renderWeekPanel();
  me_renderActivities();
  me_renderPotential();
  me_renderTimeline();
  me_renderChanges();
  renderMeBerufe();
}

function me_renderWeekPanel() {
  const weeks = meHistoryBundle?.weeks || [];
  const selected = me_getSelectedWeek();
  const previous = me_getPreviousWeek();
  const points = selected ? calcPoints(selected.flags || {}) : 0;
  const prevPoints = previous ? calcPoints(previous.flags || {}) : null;
  const delta = prevPoints == null ? null : points - prevPoints;
  const flags = selected ? Object.keys(selected.flags || {}).filter(k => selected.flags[k]) : [];

  const select = document.getElementById('week-select');
  if (!select) return;
  select.innerHTML = weeks.map((w, i) =>
    `<option value="${i}"${i === meSelectedWeekIndex ? ' selected' : ''}>${escHtml(formatWeek(w.year_week))}</option>`
  ).join('');
  select.onchange = () => { meSelectedWeekIndex = Number.parseInt(select.value, 10) || 0; me_renderOverview(); };

  const prevBtn = document.getElementById('week-prev');
  const nextBtn = document.getElementById('week-next');
  if (prevBtn) prevBtn.disabled = meSelectedWeekIndex >= weeks.length - 1;
  if (nextBtn) nextBtn.disabled = meSelectedWeekIndex <= 0;

  document.getElementById('week-sub').textContent = selected
    ? `${formatWeek(selected.year_week)} · ${points} ${tr('Punkte')}` : tr('Noch keine Woche ausgewählt');

  const rankChangeBadge = document.getElementById('rank-change-badge');
  if (selected && previous && selected.final_rank !== previous.final_rank) {
    const better = selected.final_rank < previous.final_rank;
    rankChangeBadge.style.display = 'block';
    rankChangeBadge.innerHTML = `<span class="me-badge ${better ? 'me-badge-rank-up' : 'me-badge-rank-down'}">R${previous.final_rank} → R${selected.final_rank}</span>`;
  } else {
    rankChangeBadge.style.display = 'none';
  }

  const deltaEl = document.getElementById('week-delta');
  if (delta === null) { deltaEl.textContent = '–'; deltaEl.className = 'me-delta-value neutral'; }
  else if (delta >= 0) { deltaEl.textContent = `+${delta}`; deltaEl.className = 'me-delta-value positive'; }
  else { deltaEl.textContent = String(delta); deltaEl.className = 'me-delta-value negative'; }

  const good = flags.filter(k => !DANGER.has(k) && !NEUTRAL.has(k)).length;
  const warn = flags.filter(k => DANGER.has(k)).length;
  document.getElementById('week-good').textContent = String(good);
  document.getElementById('week-warn').textContent = String(warn);
}

function me_renderActivities() {
  const selected = me_getSelectedWeek();
  const flags = selected ? selected.flags || {} : {};
  const allSet = Object.keys(flags).filter(k => flags[k]);

  document.getElementById('acts-title').textContent = selected
    ? `${tr('s_aktivitaeten')} – ${formatWeek(selected.year_week)}` : tr('s_aktivitaeten_dieser_woche');
  document.getElementById('acts-sub').textContent = selected
    ? tr('s_was_hat_dir_punkte_gebracht_oder_genommen') : tr('s_keine_woche_geladen');

  const positives = allSet
    .filter(k => !DANGER.has(k) && !NEUTRAL.has(k))
    .map(k => ({ key: k, impact: computeFlagImpact(k, flags) }))
    .filter(x => x.impact !== 0).sort((a, b) => b.impact - a.impact);
  const negatives = allSet
    .filter(k => DANGER.has(k))
    .map(k => ({ key: k, impact: computeFlagImpact(k, flags) }))
    .sort((a, b) => a.impact - b.impact);

  const posEl = document.getElementById('acts-positive');
  const negEl = document.getElementById('acts-negative');
  posEl.innerHTML = positives.length
    ? positives.map(({ key, impact }) => {
        const cls = NEUTRAL.has(key) ? 'neutral' : AMBER.has(key) ? 'bonus' : 'good';
        const ptsCls = NEUTRAL.has(key) ? 'neu' : AMBER.has(key) ? 'bon' : 'pos';
        return `<div class="me-act-item ${cls}"><span>${escHtml(LBL[key] || key)}</span><span class="me-act-pts ${ptsCls}">+${impact}</span></div>`;
      }).join('')
    : '<div class="me-empty">' + escHtml(tr('s_keine_positiven_eintraege_diese_woche')) + '</div>';
  negEl.innerHTML = negatives.length
    ? negatives.map(({ key, impact }) =>
        `<div class="me-act-item bad"><span>${escHtml(LBL[key] || key)}</span><span class="me-act-pts neg">${impact}</span></div>`
      ).join('')
    : '<div class="me-empty me-empty-good">' + escHtml(tr('s_keine_strafpunkte_diese_woche')) + '</div>';
}

function me_renderPotential() {
  const selected = me_getSelectedWeek();
  const flags = selected ? selected.flags || {} : {};
  const allKnownKeys = Object.keys(LBL);
  const opportunities = allKnownKeys
    .filter(k => !flags[k] && !DANGER.has(k) && !NEUTRAL.has(k))
    .map(k => ({ key: k, gain: computeFlagPotential(k, flags) }))
    .filter(o => o.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);

  const section = document.getElementById('potential-section');
  const grid = document.getElementById('potential-grid');
  if (!selected || !opportunities.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  grid.innerHTML = opportunities.map(({ key, gain }) => `
    <div class="me-potential-card">
      <div class="me-potential-card-label">+${gain} ${tr('Punkte möglich')}</div>
      <div class="me-potential-card-name">${escHtml(LBL[key] || key)}</div>
      <div class="me-potential-card-gain">+${gain}</div>
    </div>`).join('');
}

function me_renderTimeline() {
  const weeks = meHistoryBundle?.weeks || [];
  const maxPoints = weeks.reduce((max, w) => Math.max(max, calcPoints(w.flags || {})), 1);
  const timeline = document.getElementById('timeline');
  if (!weeks.length) { timeline.innerHTML = '<div class="me-empty">Noch keine Wochenhistorie vorhanden.</div>'; return; }
  timeline.innerHTML = weeks.map((week, index) => {
    const points = calcPoints(week.flags || {});
    const prev = weeks[index + 1] || null;
    const delta = prev ? points - calcPoints(prev.flags || {}) : null;
    return `<button class="me-timeline-row${index === meSelectedWeekIndex ? ' active' : ''}" type="button" data-action="meSelectWeek" data-args="[${index}]">
      <div>
        <div class="me-timeline-week">${escHtml(formatWeek(week.year_week))}</div>
        <div class="me-timeline-meta">R${week.final_rank} · ${RL[week.final_rank] || 'Member'}</div>
      </div>
      <div>
        <div class="me-bar-track"><div class="me-bar-fill" data-css="width:${Math.max(8, Math.round((points / maxPoints) * 100))}%"></div></div>
        <div class="me-timeline-meta">${Object.keys(week.flags || {}).filter(k => week.flags[k]).length} ${tr('aktive Felder')}</div>
      </div>
      <div class="me-timeline-score">
        <strong>${points}</strong>
        <span>${delta == null ? tr('erste Woche') : `${delta >= 0 ? '+' : ''}${delta} ${tr('zur Vorwoche')}`}</span>
      </div>
    </button>`;
  }).join('');
}

function me_renderChanges() {
  const changes = meHistoryBundle?.rank_changes || [];
  const details = document.getElementById('changelog-details');
  const wrap = document.getElementById('change-log');
  if (!changes.length) { details.style.display = 'none'; return; }
  details.style.display = 'block';
  wrap.innerHTML = changes.map(change => `
    <div class="me-change-row">
      <div class="me-change-top">
        <div class="me-change-source">${escHtml(change.source || 'system')}</div>
        <div class="me-change-when">${escHtml(formatWhen(change.created_at))}</div>
      </div>
      <div class="me-change-body">
        ${change.old_rank ? `R${change.old_rank}` : 'neu'} → R${change.applied_rank}
        ${change.requested_rank && change.requested_rank !== change.applied_rank ? `(angefragt: R${change.requested_rank})` : ''}
        ${change.is_blocked ? ' · ' + escHtml(tr('s_geschuetzt_blockiert')) : ''}
        ${change.reason ? ` · ${escHtml(change.reason)}` : ''}
      </div>
    </div>`).join('');
}

function meSelectWeek(index) { meSelectedWeekIndex = index; me_renderOverview(); }

function meStepWeek(delta) {
  const next = meSelectedWeekIndex - delta;
  if (!meHistoryBundle?.weeks?.[next]) return;
  meSelectedWeekIndex = next; me_renderOverview();
}

// ── BERUFE (Mein Bereich) ──
let meBerufPending = null; // { beruf, medHilfe, winwin }

function renderMeBerufe() {
  const section = document.getElementById('me-berufe-section');
  if (!section) return;

  const content = document.getElementById('me-berufe-content');
  if (!content) return;

  const targetName = meActiveMemberName || authMember?.member_name || '';
  const meta = memberMeta[targetName] || {};
  const member = meHistoryBundle?.member || {};
  const hasBerufData = !!(
    meta.beruf || member.beruf ||
    meta.berufMedHilfe || member.beruf_med_hilfe ||
    meta.berufWinwin || member.beruf_winwin
  );
  if (!isFeatureEnabled('berufe') && !hasBerufData) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block'; // explizit: Klasse me-berufe-section versteckt

  const beruf    = meBerufPending?.beruf    !== undefined ? meBerufPending.beruf    : (meta.beruf ?? member.beruf ?? null);
  const medHilfe = meBerufPending?.medHilfe !== undefined ? meBerufPending.medHilfe : !!(meta.berufMedHilfe ?? member.beruf_med_hilfe);
  const winwin   = meBerufPending?.winwin   !== undefined ? meBerufPending.winwin   : (meta.berufWinwin ?? member.beruf_winwin ?? null);
  const maxEngineers = getBerufeMaxEngineers();

  const kriegsherren = members.filter(n => memberMeta[n]?.beruf === 'kriegsherr' && n !== targetName).sort();

  const opts = [
    { value: null,         label: tr('Kein Beruf'),  icon: '—',  cls: '' },
    { value: 'ingenieur',  label: tr('Ingenieur'),   icon: '👷',  cls: '' },
    { value: 'kriegsherr', label: tr('Kriegsanführer'),  icon: '⚔',  cls: 'kriegsherr' },
  ];

  let html = `<div class="me-beruf-picker">`;
  for (const opt of opts) {
    const active = beruf === opt.value;
    html += `<button class="me-beruf-btn${active ? ` active ${opt.cls}` : ''}" type="button" data-action="meBerufSelect" data-args="${lwArgs(opt.value)}">${escHtml(opt.icon)} ${escHtml(opt.label)}</button>`;
  }
  html += `</div>`;

  if (beruf === 'ingenieur') {
    html += `<div class="me-beruf-sub">
      <label class="me-beruf-toggle">
        <input type="checkbox" id="me-medhilfe-cb" ${medHilfe ? 'checked' : ''}>
        <span>🏥 ${escHtml(tr('Medizinische Hilfe'))}</span>
      </label>
    </div>
    <div class="me-beruf-sub">
      <div class="me-beruf-sub-label">⚡ ${escHtml(tr('Win-Win Kriegsanführer'))}</div>
      ${kriegsherren.length
        ? `<select class="me-beruf-select" id="me-winwin-sel">
            <option value="">${escHtml(tr('— keiner —'))}</option>
            ${kriegsherren.map(n => `<option value="${escHtml(n)}"${n === winwin ? ' selected' : ''}>${escHtml(n)}</option>`).join('')}
          </select>`
        : `<div class="me-beruf-info">${escHtml(tr('Noch keine Kriegsanführer in der Allianz vorhanden.'))}</div>`
      }
    </div>`;
  } else if (beruf === 'kriegsherr') {
    const myIngenieure = members.filter(n => memberMeta[n]?.berufWinwin === targetName);
    if (myIngenieure.length) {
      html += `<div class="me-beruf-info">${escHtml(tr('Ingenieure im Win-Win'))}: ${myIngenieure.map(n => escHtml(n)).join(', ')} (${myIngenieure.length}/${maxEngineers})</div>`;
    } else {
      html += `<div class="me-beruf-info">${escHtml(tr('Noch keine Ingenieure haben dich als Win-Win gewählt.'))}</div>`;
    }
  }

  html += `<button class="v-btn save me-beruf-save" type="button" data-action="saveMeBeruf">✓ ${escHtml(tr('Speichern'))}</button>`;
  content.innerHTML = html;
}
window.renderMeBerufe = renderMeBerufe;

function meBerufSelect(beruf) {
  if (!meBerufPending) {
    const targetName = meActiveMemberName || authMember?.member_name || '';
    const meta = memberMeta[targetName] || {};
    const member = meHistoryBundle?.member || {};
    meBerufPending = {
      beruf: meta.beruf ?? member.beruf ?? null,
      medHilfe: !!(meta.berufMedHilfe ?? member.beruf_med_hilfe),
      winwin: meta.berufWinwin ?? member.beruf_winwin ?? null,
    };
  }
  meBerufPending.beruf = beruf;
  if (beruf !== 'ingenieur') { meBerufPending.medHilfe = false; meBerufPending.winwin = null; }
  renderMeBerufe();
}

async function saveMeBeruf() {
  const targetName = meActiveMemberName || authMember?.member_name || '';
  const meta = memberMeta[targetName] || {};
  const beruf    = meBerufPending?.beruf !== undefined ? meBerufPending.beruf : (meta.beruf ?? null);
  const medHilfe = beruf === 'ingenieur' ? (document.getElementById('me-medhilfe-cb')?.checked ? 1 : 0) : 0;
  const winwin   = beruf === 'ingenieur' ? (document.getElementById('me-winwin-sel')?.value || null) : null;
  try {
    await apiPost({ action: 'save_beruf', name: targetName, beruf, med_hilfe: medHilfe, winwin });
    meBerufPending = null;
    await loadMembers();
    renderMeBerufe();
    if (document.getElementById('page-v')?.classList.contains('active')) {
      renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
    }
    toast(tr('Beruf gespeichert!'));
  } catch(err) { toast(tr('Fehler: ') + err.message); }
}
