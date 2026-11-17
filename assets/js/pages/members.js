// LWHub – Verwaltung (/members): Mitglieder anlegen, bearbeiten, Detail, Flags, Zugangsanfragen
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Seiten herauslösen“).
// Normales Script, kein Modul: lädt nach dem großen <script> in index.html und vor assets/js/start.js.

let vNewRank=3;
let vNewHonor=false; // "Ehren-R4" im Formular "Mitglied hinzufügen" gewählt

// Vorschläge für die Heimat-Allianz: die in lwhub angelegten Allianzen (Freitext bleibt möglich)
let honorHomeAlliancesLoaded = false;
async function fillHonorHomeAllianceList() {
  if (honorHomeAlliancesLoaded) return;
  const list = document.getElementById('v-alliance-list');
  if (!list) return;
  try {
    const data = await fetchJson('/alliances');
    list.innerHTML = (data.alliances || [])
      .map(a => `<option value="${escHtml(a.short_name)}">${escHtml(a.title || a.short_name)}</option>`).join('');
    honorHomeAlliancesLoaded = true;
  } catch (_) { /* Freitext reicht */ }
}
window.fillHonorHomeAllianceList = fillHonorHomeAllianceList;

// ══ VERWALTUNG: Liste + Mitgliedsseite (docs/konzept-verwaltung-ux.html, Variante B) ══
// Am PC: Liste links, Mitglied rechts. Am Handy (< 900 px): das Mitglied ist eine eigene Seite, „←“ und die
// Zurueck-Geste fuehren in die Liste. Regel: Was man antippt, gilt sofort. Nur Umbenennen, Entfernen und der
// Sprung auf R4/R5 fragen nach; alles andere laesst sich unten mit „Rueckgaengig“ zuruecknehmen.
let vDetailOpen = null; // Name des geoeffneten Mitglieds (auch in der Adresse: /members/<name>)
let vFilter = 'all';    // Filter ueber der Liste: all | nodiscord | afk | honor
const vSavedAt = {};    // Kasten (week/job/profile) → Zeitpunkt des letzten Speicherns, fuer „✓ gespeichert“
let vListScrollY = null; // Handy: Scrollstand der Liste, damit „←“ wieder an dieselbe Stelle fuehrt

function vSearchValue() { return (document.getElementById('v-search')?.value || '').trim().toLowerCase(); }
function vRerender() { renderVerwaltung(vSearchValue()); }
function vCurrentRank(name) { return R5.has(name) ? 5 : R4.has(name) ? 4 : (PREV[name] || 3); }
function vIsNarrow() { return window.matchMedia('(max-width: 899px)').matches; }
function vCanWrite() {
  if (authMember?.read_only || authMember?.honor_role) {
    toast(tr('Nur Lesezugriff (Ehrenrolle): Änderungen sind nicht erlaubt.'));
    return false;
  }
  return true;
}

// Mitglied oeffnen; null = zurueck zur Liste
function vSelectMember(name) {
  const fromList = !vDetailOpen && !!name;
  if (fromList && vIsNarrow()) vListScrollY = window.scrollY;
  vDetailOpen = name || null;
  vRerender();
  lwDetailChanged('v');
  // Merken, dass dieses Mitglied aus der Liste kam: dann fuehrt „←“ per history.back() zurueck (wie die Geste)
  if (fromList) { try { history.replaceState({ ...(history.state || {}), vFromList: true }, ''); } catch (_) {} }
  if (vDetailOpen && vIsNarrow()) document.getElementById('v-layout')?.scrollIntoView({ block: 'start' });
}
window.vSelectMember = vSelectMember;
function toggleVerwaltungRow(name) { vSelectMember(name); } // frueherer Name, falls noch irgendwo verdrahtet
window.toggleVerwaltungRow = toggleVerwaltungRow;

function vBackToList() {
  if (history.state?.vFromList) { history.back(); return; } // popstate → vOpenMemberFromLink('')
  vSelectMember(null);
}
window.vBackToList = vBackToList;

function vSetFilter(f) { vFilter = f || 'all'; vRerender(); }
window.vSetFilter = vSetFilter;

// Mitglied aus dem Link oeffnen (/members/lion%20tooth, auch frueherer Name). Leer: zurueck zur Liste.
function vOpenMemberFromLink(value) {
  const want = String(value || '').trim();
  const name = want ? lwFindMemberName(want) : '';
  if (want && !name) toast(tr('s_member_not_found').replace('{name}', want));
  const wasOpen = !!vDetailOpen;
  vDetailOpen = name || null;
  // Suche leeren, sonst ist das Mitglied evtl. ausgefiltert
  const search = document.getElementById('v-search');
  if (name && search && search.value && !name.toLowerCase().includes(search.value.toLowerCase())) search.value = '';
  if (name) vFilter = 'all';
  vRerender();
  if (!name && wasOpen && vIsNarrow() && vListScrollY != null) { window.scrollTo(0, vListScrollY); vListScrollY = null; }
  else if (name && vIsNarrow()) document.getElementById('v-layout')?.scrollIntoView({ block: 'start' });
  else if (name) requestAnimationFrame(() => document.querySelector('#v-list .vm-row.is-sel')?.scrollIntoView({ block: 'nearest' }));
}

// ── Speichern mit „✓ gespeichert“ und „Rueckgaengig“ ──
function vMarkSaved(sec) { vSavedAt[sec] = Date.now(); }
function vSavedBadge(sec) {
  const recent = Date.now() - (vSavedAt[sec] || 0) < 1800;
  return `<span class="vm-saved${recent ? ' on' : ''}" data-vm-saved="${sec}">✓ ${escHtml(tr('gespeichert'))}</span>`;
}
// doFn speichert, undoFn macht es rueckgaengig. Bei Fehler: Hinweis und frisch vom Server laden.
async function vRun(sec, text, doFn, undoFn) {
  try {
    await doFn();
    vMarkSaved(sec);
    vRerender();
    lwToastUndo(text, undoFn ? async () => {
      try { await undoFn(); vMarkSaved(sec); vRerender(); toast(tr('Zurückgenommen')); }
      catch (err) { toast(tr('Fehler: ') + (err?.message || err)); }
    } : null);
  } catch (err) {
    toast(tr('Fehler: ') + (err?.message || err));
    try { await loadMembers(); await loadEntries(); } catch (_) {}
    vRerender();
  }
}

// Profil speichern: der Server will immer den ganzen Stand (Name, Rang, Rolle), die Discord-ID nur, wenn sie
// sich aendert. ch: { newName, rank, honorRole, honorHome, discordId } – nur was sich aendert.
async function vSaveProfile(name, ch) {
  const meta = memberMeta[name] || {};
  const rank = ch.rank ?? vCurrentRank(name);
  const honorRole = 'honorRole' in ch ? ch.honorRole : (meta.honorRole || null);
  const honorHome = 'honorHome' in ch ? ch.honorHome : (meta.honorHome || null);
  const payload = {
    action: 'edit_member', oldName: name, newName: ch.newName ?? name, rank,
    role: rank === 5 ? 'r5' : rank === 4 ? 'r4' : 'normal',
    honor_role: honorRole, honor_home: honorRole ? honorHome : null,
  };
  if ('discordId' in ch) payload.discordId = ch.discordId;
  await apiPost(payload);
  await loadMembers();
}

// Eintrag der Woche lokal setzen, damit der Klick sofort sichtbar ist (der Server bestaetigt danach)
function vApplyLocalFlags(name, flags) {
  const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
  let e = entries.find(x => x.name === name);
  if (!e) { e = { name, rank, baseRank: rank, flags: {}, points: 0, afk: false }; entries.push(e); }
  e.flags = flags;
  e.points = calcPoints(flags);
  e.rank = calcRanking(e.points, e.baseRank || PREV[name] || 3);
  return rank;
}

// Strafe/Bonus/AFK der gewaehlten KW. Alle Flags weg = erfasst mit 0 Punkten (wie in der Eintragen-Liste);
// ganz loeschen geht mit „Wocheneintrag löschen“.
async function vToggleFlag(name, key) {
  if (!vCanWrite()) return;
  const e = entries.find(x => x.name === name);
  const before = e ? { ...e.flags } : null;
  const flags = { ...(before || {}) };
  if (flags[key]) delete flags[key]; else flags[key] = true;
  const rank = vApplyLocalFlags(name, flags);
  vRerender();
  const label = tr(FLAGS.find(f => f.k === key)?.l || key);
  await vRun('week', `${name}: ${label} ${flags[key] ? tr('gesetzt') : tr('entfernt')}`,
    async () => { await apiPost({ action: 'save_entry', name, rank, flags }); await loadEntries(); },
    async () => {
      if (before) await apiPost({ action: 'save_entry', name, rank, flags: before });
      else await apiPost({ action: 'delete_entry', name });
      await loadEntries();
    });
}
window.vToggleFlag = vToggleFlag;
async function toggleVerwaltungFlag(name, key) { return vToggleFlag(name, key); } // frueherer Name
window.toggleVerwaltungFlag = toggleVerwaltungFlag;

async function vDeleteWeekEntry(name) {
  if (!vCanWrite()) return;
  const e = entries.find(x => x.name === name);
  if (!e) return;
  const before = { ...e.flags };
  const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
  entries = entries.filter(x => x.name !== name);
  vRerender();
  await vRun('week', `${name}: ${tr('Wocheneintrag gelöscht')}`,
    async () => { await apiPost({ action: 'delete_entry', name }); await loadEntries(); },
    async () => { await apiPost({ action: 'save_entry', name, rank, flags: before }); await loadEntries(); });
}
window.vDeleteWeekEntry = vDeleteWeekEntry;

const V_JOB_LABELS = { ingenieur: 'Ingenieur', kriegsherr: 'Kriegsanführer' };
async function setVerwaltungBeruf(name, beruf) {
  if (!vCanWrite()) return;
  beruf = beruf || null;
  const m = memberMeta[name] || {};
  const before = { beruf: m.beruf || null, med: m.berufMedHilfe ? 1 : 0, ww: m.berufWinwin || null };
  if (before.beruf === beruf) return;
  await vRun('job', `${name}: ${beruf ? tr(V_JOB_LABELS[beruf]) : tr('kein Beruf')}`,
    async () => { await apiPost({ action: 'save_beruf', name, beruf, med_hilfe: 0, winwin: null }); await loadMembers(); },
    async () => { await apiPost({ action: 'save_beruf', name, beruf: before.beruf, med_hilfe: before.med, winwin: before.ww }); await loadMembers(); });
}
window.setVerwaltungBeruf = setVerwaltungBeruf;

// Med. Hilfe und Win-Win (nur Ingenieur): speichern beim Umschalten bzw. Auswaehlen
async function vSaveBerufSub(name) {
  if (!vCanWrite()) return;
  const m = memberMeta[name] || {};
  const before = { med: m.berufMedHilfe ? 1 : 0, ww: m.berufWinwin || null };
  const med = document.getElementById('v-beruf-medhilfe')?.checked ? 1 : 0;
  const ww = document.getElementById('v-beruf-winwin')?.value || null;
  if (med === before.med && ww === before.ww) return;
  const text = med !== before.med ? `${name}: ${med ? tr('Med. Hilfe an') : tr('Med. Hilfe aus')}` : `${name}: Win-Win ${ww || tr('keins')}`;
  await vRun('job', text,
    async () => { await apiPost({ action: 'save_beruf', name, beruf: 'ingenieur', med_hilfe: med, winwin: ww }); await loadMembers(); },
    async () => { await apiPost({ action: 'save_beruf', name, beruf: 'ingenieur', med_hilfe: before.med, winwin: before.ww }); await loadMembers(); });
}
window.vSaveBerufSub = vSaveBerufSub;

async function vSetRank(name, n) {
  if (!vCanWrite()) return;
  const old = vCurrentRank(name);
  if (old === n) return;
  if (n >= 4 && old < 4 && !confirm(trf('{name} auf R{n} setzen? Damit sieht {name} alle R4-Seiten.', { name, n }))) return;
  await vRun('profile', `${name}: ${tr('Rang')} ${n} · ${RL[n] || ''}`,
    () => vSaveProfile(name, { rank: n }), () => vSaveProfile(name, { rank: old }));
}
window.vSetRank = vSetRank;

const V_ROLE_LABELS = { '': 'Aktives Mitglied', honor_member: 'Ehrenmitglied', honor_r4: 'Ehren R4' };
async function vSetRole(name, role) {
  if (!vCanWrite()) return;
  const meta = memberMeta[name] || {};
  const oldRole = meta.honorRole || null;
  const newRole = role || null;
  if (oldRole === newRole) return;
  const oldRank = vCurrentRank(name);
  const oldHome = meta.honorHome || null;
  if (newRole === 'honor_r4' && !meta.discordId) toast(tr('Ehren-R4 brauchen eine Discord-ID, sonst können sie sich nicht anmelden.'));
  await vRun('profile', `${name}: ${tr(V_ROLE_LABELS[role || ''])}`,
    () => vSaveProfile(name, { honorRole: newRole }),
    () => vSaveProfile(name, { honorRole: oldRole, rank: oldRank, honorHome: oldHome }));
}
window.vSetRole = vSetRole;

async function vSaveHome(name, el) {
  if (!vCanWrite()) { el.value = el.dataset.orig || ''; return; }
  const old = memberMeta[name]?.honorHome || '';
  const val = el.value.trim();
  if (val === old) return;
  await vRun('profile', `${name}: ${tr('Heimat-Allianz')} ${val || '–'}`,
    () => vSaveProfile(name, { honorHome: val || null }), () => vSaveProfile(name, { honorHome: old || null }));
}
window.vSaveHome = vSaveHome;

async function vSaveDiscord(name, el) {
  if (!vCanWrite()) { el.value = el.dataset.orig || ''; return; }
  const old = memberMeta[name]?.discordId || '';
  const val = el.value.trim();
  if (val === old) return;
  if (val && !/^\d{5,30}$/.test(val)) { toast(tr('Discord-ID muss numerisch sein.')); el.value = old; return; }
  await vRun('profile', `${name}: Discord-ID ${val ? tr('gespeichert') : tr('entfernt')}`,
    () => vSaveProfile(name, { discordId: val }), () => vSaveProfile(name, { discordId: old }));
}
window.vSaveDiscord = vSaveDiscord;

// Enter speichert (Feld verlassen), Esc nimmt die Eingabe zurueck
function vFieldKey(e, el) {
  if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
  if (e.key === 'Escape') { el.value = el.dataset.orig || ''; el.blur(); }
}
window.vFieldKey = vFieldKey;

async function vRename(name) {
  if (!vCanWrite()) return;
  const raw = prompt(trf('Neuer Name für {name}? Der alte Name bleibt in der Namens-Historie, alte Links funktionieren weiter.', { name }), name);
  const neu = String(raw || '').trim();
  if (!neu || neu === name) return;
  if (members.includes(neu) || honorMembers.includes(neu)) { toast(tr('Mitglied existiert bereits!')); return; }
  await vRun('profile', `${tr('Umbenannt in')} ${neu}`,
    async () => { await vSaveProfile(name, { newName: neu }); await loadEntries(); vDetailOpen = neu; lwDetailChanged('v', true); },
    async () => { await vSaveProfile(neu, { newName: name }); await loadEntries(); vDetailOpen = name; lwDetailChanged('v', true); });
}
window.vRename = vRename;

// ── Liste ──
function vAvatarHtml(name, meta) {
  const url = getEffectiveAvatarUrl(meta);
  return url
    ? `<img class="v-avatar" src="${escHtml(url)}" alt="">`
    : `<span class="v-avatar placeholder">${escHtml((name || '?').slice(0, 2).toUpperCase())}</span>`;
}
function vRankPill(name, meta) {
  if (meta.honorRole === 'honor_r4') return `<span class="rank-badge vm-honor-pill">👁 ${escHtml(tr('Ehren R4'))}</span>`;
  if (meta.honorRole) return `<span class="rank-badge vm-honor-pill">${escHtml(tr('Ehrenmitglied'))}</span>`;
  const r = vCurrentRank(name);
  return `<span class="rank-badge ${rbClass(r)}">R${r}</span>`;
}
function vRowSub(name, meta) {
  const f = entries.find(x => x.name === name)?.flags || {};
  const parts = [];
  if (f.afk) parts.push('⏸ AFK');
  if (CATS[5]?.f.some(x => f[x.k])) parts.push('❌ ' + tr('Strafe'));
  if (CATS[6]?.f.some(x => f[x.k])) parts.push('⭐ ' + tr('Bonus'));
  if (!meta.discordConnected) parts.push(tr('kein Discord'));
  if (!parts.length && meta.beruf) parts.push(meta.beruf === 'ingenieur' ? '👷 ' + tr('Ingenieur') : '⚔ ' + tr('Kriegsanführer'));
  if (meta.honorRole && meta.honorHome) parts.push(meta.honorHome);
  return parts.join(' · ');
}
function vRowHtml(name) {
  const meta = memberMeta[name] || {};
  const sub = vRowSub(name, meta);
  return `<button type="button" class="vm-row${vDetailOpen === name ? ' is-sel' : ''}" data-action="vSelectMember" data-args="${lwArgs(name)}">
      ${vAvatarHtml(name, meta)}
      <span class="vm-row-text"><span class="vm-row-name">${escHtml(name)}</span>${sub ? `<span class="vm-row-sub">${escHtml(sub)}</span>` : ''}</span>
      ${meta.discordConnected ? '' : `<span class="vm-warn" title="${escHtml(tr('kein Discord'))}">!</span>`}
      ${vRankPill(name, meta)}
      <span class="vm-chev" aria-hidden="true">›</span>
    </button>`;
}
function vMatches(name, q) {
  if (!q) return true;
  const meta = memberMeta[name] || {};
  return [name, meta.discordUsername || '', ...(meta.aliases || [])].some(s => String(s).toLowerCase().includes(q));
}
function vRenderFilters() {
  const el = document.getElementById('v-filters');
  if (!el) return;
  const afkOn = isCatEnabled('afk');
  const counts = {
    all: members.length + honorMembers.length,
    nodiscord: members.concat(honorMembers).filter(n => !memberMeta[n]?.discordConnected).length,
    afk: members.filter(n => entries.find(x => x.name === n)?.flags?.afk).length,
    honor: honorMembers.length,
  };
  const defs = [['all', tr('Alle')], ['nodiscord', tr('Discord fehlt')]];
  if (afkOn) defs.push(['afk', 'AFK']);
  defs.push(['honor', tr('Ehrenrollen')]);
  if (vFilter === 'afk' && !afkOn) vFilter = 'all';
  el.innerHTML = defs.map(([k, l]) =>
    `<button type="button" class="vm-filter${vFilter === k ? ' on' : ''}" data-action="vSetFilter" data-args="${lwArgs(k)}">${escHtml(l)}<b>${counts[k]}</b></button>`
  ).join('');
}

// ── Mitgliedsseite ──
function vSecWeek(name) {
  const cats = [[5, 'strafe'], [6, 'bonus'], [7, 'afk']].filter(([, key]) => isCatEnabled(key)).map(([i]) => CATS[i]);
  if (!cats.length) return '';
  const entry = entries.find(x => x.name === name);
  const flags = entry?.flags || {};
  // Je Art eine kleine Ueberschrift (Strafpunkte, Bonus, AFK), darunter die Knoepfe in ihrer Farbe
  const chips = cats.map(c => `<div class="vm-lbl">${escHtml(tr(c.l))}</div><div class="vm-grid2">${c.f.map(f => {
    const tone = ['r', 'a', 'n'].includes(f.t) ? f.t : 'b';
    return `<button type="button" class="vm-chip vm-c-${tone}${flags[f.k] ? ' on' : ''}" data-action="vToggleFlag" data-args="${lwArgs(name, f.k)}">${escHtml(tr(f.l))}</button>`;
  }).join('')}</div>`).join('');
  return `<div class="vm-sec">
      <div class="vm-sec-head">
        <span class="vm-sec-title">${escHtml(tr('Diese Woche'))} · <b>KW ${formatYearWeek(kw)}</b></span>
        ${vSavedBadge('week')}
        <span class="vm-kw">
          <button type="button" data-action="changeYearWeek" data-args="[-1]" title="${escHtml(tr('Vorherige Woche'))}">‹</button>
          <button type="button" data-action="changeYearWeek" data-args="[1]" title="${escHtml(tr('Nächste Woche'))}">›</button>
        </span>
      </div>
      ${chips}
      <div class="vm-week-foot">
        <span class="vm-hint">${entry ? escHtml(trf('Erfasst · {p} Punkte', { p: entry.points ?? calcPoints(flags) })) : escHtml(tr('Diese Woche noch nicht erfasst'))}</span>
        ${entry ? `<button type="button" class="vm-btn link" data-action="vDeleteWeekEntry" data-args="${lwArgs(name)}">${escHtml(tr('Wocheneintrag löschen'))}</button>` : ''}
      </div>
    </div>`;
}
function vSecJob(name) {
  if (!isFeatureEnabled('berufe')) return '';
  const meta = memberMeta[name] || {};
  const cur = meta.beruf || null;
  const jobs = [[null, '— ' + tr('Kein')], ['ingenieur', '👷 ' + tr('Ingenieur')], ['kriegsherr', '⚔ ' + tr('Kriegsanführer')]];
  let html = `<div class="vm-sec">
      <div class="vm-sec-head"><span class="vm-sec-title">👷 ${escHtml(tr('Beruf'))}</span>${vSavedBadge('job')}</div>
      <div class="vm-grid3">${jobs.map(([v, l]) =>
        `<button type="button" class="vm-chip${cur === v ? ' on' : ''}" data-action="setVerwaltungBeruf" data-args="${lwArgs(name, v)}">${escHtml(l)}</button>`).join('')}</div>`;
  if (cur === 'ingenieur') {
    const khs = members.filter(n => memberMeta[n]?.beruf === 'kriegsherr' && n !== name).sort();
    html += `<label class="vm-switch"><input type="checkbox" id="v-beruf-medhilfe"${meta.berufMedHilfe ? ' checked' : ''} data-on-change="vSaveBerufSub" data-args-change="${lwArgs(name)}"> 🏥 ${escHtml(tr('Med. Hilfe'))}</label>`;
    html += khs.length
      ? `<div class="vm-lbl">${escHtml(tr('Win-Win mit'))}</div><select class="vm-field" id="v-beruf-winwin" data-on-change="vSaveBerufSub" data-args-change="${lwArgs(name)}">
          <option value="">${escHtml(tr('— kein Win-Win —'))}</option>
          ${khs.map(n => `<option value="${escHtml(n)}"${n === meta.berufWinwin ? ' selected' : ''}>${escHtml(n)}</option>`).join('')}
        </select>`
      : `<div class="vm-hint">${escHtml(tr('Keine Kriegsanführer vorhanden'))}</div>`;
  }
  return html + '</div>';
}
function vSecProfile(name) {
  const meta = memberMeta[name] || {};
  const rank = vCurrentRank(name);
  const honorRole = meta.honorRole || '';
  const rankLocked = honorRole === 'honor_r4'; // Ehren-R4 sind immer Rang 4 (Server)
  const ranks = [1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="vm-chip ${n >= 4 ? 'vm-c-r' : 'vm-c-g'}${rank === n ? ' on' : ''}" data-action="vSetRank" data-args="${lwArgs(name, n)}"${rankLocked ? ' disabled' : ''}>${n}<small>${escHtml(RL[n] || '')}</small></button>`).join('');
  const roles = [['', tr('Aktiv')], ['honor_member', tr('Ehrenmitglied')], ['honor_r4', '👁 ' + tr('Ehren R4')]].map(([v, l]) =>
    `<button type="button" class="vm-chip${honorRole === v ? ' on' : ''}" data-action="vSetRole" data-args="${lwArgs(name, v)}">${escHtml(l)}</button>`).join('');
  const swap = meta.discordConnected && meta.discordId && meta.id !== meta.discordId
    ? `<button type="button" class="vm-btn link" data-action="swapMemberIdToDiscord" data-args="${lwArgs(name)}">${escHtml(tr('Spieler-ID auf Discord-ID setzen'))}</button>` : '';
  return `<div class="vm-sec">
      <div class="vm-sec-head"><span class="vm-sec-title">${escHtml(tr('Profil'))}</span>${vSavedBadge('profile')}</div>
      <div class="vm-lbl">${escHtml(tr('Rang'))}</div>
      <div class="vm-grid5">${ranks}</div>
      ${rankLocked ? `<div class="vm-hint">${escHtml(tr('Ehren-R4 haben immer Rang 4.'))}</div>` : ''}
      <div class="vm-lbl">${escHtml(tr('Rolle'))}</div>
      <div class="vm-grid3">${roles}</div>
      ${honorRole ? `<div class="vm-lbl">${escHtml(tr('Heimat-Allianz'))}</div>
        <input class="vm-field" list="v-alliance-list" maxlength="50" value="${escHtml(meta.honorHome || '')}" data-orig="${escHtml(meta.honorHome || '')}" placeholder="${escHtml(tr('z. B. IvX'))}"
          data-on-focus="fillHonorHomeAllianceList" data-on-change="vSaveHome" data-args-change="${lwArgs(name, LW_EL)}" data-on-keydown="vFieldKey" data-args-keydown="${lwArgs(LW_EVENT, LW_EL)}">` : ''}
      <div class="vm-lbl">Discord-ID</div>
      <input class="vm-field" inputmode="numeric" autocomplete="off" value="${escHtml(meta.discordId || '')}" data-orig="${escHtml(meta.discordId || '')}" placeholder="${escHtml(tr('numerisch oder leer'))}"
        data-on-change="vSaveDiscord" data-args-change="${lwArgs(name, LW_EL)}" data-on-keydown="vFieldKey" data-args-keydown="${lwArgs(LW_EVENT, LW_EL)}">
      <div class="vm-hint">${escHtml(tr('Speichert beim Verlassen des Felds oder mit Enter. Esc nimmt zurück.'))}</div>
      ${swap}
      <div class="vm-lbl">${escHtml(tr('Name'))}</div>
      <button type="button" class="vm-btn wide" data-action="vRename" data-args="${lwArgs(name)}">✎ ${escHtml(tr('Umbenennen…'))}</button>
    </div>`;
}
function vMetaLine(name, meta) {
  const parts = [];
  const prev = (meta.aliases || []).filter(a => a && a !== name);
  if (prev.length) parts.push(`${escHtml(tr('früher'))} <b>${escHtml(prev.slice(-2).join(', '))}</b>`);
  parts.push(`Discord <b>${meta.discordConnected ? '✓ ' + escHtml(meta.discordUsername || '') : escHtml(tr('fehlt'))}</b>`);
  if (meta.lastVisitAt) {
    const d = new Date(String(meta.lastVisitAt).replace(' ', 'T') + 'Z');
    parts.push(`${escHtml(tr('zuletzt da'))} <b>${escHtml(d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</b>`);
  } else {
    parts.push(`<b>${escHtml(tr('Noch nie eingeloggt'))}</b>`);
  }
  if (meta.power) parts.push(`Power <b>${escHtml((meta.power / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 }))} Mio</b>`);
  if (meta.hq) parts.push(`HQ <b>${escHtml(meta.hq)}</b>`);
  return `<div class="vm-meta">${parts.map(p => `<span>${p}</span>`).join('')}</div>`;
}
function vRenderDetail() {
  const el = document.getElementById('v-detail');
  if (!el) return;
  const name = vDetailOpen;
  if (!name) { el.innerHTML = `<div class="vm-empty">${escHtml(tr('Links ein Mitglied wählen'))}</div>`; return; }
  const meta = memberMeta[name] || {};
  const isHonor = !!meta.honorRole;
  el.innerHTML = `
    <div class="vm-head">
      <button type="button" class="vm-back" data-action="vBackToList" aria-label="${escHtml(tr('Zurück'))}">←</button>
      ${vAvatarHtml(name, meta)}
      <div class="vm-name">${escHtml(name)}</div>
      ${vRankPill(name, meta)}
    </div>
    ${vMetaLine(name, meta)}
    ${isHonor ? '' : vSecWeek(name)}
    ${isHonor ? '' : vSecJob(name)}
    ${vSecProfile(name)}
    ${isHonor ? '' : `<div class="vm-row-btns">
        <button type="button" class="vm-btn" data-action="openTeamEditor" data-args="${lwArgs(name)}">⚔ ${escHtml(tr('Teams'))}</button>
        <button type="button" class="vm-btn" data-action="openMemberMeInApp" data-args="${lwArgs(name)}">👁 ${escHtml(tr('Me-Ansicht'))}</button>
      </div>`}
    <div class="vm-sec vm-danger">
      <div class="vm-sec-head"><span class="vm-sec-title">${escHtml(tr('Gefahrenzone'))}</span></div>
      <button type="button" class="vm-btn danger wide" data-action="removeMember" data-args="${lwArgs(name)}">🗑 ${escHtml(tr('Entfernen…'))}</button>
    </div>`;
  // „✓ gespeichert“ nach kurzer Zeit ausblenden
  el.querySelectorAll('.vm-saved.on').forEach(b => {
    const left = 1800 - (Date.now() - (vSavedAt[b.dataset.vmSaved] || 0));
    setTimeout(() => b.classList.remove('on'), Math.max(0, left));
  });
}


function renderVerwaltung(filter=''){
  if (!document.getElementById('v-stats')) return; // R4-Seiten noch nicht geladen (z. B. Sprachwechsel beim Start)
  const missingDiscord = members.filter((n) => !memberMeta[n]?.discordConnected).length;
  const pendingAccess = accessRequests.length;
  // Ehrenrollen sind im Spiel nicht in der Allianz und zaehlen nicht mit (eigene Zeilen unten)
  const totalMembers = members.length;
  const honorR4Count = honorMembers.filter(n => memberMeta[n]?.honorRole === 'honor_r4').length;
  const honorMemberCount = honorMembers.length - honorR4Count;
  document.getElementById('v-stats').innerHTML=`
    <div class="v-stat-row"><span class="v-stat-label">${escHtml(tr('Gesamt'))}</span><span class="v-stat-value v-stat-value--gold">${totalMembers}</span></div>
    <div class="v-stat-row"><span class="v-stat-label">${escHtml(tr('R5 Chef'))}</span><span class="v-stat-value v-stat-value--purple">${R5.size}</span></div>
    <div class="v-stat-row"><span class="v-stat-label">${escHtml(tr('R4 Leader'))}</span><span class="v-stat-value v-stat-value--red">${R4.size}</span></div>
    <div class="v-stat-row"><span class="v-stat-label">R1–R3</span><span class="v-stat-value v-stat-value--green">${members.filter(n=>!R4.has(n)&&!R5.has(n)).length}</span></div>
    <div class="v-stat-row"><span class="v-stat-label">${escHtml(tr('Ehren-R4'))} <span class="v-stat-note">(${escHtml(tr('zählen nicht mit'))})</span></span><span class="v-stat-value v-stat-value--honor">${honorR4Count}</span></div>
    <div class="v-stat-row"><span class="v-stat-label">${escHtml(tr('Ehrenmitglieder'))} <span class="v-stat-note">(${escHtml(tr('zählen nicht mit'))})</span></span><span class="v-stat-value v-stat-value--honor">${honorMemberCount}</span></div>
    <div class="v-stat-row"><span class="v-stat-label">${escHtml(tr('Discord noch offen'))}</span><span class="v-stat-value ${missingDiscord ? 'v-stat-value--red' : 'v-stat-value--green'}">${missingDiscord}</span></div>
    <div class="v-stat-row v-stat-row--last"><span class="v-stat-label">${escHtml(tr('Login-Anfragen offen'))}</span><span class="v-stat-value ${pendingAccess ? 'v-stat-value--blue' : 'v-stat-value--green'}">${pendingAccess}</span></div>`;

  // Mitglied weg (entfernt oder umbenannt)? Dann zurueck zur Liste
  if (vDetailOpen && !members.includes(vDetailOpen) && !honorMembers.includes(vDetailOpen)) vDetailOpen = null;
  const q = String(filter || '').trim().toLowerCase();
  let shownActive = vFilter === 'honor' ? [] : members.filter(n => vMatches(n, q));
  let shownHonor = honorMembers.filter(n => vMatches(n, q));
  if (vFilter === 'nodiscord') {
    shownActive = shownActive.filter(n => !memberMeta[n]?.discordConnected);
    shownHonor = shownHonor.filter(n => !memberMeta[n]?.discordConnected);
  }
  if (vFilter === 'afk') {
    shownActive = shownActive.filter(n => entries.find(x => x.name === n)?.flags?.afk);
    shownHonor = [];
  }
  vRenderFilters();
  const list = document.getElementById('v-list');
  const honorHeader = `<div class="v-honor-header">${escHtml(tr('Ehrenrollen'))} <span class="v-honor-header-sub">· ${escHtml(tr('sehen zu, ändern nichts, zählen nicht mit'))}</span></div>`;
  list.innerHTML = (shownActive.map(vRowHtml).join('') + (shownHonor.length ? honorHeader + shownHonor.map(vRowHtml).join('') : ''))
    || '<div class="empty">' + escHtml(tr('Keine Mitglieder gefunden.')) + '</div>';
  vRenderDetail();
  document.getElementById('v-layout')?.classList.toggle('has-sel', !!vDetailOpen);
  document.getElementById('page-v')?.classList.toggle('v-member-open', !!vDetailOpen);
  renderAccessRequests();
}

function renderAccessRequests() {
  const wrap = document.getElementById('v-access-requests');
  const count = document.getElementById('v-access-count');
  if (!wrap || !count) return;

  count.textContent = `${accessRequests.length} ${tr('offen')}`;
  if (!accessRequests.length) {
    wrap.innerHTML = '<div class="v-access-empty">' + escHtml(tr('Keine offenen Anfragen.')) + '</div>';
    return;
  }

  wrap.innerHTML = accessRequests.map((r) => {
    const reqId = String(r.request_id || '').replace(/'/g, "\\'");
    const reqIdRaw = String(r.request_id || '');
    const selectId = `v-map-target-${reqIdRaw}`;
    const when = r.created_at ? new Date(r.created_at).toLocaleString('de-DE') : 'unbekannt';
    const dcName = r.discord_username || 'Unbekannt';
    const wanted = String(r.requested_player_name || '').trim().toLowerCase();
    const exact = members.find((m) => m.toLowerCase() === wanted);
    const includes = exact ? null : members.find((m) => wanted && m.toLowerCase().includes(wanted));
    const suggested = exact || includes || '';
    const options = [`<option value="">${escHtml(tr('Mitglied auswählen ...'))}</option>`]
      .concat(members.map((m) => `<option value="${escHtml(m)}" ${m===suggested?'selected':''}>${escHtml(m)}</option>`))
      .join('');
    return `<div class="v-access-row">
      <div class="v-access-main">
        <div>
          <div class="v-access-name">${escHtml(r.requested_player_name || 'Unbekannt')}</div>
          <div class="v-access-meta">Allianz: ${escHtml(r.requested_alliance || 'INY')} · Discord: ${escHtml(r.discord_user_id || 'n/a')} (${escHtml(dcName)})</div>
          <div class="v-access-meta">Anfrage: ${escHtml(when)}${r.note ? ` · Hinweis: ${escHtml(r.note)}` : ''}</div>
        </div>
      </div>
      <div class="v-access-actions">
        <button class="v-btn save" data-action="acceptAccessRequestAsNew" data-args="${lwArgs(reqIdRaw)}">${escHtml(tr('Als neues Mitglied'))}</button>
        <select class="v-map-select" id="${escHtml(selectId)}">${options}</select>
        <button class="v-btn map" data-action="mapAccessRequestToMember" data-args="${lwArgs(reqIdRaw)}">${escHtml(tr('Auf Member mappen'))}</button>
        <button class="v-btn reject" data-action="rejectAccessRequest" data-args="${lwArgs(reqIdRaw)}">${escHtml(tr('Ablehnen'))}</button>
      </div>
    </div>`;
  }).join('');
}

async function acceptAccessRequestAsNew(requestId) {
  const req = accessRequests.find((x) => x.request_id === requestId);
  if (!req) return;

  const name = (req.requested_player_name || '').trim();
  if (!name) {
    toast('Anfrage ohne Spielername.');
    return;
  }
  if (members.includes(name)) {
    toast('Name existiert bereits. Bitte "Auf Member mappen" nutzen.');
    return;
  }

  try {
    await apiPost({ action: 'add_member', name, rank: 3, role: 'normal' });
    await apiPost({ action: 'edit_member', oldName: name, newName: name, rank: 3, role: 'normal', discordId: req.discord_user_id || '' });
    await apiPost({ action: 'resolve_access_request', requestId, status: 'accepted' });
    await loadMembers();
    await loadEntries();
    await loadAccessRequests();
    renderVerwaltung(document.getElementById('v-search').value.toLowerCase());
    toast(name + ' wurde angelegt und verknüpft.');
  } catch (err) {
    toast(tr('Fehler: ') + err.message);
  }
}
window.acceptAccessRequestAsNew = acceptAccessRequestAsNew;

async function mapAccessRequestToMember(requestId) {
  const req = accessRequests.find((x) => x.request_id === requestId);
  if (!req) return;

  const select = document.getElementById(`v-map-target-${requestId}`);
  const targetName = (select?.value || '').trim();
  if (!targetName) {
    toast('Bitte im Dropdown ein Mitglied auswählen.');
    return;
  }
  if (!members.includes(targetName)) {
    toast('Mitglied nicht gefunden: ' + targetName);
    return;
  }

  const rank = R5.has(targetName) ? 5 : R4.has(targetName) ? 4 : (PREV[targetName] || 3);
  const role = rank===5?'r5':rank===4?'r4':'normal';

  try {
    await apiPost({ action: 'edit_member', oldName: targetName, newName: targetName, rank, role, discordId: req.discord_user_id || '' });
    await apiPost({ action: 'resolve_access_request', requestId, status: 'mapped' });
    await loadMembers();
    await loadEntries();
    await loadAccessRequests();
    renderVerwaltung(document.getElementById('v-search').value.toLowerCase());
    toast('Discord-ID auf ' + targetName + ' gemappt.');
  } catch (err) {
    toast(tr('Fehler: ') + err.message);
  }
}
window.mapAccessRequestToMember = mapAccessRequestToMember;

async function rejectAccessRequest(requestId) {
  try {
    await apiPost({ action: 'resolve_access_request', requestId, status: 'rejected' });
    await loadAccessRequests();
    renderVerwaltung(document.getElementById('v-search').value.toLowerCase());
    toast('Anfrage abgelehnt.');
  } catch (err) {
    toast(tr('Fehler: ') + err.message);
  }
}
window.rejectAccessRequest = rejectAccessRequest;

async function swapMemberIdToDiscord(name){
  const meta = memberMeta[name] || {};
  if(!meta.discordConnected || !meta.discordId){
    toast('Dieser Member ist noch nicht per Discord verbunden.');
    return;
  }
  if(meta.id === meta.discordId){
    toast('ID ist bereits identisch mit der Discord-ID.');
    return;
  }
  if(!confirm(`Spieler-ID wirklich auf Discord-ID setzen?\n${meta.id || 'unbekannt'} -> ${meta.discordId}`)) return;
  try {
    await apiPost({ action: 'swap_member_id_to_discord', name });
    await loadMembers();
    await loadEntries();
    renderVerwaltung(document.getElementById('v-search').value.toLowerCase());
    toast(name+' ID auf Discord-ID gesetzt.');
  } catch(err) {
    toast(tr('Fehler: ') + err.message);
  }
}
window.swapMemberIdToDiscord = swapMemberIdToDiscord;

async function removeMember(name){
  if (!vCanWrite()) return;
  if (!confirm(trf('{name} wirklich entfernen?', { name }))) return;
  try {
    await apiPost({ action: 'delete_member', name });
  } catch (err) { toast(tr('Fehler: ') + (err?.message || err)); return; }
  await loadMembers();
  await loadEntries();
  if (vDetailOpen === name) vDetailOpen = null;
  vRerender();
  lwDetailChanged('v', true);
  renderDashboard(); toast(name+' entfernt!');
}
window.removeMember=removeMember;
