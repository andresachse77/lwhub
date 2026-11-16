// LWHub – Admin (/admin): Allianzen, Archiv, Transfer, Zusammenführen, Admins, API-Tokens
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Seiten herauslösen“).
// Normales Script, kein Modul: lädt nach dem großen <script> in index.html und vor assets/js/start.js.

// ══════════════════════════════════════════════════════
//  ADMIN PAGE
// ══════════════════════════════════════════════════════
let adminLoaded = false;
let _adminAlliances = [];

function adminRankLabel(r) {
  return { 1:'Rookie', 2:'Pro', 3:'Elite', 4:'Leader', 5:'Chef' }[r] || 'Unbekannt';
}
function adminRankColor(r) {
  return { 1:'#f0a500', 2:'#2ecb7a', 3:'#4a9eff', 4:'#e05545', 5:'#9b6dff' }[r] || '#7a8498';
}

async function adminApi(path, options = {}) {
  const base = window.getApiBase();
  const res = await fetch(base + path, { ...options, headers: { ...lwhubAuthHeaders(), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw lwhubAuthProblem(res.status, data) || new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function adminInitPage() {
  if (adminLoaded) return;
  adminLoaded = true;
  await loadAlliances();
  loadArchive();
  loadAdmins();
}

function adminShowTab(name, btn) {
  document.querySelectorAll('#page-a .admin-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#page-a .admin-nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('admin-section-' + name)?.classList.add('active');
  btn?.classList.add('active');
  if (name === 'transfer') loadTransferAlliances();
  if (name === 'merge') loadMergeAlliances();
  if (name === 'tokens') adminInitApiTokensTab();
  lwSubChanged('a');
}

// ── Admin Feature Config ──
let adminFlagConfigCache = {}; // { allianceName: {key: bool, ...} }

function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
function openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }

// ── Alliances ──
async function loadAlliances() {
  try {
    const data = await adminApi('/alliances');
    _adminAlliances = data.alliances || [];
    renderAllianceList();
    const sel = document.getElementById('archive-alliance-filter');
    if (sel) {
      sel.innerHTML = '<option value="">Alle Allianzen</option>' +
        _adminAlliances.map(a => `<option value="${escHtml(a.short_name)}">${escHtml(a.short_name)}</option>`).join('');
    }
  } catch (e) {
    const el = document.getElementById('alliance-list');
    if (el) el.innerHTML = `<div class="empty"></div>`;
  }
}

function renderAllianceList() {
  const el = document.getElementById('alliance-list');
  if (!el) return;
  if (!_adminAlliances.length) { el.innerHTML = '<div class="empty">Keine Allianzen gefunden.</div>'; return; }
  el.innerHTML = _adminAlliances.map(a => `
    <div class="alliance-row" style="cursor:pointer;" data-action="allianceRowClick" data-args="${lwArgs(LW_EVENT, a.short_name)}">
      <div class="alliance-short">${escHtml(a.short_name)}</div>
      <div class="alliance-title-text">
        ${a.title ? escHtml(a.title) : '<em style="color:var(--soft)">Kein Titel</em>'}
        <small>Erstellt: ${a.created_at ? a.created_at.slice(0,10) : '-'}</small>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        ${a.accepts_requests
          ? '<span style="font-size:11px;background:rgba(46,203,122,0.15);color:var(--green);border:1px solid rgba(46,203,122,0.3);border-radius:6px;padding:2px 8px;">Anfragen offen</span>'
          : '<span style="font-size:11px;color:var(--soft);">Anfragen geschlossen</span>'}
        <div class="alliance-actions">
          <button class="btn btn-ghost btn-sm" data-action="openAllianceFeatures" data-args="${lwArgs(a.short_name)}">Features</button>
          <button class="btn btn-ghost btn-sm" data-action="openEditAlliance" data-args="${lwArgs(a.short_name, a.title || '', a.accepts_requests ? 1 : 0)}">Bearbeiten</button>
        </div>
      </div>
    </div>
  `).join('');
}

function openCreateAlliance() {
  document.getElementById('create-short').value = '';
  document.getElementById('create-title').value = '';
  document.getElementById('create-accepts-requests').checked = false;
  openModal('modal-create-alliance');
}

async function submitCreate() {
  const short = document.getElementById('create-short').value.trim();
  const title = document.getElementById('create-title').value.trim() || null;
  if (!short) { toast('Kürzel darf nicht leer sein', 'err'); return; }
  try {
    await adminApi('/alliances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id: authMember?.discord_id, short_name: short, title, accepts_requests: document.getElementById('create-accepts-requests').checked })
    });
    closeModal('modal-create-alliance');
    toast('Allianz angelegt', 'ok');
    await loadAlliances();
  } catch (e) { toast(tr('Fehler: ') + e.message, 'err'); }
}

function openEditAlliance(short, title, acceptsRequests = 0) {
  document.getElementById('edit-old-short').value = short;
  document.getElementById('edit-short').value = short;
  document.getElementById('edit-title').value = title;
  document.getElementById('edit-accepts-requests').checked = !!acceptsRequests;
  openModal('modal-edit-alliance');
}

async function submitEdit() {
  const oldShort = document.getElementById('edit-old-short').value;
  const newShort = document.getElementById('edit-short').value.trim();
  const title    = document.getElementById('edit-title').value.trim() || null;
  if (!newShort) { toast('Kürzel darf nicht leer sein', 'err'); return; }
  const doMigrate = newShort !== oldShort;
  if (doMigrate && !confirm(`Kürzel von "${oldShort}" auf "${newShort}" ändern?\n\nAlle Spieler, Einträge und Logs werden migriert. Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
  try {
    await adminApi(`/alliances/${encodeURIComponent(oldShort)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id: authMember?.discord_id, short_name: newShort, title, accepts_requests: document.getElementById('edit-accepts-requests').checked })
    });
    closeModal('modal-edit-alliance');
    toast(doMigrate ? 'Allianz umbenannt & Daten migriert' : 'Titel gespeichert', 'ok');
    await loadAlliances();
  } catch (e) { toast(tr('Fehler: ') + e.message, 'err'); }
}

// ── Archive ──
async function loadArchive() {
  const alliance = document.getElementById('archive-alliance-filter')?.value || '';
  const tbody = document.getElementById('archive-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="empty"><span class="spin">↻</span> Lade …</td></tr>';
  try {
    const discordId = authMember?.discord_id || '';
    const params = alliance
      ? `?discord_id=${encodeURIComponent(discordId)}&alliance=${encodeURIComponent(alliance)}`
      : `?discord_id=${encodeURIComponent(discordId)}`;
    const data = await adminApi('/archived-players' + params);
    const players = data.players || [];
    if (!players.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">Keine archivierten Spieler gefunden.</td></tr>'; return; }
    tbody.innerHTML = players.map(p => `
      <tr>
        <td><strong>${escHtml(p.current_name)}</strong></td>
        <td>${escHtml(p.alliance)}</td>
        <td><span class="rank-badge" style="background:${adminRankColor(p.current_rank_code)}22;color:${adminRankColor(p.current_rank_code)};border:1px solid ${adminRankColor(p.current_rank_code)}44">
          R${p.current_rank_code} ${escHtml(adminRankLabel(p.current_rank_code))}
        </span></td>
        <td style="color:var(--soft);font-size:12px">${p.archived_at ? p.archived_at.slice(0,16).replace('T',' ') : '-'}</td>
        <td><button class="btn btn-green btn-sm" data-action="restorePlayer" data-args="${lwArgs(p.archive_id, p.current_name)}">Wiederherstellen</button></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty"></td></tr>`;
  }
}

async function restorePlayer(archiveId, name) {
  if (!confirm(`Spieler "${name}" wiederherstellen?\n\nAlle Daten (Einträge, Namenshistorie, Identitäten) werden zurückgeholt.`)) return;
  try {
    await adminApi(`/archived-players/${encodeURIComponent(archiveId)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id: authMember?.discord_id })
    });
    toast(`${name} wiederhergestellt`, 'ok');
    await loadArchive();
  } catch (e) { toast(tr('Fehler: ') + e.message, 'err'); }
}

// ── Transfer ──
async function loadTransferAlliances() {
  try {
    const data = await adminApi('/alliances');
    const alliances = data.alliances || [];
    ['transfer-from', 'transfer-to'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const current = el.value;
      el.innerHTML = '<option value="">– wählen –</option>';
      alliances.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.short_name; opt.textContent = a.short_name;
        el.appendChild(opt);
      });
      if (current) el.value = current;
    });
  } catch (_) {}
}

async function loadTransferPlayers() {
  const fromEl = document.getElementById('transfer-from');
  const playerEl = document.getElementById('transfer-player');
  const fromAlliance = fromEl?.value;
  if (!fromAlliance) { playerEl.innerHTML = '<option value="">' + escHtml(tr('Erst Allianz wählen')) + '</option>'; return; }
  playerEl.innerHTML = '<option value="">Lade …</option>';
  try {
    const data = await adminApi(`/members?alliance=${encodeURIComponent(fromAlliance)}&discord_id=${encodeURIComponent(authMember?.discord_id || '')}`);
    const members = Array.isArray(data) ? data : (data.members || []);
    if (!members.length) { playerEl.innerHTML = '<option value="">' + escHtml(tr('Keine Spieler')) + '</option>'; return; }
    playerEl.innerHTML = '<option value="">' + escHtml(tr('Spieler wählen ...')) + '</option>' +
      members.map(m => `<option value="${escHtml(m.name)}">${escHtml(m.name)} (R${m.default_rank ?? m.rank})</option>`).join('');
  } catch (_) { playerEl.innerHTML = '<option value="">' + escHtml(tr('Fehler beim Laden')) + '</option>'; }
}

async function submitTransfer() {
  const fromAlliance = document.getElementById('transfer-from')?.value?.trim();
  const playerName   = document.getElementById('transfer-player')?.value?.trim();
  const toAlliance   = document.getElementById('transfer-to')?.value?.trim();
  if (!fromAlliance || !playerName || !toAlliance) { toast(tr('Bitte alle Felder ausfüllen'), 'err'); return; }
  if (fromAlliance === toAlliance) { toast(tr('Quell- und Ziel-Allianz sind identisch'), 'err'); return; }
  if (!confirm(`${tr('Spieler')} "${playerName}" ${tr('von')} ${fromAlliance} ${tr('nach')} ${toAlliance} ${tr('transferieren?')}\n\n${tr('Alle Daten werden mitgenommen.')}`)) return;
  try {
    await adminApi(`/members/${encodeURIComponent(playerName)}/transfer?alliance=${encodeURIComponent(fromAlliance)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id: authMember?.discord_id, to_alliance: toAlliance })
    });
    toast(`${playerName} ${tr('nach')} ${toAlliance} ${tr('transferiert')}`, 'ok');
    document.getElementById('transfer-player').innerHTML = '<option value="">' + escHtml(tr('Spieler wählen ...')) + '</option>';
    await loadTransferPlayers();
  } catch (e) { toast(tr('Fehler: ') + e.message, 'err'); }
}

// ── Zusammenfuehren ──
async function loadMergeAlliances() {
  try {
    const data = await adminApi('/alliances');
    const el = document.getElementById('merge-alliance');
    if (!el) return;
    const current = el.value;
    el.innerHTML = '<option value="">– wählen –</option>' +
      (data.alliances || []).map(a => `<option value="${escHtml(a.short_name)}">${escHtml(a.short_name)}</option>`).join('');
    if (current) el.value = current;
  } catch (_) {}
}

async function loadMergePlayers() {
  const alliance = document.getElementById('merge-alliance')?.value;
  const keepEl = document.getElementById('merge-keep');
  const dropEl = document.getElementById('merge-drop');
  if (!alliance) {
    keepEl.innerHTML = dropEl.innerHTML = '<option value="">' + escHtml(tr('Erst Allianz wählen')) + '</option>';
    return;
  }
  keepEl.innerHTML = dropEl.innerHTML = '<option value="">Lade …</option>';
  try {
    const discordId = encodeURIComponent(authMember?.discord_id || '');
    // Archiv aller Allianzen, in denen man R5 ist: wer gewechselt hat, liegt oft im Archiv der alten Allianz
    const allAlliances = [...document.getElementById('merge-alliance').options].map(o => o.value).filter(Boolean);
    const [membersData, ...archiveData] = await Promise.all([
      adminApi(`/members?alliance=${encodeURIComponent(alliance)}&discord_id=${discordId}`),
      ...allAlliances.map(a => adminApi(`/archived-players?alliance=${encodeURIComponent(a)}&discord_id=${discordId}`).catch(() => ({ players: [] }))),
    ]);
    const members = (Array.isArray(membersData) ? membersData : (membersData.members || []))
      .slice().sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
    const archived = archiveData.flatMap(d => d.players || [])
      .sort((a, b) => a.current_name.localeCompare(b.current_name, 'de', { sensitivity: 'base' }));
    const memberOpts = members.map(m => `<option value="${escHtml(m.name)}" data-id="${escHtml(m.id)}">${escHtml(m.name)} (R${m.default_rank ?? m.rank})</option>`).join('');
    keepEl.innerHTML = '<option value="">' + escHtml(tr('Spieler wählen ...')) + '</option>' + memberOpts;
    dropEl.innerHTML = '<option value="">' + escHtml(tr('Spieler wählen ...')) + '</option>' +
      '<optgroup label="Aktiv">' + members.map(m => `<option value="p:${escHtml(m.id)}">${escHtml(m.name)} (R${m.default_rank ?? m.rank})</option>`).join('') + '</optgroup>' +
      (archived.length ? '<optgroup label="Archiv">' + archived.map(p => `<option value="a:${escHtml(p.archive_id)}">${escHtml(p.current_name)} (Archiv${p.alliance !== alliance ? ' ' + escHtml(p.alliance) : ''}, ${escHtml((p.archived_at || '').slice(0, 10))})</option>`).join('') + '</optgroup>' : '');
  } catch (_) {
    keepEl.innerHTML = dropEl.innerHTML = '<option value="">' + escHtml(tr('Fehler beim Laden')) + '</option>';
  }
}

async function submitMerge() {
  const alliance = document.getElementById('merge-alliance')?.value;
  const keepEl = document.getElementById('merge-keep');
  const dropEl = document.getElementById('merge-drop');
  const keepName = keepEl?.value;
  const drop = dropEl?.value || '';
  if (!alliance || !keepName || !drop) { toast(tr('Bitte alle Felder ausfüllen'), 'err'); return; }
  const keepId = keepEl.selectedOptions[0]?.dataset.id;
  if (drop === 'p:' + keepId) { toast('Behalten und Duplikat sind derselbe Spieler', 'err'); return; }
  const dropLabel = dropEl.selectedOptions[0]?.textContent || '';
  if (!confirm(`"${dropLabel}" in "${keepName}" zusammenführen?\n\nDas Duplikat verschwindet. Seine Wochen, Scan-Werte, Namen und Discord-Verknüpfung gehen auf ${keepName} über. Das lässt sich nicht rückgängig machen.`)) return;
  const body = { discord_id: authMember?.discord_id };
  if (drop.startsWith('a:')) body.from_archive_id = drop.slice(2); else body.from_player_id = drop.slice(2);
  try {
    const res = await adminApi(`/members/${encodeURIComponent(keepName)}/merge?alliance=${encodeURIComponent(alliance)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    toast(`${res.merged_name} → ${keepName}: ${res.weeks_moved} Wochen, ${res.metrics} Scan-Werte übernommen`, 'ok');
    await loadMergePlayers();
  } catch (e) { toast(tr('Fehler: ') + e.message, 'err'); }
}

// ── Admins ──
async function loadAdmins() {
  const tbody = document.getElementById('admins-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="empty"><span class="spin">↻</span> ' + escHtml(tr('Lade …')) + '</td></tr>';
  try {
    const data = await adminApi(`/admins?discord_id=${encodeURIComponent(authMember?.discord_id || '')}`);
    const admins = data.admins || [];
    if (!admins.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">' + escHtml(tr('Keine Admins gefunden.')) + '</td></tr>'; return; }
    const selfId = authMember?.discord_id || '';
    tbody.innerHTML = admins.map(a => {
      const avatarHtml = a.avatar
        ? `<img src="https://cdn.discordapp.com/avatars/${escHtml(a.discord_user_id)}/${escHtml(a.avatar)}.png?size=32" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:6px;">` : '';
      const displayName = a.player_name || a.username || a.discord_user_id;
      const isSelf = a.discord_user_id === selfId;
      return `<tr>
        <td><strong>${escHtml(displayName)}</strong></td>
        <td style="color:var(--soft);font-size:12px">${avatarHtml}${escHtml(a.username || a.discord_user_id)}</td>
        <td>${a.alliance ? escHtml(a.alliance) : '<em style="color:var(--softer)">-</em>'}</td>
        <td style="color:var(--soft);font-size:12px">${escHtml(a.granted_by === 'system' ? tr('System') : (a.granted_by || '-'))}</td>
        <td style="color:var(--soft);font-size:12px">${escHtml(a.note || '')}</td>
        <td style="color:var(--soft);font-size:12px">${a.granted_at ? a.granted_at.slice(0,10) : '-'}</td>
        <td>${isSelf ? '' : `<button class="btn btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" data-action="revokeAdmin" data-args="${lwArgs(a.discord_user_id, displayName)}">${escHtml(tr('Entziehen'))}</button>`}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty"></td></tr>`;
  }
}

function openGrantAdmin() {
  document.getElementById('grant-player-name').value = '';
  document.getElementById('grant-note').value = '';
  openModal('modal-grant-admin');
}

async function submitGrantAdmin() {
  const input = document.getElementById('grant-player-name').value.trim();
  const note  = document.getElementById('grant-note').value.trim();
  if (!input) { toast(tr('Name oder Discord-ID eingeben'), 'err'); return; }
  const isDiscordId = /^\d{15,25}$/.test(input);
  const payload = {
    discord_id: authMember?.discord_id,
    note,
    ...(isDiscordId ? { target_discord_id: input } : { target_player_name: input })
  };
  try {
    await adminApi('/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeModal('modal-grant-admin');
    toast(tr('Admin-Recht vergeben'), 'ok');
    await loadAdmins();
  } catch (e) { toast(tr('Fehler: ') + e.message, 'err'); }
}

async function revokeAdmin(targetDiscordId, displayName) {
  if (!confirm(`${tr('Admin-Recht von')} "${displayName}" ${tr('entziehen?')}`)) return;
  try {
    await adminApi(`/admins/${encodeURIComponent(targetDiscordId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id: authMember?.discord_id })
    });
    toast(`${tr('Admin-Recht von')} ${displayName} ${tr('entzogen')}`, 'ok');
    await loadAdmins();
  } catch (e) { toast(tr('Fehler: ') + e.message, 'err'); }
}

// ── API-Tokens (Konzept v2, A4) ──
// Der Server laesst R5 der gewaehlten Allianz und den Betreiber zu; vorausgewaehlt ist die Allianz des aktiven Chars.
async function adminInitApiTokensTab() {
  const sel = document.getElementById('api-tokens-alliance');
  if (!sel) return;
  if (_adminAlliances.length === 0) await loadAlliances();
  let prev = sel.value;
  if (!prev) {
    try { prev = JSON.parse(localStorage.getItem('iny_active_char_v1') || 'null')?.alliance || ''; } catch (_) {}
  }
  sel.innerHTML = _adminAlliances.map(a =>
    `<option value="${escHtml(a.short_name)}" ${a.short_name === prev ? 'selected' : ''}>${escHtml(a.short_name)}</option>`
  ).join('');
  if (!sel.value && _adminAlliances.length) sel.value = _adminAlliances[0].short_name;
  await loadApiTokens();
}

function apiTokenRoleLabel(role) {
  return { scanner: tr('Scanner'), r4: 'R4', r5: 'R5' }[role] || role;
}

async function loadApiTokens() {
  const tbody = document.getElementById('api-tokens-tbody');
  const alliance = document.getElementById('api-tokens-alliance')?.value || '';
  if (!tbody || !alliance) return;
  tbody.innerHTML = '<tr><td colspan="8" class="empty"><span class="spin">↻</span> ' + escHtml(tr('Lade …')) + '</td></tr>';
  try {
    const data = await adminApi(`/api-tokens?alliance=${encodeURIComponent(alliance)}&discord_id=${encodeURIComponent(authMember?.discord_id || '')}`);
    const tokens = data.tokens || [];
    if (!tokens.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">' + escHtml(tr('Noch keine Tokens für diese Allianz.')) + '</td></tr>'; return; }
    const day = v => v ? escHtml(String(v).slice(0, 16)) : '';
    tbody.innerHTML = tokens.map(t => {
      const status = !t.is_active
        ? `<span style="color:var(--red)">${escHtml(tr('Widerrufen'))}</span>`
        : t.expired
          ? `<span style="color:var(--soft)">${escHtml(tr('Abgelaufen'))}</span>`
          : `<span style="color:var(--green)">${escHtml(tr('Aktiv'))}</span>`;
      return `<tr${t.is_active ? '' : ' style="opacity:.55"'}>
        <td><strong>${escHtml(t.client_name)}</strong><div style="color:var(--softer);font-size:11px;font-family:monospace">${escHtml(String(t.token_id).slice(0, 8))}</div></td>
        <td>${escHtml(apiTokenRoleLabel(t.role))}</td>
        <td style="color:var(--soft);font-size:12px">${escHtml(t.created_by_name || t.created_by || '-')}</td>
        <td style="color:var(--soft);font-size:12px">${day(t.created_at)}</td>
        <td style="color:var(--soft);font-size:12px">${t.last_used_at ? day(t.last_used_at) : escHtml(tr('nie'))}</td>
        <td style="color:var(--soft);font-size:12px">${t.expires_at ? day(t.expires_at) : escHtml(tr('unbegrenzt'))}</td>
        <td>${status}</td>
        <td>${t.is_active ? `<button class="btn btn-ghost btn-sm" style="color:var(--red);border-color:var(--red)" data-action="revokeApiToken" data-args="${lwArgs(t.token_id, t.client_name)}">${escHtml(tr('Widerrufen'))}</button>` : ''}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">${escHtml(tr('Fehler: ') + e.message)}</td></tr>`;
  }
}

function openCreateApiToken() {
  document.getElementById('api-token-name').value = '';
  document.getElementById('api-token-role').value = 'scanner';
  document.getElementById('api-token-expires').value = '';
  openModal('modal-create-api-token');
}

async function submitCreateApiToken() {
  const alliance = document.getElementById('api-tokens-alliance')?.value || '';
  const clientName = document.getElementById('api-token-name').value.trim();
  if (!clientName) { toast(tr('Bitte einen Namen eingeben'), 'err'); return; }
  try {
    const data = await adminApi('/api-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discord_id: authMember?.discord_id,
        alliance,
        client_name: clientName,
        role: document.getElementById('api-token-role').value,
        expires_at: document.getElementById('api-token-expires').value || null
      })
    });
    closeModal('modal-create-api-token');
    document.getElementById('api-token-plain').value = data.token || '';
    openModal('modal-api-token-created');
    await loadApiTokens();
  } catch (e) { toast(tr('Fehler: ') + e.message, 'err'); }
}

function copyApiToken(btn) {
  const input = document.getElementById('api-token-plain');
  const text = input?.value || '';
  if (!text) return;
  const done = () => {
    const orig = btn.textContent;
    btn.textContent = '✓ ' + tr('Kopiert');
    setTimeout(() => { btn.textContent = orig; }, 1800);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => input.select());
  } else {
    input.select();
    try { document.execCommand('copy'); done(); } catch (_) {}
  }
}

function closeApiTokenCreated() {
  // Klartext nicht im DOM stehen lassen – er wird nie wieder angezeigt
  document.getElementById('api-token-plain').value = '';
  closeModal('modal-api-token-created');
}

async function revokeApiToken(tokenId, clientName) {
  if (!confirm(`${tr('Token widerrufen?')}\n\n${clientName}`)) return;
  const alliance = document.getElementById('api-tokens-alliance')?.value || '';
  try {
    await adminApi(`/api-tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id: authMember?.discord_id, alliance })
    });
    toast(tr('Token widerrufen'), 'ok');
    await loadApiTokens();
  } catch (e) { toast(tr('Fehler: ') + e.message, 'err'); }
}
