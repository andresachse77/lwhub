// LWHub – Daten laden/speichern, R4-Listener, Bearbeiten-Dialog, Kalenderwoche
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html). Normales Script, kein Modul:
// alles bleibt global wie vorher. Die Reihenfolge der <script>-Tags in index.html ist die Ladereihenfolge.

// ══════════════════════════════════════════════════════
//  Daten laden/speichern via Google Apps Script API
// ══════════════════════════════════════════════════════

async function loadMembers() {
  const data = await api('members');
  members = []; honorMembers = []; PREV = {}; R4.clear(); R5.clear(); memberMeta = {};
  if (!data || data.error) return;
  data.forEach(m => {
    const honorRole = m.honor_role || null;
    if (honorRole) honorMembers.push(m.name);
    else members.push(m.name);
    PREV[m.name] = m.rank;
    memberMeta[m.name] = {
      id: m.id || null,
      alliance: m.alliance || 'INY',
      honorRole,
      honorHome: m.honor_home || null,
      honorHomeAlliance: m.honor_home_alliance || null,
      canWrite: m.can_write !== false,
      readOnly: !!m.read_only,
      discordId: m.discord_id || null,
      discordUsername: m.discord_username || null,
      preferredLanguage: m.preferred_language || 'de',
      discordAvatarUrl: m.discord_avatar_url || null,
      discordConnected: !!m.discord_connected,
      lastVisitAt: m.last_visit_at || null,
      beruf: m.beruf || null,
      berufMedHilfe: !!m.beruf_med_hilfe,
      berufWinwin: m.beruf_winwin || null,
      aliases: Array.isArray(m.aliases) ? m.aliases : [], // fruehere Namen, fuer Links wie /members/alter-name
    };
    if (!honorRole && (m.role === 'r4' || m.rank === 4)) R4.add(m.name);
    if (!honorRole && (m.role === 'r5' || m.rank === 5)) R5.add(m.name);
  });
}

async function loadEntries() {
  const [data] = await Promise.all([api('entries', { kw }), loadWeekRoster(kw)]);
  applyEntriesData(data);
  entriesLoadedAt = Date.now();
  writeEntriesCache(kw, data || []);
}

function hydrateEntriesFromCache(yearWeek, { allowStale = false } = {}) {
  const cached = readEntriesCache(yearWeek);
  if (!cached) return false;
  const isFresh = (Date.now() - cached.savedAt) < ENTRIES_REFRESH_MS;
  if (!allowStale && !isFresh) return false;
  applyEntriesData(cached.data);
  entriesLoadedAt = cached.savedAt;
  return true;
}

function entriesNeedRefresh() {
  return !entriesLoadedAt || (Date.now() - entriesLoadedAt) >= ENTRIES_REFRESH_MS;
}

async function refreshEntriesIfNeeded({ force = false, background = false } = {}) {
  if (!force && !entriesNeedRefresh()) return;
  if (entriesLoading) return;

  entriesLoading = true;
  renderAll();
  try {
    await loadEntries();
    renderAll();
  } catch (err) {
    toast('Fehler beim Laden der Wocheneinträge: ' + err.message);
  } finally {
    entriesLoading = false;
    if (!background) renderAll();
  }
}

async function ensureCoreDataLoaded({ forceEntries = false } = {}) {
  if (coreDataInitPromise) return coreDataInitPromise;

  coreDataInitPromise = (async () => {
    await loadMembers();
    // Show cached entries immediately when available, then refresh in background.
    hydrateEntriesFromCache(kw, { allowStale: true });
    await refreshEntriesIfNeeded({ force: forceEntries || !entries.length, background: true });
    renderAll();
  })();

  try {
    return await coreDataInitPromise;
  } finally {
    coreDataInitPromise = null;
  }
}

async function loadAccessRequests() {
  try {
    const data = await api('access_requests');
    accessRequests = Array.isArray(data) ? data : [];
  } catch (err) {
    accessRequests = [];
  }
}

async function saveEntry(name, rank, flags) {
  await apiPost({ action: 'save_entry', name, rank, flags });
  await loadEntries();
}

// ── Bearbeiten-Dialog speichert sofort ──
// Wie in der Verwaltung: jeder Klick auf ein Flag oder einen Rang wird gespeichert (kurz gesammelt, damit
// schnelles Klicken nur einmal speichert). „✓ Fertig“ und ✕ schliessen nur noch; „Fertig“ erfasst ein
// Mitglied ohne Flags wie bisher mit 0 Punkten.
let edSaveTimer = null;
let edDirty = false;
let edSaveChain = Promise.resolve(); // Speichern nacheinander, nie zwei Anfragen fuer denselben Stand

function edCanWrite() {
  if (authMember?.read_only || authMember?.honor_role) {
    toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.'));
    return false;
  }
  return true;
}

function edSetSaveState(state) {
  const el = document.getElementById('editorSaveState');
  if (!el) return;
  el.textContent = state === 'saving' ? tr('speichert…') : state === 'saved' ? tr('✓ gespeichert')
    : state === 'error' ? tr('Fehler beim Speichern') : '';
  el.classList.toggle('is-saved', state === 'saved');
  el.classList.toggle('is-error', state === 'error');
}

function edMarkOpenRow() {
  document.querySelectorAll('.member-row').forEach((r) => r.classList.toggle('is-open', !!edName && r.dataset.name === edName));
}

function edScheduleSave() {
  edDirty = true;
  edSetSaveState('saving');
  clearTimeout(edSaveTimer);
  edSaveTimer = setTimeout(edFlushSave, 400);
}

// Offene Aenderung jetzt speichern. Name, Rang und Flags werden sofort festgehalten, der Dialog darf danach zugehen.
function edFlushSave() {
  clearTimeout(edSaveTimer);
  edSaveTimer = null;
  if (!edDirty || !edName) return edSaveChain;
  edDirty = false;
  const name = edName;
  const rank = isFixed(name) ? fixedRank(name) : edRank;
  const flags = { ...edFlags };
  edSaveChain = edSaveChain.then(async () => {
    try {
      await saveEntry(name, rank, flags);
      renderAll();
      edMarkOpenRow();
      if (edName === name && !edDirty) edSetSaveState('saved');
    } catch (err) {
      if (edName === name) edSetSaveState('error');
      toast(tr('Fehler: ') + (err?.message || err));
    }
  });
  return edSaveChain;
}

// Called after R4 pages are injected into the DOM
function initR4Listeners() {
  initFilterBars();

  const kwInput = document.getElementById('kwInput');
  if (kwInput) kwInput.value = formatYearWeek(kw);
  updateKwDisplays();

  const rankRow = document.getElementById('rankRow');
  if (rankRow && !rankRow._listenerAttached) {
    rankRow._listenerAttached = true;
    rankRow.addEventListener('click', function(e) {
      const btn = e.target.closest('.rk-btn');
      if (!btn || btn.disabled) return;
      const r = parseInt(btn.dataset.r);
      if (r === edRank || !edCanWrite()) return;
      edRank = r;
      document.querySelectorAll('.rk-btn').forEach(b => b.classList.toggle('on', parseInt(b.dataset.r) === edRank));
      edScheduleSave();
    });
  }

  // „✓ Fertig“: Aenderungen sind schon gespeichert. Noch gar nicht erfasst? Dann jetzt (auch ohne Flags, 0 Punkte).
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn && !saveBtn._listenerAttached) {
    saveBtn._listenerAttached = true;
    saveBtn.addEventListener('click', async function() {
      if (!edName) return;
      if (!edCanWrite()) return;
      const name = edName;
      if (!entries.find(x => x.name === name)) edDirty = true;
      const changed = edDirty;
      closeEditor(); // speichert Offenes noch (edFlushSave)
      await edSaveChain;
      if (changed) toast(name + ' gespeichert!');
    });
  }

  const editorClose = document.getElementById('editorClose');
  if (editorClose && !editorClose._listenerAttached) {
    editorClose._listenerAttached = true;
    editorClose.addEventListener('click', closeEditor);
  }

  const searchInput = document.getElementById('searchInput');
  if (searchInput && !searchInput._listenerAttached) {
    searchInput._listenerAttached = true;
    searchInput.addEventListener('input', function() { search = this.value.toLowerCase(); renderList(); });
  }

  document.querySelectorAll('[data-lf]').forEach(b => {
    if (b._listenerAttached) return;
    b._listenerAttached = true;
    b.addEventListener('click', function() {
      listFilter = this.dataset.lf;
      document.querySelectorAll('[data-lf]').forEach(x => x.classList.toggle('on', x.dataset.lf === listFilter));
      renderList();
    });
  });

  document.querySelectorAll('.vrank-btn').forEach(btn => {
    if (btn._listenerAttached) return;
    btn._listenerAttached = true;
    btn.addEventListener('click', function() {
      // "honor" = Ehren-R4: Gast aus einer anderen Allianz, sieht alles wie R4, aendert nichts, zaehlt nicht mit
      vNewHonor = this.dataset.vr === 'honor';
      vNewRank = vNewHonor ? 4 : parseInt(this.dataset.vr);
      document.querySelectorAll('.vrank-btn').forEach(b => b.classList.toggle('on', b.dataset.vr === this.dataset.vr));
      const homeWrap = document.getElementById('v-new-home-wrap');
      if (homeWrap) homeWrap.hidden = !vNewHonor;
      if (vNewHonor) fillHonorHomeAllianceList();
    });
  });

  const vAddBtn = document.getElementById('v-add-btn');
  if (vAddBtn && !vAddBtn._listenerAttached) {
    vAddBtn._listenerAttached = true;
    vAddBtn.addEventListener('click', async function() {
      const name = document.getElementById('v-new-name').value.trim();
      if (!name) { toast('Bitte einen Namen eingeben!'); return; }
      if (members.includes(name) || honorMembers.includes(name)) { toast('Mitglied existiert bereits!'); return; }
      const role = vNewRank === 5 ? 'r5' : vNewRank === 4 ? 'r4' : 'normal';
      const discordId = (document.getElementById('v-new-discord')?.value || '').trim();
      const honorHome = vNewHonor ? (document.getElementById('v-new-home')?.value || '').trim() : '';
      if (vNewHonor && !discordId) { toast(tr('Ehren-R4 brauchen eine Discord-ID, sonst können sie sich nicht anmelden.')); return; }
      try {
        await apiPost({
          action: 'add_member', name, rank: vNewRank, role, discord_id: discordId || undefined,
          honor_role: vNewHonor ? 'honor_r4' : null, honor_home: honorHome || null,
        });
      } catch(e) {
        toast(e.message || 'Fehler beim Hinzufügen'); return;
      }
      await loadMembers();
      document.getElementById('v-new-name').value = '';
      if (document.getElementById('v-new-discord')) document.getElementById('v-new-discord').value = '';
      if (document.getElementById('v-new-home')) document.getElementById('v-new-home').value = '';
      renderVerwaltung();
      toast(name + ' hinzugefügt!');
    });
  }

  const vSearch = document.getElementById('v-search');
  if (vSearch && !vSearch._listenerAttached) {
    vSearch._listenerAttached = true;
    vSearch.addEventListener('input', function() { renderVerwaltung(this.value.toLowerCase()); });
  }
}

// ── RANK BUTTONS ──
function openEditor(name){
  if(guardFormer(name)) return;
  edFlushSave(); // Offenes vom vorigen Mitglied noch speichern
  edSetSaveState('');
  edName=name;
  const e=entries.find(x=>x.name===name);
  edFlags=e?{...e.flags}:{};
  const fixed=isFixed(name);
  edRank=fixed?fixedRank(name):(PREV[name]||3);

  document.getElementById('editorName').textContent=name+(fixed?' · '+(R5.has(name)?'R5 '+RL[5]:'R4 '+RL[4]):'');
  document.getElementById('editor').style.display='block';

  // Rank btns
  document.querySelectorAll('.rk-btn').forEach(b=>{
    b.disabled=fixed;
    b.classList.toggle('on',parseInt(b.dataset.r)===edRank);
  });
  const fn=document.getElementById('fixedNote');
  fn.style.display=fixed?'block':'none';
  if(fixed) fn.textContent=(R5.has(name)?'R5 – '+RL[5]:'R4 – '+RL[4])+' · Rank ist fix';

  // Flag categories
  document.getElementById('flagCats').innerHTML=CATS.map(cat=>{
    const btns=cat.f.map(f=>{
      const on=!!edFlags[f.k];
      // Farben je Typ: .editor-flag-on-r/a/n/b in app.css
      const onCls=on?' editor-flag-on-'+(['r','a','n'].includes(f.t)?f.t:'b'):'';
      return `<button class="flag-btn${onCls}" data-fk="${f.k}" data-action="toggleFlag" data-args="${lwArgs(f.k)}">${escHtml(tr(f.l))}</button>`;
    }).join('');
    // Kategorie-Farben (bg/bc/lc aus CATS) je Typ: .editor-flag-cat-r/a/n/b in app.css
    return `<div class="flag-cat editor-flag-cat-${['r','a','n'].includes(cat.t)?cat.t:'b'}">
      <div class="flag-cat-title">${escHtml(tr(cat.l))}</div>
      <div class="flag-btns">${btns}</div>
    </div>`;
  }).join('');

  // highlight open row
  document.querySelectorAll('.member-row').forEach(r=>r.classList.toggle('is-open',r.dataset.name===name));
  document.getElementById('editor').scrollIntoView({behavior:'smooth',block:'nearest'});
}
window.openEditor=openEditor;

function toggleFlag(k){
  if(!edName || !edCanWrite()) return;
  edFlags[k]=!edFlags[k];
  const btn=document.querySelector(`[data-fk="${k}"]`);
  const f=FLAGS.find(x=>x.k===k);
  const on=edFlags[k];
  // Farbe je Typ wie beim Oeffnen (openEditor): r rot, a gold, n (AFK) lila, sonst blau
  const onCls='editor-flag-on-'+(['r','a','n'].includes(f.t)?f.t:'b');
  btn.classList.remove('editor-flag-on-r','editor-flag-on-a','editor-flag-on-n','editor-flag-on-b');
  if(on) btn.classList.add(onCls);
  edScheduleSave();
}
window.toggleFlag=toggleFlag;

function closeEditor(){
  edFlushSave(); // Offenes noch speichern, bevor der Name weg ist
  document.getElementById('editor').style.display='none';
  edName=null; edFlags={};
  edMarkOpenRow();
  edSetSaveState('');
}

// ── KW ──
function updateKwDisplays() {
  const fmt = formatYearWeek(kw);
  document.querySelectorAll('.kw-val').forEach(el => el.textContent = fmt);
  const kwInput = document.getElementById('kwInput');
  if (kwInput) kwInput.value = fmt;
  const kwD = document.getElementById('kw-d');
  if (kwD) kwD.textContent = fmt;
}

async function kwChanged(){
  const parsed = parseYearWeek(document.getElementById('kwInput').value);
  if (parsed == null) {
    toast('Bitte JahrWoche im Format YYWW eingeben, z. B. 2616.');
    return;
  }
  await runWithBattleLoader(async () => {
    const prevKw = kw;
    kw = parsed;
    updateKwDisplays();
    try { await loadEntries(); } catch(e) {}
    if (entries.length === 0 && !confirm(`KW ${formatYearWeek(kw)} hat noch keine Einträge.\nWoche anlegen und wechseln?`)) {
      kw = prevKw;
      updateKwDisplays();
      try { await loadEntries(); } catch(e) {}
    }
    renderAll();
    lwKwChanged();
  }, 0);
}

async function changeYearWeek(delta) {
  await runWithBattleLoader(async () => {
    const prevKw = kw;
    kw = shiftYearWeek(kw, delta);
    updateKwDisplays();
    try { await loadEntries(); } catch(e) {}
    if (entries.length === 0 && !confirm(`KW ${formatYearWeek(kw)} hat noch keine Einträge.\nWoche anlegen und wechseln?`)) {
      kw = prevKw;
      updateKwDisplays();
      try { await loadEntries(); } catch(e) {}
    }
    renderAll();
    lwKwChanged();
  }, 0);
}
window.changeYearWeek = changeYearWeek;
