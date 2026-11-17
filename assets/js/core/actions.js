// LWHub – Aktionen statt Inline-Handlern (data-action …), siehe CLAUDE.md
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Kern auslagern“).
// Normales Script, kein Modul: alles bleibt global wie vorher. Reihenfolge der <script>-Tags in index.html beachten.

// ══════════════════════════════════════════════════════
//  AKTIONEN statt Inline-Handlern (on…=), siehe CLAUDE.md
// ══════════════════════════════════════════════════════
// Klick:          data-action="fn"           data-args='["a", 1]'
// andere Events:  data-on-change="fn"         data-args-change='[…]'
//                 (ebenso input, keydown, focus, mousedown, mouseover, mouseout,
//                  dragstart, dragover, dragleave, drop, dragend)
// Platzhalter in den Argumenten: {"$":"el"} = das Element, {"$":"event"} = das Event,
//                                {"$":"value"} = el.value. Im JS: lwArgs(LW_EL, LW_EVENT, name).
// data-stop="click mousedown" stoppt das Event an diesem Element (wie event.stopPropagation()),
// data-prevent="click dragstart" verhindert die Standardaktion (wie event.preventDefault()).
// Aufgerufen werden nur Funktionen aus LW_ACTIONS. Neue Funktion → hier eintragen.
const LW_ACTIONS = new Set([
  'acceptAccessRequestAsNew', 'adminShowTab', 'allianceRowClick', 'allowHeroDrop', 'auOpen', 'berufePlannerCopyMail',
  'berufePlannerLoadPage', 'berufePlannerSetSort', 'bpAccAssign', 'bpAccDrop', 'bpAccToQueue', 'bpAccToggle',
  'bpAccToggleAll', 'bpAllowDrop', 'bpAskCopyAgain', 'bpAskPlayer', 'bpDragEnd', 'bpDragStart',
  'bpDropLeave', 'bpDropNewWarlord', 'bpDropToEngineerSlot', 'bpDropToQueue', 'bpDropToWarlord', 'bpFillApply',
  'bpFillReroll', 'bpFillRest', 'bpHistBack', 'bpHistRestore', 'bpHistShow', 'bpJumpWrong', 'bpMakeWarlord', 'bpOpenHistory', 'bpOpenTemplates', 'bpSaveRankCheck',
  'bpSetView', 'bpTogglePair', 'bpTplInsertVar', 'bpTplRenderPreview', 'bpTplResetLang', 'bpTplSave',
  'bpTplSwitchLang', 'bpTplSwitchVariant', 'bpUnsetWarlord', 'changeYearWeek', 'clearTeamHero',
  'closeApiTokenCreated', 'closeModal', 'closeTeamEditor', 'copyApiToken', 'discordLogin', 'discordLogout',
  'ergebnisApply', 'ergebnisSortBy', 'fillHonorHomeAllianceList', 'loadApiTokens', 'loadArchive', 'loadErgebnis',
  'loadMergePlayers', 'loadSeInactive', 'loadTransferPlayers', 'lwReload', 'lwSelectText', 'lwShareLink', 'lwhubReauthLogin',
  'mapAccessRequestToMember', 'meBerufSelect', 'meSelectWeek', 'meStepWeek', 'onPoolHeroDragStart', 'onTeamSlotDragStart',
  'onTeamSlotDrop', 'openAllianceFeatures', 'openCreateAlliance', 'openCreateApiToken', 'openEditAlliance', 'openEditor',
  'openGrantAdmin', 'openMemberMe', 'openMemberMeInApp', 'openTeamEditor', 'rejectAccessRequest', 'removeMember',
  'restorePlayer', 'revokeAdmin', 'revokeApiToken', 'saveAllianceSettings', 'saveMeBeruf',
  'saveTeams', 'selectEventView', 'setVerwaltungBeruf', 'showPage',
  'spendeImportFromScanner', 'spendeSet', 'spezialImportFromScanner', 'spezialSaveEvent', 'spezialSet', 'spezialSetNoEvent',
  'spezialToggleSkip', 'submitAccessRequest', 'submitCreate', 'submitCreateApiToken', 'submitEdit',
  'submitGrantAdmin', 'submitMerge', 'submitTransfer', 'syncData', 'toggleCatConfig', 'toggleDoneMode',
  'toggleEventContrast', 'toggleEventDoneMode', 'toggleFlag', 'toggleVerwaltungFlag', 'toggleVerwaltungRow',
  'vBackToList', 'vDeleteWeekEntry', 'vFieldKey', 'vRename', 'vSaveBerufSub', 'vSaveDiscord', 'vSaveHome', 'vSelectMember',
  'vSetFilter', 'vSetRank', 'vSetRole', 'vToggleFlag', 'vsImportFromScanner',
  'vsSet', 'vsToggleSparwoche', 'wacheSet', 'wuesteSet', 'zugCalDragStart', 'zugCancelEditForm',
  'zugCancelNoShow', 'zugCloseEventForm', 'zugConfirmNoShow', 'zugCopyMail', 'zugDayClick', 'zugDayHover',
  'zugDeleteEntry', 'zugDragLeave', 'zugDragOver', 'zugDragStart', 'zugEditExisting', 'zugHandleDrop',
  'zugMarkCompleted', 'zugNavToday', 'zugNavWeek', 'zugOpenNoShowForm', 'zugQueueDragLeave', 'zugQueueDragOver',
  'zugQueueDrop', 'zugRoNavToday', 'zugRoNavWeek', 'zugRoPickDay', 'zugSaveEntry', 'zugSyncQueue',
]);
const LW_EL = Object.freeze({ $: 'el' });
const LW_EVENT = Object.freeze({ $: 'event' });
const LW_VALUE = Object.freeze({ $: 'value' });
const LW_EVENT_TYPES = ['click', 'change', 'input', 'keydown', 'focus', 'mousedown', 'mouseover', 'mouseout',
  'dragstart', 'dragover', 'dragleave', 'drop', 'dragend'];
const LW_NON_BUBBLING = new Set(['focus']);

/** Argumente für data-args als HTML-sicherer JSON-Text (für Template-Strings). */
function lwArgs(...args) { return escHtml(JSON.stringify(args)); }

function lwParseArgs(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [v];
  } catch (err) {
    console.warn('[lwhub] data-args nicht lesbar:', raw);
    return null;
  }
}

function lwResolveArg(a, el, e) {
  if (a && typeof a === 'object' && !Array.isArray(a) && typeof a.$ === 'string') {
    if (a.$ === 'el') return el;
    if (a.$ === 'event') return e;
    if (a.$ === 'value') return el.value;
  }
  return a;
}

function lwRunAction(el, type, e) {
  const name = el.getAttribute(type === 'click' ? 'data-action' : 'data-on-' + type);
  if (!name) return;
  const fn = LW_ACTIONS.has(name) ? window[name] : null;
  if (typeof fn !== 'function') { console.warn('[lwhub] unbekannte Aktion:', name); return; }
  const args = lwParseArgs(el.getAttribute(type === 'click' ? 'data-args' : 'data-args-' + type));
  if (!args) return;
  fn.apply(el, args.map((a) => lwResolveArg(a, el, e)));
}

function lwHasWord(el, attr, word) {
  const v = el.getAttribute(attr);
  return !!v && v.split(/\s+/).includes(word);
}

// Läuft in der Capture-Phase am document und geht vom Ziel nach oben, so wie die alten
// Inline-Handler beim Aufsteigen (innen zuerst). data-stop beendet den Weg nach oben.
function lwDispatch(e) {
  const type = e.type;
  const attr = type === 'click' ? 'data-action' : 'data-on-' + type;
  let n = e.target;
  if (n && n.nodeType !== 1) n = n.parentElement;
  for (; n && n.nodeType === 1; n = n.parentElement) {
    if (lwHasWord(n, 'data-prevent', type)) e.preventDefault();
    if (n.hasAttribute(attr)) lwRunAction(n, type, e);
    if (lwHasWord(n, 'data-stop', type)) {
      // wie event.stopPropagation() an genau diesem Element: Vorfahren sehen das Event nicht mehr
      n.addEventListener(type, (ev) => ev.stopPropagation(), { once: true });
      break;
    }
    if (LW_NON_BUBBLING.has(type)) break;
  }
}
LW_EVENT_TYPES.forEach((type) => document.addEventListener(type, lwDispatch, true));

// kleine Helfer, die vorher direkt im HTML standen
function lwSelectText(el) { el.select(); }
function lwReload() { location.reload(); }
function allianceRowClick(e, shortName) {
  if (e.target.closest('button')) return;
  openAllianceFeatures(shortName);
}
function zugDayHover(el, on, isToday) {
  el.style.borderColor = (on || isToday) ? 'var(--gold)' : 'rgba(255,255,255,0.06)';
}
