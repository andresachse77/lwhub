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

let editingMember=null;
let vDetailOpen=null; // name of member with expanded detail in Verwaltung

// ── VERWALTUNG DETAIL / FLAG TOGGLE ──
function toggleVerwaltungRow(name) {
  if (vDetailOpen === name) {
    vDetailOpen = null;
    editingMember = null;
  } else {
    vDetailOpen = name;
  }
  renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
  lwDetailChanged('v'); // /members/<name>: aufgeklapptes Mitglied hat einen eigenen Link
}
window.toggleVerwaltungRow = toggleVerwaltungRow;

// Mitglied aus dem Link aufklappen (/members/lion%20tooth). Gross/Klein egal; ein frueherer Name findet ueber
// die Namens-Historie (memberMeta.aliases) den heutigen, die Adresse zeigt danach den neuen Namen.
// Leerer Wert: alles zuklappen. Zeichnet die Liste immer neu.
function vOpenMemberFromLink(value) {
  const want = String(value || '').trim().toLowerCase();
  const all = members.concat(honorMembers);
  const name = !want ? null
    : all.find((n) => n.toLowerCase() === want)
      || all.find((n) => (memberMeta[n]?.aliases || []).some((a) => String(a).toLowerCase() === want));
  if (want && !name) toast(tr('s_member_not_found').replace('{name}', value));
  if (vDetailOpen !== name) editingMember = null;
  vDetailOpen = name || null;
  // Suche leeren, sonst ist das Mitglied evtl. ausgefiltert
  const search = document.getElementById('v-search');
  if (name && search && search.value && !name.toLowerCase().includes(search.value.toLowerCase())) search.value = '';
  renderVerwaltung(search?.value.toLowerCase() || '');
  if (name) requestAnimationFrame(() => document.querySelector('#v-list .v-row-wrap.is-open')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
}

async function toggleVerwaltungFlag(name, flagKey) {
  let e = entries.find(x => x.name === name);
  const rank = isFixed(name) ? fixedRank(name) : (PREV[name] || 3);
  if (!e) { e = { name, rank, baseRank: rank, flags: {}, points: 0, afk: false }; entries.push(e); }
  const flags = e.flags;
  if (flags[flagKey]) delete flags[flagKey]; else flags[flagKey] = true;
  e.points = calcPoints(flags); e.rank = calcRanking(e.points, e.baseRank || PREV[name] || 3);
  renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
  try {
    if (!Object.values(flags).some(Boolean)) {
      entries = entries.filter(x => x.name !== name);
      await apiPost({ action: 'delete_entry', name });
    } else {
      await apiPost({ action: 'save_entry', name, rank, flags: {...flags} });
    }
    await loadEntries();
    renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
  } catch (err) {
    toast(tr('Fehler: ') + err.message);
    await loadEntries();
    renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
  }
}
window.toggleVerwaltungFlag = toggleVerwaltungFlag;

function buildVerwaltungBerufHtml(name, esc, meta) {
  if (!isFeatureEnabled('berufe')) return '';
  const currentBeruf = meta.beruf || null;
  const currentMedHilfe = !!meta.berufMedHilfe;
  const currentWinwin = meta.berufWinwin || null;
  const kriegsherren = members.filter(function(n) { return memberMeta[n] && memberMeta[n].beruf === 'kriegsherr' && n !== name; }).sort();

  const berufDefs = [
    { v: null,         l: '— ' + tr('Kein') },
    { v: 'ingenieur',  l: '👷 ' + tr('Ingenieur') },
    { v: 'kriegsherr', l: '⚔ ' + tr('Kriegsanführer') },
  ];
  let berufBtns = '';
  for (let i = 0; i < berufDefs.length; i++) {
    const o = berufDefs[i];
    const active = currentBeruf === o.v;
    berufBtns += '<button class="flag-btn' + (active ? ' v-beruf-on' : '') + '" data-stop="click" data-action="setVerwaltungBeruf" data-args="' + lwArgs(name, o.v) + '">' + o.l + '</button>';
  }

  let subHtml = '';
  if (currentBeruf === 'ingenieur') {
    let winwinEl;
    if (kriegsherren.length) {
      let opts = '<option value="">' + escHtml(tr('— kein Win-Win —')) + '</option>';
      for (let i = 0; i < kriegsherren.length; i++) {
        const n = kriegsherren[i];
        opts += '<option value="' + escHtml(n) + '"' + (n === currentWinwin ? ' selected' : '') + '>' + escHtml(n) + '</option>';
      }
      winwinEl = '<select class="v-rank-sel v-beruf-winwin" id="v-beruf-winwin" data-stop="click">' + opts + '</select>';
    } else {
      winwinEl = '<span class="v-beruf-empty">' + escHtml(tr('Keine Kriegsanführer vorhanden')) + '</span>';
    }
    subHtml = '<div class="v-beruf-sub">'
      + '<label class="v-beruf-medhilfe">'
      + '<input type="checkbox" id="v-beruf-medhilfe"' + (currentMedHilfe ? ' checked' : '') + '> 🏥 ' + escHtml(tr('Med. Hilfe'))
      + '</label>' + winwinEl + '</div>'
      + '<button class="v-btn save v-beruf-save" data-stop="click" data-action="saveVerwaltungBerufSub" data-args="' + lwArgs(name) + '">✓ ' + escHtml(tr('Beruf speichern')) + '</button>';
  }

  return '<div class="flag-cat v-beruf-cat">'
    + '<div class="flag-cat-title">👷 ' + escHtml(tr('Beruf')) + '</div>'
    + '<div class="flag-btns">' + berufBtns + '</div>'
    + subHtml
    + '</div>';
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

  const shownActive = filter ? members.filter(n=>n.toLowerCase().includes(filter)) : members;
  const shownHonor  = filter ? honorMembers.filter(n=>n.toLowerCase().includes(filter)) : honorMembers;
  const shown = shownActive.concat(shownHonor);
  const list=document.getElementById('v-list');
  if(!shown.length){
    list.innerHTML='<div class="empty">' + escHtml(tr('Keine Mitglieder gefunden.')) + '</div>';
    renderAccessRequests();
    return;
  }

  list.innerHTML=shown.map((name, idx)=>{
    const role=R5.has(name)?5:R4.has(name)?4:(PREV[name]||3);
    const meta = memberMeta[name] || {};
    const honorRole = meta.honorRole || null;
    const isHonor = !!honorRole;
    const honorBadgeText = (honorRole === 'honor_r4' ? tr('Ehren R4') : (honorRole === 'honor_member' ? tr('Ehrenmitglied') : ''))
      + (isHonor && meta.honorHome ? ` · ${meta.honorHome}` : '');
    const esc = name.replace(/'/g,"\\'");
    const effectiveAvatar = getEffectiveAvatarUrl(meta);
    const avatar = effectiveAvatar
      ? `<img class="v-avatar" src="${escHtml(effectiveAvatar)}" alt="">`
      : `<div class="v-avatar placeholder">${escHtml((name||'?').slice(0,2).toUpperCase())}</div>`;
    const discordState = meta.discordConnected
      ? `<span class="v-state ok">Discord ✓</span>`
      : `<span class="v-state warn">${escHtml(tr('kein Discord'))}</span>`;

    const isOpen = vDetailOpen === name;
    const isEditing = editingMember === name && isOpen;

    let detailHtml = '';
    if (isOpen) {
      const entry = entries.find(x => x.name === name);
      const currentFlags = entry ? {...entry.flags} : {};

      let memberInfoHtml = '';
      if (isEditing) {
        memberInfoHtml = `
          <div class="v-edit-row">
            <div class="v-edit-field">
              <div class="vlabel">Name</div>
              <input class="vinput" id="v-edit-input" value="${name.replace(/"/g,'&quot;')}" data-on-keydown="saveMemberEditOnEnter" data-args-keydown="${lwArgs(LW_EVENT, name)}">
            </div>
            <div class="v-edit-field">
              <div class="vlabel">Discord-ID</div>
              <input class="vinput" id="v-edit-discord" value="${(meta.discordId||'').replace(/"/g,'&quot;')}" placeholder="${escHtml(tr('numerisch oder leer'))}">
            </div>
          </div>
          <div class="v-edit-block">
            <div class="vlabel">${escHtml(tr('Rang'))}</div>
            <select class="v-rank-sel" id="v-edit-rank">
              <option value="1" ${role===1?'selected':''}>1 · ${escHtml(RL[1])}</option>
              <option value="2" ${role===2?'selected':''}>2 · ${escHtml(RL[2])}</option>
              <option value="3" ${role===3?'selected':''}>3 · ${escHtml(RL[3])}</option>
              <option value="4" ${role===4?'selected':''}>4 · ${escHtml(RL[4])} (R4)</option>
              <option value="5" ${role===5?'selected':''}>5 · ${escHtml(RL[5])} (R5)</option>
            </select>
          </div>
          <div class="v-edit-block">
            <div class="vlabel">${escHtml(tr('Rolle/Status'))}</div>
            <select class="v-rank-sel" id="v-edit-honor-role">
              <option value="" ${!isHonor?'selected':''}>${escHtml(tr('Aktives Mitglied'))}</option>
              <option value="honor_member" ${honorRole==='honor_member'?'selected':''}>${escHtml(tr('Ehrenmitglied'))}</option>
              <option value="honor_r4" ${honorRole==='honor_r4'?'selected':''}>${escHtml(tr('Ehren R4'))}</option>
            </select>
          </div>
          <div class="v-edit-block">
            <div class="vlabel">${escHtml(tr('Heimat-Allianz'))} <span class="v-edit-hint">(${escHtml(tr('nur bei Ehrenrolle'))})</span></div>
            <input class="vinput" id="v-edit-honor-home" list="v-alliance-list" value="${escHtml(meta.honorHome||'')}" placeholder="${escHtml(tr('z. B. IvX'))}" maxlength="50" data-on-focus="fillHonorHomeAllianceList">
          </div>`;
      } else {
        const lastVisitStr = meta.lastVisitAt
          ? (() => { const d = new Date(meta.lastVisitAt.replace(' ','T')+'Z'); return d.toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}); })()
          : null;
        memberInfoHtml = `
          <div class="v-info-line">
            <span>Discord-ID: ${escHtml(meta.discordId||'–')}${meta.discordUsername?` (${escHtml(meta.discordUsername)})`:''}</span>
            <span>·</span><span>${escHtml(tr('Spieler-ID'))}: ${escHtml(meta.id||'–')}</span>
            ${isHonor ? `<span>·</span><span>${escHtml(tr('Heimat-Allianz'))}: ${escHtml(meta.honorHome||'–')}${meta.honorHomeAlliance ? ' ✓ lwhub' : ''}</span>` : ''}
            ${lastVisitStr?`<span class="v-last-visit">· 🕐 ${lastVisitStr}</span>`:`<span class="v-never-visited">· ${escHtml(tr('Noch nie eingeloggt'))}</span>`}
          </div>`;
      }

      // Non-event flags: Strafpunkte (5), Bonus (6), AFK (7)
      const flagsHtml = isHonor ? '' : [
        { cat: CATS[5], key: 'strafe' },
        { cat: CATS[6], key: 'bonus' },
        { cat: CATS[7], key: 'afk' }
      ].map(({ cat, key }) => {
        if (!isCatEnabled(key)) return '';
        const btns = cat.f.map(f => {
          const on = !!currentFlags[f.k];
          const onClass = f.t==='r'?' v-flag-on-r'
            :f.t==='a'?' v-flag-on-a'
            :f.t==='n'?' v-flag-on-n'
            :' v-flag-on-b';
          return `<button class="flag-btn${on?onClass:''}" data-stop="click" data-action="toggleVerwaltungFlag" data-args="${lwArgs(name, f.k)}">${escHtml(tr(f.l))}</button>`;
        }).join('');
        return `<div class="flag-cat" data-css="${escHtml('background:' + cat.bg + ';border:1px solid ' + cat.bc)}">
          <div class="flag-cat-title" data-css="${escHtml('color:' + cat.lc)}">${cat.l} <small class="v-flagcat-kw">KW ${formatYearWeek(kw)}</small></div>
          <div class="flag-btns">${btns}</div>
        </div>`;
      }).join('');

      const actionBtns = isEditing
        ? `<div class="v-actions">
            <button class="v-btn save" data-stop="click" data-action="saveMemberEdit" data-args="${lwArgs(name)}">✓ Speichern</button>
            <button class="v-btn cancel" data-stop="click" data-action="cancelEdit">✕ Abbrechen</button>
          </div>`
        : `<div class="v-actions v-actions--wrap">
            <button class="v-btn edit" data-stop="click" data-action="startEdit" data-args="${lwArgs(name)}">✏ ${escHtml(tr('Bearbeiten'))}</button>
            <button class="v-btn del" data-stop="click" data-action="removeMember" data-args="${lwArgs(name)}">🗑 ${escHtml(tr('Entfernen'))}</button>
            ${isHonor ? '' : `<button class="v-btn v-btn-teams" data-stop="click" data-action="openTeamEditor" data-args="${lwArgs(name)}">⚔ ${escHtml(tr('Teams'))}</button>`}
            ${isHonor ? '' : `<button class="v-btn v-btn-me" data-stop="click" data-action="openMemberMeInApp" data-args="${lwArgs(name)}">👁 ${escHtml(tr('Me-Ansicht'))}</button>`}
          </div>`;

      detailHtml = '<div class="v-detail" data-stop="click">'
        + memberInfoHtml
        + (flagsHtml ? '<div class="flag-cats">' + flagsHtml + '</div>' : '')
        + (isHonor ? '' : buildVerwaltungBerufHtml(name, esc, meta))
        + actionBtns
        + '</div>';
    }

    const honorSectionHeader = (shownHonor.length && idx === shownActive.length)
      ? `<div class="v-honor-header">${escHtml(tr('Ehrenrollen'))} <span class="v-honor-header-sub">· ${escHtml(tr('sehen zu, ändern nichts, zählen nicht mit'))}</span></div>`
      : '';

    return `${honorSectionHeader}<div class="v-row-wrap${isOpen?' is-open':''}" data-action="toggleVerwaltungRow" data-args="${lwArgs(name)}">
      <div class="v-row">
        <div class="v-member">
          ${avatar}
          <div class="v-member-text">
            <div class="v-name">${escHtml(name)}</div>
          </div>
        </div>
        ${discordState}
        <span class="rank-badge ${rbClass(role)}">${role} · ${RL[role]||''}${isHonor ? ` · ${escHtml(honorBadgeText)}` : ''}</span>
        <span class="v-row-arrow">${isOpen?'▲':'▼'}</span>
      </div>
      ${detailHtml}
    </div>`;
  }).join('');

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

function startEdit(name){ vDetailOpen=name; editingMember=name; renderVerwaltung(document.getElementById('v-search').value.toLowerCase()); setTimeout(()=>document.getElementById('v-edit-input')?.focus(),50); }
function cancelEdit(){ editingMember=null; renderVerwaltung(document.getElementById('v-search').value.toLowerCase()); }
window.startEdit=startEdit; window.cancelEdit=cancelEdit;

async function saveMemberEdit(oldName){
  const newName=document.getElementById('v-edit-input')?.value.trim();
  const newRank=parseInt(document.getElementById('v-edit-rank')?.value||3);
  const honorRole=(document.getElementById('v-edit-honor-role')?.value || '').trim() || null;
  const honorHome=honorRole ? ((document.getElementById('v-edit-honor-home')?.value || '').trim() || null) : null;
  const discordIdRaw=document.getElementById('v-edit-discord')?.value.trim() || '';
  if(!newName){toast('Name darf nicht leer sein!');return;}
  if(discordIdRaw && !/^\d{5,30}$/.test(discordIdRaw)){
    toast('Discord-ID muss numerisch sein.');
    return;
  }
  const role = newRank===5?'r5':newRank===4?'r4':'normal';
  await apiPost({ action: 'edit_member', oldName, newName, rank: newRank, role, honor_role: honorRole, honor_home: honorHome, discordId: discordIdRaw });
  await loadMembers();
  await loadEntries();
  if (vDetailOpen === oldName) vDetailOpen = newName;
  editingMember=null;
  renderVerwaltung(document.getElementById('v-search').value.toLowerCase());
  lwDetailChanged('v', true); // neuer Name auch in der Adresse
  toast(newName+' gespeichert!');
}
window.saveMemberEdit=saveMemberEdit;

async function setVerwaltungBeruf(name, beruf) {
  beruf = beruf || null;
  try {
    await apiPost({ action: 'save_beruf', name, beruf, med_hilfe: 0, winwin: null });
    await loadMembers();
    renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
  } catch(err) { toast(tr('Fehler: ') + err.message); }
}
window.setVerwaltungBeruf = setVerwaltungBeruf;

async function saveVerwaltungBerufSub(name) {
  const medHilfe = document.getElementById('v-beruf-medhilfe')?.checked ? 1 : 0;
  const winwin = document.getElementById('v-beruf-winwin')?.value || null;
  try {
    await apiPost({ action: 'save_beruf', name, beruf: 'ingenieur', med_hilfe: medHilfe, winwin });
    await loadMembers();
    renderVerwaltung(document.getElementById('v-search')?.value.toLowerCase() || '');
    toast('Beruf gespeichert!');
  } catch(err) { toast(tr('Fehler: ') + err.message); }
}
window.saveVerwaltungBerufSub = saveVerwaltungBerufSub;

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
  if(!confirm('"'+name+'" wirklich entfernen?')) return;
  await apiPost({ action: 'delete_member', name });
  await loadMembers();
  await loadEntries();
  if (vDetailOpen === name) vDetailOpen = null;
  if (editingMember === name) editingMember = null;
  renderVerwaltung(document.getElementById('v-search').value.toLowerCase());
  lwDetailChanged('v', true);
  renderDashboard(); toast(name+' entfernt!');
}
window.removeMember=removeMember;
