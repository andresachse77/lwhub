// LWHub – Zug: Planer für R4 (/train/plan) und Ansicht für alle (/train)
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Seiten herauslösen“).
// Normales Script, kein Modul: lädt nach dem großen <script> in index.html und vor assets/js/start.js.

// ══════════════════════════════════════════════════════════════════════════════
// ZUG-PLANER
// ══════════════════════════════════════════════════════════════════════════════
(function(){
  let zugWindowStart  = null;   // 'YYYY-MM-DD' Monday of first visible week
  let zugSchedule     = [];     // entries loaded for current window
  let zugQueue        = [];     // queue rows
  let zugRulesets     = [];     // kept for compatibility, UI is fixed to standard
  let zugActiveRuleset= 'standard';
  let zugOpenEntry      = null;   // the schedule entry being edited
  let zugOpenDate       = null;   // the date string being acted on
  let zugDragMember     = null;   // member name being dragged from queue
  let zugDragSourceDate = null;   // date string of calendar cell being dragged

  // Farben je Status: dieselben Werte stehen als .zug-status-<status> in app.css (kein style-Attribut wegen CSP)
  const STATUS_COLOR = {
    planned:   'rgba(74,158,255,0.55)',
    completed: 'rgba(46,203,122,0.65)',
    noshow:    'rgba(224,85,69,0.65)',
    cancelled: 'rgba(100,100,100,0.45)',
  };
  const STATUS_LABEL = { planned:'Geplant', completed:'Abgeschlossen', noshow:'No-Show', cancelled:'Abgesagt' };
  // Klasse für den Hintergrund eines Kalendertags: unbekannter Status wie „geplant“, ohne Eintrag keiner
  function zugStatusClass(entry) {
    if (!entry) return '';
    return ' zug-status-' + (STATUS_COLOR[entry.status] ? entry.status : 'planned');
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  function zugMonthStart(ym) {
    const [y,m] = ym.split('-').map(Number);
    return new Date(y, m-1, 1);
  }
  function zugMonthLabel(ym) {
    const d = zugMonthStart(ym);
    return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }
  function isoWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay() || 7;
    d.setDate(d.getDate() + 4 - day);
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  // ── golden train SVG icon ──────────────────────────────────────────────────
  function zugSvg(size) {
    size = size || 16;
    const w = Math.round(size * 1.9);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size}" viewBox="0 0 38 20" class="zug-svg">`
      // smoke puffs
      + `<circle cx="9" cy="2.2" r="2" fill="rgba(255,255,255,0.42)"/>`
      + `<circle cx="13.5" cy="0.9" r="1.2" fill="rgba(255,255,255,0.28)"/>`
      // chimney
      + `<rect x="6.5" y="3" width="4" height="4.5" rx="0.8" fill="#B87300"/>`
      // boiler (main cylinder)
      + `<rect x="1" y="6.5" width="22" height="9" rx="4" fill="#F0A500"/>`
      // boiler shine
      + `<rect x="2" y="7.2" width="19" height="3.2" rx="2" fill="rgba(255,230,90,0.38)"/>`
      // cab body
      + `<rect x="19" y="3.5" width="10" height="12" rx="1.5" fill="#D4890A"/>`
      // cab roof
      + `<rect x="18" y="2.2" width="12" height="2.5" rx="1" fill="#B87300"/>`
      // window
      + `<rect x="21" y="5" width="5" height="4" rx="1" fill="#87CEEB" opacity="0.88"/>`
      // window glare
      + `<rect x="21.5" y="5.3" width="1.5" height="1" rx="0.5" fill="rgba(255,255,255,0.6)"/>`
      // front coupler
      + `<rect x="0" y="10.8" width="2" height="2.5" rx="0.4" fill="#9A6200"/>`
      // big drive wheel
      + `<circle cx="8.5" cy="17" r="3.4" fill="#9A6200" stroke="#F0C040" stroke-width="1.1"/>`
      + `<circle cx="8.5" cy="17" r="1.3" fill="#C8820A"/>`
      // spokes
      + `<line x1="8.5" y1="13.6" x2="8.5" y2="20.4" stroke="#C8820A" stroke-width="0.7"/>`
      + `<line x1="5.1" y1="15" x2="11.9" y2="19" stroke="#C8820A" stroke-width="0.7"/>`
      + `<line x1="5.1" y1="19" x2="11.9" y2="15" stroke="#C8820A" stroke-width="0.7"/>`
      // small front wheel
      + `<circle cx="3" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/>`
      // rear wheels
      + `<circle cx="21" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/>`
      + `<circle cx="27" cy="17.5" r="1.9" fill="#9A6200" stroke="#EAB800" stroke-width="0.85"/>`
      // connecting rod
      + `<rect x="3" y="16.3" width="25" height="1.5" rx="0.5" fill="#9A6200" opacity="0.6"/>`
      + `</svg>`;
  }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function getDiscordId() { return authMember?.discord_id || ''; }
  function isHonorReadOnlyUser() { return !!(authMember?.read_only || authMember?.honor_role); }

  // ── API calls ──────────────────────────────────────────────────────────────
  async function zugApiFetch(path, opts={}) {
    return fetchJson(path, opts);
  }

  async function zugLoadRulesets() {
    try {
      const d = await zugApiFetch('/zug/rulesets');
      if (d.ok) zugRulesets = d.rulesets || [];
    } catch(e) { console.warn('zugLoadRulesets', e); }
  }

  async function zugLoadQueue() {
    try {
      const d = await zugApiFetch(`/zug/queue?ruleset=${encodeURIComponent(zugActiveRuleset)}`);
      if (d.ok) zugQueue = d.queue || [];
    } catch(e) { console.warn('zugLoadQueue', e); }
  }

  // Returns 'YYYY-MM-DD' of the ISO Monday of the week containing dateStr
  function getMondayOfWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7; // Mon=0
    d.setDate(d.getDate() - dow);
    const _p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${_p(d.getMonth()+1)}-${_p(d.getDate())}`;
  }

  // Load schedule entries for all months that overlap with a weekCount-week window
  async function zugLoadScheduleForWindow(windowStart, weekCount) {
    const months = new Set();
    const _p = n => String(n).padStart(2,'0');
    for (let w = 0; w <= weekCount; w++) {
      const d = new Date(windowStart + 'T00:00:00');
      d.setDate(d.getDate() + w * 7);
      months.add(d.getFullYear() + '-' + _p(d.getMonth()+1));
      const dEnd = new Date(d); dEnd.setDate(dEnd.getDate() + 6);
      months.add(dEnd.getFullYear() + '-' + _p(dEnd.getMonth()+1));
    }
    const results = await Promise.all([...months].map(mo =>
      zugApiFetch(`/zug/schedule?month=${encodeURIComponent(mo)}`).catch(() => ({ok:false}))
    ));
    const seen = new Set();
    zugSchedule = [];
    for (const d of results) {
      if (!d.ok) continue;
      for (const e of (d.entries || [])) {
        const k = e.event_date + '|' + e.ruleset_key;
        if (!seen.has(k)) { seen.add(k); zugSchedule.push(e); }
      }
    }
  }

  // ── main entry point ───────────────────────────────────────────────────────
  window.zugLoadPage = async function() {
    zugActiveRuleset = 'standard';
    if (!zugWindowStart) zugWindowStart = getMondayOfWeek(todayStr());
    const weekCount = zugCalWeekCount();
    await Promise.all([zugLoadQueue(), zugLoadScheduleForWindow(zugWindowStart, weekCount)]);
    zugRenderCalendar();
    zugRenderQueue();
  };

  window.zugOnRulesetChange = async function() {
    zugActiveRuleset = 'standard';
    await zugLoadQueue();
    zugRenderQueue();
    zugRenderCalendar();
  };

  window.zugNavWeek = async function(delta) {
    const d = new Date(zugWindowStart + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    const _p = n => String(n).padStart(2,'0');
    zugWindowStart = `${d.getFullYear()}-${_p(d.getMonth()+1)}-${_p(d.getDate())}`;
    const weekCount = zugCalWeekCount();
    await zugLoadScheduleForWindow(zugWindowStart, weekCount);
    zugRenderCalendar();
  };

  window.zugNavToday = async function() {
    zugWindowStart = getMondayOfWeek(todayStr());
    const weekCount = zugCalWeekCount();
    await zugLoadScheduleForWindow(zugWindowStart, weekCount);
    zugRenderCalendar();
  };

  window.zugSyncQueue = async function() {
    if (isHonorReadOnlyUser()) { toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.')); return; }
    const btn = document.getElementById('zug-sync-btn');
    if (btn) btn.textContent = '…';
    try {
      const d = await zugApiFetch('/zug/queue/sync', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ discord_id: getDiscordId(), ruleset: 'standard' })
      });
      if (d.ok) { zugQueue = d.queue || []; zugRenderQueue(); toast('Queue synchronisiert'); }
      else toast(d.error || 'Fehler', 'err');
    } catch(e) { toast(tr('Fehler: ') + e.message, 'err'); }
    if (btn) btn.textContent = '⟳ Queue sync';
  };

  function zugArrangePanels() {
    const wrap = document.getElementById('zug-cal-panel')?.parentElement;
    const cal = document.getElementById('zug-cal-panel');
    const queue = document.getElementById('zug-queue-panel');
    const planned = document.getElementById('zug-planned-panel');
    if (!wrap || !cal || !queue || !planned) return;
    if (window.innerWidth <= 900) {
      if (cal.nextElementSibling !== planned) {
        wrap.insertBefore(planned, queue);
      }
      return;
    }
    if (queue.nextElementSibling !== planned) {
      wrap.insertBefore(planned, queue.nextElementSibling);
    }
  }

  // ── render: ruleset select ─────────────────────────────────────────────────
  function zugRenderRulesetSelect() {
    return;
  }

  // ── render: calendar ───────────────────────────────────────────────────────
  // How many week columns fit in the calendar panel at current width
  function zugCalWeekCount() {
    const grid = document.getElementById('zug-cal-grid');
    const DAY_COL_W = 36;
    const MIN_CELL_W = 120; // ~30% more than the read-only view (90px)
    const containerW = (grid ? grid.offsetWidth : 0) || (window.innerWidth - 64);
    return Math.max(1, Math.floor((containerW - DAY_COL_W) / MIN_CELL_W));
  }

  function zugRenderCalendar() {
    const titleEl = document.getElementById('zug-cal-title');
    const grid    = document.getElementById('zug-cal-grid');
    if (!titleEl || !grid) return;

    const today = todayStr();
    const weekCount = zugCalWeekCount();

    // Build the weeks array from zugWindowStart
    const _p = n => String(n).padStart(2,'0');
    const weeks = [];
    for (let w = 0; w < weekCount; w++) {
      const weekStart = new Date(zugWindowStart + 'T00:00:00');
      weekStart.setDate(weekStart.getDate() + w * 7);
      const week = [];
      for (let d = 0; d < 7; d++) {
        const dd = new Date(weekStart); dd.setDate(dd.getDate() + d);
        week.push(dd.getFullYear() + '-' + _p(dd.getMonth()+1) + '-' + _p(dd.getDate()));
      }
      weeks.push(week);
    }

    // Title: "KW N – KW M (YYYY)"
    const firstKw = isoWeek(weeks[0][0]);
    const lastKw  = isoWeek(weeks[weeks.length - 1][0]);
    const pivotDate = weeks[Math.floor(weeks.length / 2)][3]; // Thursday of middle week → ISO year
    const titleYear = new Date(pivotDate + 'T00:00').getFullYear();
    titleEl.innerHTML = zugSvg(16) + ' KW\u00a0' + firstKw + '\u2013KW\u00a0' + lastKw + ' (' + titleYear + ')';

    // Index entries by date (active ruleset)
    const byDate = {};
    for (const e of zugSchedule) {
      if (e.ruleset_key === zugActiveRuleset || zugActiveRuleset === 'all') byDate[e.event_date] = e;
    }
    const byDateAll = {};
    for (const e of zugSchedule) { (byDateAll[e.event_date] = byDateAll[e.event_date] || []).push(e); }

    // Transposed layout: rows = weekdays (Mo–So), columns = calendar weeks
    const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    // Breite der Tages-Spalte (36px) steht in .zug-cal-daycol
    let html = '<table class="zug-cal-table">';
    html += '<colgroup><col class="zug-cal-daycol">';
    for (let i = 0; i < weeks.length; i++) html += '<col>';
    html += '</colgroup>';

    // Header row: corner + one KW-header per week (with mail button)
    html += '<thead><tr><th class="zug-cal-corner"></th>';
    for (const week of weeks) {
      const kw = isoWeek(week[0]);
      const kwYear = new Date(week[3] + 'T00:00').getFullYear();
      const mailLines = ['KW' + kw + ' (' + kwYear + ') \u2013 W\u00f6chentliche Schaffner-Bestimmung', ''];
      for (const ds of week) {
        const e = byDate[ds];
        const d = new Date(ds + 'T00:00');
        const dayName = d.toLocaleDateString('de-DE', {weekday:'long'});
        const dayNum  = d.toLocaleDateString('de-DE', {day:'numeric', month:'numeric'});
        mailLines.push(e
          ? dayName + ' (' + dayNum + '): ' + e.schaffner_name + (e.vip_name ? '  |  VIP: ' + e.vip_name : '')
          : dayName + ' (' + dayNum + '): \u2014');
      }
      const mailAttr = mailLines.join('\n').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html += '<th class="zug-cal-kw-head">'
        + '<div class="zug-cal-kw-text zug-cal-kw-label">KW ' + kw + '</div>'
        + '<button data-mailtext="' + mailAttr + '" data-action="zugCopyMail" data-args="' + lwArgs(LW_EL) + '" class="zug-cal-mail-btn" title="Mail-Text f\u00fcr KW ' + kw + ' kopieren">\u2709 Mail</button>'
        + '</th>';
    }
    html += '</tr></thead><tbody>';

    // 7 rows: one per weekday
    for (let dow = 0; dow < 7; dow++) {
      const isWeekend = dow >= 5;
      html += '<tr><td class="zug-cal-dow' + (isWeekend ? ' is-weekend' : '') + '">' + DAY_NAMES[dow] + '</td>';
      for (const week of weeks) {
        const dateStr = week[dow];
        const dayNum = parseInt(dateStr.slice(8));
        const isToday = dateStr === today;
        const entry = byDate[dateStr];
        const allEntries = byDateAll[dateStr] || [];
        const isPlanned = entry && entry.status === 'planned';
        let inner = '<div class="zug-cal-daynum zug-cal-daynum-row' + (isToday ? ' is-today' : '') + '">'
          + '<span>' + dayNum + '</span>'
          + (isPlanned ? '<span class="zug-cal-grip">\u28bf</span>' : '')
          + '</div>';
        if (entry) {
          inner += '<div class="zug-cal-name" title="' + escHtml(entry.schaffner_name) + '">' + zugSvg(12) + ' ' + escHtml(entry.schaffner_name) + '</div>';
          if (entry.vip_name) inner += '<div class="zug-cal-vip" title="' + escHtml(entry.vip_name) + '">\u2b50 ' + escHtml(entry.vip_name) + '</div>';
        } else if (allEntries.length) {
          inner += '<div class="zug-cal-others">' + allEntries.length + ' and. RW</div>';
        }
        const draggable = isPlanned ? 'draggable="true" data-on-dragstart="zugCalDragStart" data-args-dragstart="' + lwArgs(LW_EVENT, dateStr) + '"' : '';
        html += '<td ' + draggable + ' data-action="zugDayClick" data-args="' + lwArgs(dateStr) + '" data-on-dragover="zugDragOver" data-args-dragover="' + lwArgs(LW_EVENT, LW_EL) + '" data-on-dragleave="zugDragLeave" data-args-dragleave="' + lwArgs(LW_EL, String(isToday)) + '" data-on-drop="zugHandleDrop" data-args-drop="' + lwArgs(LW_EVENT, dateStr, LW_EL, String(isToday)) + '" data-date="' + dateStr + '" class="zug-day-cell zug-cal-day' + zugStatusClass(entry) + (isToday ? ' is-today' : '') + (isPlanned ? ' is-planned' : '') + '" data-on-mouseover="zugDayHover" data-args-mouseover="' + lwArgs(LW_EL, true, isToday) + '" data-on-mouseout="zugDayHover" data-args-mouseout="' + lwArgs(LW_EL, false, isToday) + '">'
          + inner + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    grid.innerHTML = html;
  }

  // Re-render on resize so week column count adapts
  let _zugResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_zugResizeTimer);
    _zugResizeTimer = setTimeout(() => {
      if (zugWindowStart) zugRenderCalendar();
    }, 150);
  });



  // ── mail copy ──────────────────────────────────────────────────────────────
  window.zugCopyMail = function(btn) {
    const text = btn.dataset.mailtext || '';
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ Kopiert';
        btn.style.color = 'var(--green)';
        setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1800);
      }).catch(() => zugShowMailFallback(text));
    } else {
      zugShowMailFallback(text);
    }
  };

  function zugShowMailFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:480px;height:200px;z-index:9999;background:var(--card2);color:var(--text);border:1px solid var(--gold);border-radius:8px;padding:12px;font-size:13px;resize:none;';
    ta.setAttribute('readonly','');
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    ta.addEventListener('blur', () => ta.remove());
  }

  // ── render: queue ──────────────────────────────────────────────────────────
  function zugRenderQueue() {
    const el = document.getElementById('zug-queue-list');
    const plannedEl = document.getElementById('zug-planned-list');
    if (!el) return;
    if (!plannedEl) return;
    if (!zugQueue.length) {
      el.innerHTML = '<div class="zug-empty-msg">Noch keine Mitglieder in der Queue. Bitte Queue-Sync ausführen.</div>';
      plannedEl.innerHTML = '<div class="zug-empty-msg">Keine geplanten Schaffner.</div>';
      return;
    }
    // Wer hat bereits einen geplanten Termin in der Zukunft?
    const _pad = n => String(n).padStart(2,'0');
    const _nd = new Date();
    const todayStr = _nd.getFullYear() + '-' + _pad(_nd.getMonth()+1) + '-' + _pad(_nd.getDate());
    const plannedNames = new Set(
      zugSchedule
        .filter(e => e.status === 'planned' && e.event_date >= todayStr)
        .map(e => e.schaffner_name)
    );

    const free     = zugQueue.filter(r => !plannedNames.has(r.member_name));
    const assigned = zugQueue.filter(r =>  plannedNames.has(r.member_name));

    const renderRow = (row, rank, isFirst, isAssigned) => {
      const last = row.last_turn_date ? tr('Letzter Einsatz') + ': ' + row.last_turn_date : tr('Noch nie');
      // Farben je Zustand (frei / Erster / geplant): .zug-queue-row, .is-first, .is-assigned in app.css
      const state  = isAssigned ? ' is-assigned' : isFirst ? ' is-first' : '';
      const badge  = isAssigned ? '<span class="zug-queue-done">✓ geplant</span>' :
                     isFirst    ? '<span>' + zugSvg(15) + '</span>' :
                                  '<span class="zug-queue-grip">⠿</span>';
      return '<div draggable="true" data-member="' + escHtml(row.member_name) + '" data-on-dragstart="zugDragStart" data-args-dragstart="' + lwArgs(LW_EVENT, row.member_name) + '" data-on-dragover="zugQueueDragOver" data-args-dragover="' + lwArgs(LW_EVENT, LW_EL) + '" data-on-dragleave="zugQueueDragLeave" data-args-dragleave="' + lwArgs(LW_EL) + '" data-on-drop="zugQueueDrop" data-args-drop="' + lwArgs(LW_EVENT, LW_EL) + '" class="zug-queue-row' + state + '">' +
        '<span class="zug-queue-rank">' + rank + '</span>' +
        '<div class="zug-queue-main">' +
          '<div class="zug-queue-name">' + escHtml(row.member_name) + '</div>' +
          '<div class="zug-queue-meta">' + last + ' · ' + row.turn_count + tr('× gefahren') + '</div>' +
        '</div>' + badge + '</div>';
    };

    el.innerHTML = free.length
      ? free.map((row, i) => renderRow(row, i + 1, i === 0, false)).join('')
      : '<div class="zug-empty-msg">Alle verfügbaren Mitglieder sind bereits geplant.</div>';
    plannedEl.innerHTML = assigned.length
      ? assigned.map((row) => renderRow(row, '–', false, true)).join('')
      : '<div class="zug-empty-msg">Keine geplanten Schaffner.</div>';
  }

  // ── drag & drop ────────────────────────────────────────────────────────────
  let zugDropHandled = false; // suppress click-after-drop

  window.zugDragStart = function(event, memberName) {
    zugDragMember     = memberName;
    zugDragSourceDate = null;
    window._zugDragPayload = 'member:' + memberName; // most reliable cross-env transfer
    try { event.dataTransfer.setData('text/plain', 'member:' + memberName); } catch(e){}
    event.dataTransfer.effectAllowed = 'copy';
  };

  // ── queue drag-to-reorder ─────────────────────────────────────────────────
  window.zugQueueDragOver = function(event, el) {
    if (!(window._zugDragPayload || '').startsWith('member:')) return;
    event.preventDefault();
    event.stopPropagation();
    el.style.outline = '2px solid var(--gold)';
    el.style.outlineOffset = '-1px';
  };

  window.zugQueueDragLeave = function(el) {
    el.style.outline = '';
    el.style.outlineOffset = '';
  };

  window.zugQueueDrop = async function(event, el) {
    if (isHonorReadOnlyUser()) return;
    event.preventDefault();
    event.stopPropagation();
    el.style.outline = '';
    el.style.outlineOffset = '';
    const rawData = window._zugDragPayload || '';
    window._zugDragPayload = null;
    if (!rawData.startsWith('member:')) return;
    const srcName = rawData.slice(7);
    const tgtName = el.dataset.member;
    if (!tgtName || srcName === tgtName) return;
    const names = zugQueue.map(r => r.member_name);
    if (names.indexOf(srcName) < 0 || names.indexOf(tgtName) < 0) return;
    const newOrder = names.filter(n => n !== srcName);
    newOrder.splice(newOrder.indexOf(tgtName), 0, srcName);
    const byName = Object.fromEntries(zugQueue.map(r => [r.member_name, r]));
    zugQueue = newOrder.map(n => byName[n]);
    zugRenderQueue();
    try {
      await zugApiFetch('/zug/queue/reorder', {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({ discord_id: getDiscordId(), ruleset: zugActiveRuleset, order: newOrder })
      });
    } catch(e) { console.warn('zugQueueDrop', e); }
  };

  window.zugCalDragStart = function(event, dateStr) {
    const todayStr = (function(){ const n=new Date(); const p=n=>String(n).padStart(2,'0'); return n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate()); })();
    if (dateStr < todayStr) { event.preventDefault(); return; }
    zugDragSourceDate = dateStr;
    zugDragMember     = null;
    window._zugDragPayload = 'date:' + dateStr;
    try { event.dataTransfer.setData('text/plain', 'date:' + dateStr); } catch(e){}
    event.dataTransfer.effectAllowed = 'copy';
    event.stopPropagation();
  };

  window.zugDragOver = function(event, cell) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    cell.style.borderColor = 'var(--gold)';
    cell.style.boxShadow   = '0 0 0 2px rgba(240,165,0,0.4)';
  };

  window.zugDragLeave = function(cell, isToday) {
    cell.style.borderColor = isToday === 'true' ? 'var(--gold)' : 'rgba(255,255,255,0.06)';
    cell.style.boxShadow   = '';
  };

  window.zugHandleDrop = async function(event, dateStr, cell, isToday) {
    if (isHonorReadOnlyUser()) return;
    event.preventDefault();
    event.stopPropagation();
    zugDropHandled = true;
    setTimeout(() => { zugDropHandled = false; }, 300);
    cell.style.borderColor = isToday === 'true' ? 'var(--gold)' : 'rgba(255,255,255,0.06)';
    cell.style.boxShadow   = '';

    // read payload: window global (most reliable) → module var → dataTransfer
    let rawData = window._zugDragPayload || '';
    window._zugDragPayload = null;
    if (!rawData) { try { rawData = event.dataTransfer.getData('text/plain') || ''; } catch(e){} }
    if (!rawData && zugDragSourceDate) rawData = 'date:'   + zugDragSourceDate;
    if (!rawData && zugDragMember)     rawData = 'member:' + zugDragMember;

    const isCalDrag   = rawData.startsWith('date:');
    const isQueueDrag = rawData.startsWith('member:');

    // ── Calendar-to-calendar drag (swap / move) ──────────────────────────────
    if (isCalDrag) {
      const srcDate = rawData.slice(5);
      zugDragSourceDate = null;
      if (!srcDate || srcDate === dateStr) return;
      const todayStr = (function(){ const n=new Date(); const p=n=>String(n).padStart(2,'0'); return n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate()); })();
      if (dateStr < todayStr) { toast('Vergangene Tage können nicht bearbeitet werden', 'err'); return; }
      try {
        const d = await zugApiFetch('/zug/schedule/swap', {
          method: 'POST', headers: {'content-type': 'application/json'},
          body: JSON.stringify({ discord_id: getDiscordId(), date1: srcDate, date2: dateStr, ruleset_key: zugActiveRuleset })
        });
        if (d.ok) {
          await Promise.all([zugLoadQueue(), zugLoadScheduleForWindow(zugWindowStart, zugCalWeekCount())]);
          zugRenderCalendar(); zugRenderQueue();
          toast(d.msg || (d.action === 'swapped' ? 'Tausch durchgeführt' : 'Eintrag verschoben'));
        } else {
          toast(d.error || 'Fehler beim Tauschen', 'err');
        }
      } catch(e) { toast(tr('Fehler: ') + e.message, 'err'); }
      return;
    }

    // ── Queue-to-calendar drag ───────────────────────────────────────────────
    if (!isQueueDrag) return;
    const memberName = rawData.slice(7); // strip 'member:' prefix
    zugDragMember = null;
    if (!memberName) return;

    zugOpenDate  = dateStr;
    zugOpenEntry = zugSchedule.find(e => e.event_date === dateStr && e.ruleset_key === zugActiveRuleset) || null;

    const overlay = document.getElementById('zug-event-overlay');
    document.getElementById('zug-ev-date-display').textContent =
      `${new Date(dateStr+'T00:00').toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · KW ${isoWeek(dateStr)}`;

    // Reset sub-sections
    document.getElementById('zug-ev-existing').style.display    = 'none';
    document.getElementById('zug-ev-noshow').style.display      = 'none';
    zugActiveRuleset = 'standard';

    if (zugOpenEntry) {
      // Date already has entry – show it, but swap Schaffner directly via form
      document.getElementById('zug-ev-title').textContent = 'Termin bearbeiten';
      await zugOpenCreateForm(true);
      // Override with the dragged member
      document.getElementById('zug-ev-schaffner').value = memberName;
    } else {
      // New entry – open form pre-filled with dragged member
      document.getElementById('zug-ev-title').textContent = 'Termin planen';
      const mOpts = '<option value="">— keiner —</option>' +
        members.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
      document.getElementById('zug-ev-schaffner').innerHTML = mOpts;
      document.getElementById('zug-ev-vip').innerHTML       = mOpts;
      document.getElementById('zug-ev-notes').value         = '';
      document.getElementById('zug-ev-schaffner').value     = memberName;
      document.getElementById('zug-ev-save-btn').textContent = 'Anlegen';
      document.getElementById('zug-ev-form').style.display = 'block';
    }
    overlay.style.display = 'flex';
  };

  // ── render: ruleset list ───────────────────────────────────────────────────
  function zugRenderRulesetList() {
    return;
  }

  // ── ruleset form ───────────────────────────────────────────────────────────
  window.zugShowRulesetForm = function(key) {
    return;
  };
  window.zugHideRulesetForm = function() {
    return;
  };
  window.zugSaveRuleset = async function() {
    return;
  };
  window.zugDeleteRuleset = async function(key) {
    return;
  };

  // ── day click & event form ─────────────────────────────────────────────────
  window.zugDayClick = async function(dateStr) {
    if (zugDropHandled) return; // suppress click-after-drop
    zugActiveRuleset = 'standard';
    zugOpenDate  = dateStr;
    zugOpenEntry = zugSchedule.find(e => e.event_date === dateStr && e.ruleset_key === zugActiveRuleset) || null;

    const overlay = document.getElementById('zug-event-overlay');
    document.getElementById('zug-ev-date-display').textContent =
      `${new Date(dateStr+'T00:00').toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · KW ${isoWeek(dateStr)}`;

    // reset sub-sections
    document.getElementById('zug-ev-existing').style.display    = 'none';
    document.getElementById('zug-ev-noshow').style.display      = 'none';
    document.getElementById('zug-ev-form').style.display        = 'none';

    if (zugOpenEntry) {
      const e = zugOpenEntry;
      document.getElementById('zug-ev-info-schaffner').textContent = e.schaffner_name + (e.is_substitute && e.original_schaffner_name ? ` (Einspringer für ${e.original_schaffner_name})` : '');
      document.getElementById('zug-ev-info-vip').textContent = e.vip_name || '—';
      const statusEl = document.getElementById('zug-ev-info-status');
      statusEl.innerHTML = `<span class="zug-status-pill${STATUS_COLOR[e.status] ? ' zug-status-' + e.status : ''}">${STATUS_LABEL[e.status]||e.status}</span>`;
      document.getElementById('zug-ev-info-notes').textContent = e.notes || '';
      document.getElementById('zug-ev-existing').style.display = 'block';
      document.getElementById('zug-ev-title').textContent = 'Termin bearbeiten';
    } else {
      if (isHonorReadOnlyUser()) {
        toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.'));
        return;
      }
      document.getElementById('zug-ev-title').textContent = 'Termin planen';
      await zugOpenCreateForm(false);
    }
    overlay.style.display = 'flex';
  };

  window.zugCloseEventForm = function() {
    document.getElementById('zug-event-overlay').style.display = 'none';
    zugOpenEntry = null; zugOpenDate = null;
  };

  window.zugMarkCompleted = async function() {
    if (isHonorReadOnlyUser()) { toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.')); return; }
    if (!zugOpenEntry) return;
    try {
      const d = await zugApiFetch(`/zug/schedule/${encodeURIComponent(zugOpenEntry.id)}`, {
        method:'PUT', headers:{'content-type':'application/json'},
        body: JSON.stringify({ discord_id:getDiscordId(), status:'completed' })
      });
      if (d.ok) { await zugReloadAndClose(); toast('Als abgeschlossen markiert'); }
      else toast(d.error||'Fehler','err');
    } catch(e) { toast(tr('Fehler: ') + e.message, 'err'); }
  };

  window.zugOpenNoShowForm = function() {
    if (isHonorReadOnlyUser()) { toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.')); return; }
    // Build substitute select
    const sel = document.getElementById('zug-ev-sub-select');
    sel.innerHTML = '<option value="">— kein Einspringer —</option>' +
      members.filter(m => m !== zugOpenEntry?.schaffner_name)
             .map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
    document.getElementById('zug-ev-noshow-notes').value = '';
    document.getElementById('zug-ev-noshow').style.display = 'block';
  };

  window.zugCancelNoShow = function() {
    document.getElementById('zug-ev-noshow').style.display = 'none';
  };

  window.zugConfirmNoShow = async function() {
    if (isHonorReadOnlyUser()) { toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.')); return; }
    if (!zugOpenEntry) return;
    const sub   = document.getElementById('zug-ev-sub-select').value.trim();
    const notes = document.getElementById('zug-ev-noshow-notes').value.trim();
    try {
      const d = await zugApiFetch(`/zug/schedule/${encodeURIComponent(zugOpenEntry.id)}/noshow`, {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ discord_id:getDiscordId(), substitute_name:sub||null, notes:notes||null })
      });
      if (d.ok) { await zugReloadAndClose(); toast(sub ? `No-Show. Einspringer: ${sub}` : 'No-Show eingetragen'); }
      else toast(d.error||'Fehler','err');
    } catch(e) { toast(tr('Fehler: ') + e.message, 'err'); }
  };

  window.zugEditExisting = async function() {
    if (isHonorReadOnlyUser()) { toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.')); return; }
    await zugOpenCreateForm(true);
  };

  window.zugCancelEditForm = function() {
    if (zugOpenEntry) {
      document.getElementById('zug-ev-form').style.display = 'none';
      document.getElementById('zug-ev-existing').style.display = 'block';
    } else {
      zugCloseEventForm();
    }
  };

  window.zugDeleteEntry = async function() {
    if (isHonorReadOnlyUser()) { toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.')); return; }
    if (!zugOpenEntry || !confirm('Termin wirklich löschen?')) return;
    try {
      const d = await zugApiFetch(`/zug/schedule/${encodeURIComponent(zugOpenEntry.id)}`, {
        method:'DELETE', headers:{'content-type':'application/json'},
        body: JSON.stringify({ discord_id:getDiscordId() })
      });
      if (d.ok) { await zugReloadAndClose(); toast('Termin gelöscht'); }
      else toast(d.error||'Fehler','err');
    } catch(e) { toast(tr('Fehler: ') + e.message, 'err'); }
  };

  window.zugOpenCreateForm = async function(editing=false) {
    if (isHonorReadOnlyUser()) { return; }
    // Build member selects
    const mOpts = '<option value="">— keiner —</option>' +
      members.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
    document.getElementById('zug-ev-schaffner').innerHTML = mOpts;
    document.getElementById('zug-ev-vip').innerHTML       = mOpts;
    document.getElementById('zug-ev-notes').value         = '';

    if (editing && zugOpenEntry) {
      document.getElementById('zug-ev-schaffner').value = zugOpenEntry.schaffner_name || '';
      document.getElementById('zug-ev-vip').value       = zugOpenEntry.vip_name || '';
      document.getElementById('zug-ev-notes').value     = zugOpenEntry.notes || '';
      document.getElementById('zug-ev-save-btn').textContent = 'Aktualisieren';
    } else {
      document.getElementById('zug-ev-vip').value = '';
      document.getElementById('zug-ev-save-btn').textContent = 'Anlegen';
    }

    document.getElementById('zug-ev-existing').style.display    = 'none';
    document.getElementById('zug-ev-form').style.display        = 'block';
  };

  window.zugSaveEntry = async function() {
    if (isHonorReadOnlyUser()) { toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.')); return; }
    const schaffner = document.getElementById('zug-ev-schaffner').value;
    const vip       = document.getElementById('zug-ev-vip').value;
    const notes     = document.getElementById('zug-ev-notes').value.trim();
    if (!schaffner) { toast('Schaffner auswählen','err'); return; }
    try {
      if (zugOpenEntry) {
        const d = await zugApiFetch(`/zug/schedule/${encodeURIComponent(zugOpenEntry.id)}`, {
          method:'PUT', headers:{'content-type':'application/json'},
          body: JSON.stringify({ discord_id:getDiscordId(), schaffner_name:schaffner, vip_name:vip||null, notes:notes||null })
        });
        if (d.ok) { await zugReloadAndClose(); toast('Termin aktualisiert'); }
        else toast(d.error||'Fehler','err');
      } else {
        const d = await zugApiFetch('/zug/schedule', {
          method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({ discord_id:getDiscordId(), event_date:zugOpenDate, ruleset_key:zugActiveRuleset, schaffner_name:schaffner, vip_name:vip||null, notes:notes||null, auto_advance:true, created_by:authMember?.member_name||'' })
        });
        if (d.ok) { await zugReloadAndClose(); toast('Termin angelegt'); }
        else toast(d.error||'Fehler','err');
      }
    } catch(e) { toast(tr('Fehler: ') + e.message, 'err'); }
  };

  async function zugReloadAndClose() {
    await Promise.all([zugLoadQueue(), zugLoadScheduleForWindow(zugWindowStart, zugCalWeekCount())]);
    zugRenderCalendar();
    zugRenderQueue();
    zugCloseEventForm();
  }
  // ── READ-ONLY view (alle Mitglieder) ──────────────────────────────────────
  let zugRoWindowStart  = null;  // 'YYYY-MM-DD' Monday of first visible week
  let zugRoSchedule     = [];
  let zugRoActiveRuleset = 'standard';
  let zugRoFocusDate    = '';    // 'YYYY-MM-DD': markierter Tag, steht im Link (/train/2026-11-12)

  window.zugRoGetFocusDate = () => zugRoFocusDate;
  window.zugRoSetFocusDate = (d) => { zugRoFocusDate = /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : ''; };

  // Tag angetippt: markieren (nochmal tippen hebt es auf). Die Adresse zeigt den Tag, „Link teilen“ schickt ihn.
  window.zugRoPickDay = function(dateStr) {
    zugRoFocusDate = zugRoFocusDate === dateStr ? '' : dateStr;
    zugRoRenderCalendar();
    lwDetailChanged('zv', true);
  };

  // How many week columns fit in the read-only calendar at current width
  function zugRoCalWeekCount() {
    const grid = document.getElementById('zug-ro-cal-grid');
    const DAY_COL_W  = 36;
    const MIN_CELL_W = 150; // wide enough so names aren't cut off
    const containerW = (grid ? grid.offsetWidth : 0) || (window.innerWidth - 48);
    return Math.max(1, Math.floor((containerW - DAY_COL_W) / MIN_CELL_W));
  }

  async function zugRoLoadScheduleForWindow(windowStart, weekCount) {
    const months = new Set();
    const _p = n => String(n).padStart(2,'0');
    for (let w = 0; w <= weekCount; w++) {
      const d = new Date(windowStart + 'T00:00:00');
      d.setDate(d.getDate() + w * 7);
      months.add(d.getFullYear() + '-' + _p(d.getMonth()+1));
      const dEnd = new Date(d); dEnd.setDate(dEnd.getDate() + 6);
      months.add(dEnd.getFullYear() + '-' + _p(dEnd.getMonth()+1));
    }
    const results = await Promise.all([...months].map(mo =>
      zugApiFetch(`/zug/schedule?month=${encodeURIComponent(mo)}`).catch(() => ({ok:false}))
    ));
    const seen = new Set();
    zugRoSchedule = [];
    for (const d of results) {
      if (!d.ok) continue;
      for (const e of (d.entries || [])) {
        const k = e.event_date + '|' + e.ruleset_key;
        if (!seen.has(k)) { seen.add(k); zugRoSchedule.push(e); }
      }
    }
  }

  // Fenster so legen, dass der Tag aus dem Link sichtbar ist (an derselben Stelle wie sonst der letzte geplante Tag)
  function zugRoAlignWindowTo(dateStr, weekCount) {
    const rightGapCols = weekCount >= 2 ? 1 : 0;
    const colsBefore = Math.max(0, weekCount - 1 - rightGapCols);
    const d = new Date(getMondayOfWeek(dateStr) + 'T00:00:00');
    d.setDate(d.getDate() - colsBefore * 7);
    const _p = n => String(n).padStart(2,'0');
    zugRoWindowStart = `${d.getFullYear()}-${_p(d.getMonth()+1)}-${_p(d.getDate())}`;
  }

  function zugRoAlignWindowToLatest(weekCount) {
    const plannedDates = zugRoSchedule
      .filter(e => e && e.status === 'planned' && typeof e.event_date === 'string')
      .map(e => e.event_date)
      .sort();
    const anyDates = zugRoSchedule
      .filter(e => e && typeof e.event_date === 'string')
      .map(e => e.event_date)
      .sort();
    const latest = plannedDates.length
      ? plannedDates[plannedDates.length - 1]
      : (anyDates.length ? anyDates[anyDates.length - 1] : todayStr());

    const latestWeekMonday = getMondayOfWeek(latest);
    const rightGapCols = weekCount >= 2 ? 1 : 0;
    const colsBeforeLatest = Math.max(0, weekCount - 1 - rightGapCols);
    const d = new Date(latestWeekMonday + 'T00:00:00');
    d.setDate(d.getDate() - colsBeforeLatest * 7);
    const _p = n => String(n).padStart(2,'0');
    zugRoWindowStart = `${d.getFullYear()}-${_p(d.getMonth()+1)}-${_p(d.getDate())}`;
  }

  function zugRoRenderRulesetSelect() {
    const sel = document.getElementById('zug-ro-ruleset-select');
    if (!sel) return;
    sel.innerHTML = zugRulesets.map(r =>
      `<option value="${escHtml(r.ruleset_key)}"${r.ruleset_key===zugRoActiveRuleset?' selected':''}>${escHtml(r.ruleset_name)}</option>`
    ).join('') || '<option value="standard">Standard</option>';
  }

  function zugRoRenderCalendar() {
    const titleEl = document.getElementById('zug-ro-cal-title');
    const grid    = document.getElementById('zug-ro-cal-grid');
    if (!titleEl || !grid) return;

    const today = todayStr();
    const weekCount = zugRoCalWeekCount();

    // Build weeks from zugRoWindowStart
    const _pad = n => String(n).padStart(2,'0');
    const weeks = [];
    for (let w = 0; w < weekCount; w++) {
      const weekStart = new Date(zugRoWindowStart + 'T00:00:00');
      weekStart.setDate(weekStart.getDate() + w * 7);
      const week = [];
      for (let d = 0; d < 7; d++) {
        const dd = new Date(weekStart); dd.setDate(dd.getDate() + d);
        week.push(dd.getFullYear() + '-' + _pad(dd.getMonth()+1) + '-' + _pad(dd.getDate()));
      }
      weeks.push(week);
    }

    // Title: "KW N – KW M (YYYY)"
    const firstKw  = isoWeek(weeks[0][0]);
    const lastKw   = isoWeek(weeks[weeks.length - 1][0]);
    const pivotDate = weeks[Math.floor(weeks.length / 2)][3]; // Thursday of middle week
    const titleYear = new Date(pivotDate + 'T00:00').getFullYear();
    titleEl.innerHTML = zugSvg(16) + ' KW\u00a0' + firstKw + '\u2013KW\u00a0' + lastKw + ' (' + titleYear + ')';

    const byDate = {};
    for (const e of zugRoSchedule) {
      if (e.ruleset_key === zugRoActiveRuleset || zugRoActiveRuleset === 'all') byDate[e.event_date] = e;
    }

    // Transposed layout: rows = weekdays (Mo–So), columns = calendar weeks (KW N)
    const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    // Breite der Tages-Spalte (36px) steht in .zug-cal-daycol
    let html = '<table class="zug-cal-table">';
    html += '<colgroup><col class="zug-cal-daycol">';
    for (let i = 0; i < weeks.length; i++) html += '<col>';
    html += '</colgroup>';
    html += '<thead><tr><th class="zug-cal-corner"></th>';
    for (const week of weeks) {
      const kw = isoWeek(week[0]);
      html += '<th class="zug-cal-kw-head zug-cal-kw-text">KW ' + kw + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (let dow = 0; dow < 7; dow++) {
      const isWeekend = dow >= 5;
      html += '<tr><td class="zug-cal-dow' + (isWeekend ? ' is-weekend' : '') + '">' + DAY_NAMES[dow] + '</td>';
      for (const week of weeks) {
        const dateStr = week[dow];
        const dayNum = parseInt(dateStr.slice(8));
        const isToday = dateStr === today;
        const entry = byDate[dateStr];
        const isFocus = dateStr === zugRoFocusDate;
        let inner = '<div class="zug-cal-daynum' + (isToday ? ' is-today' : '') + '">' + dayNum + '</div>';
        if (entry) {
          inner += '<div class="zug-cal-name" title="' + escHtml(entry.schaffner_name) + '">' + zugSvg(12) + ' ' + escHtml(entry.schaffner_name) + '</div>';
          if (entry.vip_name) inner += '<div class="zug-cal-vip" title="' + escHtml(entry.vip_name) + '">\u2b50 ' + escHtml(entry.vip_name) + '</div>';
        }
        // Hintergrund je Status (.zug-status-*), goldener Rand für heute (.is-today)
        html += '<td class="zug-day-cell zug-ro-day' + zugStatusClass(entry) + (isToday ? ' is-today' : '') + (isFocus ? ' is-focus' : '') + '" data-date="' + dateStr + '" data-action="zugRoPickDay" data-args="' + lwArgs(dateStr) + '">' + inner + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    grid.innerHTML = html;
  }

  window.zugRoLoadPage = async function() {
    zugRoActiveRuleset = 'standard';
    const weekCount = zugRoCalWeekCount();
    if (zugRoFocusDate) {
      // Tag aus dem Link: gleich das passende Fenster laden
      zugRoAlignWindowTo(zugRoFocusDate, weekCount);
    } else {
      if (!zugRoWindowStart) zugRoWindowStart = getMondayOfWeek(todayStr());
      await Promise.all([zugRoLoadScheduleForWindow(zugRoWindowStart, weekCount)]);
      zugRoAlignWindowToLatest(weekCount);
    }
    await Promise.all([zugRoLoadScheduleForWindow(zugRoWindowStart, weekCount)]);
    zugArrangePanels();
    zugRoRenderCalendar();
    if (zugRoFocusDate) {
      requestAnimationFrame(() => document.querySelector('#zug-ro-cal-grid .zug-ro-day.is-focus')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
    }
  };

  // Andere Wochen angezeigt: die Markierung geht mit aus der Adresse (sie waere sonst evtl. gar nicht sichtbar)
  function zugRoClearFocus() {
    if (!zugRoFocusDate) return;
    zugRoFocusDate = '';
    lwDetailChanged('zv', true);
  }

  window.zugRoNavWeek = async function(delta) {
    zugRoClearFocus();
    const d = new Date(zugRoWindowStart + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    const _p = n => String(n).padStart(2,'0');
    zugRoWindowStart = `${d.getFullYear()}-${_p(d.getMonth()+1)}-${_p(d.getDate())}`;
    const weekCount = zugRoCalWeekCount();
    await zugRoLoadScheduleForWindow(zugRoWindowStart, weekCount);
    zugRoRenderCalendar();
  };

  window.zugRoNavToday = async function() {
    zugRoClearFocus();
    zugRoWindowStart = getMondayOfWeek(todayStr());
    const weekCount = zugRoCalWeekCount();
    await zugRoLoadScheduleForWindow(zugRoWindowStart, weekCount);
    zugRoAlignWindowToLatest(weekCount);
    await zugRoLoadScheduleForWindow(zugRoWindowStart, weekCount);
    zugRoRenderCalendar();
  };

  window.zugRoOnRulesetChange = function() {
    zugRoActiveRuleset = 'standard';
    zugRoRenderCalendar();
  };

  // Re-render on resize so the visible week count adapts to available width
  let _zugRoResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_zugRoResizeTimer);
    _zugRoResizeTimer = setTimeout(() => {
      zugArrangePanels();
      if (zugRoWindowStart) zugRoRenderCalendar();
    }, 150);
  });

})(); // end Zug module
