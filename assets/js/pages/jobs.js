// LWHub – Berufeplaner (/jobs)
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html, Schritt „Seiten herauslösen“).
// Normales Script, kein Modul: lädt nach dem großen <script> in index.html und vor assets/js/start.js.

// ══════════════════════════════════════════════════════════════════════════════
// BERUFEPLANNER
// ══════════════════════════════════════════════════════════════════════════════
(function() {
  // Namen fuer onclick-Argumente: encodeURIComponent laesst ' stehen und bricht bei "O'Brien" den Handler;
  // decodeURIComponent macht aus %27 wieder ein '
  const bpEnc = s => encodeURIComponent(s).replace(/'/g, '%27');
  let bpSort = 'asc';

  function bpEngineerListFor(kriegsherrName) {
    return members.filter(n => {
      const m = memberMeta[n] || {};
      return m.beruf === 'ingenieur' && m.berufWinwin === kriegsherrName;
    });
  }

  function bpWarlordList() {
    const warlords = members.filter(n => (memberMeta[n]?.beruf || null) === 'kriegsherr');
    warlords.sort((a, b) => a.localeCompare(b, 'de'));
    if (bpSort === 'desc') warlords.reverse();
    if (bpSort === 'count_desc' || bpSort === 'count_asc') {
      warlords.sort((a, b) => {
        const diff = bpEngineerListFor(a).length - bpEngineerListFor(b).length;
        return bpSort === 'count_desc' ? -diff : diff;
      });
    }
    return warlords;
  }

  // Ingenieure, deren Kriegsanführer umbenannt, archiviert oder kein Kriegsanführer mehr ist, landen wieder in der Warteschlange
  function bpQueueList() {
    const warlords = new Set(members.filter(n => (memberMeta[n]?.beruf || null) === 'kriegsherr'));
    return members.filter(n => {
      const m = memberMeta[n] || {};
      if (m.beruf === 'kriegsherr') return false;
      if (m.beruf === 'ingenieur' && warlords.has(m.berufWinwin)) return false;
      return true;
    }).sort((a, b) => a.localeCompare(b, 'de'));
  }

  // Rangwappen in Rangfarbe (wie die Rang-Badges, RC) mit weisser Ziffer; bewusst ohne Rangname
  function bpRankShield(name) {
    const rank = Number(PREV[name]);
    if (!Number.isInteger(rank) || rank < 1 || rank > 5) return '';
    return `<span class="bp-shield" title="R${rank}"><svg viewBox="0 0 20 24" aria-hidden="true"><path d="M10 1 L18.5 4 V11 C18.5 16.5 14.8 20.6 10 23 C5.2 20.6 1.5 16.5 1.5 11 V4 Z" fill="${RC[rank]}" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/></svg><b>${rank}</b></span>`;
  }

  // Erwarteter Beruf aus dem Rang; null = nicht pruefbar (R1/R4/R5 oder Rangcheck aus)
  function bpExpectedBeruf(rank) {
    if (!isBerufRankCheckOn()) return null;
    const r2 = getBerufRankCheckR2();
    if (rank === 2) return r2;
    if (rank === 3) return r2 === 'ingenieur' ? 'kriegsherr' : 'ingenieur';
    return null;
  }

  // placement: 'kriegsherr' | 'ingenieur' | 'queue' → 'ok' | 'wrong' | 'open' | null
  function bpBerufStatus(name, placement) {
    const expected = bpExpectedBeruf(Number(PREV[name]));
    if (!expected) return null;
    if (placement === 'queue') return 'open';
    return placement === expected ? 'ok' : 'wrong';
  }

  // Zusatzklassen und Hinweis fuer eine Kachel. Kriegsanführer-Spalte links, Ingenieur-Slots rechts.
  // compact (Tabelle): nur der Pfeil als Hinweis, damit der gekuerzte Name nicht ganz verschwindet
  function bpCheckMarkup(name, placement, compact) {
    const status = bpBerufStatus(name, placement);
    if (!status) return { cls: '', hint: '' };
    const expected = bpExpectedBeruf(Number(PREV[name]));
    let cls = expected === 'kriegsherr' ? ' bp-exp-kh' : ' bp-exp-ing';
    let hint = '';
    if (status === 'wrong') {
      const toIng = expected === 'ingenieur';
      cls += toIng ? ' bp-wrong bp-pull-right' : ' bp-wrong bp-pull-left';
      const label = tr(toIng ? 's_bp_hint_to_ing' : 's_bp_hint_to_kh');
      hint = compact
        ? `<span class="bp-hint" title="${escHtml(label + ' ' + tr('s_bp_hint_title'))}">${toIng ? '→' : '←'}</span>`
        : `<span class="bp-hint" title="${escHtml(tr('s_bp_hint_title'))}">${escHtml(label)}</span>`;
    }
    return { cls, hint };
  }

  // Spieler fragen (B7): Standardvorlage je Sprache, Text in der Sprache des Spielers. Eigene Vorlagen
  // (B8) kommen spaeter als alliance_config berufe_frage_vorlagen = {"de": "...", ...} und gehen vor.
  const BP_ASK_DEFAULTS = {
    de: { ing: 'Ingenieur', kh: 'Kriegsanführer', none: 'noch keiner', text: 'Hallo $Spieler, kannst du mir bitte deinen aktuellen Beruf bestätigen? Bei uns gilt: R2 = $R2Beruf, R3 = $R3Beruf. Danke! – $Absender', r145: 'Hallo $Spieler, kurze Frage für unseren Berufeplaner: Bist du gerade Kriegsanführer oder Ingenieur? Bei mir steht: $BerufIst. Danke! – $Absender' },
    en: { ing: 'Engineer', kh: 'Warlord', none: 'none yet', text: 'Hi $Spieler, could you please confirm your current profession? Our rule: R2 = $R2Beruf, R3 = $R3Beruf. Thanks! – $Absender', r145: 'Hi $Spieler, quick question for our profession planner: are you currently a Warlord or an Engineer? I have you down as: $BerufIst. Thanks! – $Absender' },
    fr: { ing: 'Ingénieur', kh: 'Seigneur de guerre', none: 'aucun pour l\'instant', text: 'Salut $Spieler, peux-tu me confirmer ton métier actuel ? Chez nous : R2 = $R2Beruf, R3 = $R3Beruf. Merci ! – $Absender', r145: 'Salut $Spieler, petite question pour notre planning des métiers : es-tu Seigneur de guerre ou Ingénieur en ce moment ? Chez moi tu es noté : $BerufIst. Merci ! – $Absender' },
    es: { ing: 'Ingeniero', kh: 'Señor de la guerra', none: 'ninguno todavía', text: 'Hola $Spieler, ¿puedes confirmarme tu profesión actual? Nuestra regla: R2 = $R2Beruf, R3 = $R3Beruf. ¡Gracias! – $Absender', r145: 'Hola $Spieler, una pregunta rápida para nuestro planificador de profesiones: ¿ahora eres Señor de la guerra o Ingeniero? Yo te tengo como: $BerufIst. ¡Gracias! – $Absender' },
    it: { ing: 'Ingegnere', kh: 'Signore della guerra', none: 'ancora nessuna', text: 'Ciao $Spieler, puoi confermarmi la tua professione attuale? Da noi vale: R2 = $R2Beruf, R3 = $R3Beruf. Grazie! – $Absender', r145: 'Ciao $Spieler, domanda veloce per il nostro planner delle professioni: al momento sei Signore della guerra o Ingegnere? Io ti ho segnato come: $BerufIst. Grazie! – $Absender' },
    pl: { ing: 'Inżynier', kh: 'Warlord', none: 'jeszcze brak', text: 'Cześć $Spieler, czy możesz potwierdzić swój obecny zawód? U nas: R2 = $R2Beruf, R3 = $R3Beruf. Dzięki! – $Absender', r145: 'Cześć $Spieler, szybkie pytanie do naszego planu zawodów: jesteś teraz Warlordem czy Inżynierem? U mnie jesteś zapisany jako: $BerufIst. Dzięki! – $Absender' },
    zh: { ing: '工程师', kh: '战争领主', none: '暂无', text: '你好 $Spieler，请确认一下你当前的职业。我们的规定：R2 = $R2Beruf，R3 = $R3Beruf。谢谢！– $Absender', r145: '你好 $Spieler，问一下职业安排：你现在是战争领主还是工程师？我这边记录的是：$BerufIst。谢谢！– $Absender' },
  };

  const BP_ASK_VARS = ['Spieler', 'Rang', 'R2Beruf', 'R3Beruf', 'BerufIst', 'BerufSoll', 'Allianz', 'Absender'];

  function bpCustomAskTemplates() {
    let custom = flagConfig?.berufe_frage_vorlagen;
    if (typeof custom === 'string') { try { custom = JSON.parse(custom); } catch (e) { custom = null; } }
    return (custom && typeof custom === 'object' && !Array.isArray(custom)) ? custom : {};
  }

  // Zwei Texte je Sprache: 'r23' erklaert die Regel R2/R3 = Beruf; 'r145' fragt direkt (R1/R4/R5 sagen
  // nichts ueber den Beruf, ebenso wenn der Rangcheck aus ist). Eigene Texte: "<lang>" bzw. "<lang>_r145".
  const bpTplKey = (lang, variant) => variant === 'r145' ? `${lang}_r145` : lang;
  const bpTplDefault = (lang, variant) => { const b = BP_ASK_DEFAULTS[lang] || BP_ASK_DEFAULTS.de; return variant === 'r145' ? b.r145 : b.text; };
  function bpAskVariant(name) {
    const rank = Number(PREV[name]);
    return isBerufRankCheckOn() && (rank === 2 || rank === 3) ? 'r23' : 'r145';
  }

  function bpAskTemplate(lang, variant = 'r23') {
    const custom = bpCustomAskTemplates();
    const base = BP_ASK_DEFAULTS[lang] || BP_ASK_DEFAULTS.de;
    const own = custom[bpTplKey(lang, variant)];
    const text = (typeof own === 'string' && own.trim()) ? own : bpTplDefault(lang, variant);
    return { ...base, text };
  }

  function bpAskLang(name) {
    const lang = memberMeta[name]?.preferredLanguage;
    return BP_ASK_DEFAULTS[lang] ? lang : 'de';
  }

  function bpBuildAskText(name, lang = bpAskLang(name), text = null, variant = bpAskVariant(name)) {
    const meta = memberMeta[name] || {};
    const tpl = bpAskTemplate(lang, variant);
    if (text !== null) tpl.text = text;
    const word = b => b === 'kriegsherr' ? tpl.kh : b === 'ingenieur' ? tpl.ing : '';
    const rank = Number(PREV[name]);
    const r2 = getBerufRankCheckR2();
    const r3 = r2 === 'ingenieur' ? 'kriegsherr' : 'ingenieur';
    // Wie im Planer einsortiert: Ingenieur nur mit gueltigem Kriegsanführer, sonst steht er in der Warteschlange
    const placed = meta.beruf === 'kriegsherr' ? 'kriegsherr'
      : (meta.beruf === 'ingenieur' && !bpQueueList().includes(name)) ? 'ingenieur' : null;
    const vars = {
      Spieler: name,
      Rang: Number.isInteger(rank) && rank > 0 ? `R${rank}` : '',
      R2Beruf: word(r2),
      R3Beruf: word(r3),
      BerufIst: placed ? word(placed) : tpl.none,
      BerufSoll: rank === 2 ? word(r2) : rank === 3 ? word(r3) : '',
      Allianz: authMember?.alliance || '',
      Absender: authMember?.member_name || '',
    };
    return tpl.text.replace(new RegExp(`\\$(${BP_ASK_VARS.join('|')})\\b`, 'g'), (m, k) => vars[k]);
  }

  // Vorlagen-Editor (B8): Entwurf je Sprache, gespeichert werden nur Texte, die vom Standard abweichen
  let bpTplDraft = {};
  let bpTplLang = 'de';
  let bpTplVariant = 'r23';

  function bpTplSample() {
    const ranks = bpTplVariant === 'r145' ? [1, 4, 5] : [2, 3];
    return members.find(n => ranks.includes(Number(PREV[n]))) || members[0] || 'Kiwi';
  }

  function bpTplRenderPreview() {
    const ta = document.getElementById('bp-tpl-text');
    const pv = document.getElementById('bp-tpl-preview');
    if (!ta || !pv) return;
    bpTplDraft[bpTplKey(bpTplLang, bpTplVariant)] = ta.value;
    pv.textContent = bpBuildAskText(bpTplSample(), bpTplLang, ta.value, bpTplVariant);
    document.querySelectorAll('#bp-tpl-variant [data-variant]').forEach(b => b.classList.toggle('on', b.dataset.variant === bpTplVariant));
    const note = document.getElementById('bp-tpl-variant-note');
    if (note) note.textContent = tr(bpTplVariant === 'r145' ? 's_bp_tpl_var_note_r145' : 's_bp_tpl_var_note_r23');
  }

  window.bpTplRenderPreview = bpTplRenderPreview; // oninput im Textfeld des Editors

  window.bpTplSwitchVariant = function(variant) {
    const ta = document.getElementById('bp-tpl-text');
    if (!ta) return;
    bpTplDraft[bpTplKey(bpTplLang, bpTplVariant)] = ta.value;
    bpTplVariant = variant === 'r145' ? 'r145' : 'r23';
    ta.value = bpTplDraft[bpTplKey(bpTplLang, bpTplVariant)];
    bpTplRenderPreview();
  };

  window.bpOpenTemplates = function() {
    if (!bpCanEditRankCheck()) { toast(tr('s_bp_rc_only_r4'), 'err'); return; }
    const custom = bpCustomAskTemplates();
    bpTplDraft = {};
    Object.keys(BP_ASK_DEFAULTS).forEach(l => ['r23', 'r145'].forEach(v => {
      const k = bpTplKey(l, v);
      bpTplDraft[k] = (typeof custom[k] === 'string' && custom[k].trim()) ? custom[k] : bpTplDefault(l, v);
    }));
    bpTplVariant = 'r23';
    const langEl = document.getElementById('bp-tpl-lang');
    bpTplLang = BP_ASK_DEFAULTS[langEl?.value] ? langEl.value : 'de';
    const chips = document.getElementById('bp-tpl-chips');
    if (chips) {
      chips.innerHTML = BP_ASK_VARS.map(v => `<button type="button" class="bp-tpl-chip" data-action="bpTplInsertVar" data-args="${lwArgs(v)}">$${v}</button>`).join('');
    }
    document.getElementById('bp-tpl-text').value = bpTplDraft[bpTplKey(bpTplLang, bpTplVariant)];
    bpTplRenderPreview();
    openModal('modal-bp-templates');
  };

  window.bpTplSwitchLang = function(lang) {
    const ta = document.getElementById('bp-tpl-text');
    if (!ta || !BP_ASK_DEFAULTS[lang]) return;
    bpTplDraft[bpTplKey(bpTplLang, bpTplVariant)] = ta.value;
    bpTplLang = lang;
    ta.value = bpTplDraft[bpTplKey(lang, bpTplVariant)];
    bpTplRenderPreview();
  };

  window.bpTplInsertVar = function(v) {
    const ta = document.getElementById('bp-tpl-text');
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    ta.value = ta.value.slice(0, start) + '$' + v + ta.value.slice(end);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + v.length + 1;
    bpTplRenderPreview();
  };

  window.bpTplResetLang = function() {
    const ta = document.getElementById('bp-tpl-text');
    if (!ta) return;
    ta.value = bpTplDefault(bpTplLang, bpTplVariant);
    bpTplRenderPreview();
  };

  window.bpTplSave = async function(btn) {
    bpTplRenderPreview();
    const out = {};
    Object.keys(BP_ASK_DEFAULTS).forEach(l => ['r23', 'r145'].forEach(v => {
      const k = bpTplKey(l, v);
      const t = String(bpTplDraft[k] || '').trim();
      if (t && t !== bpTplDefault(l, v)) out[k] = t;
    }));
    const value = Object.keys(out).length ? JSON.stringify(out) : '';
    const alliance = getEffectiveAllianceForApi();
    if (btn) btn.disabled = true;
    try {
      await adminApi(`/alliance-config?alliance=${bpEnc(alliance)}`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ discord_id: authMember?.discord_id || '', config: { berufe_frage_vorlagen: value } })
      });
      flagConfig = { ...flagConfig, berufe_frage_vorlagen: value };
      if (alliance && adminFlagConfigCache[alliance]) adminFlagConfigCache[alliance] = { ...adminFlagConfigCache[alliance], berufe_frage_vorlagen: value };
      closeModal('modal-bp-templates');
      toast(tr('s_bp_tpl_saved'), 'ok');
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  // B6: Zaehler "n falsch einsortiert". Klick springt der Reihe nach zur naechsten falschen Kachel
  // (im Akkordeon wird die Karte dafuer aufgeklappt) und laesst sie kurz aufleuchten.
  let bpWrongIdx = -1;
  function bpWrongList() {
    if (!isBerufRankCheckOn()) return [];
    const out = [];
    bpWarlordList().forEach(kh => {
      if (bpBerufStatus(kh, 'kriegsherr') === 'wrong') out.push({ name: kh, kh });
      bpEngineerListFor(kh).forEach(n => { if (bpBerufStatus(n, 'ingenieur') === 'wrong') out.push({ name: n, kh }); });
    });
    return out;
  }
  function bpRenderWrongCount() {
    const el = document.getElementById('bp-wrong-count');
    if (!el) return;
    if (!isBerufRankCheckOn()) { el.hidden = true; return; }
    const n = bpWrongList().length;
    el.hidden = false;
    el.classList.toggle('ok', n === 0);
    el.disabled = n === 0;
    el.textContent = n ? `⚠ ${trf('s_bp_wrong_count', { n })}` : `✓ ${tr('s_bp_wrong_none')}`;
    el.title = n ? tr('s_bp_wrong_title') : '';
  }
  window.bpJumpWrong = function() {
    const list = bpWrongList();
    if (!list.length) return;
    bpWrongIdx = (bpWrongIdx + 1) % list.length;
    const target = list[bpWrongIdx];
    if (bpView === 'acc' && target.name !== target.kh && !bpOpenSet.has(target.kh)) {
      if (bpOpenSet.size <= 1) bpOpenSet.clear();
      bpOpenSet.add(target.kh);
      window.berufePlannerRender();
    }
    const sel = `#bp-grid [data-member="${CSS.escape(target.name)}"]`;
    const hit = document.querySelector(sel);
    const box = hit?.closest('.bp-acc-head, .bp-acc-eng, td') || hit;
    if (!box) return;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.remove('bp-flash');
    void box.offsetWidth; // Animation neu starten
    box.classList.add('bp-flash');
    setTimeout(() => box.classList.remove('bp-flash'), 1800);
  };

  // Feste Paare (♥): Ingenieur bleibt bei seinem Kriegsanführer, "Automatisch aufteilen" setzt ihn nie um.
  // alliance_config berufe_paare = {"<Ingenieur-ID>": "<Kriegsanführer-ID>"}; IDs ueberstehen Umbenennungen.
  function bpPairs() {
    let v = flagConfig?.berufe_paare;
    if (typeof v === 'string') { try { v = JSON.parse(v || '{}'); } catch (e) { v = null; } }
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }
  function bpIsPinned(name) {
    const m = memberMeta[name];
    if (!m || m.beruf !== 'ingenieur' || !m.berufWinwin || !m.id) return false;
    const khId = memberMeta[m.berufWinwin]?.id;
    return !!khId && bpPairs()[m.id] === khId;
  }
  function bpPairBtn(name) {
    const on = bpIsPinned(name);
    const canEdit = bpCanEditRankCheck();
    if (!on && !canEdit) return '';
    return `<button class="bp-pair-btn${on ? ' on' : ''}" type="button" draggable="false" title="${escHtml(tr(on ? 's_bp_pair_on' : 's_bp_pair_off'))}"${canEdit ? '' : ' disabled'} data-stop="mousedown dragstart click" data-prevent="dragstart click" data-action="bpTogglePair" data-args="${lwArgs(bpEnc(name))}">${on ? '♥' : '♡'}</button>`;
  }
  window.bpTogglePair = async function(nameEnc) {
    if (!bpCanEditRankCheck()) { toast(tr('s_bp_rc_only_r4'), 'err'); return; }
    const name = decodeURIComponent(nameEnc);
    const m = memberMeta[name];
    const khId = memberMeta[m?.berufWinwin]?.id;
    if (!m?.id || !khId) return;
    // Nur Paare behalten, die noch so im Planer stehen (veraltete raeumen sich dabei auf)
    const next = {};
    members.forEach(n => { if (bpIsPinned(n)) next[memberMeta[n].id] = memberMeta[memberMeta[n].berufWinwin].id; });
    if (next[m.id] === khId) delete next[m.id]; else next[m.id] = khId;
    try {
      await bpSavePairs(next);
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
    window.berufePlannerRender();
  };

  async function bpSavePairs(next) {
    const value = JSON.stringify(next);
    const alliance = getEffectiveAllianceForApi();
    await adminApi(`/alliance-config?alliance=${bpEnc(alliance)}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ discord_id: authMember?.discord_id || '', config: { berufe_paare: value } })
    });
    flagConfig = { ...flagConfig, berufe_paare: value };
    if (alliance && adminFlagConfigCache[alliance]) adminFlagConfigCache[alliance] = { ...adminFlagConfigCache[alliance], berufe_paare: value };
  }

  // Ein festes Paar loest sich auf, sobald es nicht mehr so im Planer steht: Ingenieur woanders hin oder in die
  // Warteschlange, oder sein Kriegsanführer ist keiner mehr. Sonst "wacht" das Herz beim Zurueckbauen wieder auf.
  async function bpDropStalePairs(name, beruf, winwin) {
    const pairs = bpPairs();
    const id = memberMeta[name]?.id;
    if (!id || !Object.keys(pairs).length) return;
    const khId = winwin ? memberMeta[winwin]?.id : null;
    const next = { ...pairs };
    let changed = false;
    if (next[id] && !(beruf === 'ingenieur' && khId && next[id] === khId)) { delete next[id]; changed = true; }
    if (beruf !== 'kriegsherr') {
      Object.keys(next).forEach(k => { if (next[k] === id) { delete next[k]; changed = true; } });
    }
    if (!changed || !bpCanEditRankCheck()) return;
    try {
      await bpSavePairs(next);
    } catch (err) {
      console.warn('berufe_paare aufraeumen fehlgeschlagen', err);
    }
  }

  // Muelleimer "In die Warteschlange" (SVG statt Emoji, sieht ueberall gleich aus). fn = Name in LW_ACTIONS, arg = kodierter Name.
  function bpDelBtn(fn, arg) {
    return `<button class="bp-acc-btn bp-acc-del" type="button" draggable="false" title="${escHtml(tr('s_bp_to_queue_btn'))}" data-stop="mousedown dragstart click" data-prevent="dragstart click" data-action="${fn}" data-args="${lwArgs(arg)}"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"/></svg></button>`;
  }

  function bpAskBtn(name) {
    return `<button class="bp-ask-btn" type="button" draggable="false" title="${escHtml(tr('s_bp_ask_title'))}" data-stop="mousedown dragstart click" data-prevent="dragstart click" data-action="bpAskPlayer" data-args="${lwArgs(bpEnc(name))}">✉</button>`;
  }

  function bpCopyText(text, onDone) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      toast(tr('s_bp_clipboard_unavailable'), 'err');
      return;
    }
    navigator.clipboard.writeText(text).then(onDone).catch(() => toast(tr('s_bp_copy_failed'), 'err'));
  }

  window.bpAskPlayer = function(nameEnc) {
    const name = decodeURIComponent(String(nameEnc || ''));
    const ta = document.getElementById('bp-ask-text');
    const who = document.getElementById('bp-ask-name');
    if (!ta) return;
    if (who) who.textContent = name;
    ta.value = bpBuildAskText(name);
    openModal('modal-bp-ask');
    ta.focus();
    ta.select();
    bpCopyText(ta.value, () => toast(tr('s_bp_ask_copied'), 'ok'));
  };

  window.bpAskCopyAgain = function(btn) {
    const ta = document.getElementById('bp-ask-text');
    if (!ta) return;
    bpCopyText(ta.value, () => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  };

  function bpCanEditRankCheck() {
    if (authMember?.can_set_features) return true;
    if (authMember?.read_only || authMember?.honor_role) return false;
    return (authMember?.rank || 0) >= 4;
  }

  function bpRenderRankCheckControls() {
    const box = document.getElementById('bp-rc');
    const onEl = document.getElementById('bp-rc-on');
    const r2El = document.getElementById('bp-rc-r2');
    if (!box || !onEl || !r2El) return;
    const canEdit = bpCanEditRankCheck();
    onEl.checked = isBerufRankCheckOn();
    r2El.value = getBerufRankCheckR2();
    onEl.disabled = !canEdit;
    r2El.disabled = !canEdit || !onEl.checked;
    box.title = canEdit ? '' : tr('s_bp_rc_only_r4');
    const tplBtn = document.getElementById('bp-tpl-btn');
    if (tplBtn) tplBtn.style.display = canEdit ? '' : 'none';
    const fillBtn = document.getElementById('bp-fill-btn');
    if (fillBtn) fillBtn.title = tr('s_bp_fill_title');
  }

  window.bpSaveRankCheck = async function() {
    const onEl = document.getElementById('bp-rc-on');
    const r2El = document.getElementById('bp-rc-r2');
    if (!onEl || !r2El || !bpCanEditRankCheck()) return;
    const alliance = getEffectiveAllianceForApi();
    const next = { berufe_rangcheck: !!onEl.checked, berufe_rangcheck_r2: r2El.value === 'kriegsherr' ? 'kriegsherr' : 'ingenieur' };
    onEl.disabled = true;
    r2El.disabled = true;
    try {
      await adminApi(`/alliance-config?alliance=${bpEnc(alliance)}`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ discord_id: authMember?.discord_id || '', config: next })
      });
      flagConfig = { ...flagConfig, ...next };
      if (alliance && adminFlagConfigCache[alliance]) adminFlagConfigCache[alliance] = { ...adminFlagConfigCache[alliance], ...next };
      if (document.getElementById('page-r')?.classList.contains('active')) loadErgebnis(); // Empfehlungen haengen am Rangcheck
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
    window.berufePlannerRender();
  };

  async function bpSaveBeruf(name, beruf, medHilfe, winwin) {
    await apiPost({ action: 'save_beruf', name, beruf, med_hilfe: medHilfe ? 1 : 0, winwin: winwin || null });
    await bpDropStalePairs(name, beruf, winwin);
  }

  // ── Berufe-Verlauf (api/src/beruf-history.php) ──
  // Liste der gespeicherten Staende; ein Klick zeigt, was sich gegenueber heute aendern wuerde, R4/R5 koennen
  // einzelne oder alle Aenderungen wiederherstellen.
  let bpHistCurrent = null;
  function bpHistWhen(s) {
    const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/);
    if (!m) return escHtml(s || '');
    let wd = '';
    try { wd = new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(document.documentElement.lang || 'de', { weekday: 'short' }) + ' '; } catch (_) {}
    return escHtml(`${wd}${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`);
  }
  function bpHistSource(src) {
    const s = String(src || '').replace(/^before:/, '');
    const key = s.startsWith('restore:') ? 'restore' : s.startsWith('move') ? 'move' : s;
    const map = { planer: 's_bp_hist_src_planer', scan: 's_bp_hist_src_scan', archive: 's_bp_hist_src_archive', move: 's_bp_hist_src_move',
      merge: 's_bp_hist_src_merge', restore: 's_bp_hist_src_restore', 'restore-player': 's_bp_hist_src_archive', check: 's_bp_hist_src_check' };
    return tr(map[key] || 's_bp_hist_src_check');
  }
  function bpHistLabel(e) {
    if (!e) return '—';
    if (e.b === 'kriegsherr') return '⚔ ' + escHtml(tr('s_bp_hist_kh'));
    if (e.b === 'ingenieur') {
      return '🔧 ' + escHtml(tr('s_bp_hist_ing')) + (e.w ? ' ' + escHtml(tr('s_bp_hist_at')) + ' <b>' + escHtml(e.w) + '</b>' : '') + (e.m ? ' · ✚' : '');
    }
    return escHtml(tr('s_bp_queue_title'));
  }
  window.bpOpenHistory = async function() {
    bpHistCurrent = null;
    document.getElementById('bp-hist-back').hidden = true;
    document.getElementById('bp-hist-restore').hidden = true;
    document.getElementById('bp-hist-hint').hidden = false;
    const body = document.getElementById('bp-hist-body');
    body.innerHTML = '<span class="spin">↻</span>';
    openModal('modal-bp-history');
    try {
      const data = await fetchJson('/beruf-history');
      const rows = data.snapshots || [];
      if (!rows.length) { body.innerHTML = `<div class="hint">${escHtml(tr('s_bp_hist_empty'))}</div>`; return; }
      body.innerHTML = rows.map(r => {
        const sum = (r.changes_list || []).slice(0, 4).map(c => `${escHtml(c.name)}: ${bpHistLabel(c.to)}`).join(' · ')
          + (r.changes > 4 ? ' …' : '');
        const by = r.changed_by ? ' · ' + escHtml(r.changed_by) : '';
        const count = r.changes ? ` · ${r.changes} ${escHtml(tr('s_bp_hist_changes'))}` : '';
        return `<button type="button" class="bp-hist-row" data-action="bpHistShow" data-args="${lwArgs(r.snapshot_id)}">
          <b>${bpHistWhen(r.created_at)}</b> <span class="bp-hist-meta">· ${escHtml(bpHistSource(r.source))}${by}${count} · ⚔ ${r.warlords} · 🔧 ${r.engineers}</span>
          ${sum ? `<div class="bp-hist-sum">${sum}</div>` : ''}</button>`;
      }).join('');
    } catch (err) {
      body.innerHTML = `<div class="hint">${escHtml(tr('Fehler: ') + err.message)}</div>`;
    }
  };
  window.bpHistBack = function() { window.bpOpenHistory(); };
  window.bpHistShow = async function(id) {
    const body = document.getElementById('bp-hist-body');
    body.innerHTML = '<span class="spin">↻</span>';
    document.getElementById('bp-hist-back').hidden = false;
    document.getElementById('bp-hist-hint').hidden = true;
    const restoreBtn = document.getElementById('bp-hist-restore');
    restoreBtn.hidden = true;
    try {
      const data = await fetchJson(`/beruf-history/${encodeURIComponent(id)}`);
      bpHistCurrent = data;
      const canRestore = bpCanEditRankCheck();
      const changes = data.changes || [];
      let html = `<div style="margin-bottom:8px"><b>${escHtml(tr('s_bp_hist_state_of'))} ${bpHistWhen(data.snapshot.created_at)}</b></div>`;
      if (!changes.length) html += `<div class="hint">${escHtml(tr('s_bp_hist_same'))}</div>`;
      html += changes.map(c => `<label class="bp-hist-change">
          ${canRestore ? `<input type="checkbox" class="bp-hist-pick" value="${escHtml(c.id)}" checked>` : ''}
          <span><b>${escHtml(c.name)}</b><br>
          <span class="bp-hist-from">${escHtml(tr('s_bp_hist_now'))}: ${bpHistLabel(c.from)}</span><br>
          ${escHtml(tr('s_bp_hist_then'))}: ${bpHistLabel(c.to)}</span></label>`).join('');
      if ((data.gone || []).length) {
        html += `<div class="hint" style="margin-top:10px">${escHtml(tr('s_bp_hist_gone'))}: `
          + data.gone.map(g => `${escHtml(g.name)} (${bpHistLabel(g)})`).join(', ') + '</div>';
      }
      body.innerHTML = html;
      restoreBtn.hidden = !canRestore || !changes.length;
    } catch (err) {
      body.innerHTML = `<div class="hint">${escHtml(tr('Fehler: ') + err.message)}</div>`;
    }
  };
  window.bpHistRestore = async function(btn) {
    if (!bpHistCurrent) return;
    const ids = Array.from(document.querySelectorAll('#bp-hist-body .bp-hist-pick:checked')).map(el => el.value);
    if (!ids.length) return;
    if (!confirm(tr('s_bp_hist_confirm').replace('{n}', ids.length))) return;
    bpBusy(btn, true);
    try {
      await fetchJson(`/beruf-history/${encodeURIComponent(bpHistCurrent.snapshot.snapshot_id)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_id: authMember?.discord_id || '', player_ids: ids })
      });
      toast(tr('s_bp_hist_done'), 'ok');
      closeModal('modal-bp-history');
      await window.berufePlannerLoadPage();
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    } finally {
      bpBusy(btn, false);
    }
  };

  // Ansicht: Akkordeon (Standard, Mockup C aus docs/konzept-berufe-mobil.html) oder die bisherige Tabelle.
  // In der Tabelle wurden lange Namen abgeschnitten, auch auf grossen Bildschirmen.
  let bpView = (() => { try { return localStorage.getItem('lwhub_bp_view') || 'acc'; } catch (_) { return 'acc'; } })();
  // Aufgeklappte Kriegsanführer. Ein Klick klappt nur diesen einen auf, "Alle aufklappen" alle.
  const bpOpenSet = new Set();
  window.bpSetView = function(view) {
    bpView = view === 'table' ? 'table' : 'acc';
    try { localStorage.setItem('lwhub_bp_view', bpView); } catch (_) {}
    window.berufePlannerRender();
  };
  window.bpAccToggle = function(khEnc) {
    const kh = decodeURIComponent(khEnc);
    if (bpOpenSet.has(kh)) bpOpenSet.delete(kh);
    else {
      if (bpOpenSet.size <= 1) bpOpenSet.clear(); // einzeln: wie bisher immer nur einer offen
      bpOpenSet.add(kh);
    }
    window.berufePlannerRender();
  };
  window.bpAccToggleAll = function() {
    const warlords = bpWarlordList();
    const allOpen = warlords.length > 0 && warlords.every(kh => bpOpenSet.has(kh));
    bpOpenSet.clear();
    if (!allOpen) warlords.forEach(kh => bpOpenSet.add(kh));
    window.berufePlannerRender();
  };

  // Pfeilrichtung des Zitterns wie beim Hinweis (→ Ing. / ← KH)
  const bpPullCls = c => (c.cls.match(/bp-pull-(left|right)/) || [''])[0];

  function bpAccordionHtml(warlords, maxIng) {
    if (!warlords.length) return `<div class="bp-acc-empty">${escHtml(tr('s_bp_no_warlords'))}</div>`;
    const queue = bpQueueList();
    const isWrong = c => c.cls.includes('bp-wrong');
    return '<div class="bp-acc">' + warlords.map(kh => {
      const engs = bpEngineerListFor(kh);
      const khEnc = bpEnc(kh);
      const open = bpOpenSet.has(kh);
      const full = engs.length >= maxIng;
      const khCheck = bpCheckMarkup(kh, 'kriegsherr');
      let h = `<div class="bp-acc-card${open ? ' open' : ''}${isWrong(khCheck) ? ' wrong ' + bpPullCls(khCheck) : ''}" data-on-dragover="bpAllowDrop" data-args-dragover="${lwArgs(LW_EVENT, LW_EL)}" data-on-dragleave="bpDropLeave" data-args-dragleave="${lwArgs(LW_EL)}" data-on-drop="bpAccDrop" data-args-drop="${lwArgs(LW_EVENT, khEnc, LW_EL)}">`
        + `<div class="bp-acc-head" data-action="bpAccToggle" data-args="${lwArgs(khEnc)}">`
        + `<span class="bp-acc-grip" draggable="true" data-member="${escHtml(kh)}" data-on-dragstart="bpDragStart" data-args-dragstart="${lwArgs(LW_EVENT, kh)}" data-on-dragend="bpDragEnd" data-stop="click">⠿</span>`
        + bpRankShield(kh) + `<span class="bp-acc-kh">⚔ ${escHtml(kh)}</span>` + khCheck.hint
        + `<span class="bp-acc-cap${full ? ' full' : ''}">${engs.length}/${maxIng}</span>` + bpAskBtn(kh) + bpDelBtn('bpUnsetWarlord', khEnc)
        + '<span class="bp-acc-chev">›</span></div>';
      if (!open) {
        if (engs.length) {
          h += '<div class="bp-acc-mini">' + engs.map(n => {
            const c = bpCheckMarkup(n, 'ingenieur');
            return `<span${isWrong(c) ? ` class="wrong ${bpPullCls(c)}" title="${escHtml(tr('s_bp_hint_title'))}"` : ''}>${bpIsPinned(n) ? '<span class="bp-pair-mini">♥</span> ' : ''}${escHtml(n)}</span>`;
          }).join(' · ') + '</div>';
        }
        return h + '</div>';
      }
      h += engs.map(n => {
        const c = bpCheckMarkup(n, 'ingenieur');
        return `<div class="bp-acc-eng${isWrong(c) ? ' wrong ' + bpPullCls(c) : ''}" draggable="true" data-member="${escHtml(n)}" data-on-dragstart="bpDragStart" data-args-dragstart="${lwArgs(LW_EVENT, n)}" data-on-dragend="bpDragEnd">`
          // Reihenfolge ✉ ♡ 🗑: das Herz liegt zwischen Fragen und Entfernen, damit man nicht versehentlich entfernt
          + `<span class="bp-acc-grip">⠿</span>${bpRankShield(n)}<span class="bp-acc-ing">👷 ${escHtml(n)}</span>${c.hint}${bpAskBtn(n)}${bpPairBtn(n)}`
          + bpDelBtn('bpAccToQueue', bpEnc(n)) + '</div>';
      }).join('');
      if (!full) {
        h += `<div class="bp-acc-add"><select data-on-change="bpAccAssign" data-args-change="${lwArgs(LW_EL, khEnc)}">`
          + `<option value="">＋ ${escHtml(tr('s_bp_acc_add'))} (${maxIng - engs.length} ${escHtml(tr('s_bp_acc_free'))})</option>`
          + (queue.length ? `<optgroup label="${escHtml(tr('s_bp_queue_title'))}">${queue.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('')}</optgroup>` : '')
          + '</select></div>';
      }
      return h + '</div>';
    }).join('') + '</div>';
  }

  // Spieler als Ingenieur zu einem Kriegsanführer (Akkordeon: Ziehen auf die Karte oder Auswahl "+ Ingenieur")
  async function bpAccAssignName(name, kh) {
    const engs = bpEngineerListFor(kh);
    if (!name || name === kh || engs.includes(name)) return;
    if (engs.length >= getBerufeMaxEngineers()) { toast(trf('{kh} hat schon {n} Ingenieure', { kh, n: engs.length }), 'err'); return; }
    const meta = memberMeta[name] || {};
    if (meta.beruf === 'kriegsherr' && !confirm(trf('{name} ist Kriegsanführer. Zum Ingenieur bei {kh} machen? Seine Ingenieure kommen in die Warteschlange.', { name, kh }))) return;
    try {
      await bpSaveBeruf(name, 'ingenieur', !!meta.berufMedHilfe, kh);
      if (bpOpenSet.size <= 1) bpOpenSet.clear();
      bpOpenSet.add(kh);
      await loadMembers();
      window.berufePlannerRender();
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
  }
  window.bpAccDrop = async function(event, khEnc, el) {
    event.preventDefault();
    bpDropLeave(el);
    await bpAccAssignName(bpReadDragMember(event), decodeURIComponent(khEnc));
  };
  window.bpAccAssign = function(select, khEnc) {
    const name = select.value;
    select.value = '';
    if (name) bpAccAssignName(name, decodeURIComponent(khEnc));
  };
  window.bpAccToQueue = async function(nameEnc) {
    const name = decodeURIComponent(nameEnc);
    try {
      await bpSaveBeruf(name, 'ingenieur', !!(memberMeta[name] || {}).berufMedHilfe, null);
      await loadMembers();
      window.berufePlannerRender();
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
  };

  window.berufePlannerRender = function() {
    const queueEl = document.getElementById('bp-queue');
    const gridEl = document.getElementById('bp-grid');
    const subEl = document.getElementById('bp-grid-sub');
    if (!queueEl || !gridEl) return;

    const maxIng = getBerufeMaxEngineers();
    const queue = bpQueueList();
    const warlords = bpWarlordList();
    if (subEl) {
      subEl.textContent = `${tr('s_bp_subtext_prefix')} ${maxIng} ${tr('s_bp_subtext_suffix')}`;
    }
    bpRenderRankCheckControls();
    bpRenderWrongCount();

    if (!queue.length) {
      queueEl.innerHTML = `<div style="font-size:12px;color:var(--soft);padding:8px;">${escHtml(tr('s_bp_queue_empty'))}</div>`;
    } else {
      queueEl.innerHTML = queue.map(name =>
        `<div class="bp-queue-item${bpCheckMarkup(name, 'queue').cls}" draggable="true" data-member="${escHtml(name)}" data-on-dragstart="bpDragStart" data-args-dragstart="${lwArgs(LW_EVENT, name)}" data-on-dragend="bpDragEnd">
          <span class="bp-queue-handle">⠿</span>
          ${bpRankShield(name)}
          <span class="bp-queue-name">${escHtml(name)}</span>
          ${bpAskBtn(name)}
          <button class="bp-queue-promote-btn" data-stop="click" data-prevent="click" data-action="bpMakeWarlord" data-args="${lwArgs(bpEnc(name))}" title="${escHtml(tr('s_bp_make_warlord'))}">+</button>
        </div>`
      ).join('');
    }

    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">'
      + `<div data-on-dragover="bpAllowDrop" data-args-dragover="${lwArgs(LW_EVENT, LW_EL)}" data-on-dragleave="bpDropLeave" data-args-dragleave="${lwArgs(LW_EL)}" data-on-drop="bpDropNewWarlord" data-args-drop="${lwArgs(LW_EVENT, LW_EL)}" style="padding:8px;border:1px dashed rgba(224,85,69,0.35);border-radius:8px;color:#f09080;font-size:11px;">${escHtml(tr('s_bp_drop_new_warlord'))}</div>`
      + `<div data-on-dragover="bpAllowDrop" data-args-dragover="${lwArgs(LW_EVENT, LW_EL)}" data-on-dragleave="bpDropLeave" data-args-dragleave="${lwArgs(LW_EL)}" data-on-drop="bpDropToQueue" data-args-drop="${lwArgs(LW_EVENT, LW_EL)}" style="padding:8px;border:1px dashed rgba(255,255,255,0.2);border-radius:8px;color:var(--soft);font-size:11px;">${escHtml(tr('s_bp_drop_to_queue'))}</div>`
      + '</div>';
    document.querySelectorAll('#bp-view [data-bpview]').forEach(b => b.classList.toggle('on', b.dataset.bpview === bpView));
    // "Alle auf-/zuklappen" im Planer-Kopf neben dem Ansicht-Umschalter, nur in der Kartenansicht
    const accAll = document.getElementById('bp-acc-all');
    if (accAll) {
      const allOpen = warlords.length > 0 && warlords.every(kh => bpOpenSet.has(kh));
      accAll.hidden = bpView !== 'acc' || !warlords.length;
      accAll.textContent = `${allOpen ? '▴' : '▾'} ${tr(allOpen ? 's_bp_acc_collapse_all' : 's_bp_acc_expand_all')}`;
    }
    if (bpView === 'acc') {
      gridEl.innerHTML = html + bpAccordionHtml(warlords, maxIng);
      return;
    }
    html += '<div class="bp-table-wrap"><table class="bp-table">';
    html += `<thead><tr><th style="text-align:left;font-size:11px;color:var(--soft);padding:6px;">${escHtml(tr('s_kriegsherr'))}</th>`;
    for (let i = 1; i <= maxIng; i++) {
      html += `<th style="text-align:left;font-size:11px;color:var(--soft);padding:6px;">${escHtml(tr('s_bp_ing_prefix'))} ${i}</th>`;
    }
    html += `<th style="text-align:left;font-size:11px;color:var(--soft);padding:6px;width:44px;"></th></tr></thead><tbody>`;

    warlords.forEach((kh) => {
      const engineers = bpEngineerListFor(kh);
      const khEnc = bpEnc(kh);
      html += '<tr>';
      const khCheck = bpCheckMarkup(kh, 'kriegsherr', true);
      html += `<td class="bp-cell-name${khCheck.cls}" data-on-dragover="bpAllowDrop" data-args-dragover="${lwArgs(LW_EVENT, LW_EL)}" data-on-dragleave="bpDropLeave" data-args-dragleave="${lwArgs(LW_EL)}" data-on-drop="bpDropToWarlord" data-args-drop="${lwArgs(LW_EVENT, khEnc, LW_EL)}">`;
      html += `<div class="bp-name-draggable" draggable="true" data-member="${escHtml(kh)}" data-on-dragstart="bpDragStart" data-args-dragstart="${lwArgs(LW_EVENT, kh)}" data-on-dragend="bpDragEnd">`;
      html += bpRankShield(kh);
      html += '<span class="bp-ico" style="font-size:12px;color:#f09080;">⚔</span>';
      html += `<span class="bp-name-text kh" title="${escHtml(kh)}">${escHtml(kh)}</span>`;
      html += khCheck.hint;
      html += bpAskBtn(kh);
      html += '</div></td>';

      for (let i = 0; i < maxIng; i++) {
        const eng = engineers[i] || null;
        const engCheck = eng ? bpCheckMarkup(eng, 'ingenieur', true) : { cls: '', hint: '' };
        html += `<td class="bp-cell-slot${engCheck.cls}" data-on-dragover="bpAllowDrop" data-args-dragover="${lwArgs(LW_EVENT, LW_EL)}" data-on-dragleave="bpDropLeave" data-args-dragleave="${lwArgs(LW_EL)}" data-on-drop="bpDropToEngineerSlot" data-args-drop="${lwArgs(LW_EVENT, khEnc, i, LW_EL)}">`;
        if (eng) {
          html += `<div class="bp-name-draggable" draggable="true" data-member="${escHtml(eng)}" data-on-dragstart="bpDragStart" data-args-dragstart="${lwArgs(LW_EVENT, eng)}" data-on-dragend="bpDragEnd">`;
          html += bpRankShield(eng);
          html += '<span class="bp-ico" style="font-size:12px;color:#80b8ff;">👷</span>';
          html += `<span class="bp-name-text ing" title="${escHtml(eng)}">${escHtml(eng)}</span>`;
          html += engCheck.hint;
          html += bpAskBtn(eng);
          html += bpPairBtn(eng);
          html += '</div>';
        } else {
          html += `<span class="bp-slot-text">${escHtml(tr('s_bp_slot_free'))}</span>`;
        }
        html += '</td>';
      }

      html += `<td class="bp-cell-action">${bpDelBtn('bpUnsetWarlord', khEnc)}</td>`;
      html += '</tr>';
    });

    if (!warlords.length) {
      html += `<tr><td colspan="${maxIng + 2}" style="padding:12px;color:var(--soft);font-size:12px;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.15);border-radius:8px;">${escHtml(tr('s_bp_no_warlords'))}</td></tr>`;
    }

    html += '</tbody></table></div>';
    gridEl.innerHTML = html;
  };

  window.berufePlannerLoadPage = async function() {
    await loadFlagConfig();
    await loadMembers();
    const sel = document.getElementById('bp-sort-select');
    if (sel && sel.value) bpSort = sel.value;
    window.berufePlannerRender();
  };

  window.berufePlannerSetSort = function(mode) {
    bpSort = mode || 'asc';
    window.berufePlannerRender();
  };

  window.bpDragStart = function(event, memberName) {
    window._bpDragMember = memberName;
    // Zittern waehrend des Ziehens aussetzen
    document.getElementById('page-bp')?.classList.add('bp-dragging');
    try { event.dataTransfer.setData('text/plain', memberName); } catch (e) {}
    event.dataTransfer.effectAllowed = 'copy';
  };

  window.bpDragEnd = function() {
    document.getElementById('page-bp')?.classList.remove('bp-dragging');
  };

  window.bpAllowDrop = function(event, el) {
    event.preventDefault();
    if (el) {
      el.style.outline = '2px solid var(--gold)';
      el.style.outlineOffset = '-1px';
    }
  };

  window.bpDropLeave = function(el) {
    if (!el) return;
    el.style.outline = '';
    el.style.outlineOffset = '';
  };

  function bpReadDragMember(event) {
    window.bpDragEnd();
    let name = window._bpDragMember || '';
    window._bpDragMember = null;
    if (!name) {
      try { name = event.dataTransfer.getData('text/plain') || ''; } catch (e) {}
    }
    return name;
  }

  window.bpDropToQueue = async function(event, el) {
    event.preventDefault();
    bpDropLeave(el);
    const name = bpReadDragMember(event);
    if (!name) return;
    try {
      const meta = memberMeta[name] || {};
      if ((meta.beruf || null) === 'kriegsherr') {
        await bpSaveBeruf(name, null, 0, null);
      } else {
        await bpSaveBeruf(name, 'ingenieur', !!meta.berufMedHilfe, null);
      }
      await loadMembers();
      window.berufePlannerRender();
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
  };

  window.bpDropToWarlord = async function(event, warlordName, el) {
    event.preventDefault();
    bpDropLeave(el);
    warlordName = decodeURIComponent(String(warlordName || ''));
    const name = bpReadDragMember(event);
    if (!name || name === warlordName) return;
    try {
      await bpSaveBeruf(name, 'kriegsherr', 0, null);
      await loadMembers();
      window.berufePlannerRender();
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
  };

  window.bpDropNewWarlord = async function(event, el) {
    event.preventDefault();
    bpDropLeave(el);
    const name = bpReadDragMember(event);
    if (!name) return;
    try {
      await bpSaveBeruf(name, 'kriegsherr', 0, null);
      await loadMembers();
      window.berufePlannerRender();
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
  };

  window.bpDropToEngineerSlot = async function(event, warlordName, slotIndex, el) {
    event.preventDefault();
    bpDropLeave(el);
    warlordName = decodeURIComponent(String(warlordName || ''));
    const dragName = bpReadDragMember(event);
    if (!dragName) return;
    const engineers = bpEngineerListFor(warlordName);
    const slotOccupant = engineers[slotIndex] || null;
    if (slotOccupant === dragName) return;

    try {
      if (slotOccupant && slotOccupant !== dragName) {
        const occMeta = memberMeta[slotOccupant] || {};
        await bpSaveBeruf(slotOccupant, 'ingenieur', !!occMeta.berufMedHilfe, null);
      }
      const dragMeta = memberMeta[dragName] || {};
      await bpSaveBeruf(dragName, 'ingenieur', !!dragMeta.berufMedHilfe, warlordName);
      await loadMembers();
      window.berufePlannerRender();
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
  };

  window.bpUnsetWarlord = async function(name) {
    name = decodeURIComponent(String(name || ''));
    const msg = `${tr('s_bp_confirm_unset_title')} ${name}?\n\n${tr('s_bp_confirm_unset_line1')}\n${tr('s_bp_confirm_unset_line2')}`;
    if (!confirm(msg)) return;
    try {
      await bpSaveBeruf(name, null, 0, null);
      await loadMembers();
      window.berufePlannerRender();
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
  };

  function bpBuildMailText() {
    // Erste Zeile kommt im Spiel in den Betreff, der Rest ist der Inhalt. Ohne Ingenieur-Hoechstzahl, die braucht dort keiner.
    const warlords = bpWarlordList();
    const lines = [tr('s_bp_mail_title'), tr('s_bp_mail_winwin'), ''];
    if (!warlords.length) {
      lines.push(tr('s_bp_no_warlords_assigned'));
      return lines.join('\n');
    }
    warlords.forEach((kh) => {
      const engineers = bpEngineerListFor(kh);
      lines.push(`⚔ ${kh}`);
      if (!engineers.length) {
        lines.push(`  - ${tr('s_bp_no_engineers')}`);
      } else {
        engineers.forEach((name, idx) => lines.push(`  ${idx + 1}. 👷 ${name}`)); // 👷 wie das Ingenieur-Bild im Spiel; ⚗ sah dort wie ein Grill aus
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  window.berufePlannerCopyMail = function(btn) {
    const text = bpBuildMailText();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (!btn) return;
        const orig = btn.textContent;
        btn.textContent = '✓';
        btn.style.color = 'var(--green)';
        setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1800);
      }).catch(() => {
        toast(tr('s_bp_copy_failed'), 'err');
      });
      return;
    }
    toast(tr('s_bp_clipboard_unavailable'), 'err');
  };

  window.bpMakeWarlord = async function(encodedName) {
    const name = decodeURIComponent(String(encodedName || ''));
    if (!name) return;
    try {
      await bpSaveBeruf(name, 'kriegsherr', 0, null);
      await loadMembers();
      window.berufePlannerRender();
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
    }
  };

  // Automatisch aufteilen (mit Vorschau):
  //  1. Wer in der Warteschlange vom Rang her Kriegsanführer ist (Rangcheck an), wird Kriegsanführer.
  //  2. Jeder Kriegsanführer ohne aktiven Ingenieur bekommt zuerst einen aktiven aus der Warteschlange
  //     (aktiv = oberes Drittel nach Punkten der letzten 4 abgeschlossenen Wochen, AFK/fehlend = 0).
  //  3. Der Rest geht gleichmaessig und zufaellig auf die freien Plaetze.
  //  4. Optional (Haekchen, Standard an): Kriegsanführer mit 2+ Aktiven geben einen an Kriegsanführern ohne
  //     Aktiven ab; ist der Empfaenger voll, geht dafuer sein schwaechster Ingenieur zurueck (Tausch).
  //  5. Optional (gleiches Haekchen): Anzahl ausgleichen, kein Kriegsanführer hat 2+ Ingenieure mehr als ein anderer.
  //  ♥-Paare und R4/R5 werden nie angefasst.
  let bpFillScores = null; // { scores: {name: pts}, threshold, weeks }
  let bpFillCurrent = null;

  const bpShuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  async function bpLoadFillScores() {
    const data = await api('ranking-history', { weeks: 4 });
    const weeks = data?.weeks || [];
    const scores = {};
    (data?.players || []).forEach(p => {
      scores[p.name] = weeks.reduce((sum, yw) => {
        const e = p.entries?.[yw];
        return sum + (e && !e.missing && !e.afk ? calcPoints(e.flags || {}) : 0);
      }, 0);
    });
    const sorted = Object.values(scores).filter(v => v > 0).sort((a, b) => b - a);
    const threshold = sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length / 3) - 1)] : Infinity;
    return { scores, threshold, weeks: weeks.length };
  }

  function bpPlanFill(withMoves) {
    const { scores, threshold } = bpFillScores;
    const pts = n => scores[n] || 0;
    const isActive = n => pts(n) > 0 && pts(n) >= threshold;
    const maxIng = getBerufeMaxEngineers();
    const stay = [];
    const newKh = [];
    const cands = [];
    bpQueueList().forEach(n => {
      const rank = Number(PREV[n]);
      if (rank >= 4) stay.push({ name: n, reason: 'r45' });
      else if (bpExpectedBeruf(rank) === 'kriegsherr') newKh.push(n);
      else cands.push(n);
    });
    const warlords = [...bpWarlordList(), ...newKh];
    // Zustand: Kriegsanführer -> Ingenieure; origin = Kriegsanführer vor der Verteilung (null = Warteschlange)
    const slots = new Map();
    const origin = {};
    warlords.forEach(kh => {
      const engs = newKh.includes(kh) ? [] : bpEngineerListFor(kh);
      slots.set(kh, engs.slice());
      engs.forEach(n => { origin[n] = kh; });
    });
    const freeOf = kh => maxIng - slots.get(kh).length;
    const hasActive = kh => slots.get(kh).some(isActive);
    const movable = n => origin[n] === null || (!bpIsPinned(n) && Number(PREV[n]) < 4);
    const put = (n, kh) => { slots.get(kh).push(n); };
    const pull = (n, kh) => { const l = slots.get(kh); l.splice(l.indexOf(n), 1); };
    cands.forEach(n => { origin[n] = null; });

    // Schritt 2: die aktivsten aus der Warteschlange zuerst an Kriegsanführern ohne aktiven Ingenieur
    const activeCands = bpShuffle(cands.filter(isActive)).sort((a, b) => pts(b) - pts(a));
    const used = new Set();
    bpShuffle(warlords.filter(kh => !hasActive(kh) && freeOf(kh) > 0)).forEach(kh => {
      const n = activeCands.find(c => !used.has(c));
      if (!n) return;
      used.add(n);
      put(n, kh);
    });
    // Schritt 3: Rest gleichmaessig, Zufall bei Gleichstand
    bpShuffle(cands.filter(n => !used.has(n))).forEach(n => {
      const best = Math.max(0, ...warlords.map(freeOf));
      if (!best) { stay.push({ name: n, reason: 'full' }); return; }
      const options = warlords.filter(kh => freeOf(kh) === best);
      put(n, options[Math.floor(Math.random() * options.length)]);
    });
    // Schritt 4: Aktive umsetzen, bis jeder Kriegsanführer einen hat (soweit moeglich)
    if (withMoves) {
      bpShuffle(warlords.filter(kh => !hasActive(kh))).forEach(w => {
        // Spender: Kriegsanführer mit den meisten Aktiven (mind. 2), davon einer beweglich
        const donors = warlords
          .filter(d => d !== w && slots.get(d).filter(isActive).length >= 2 && slots.get(d).some(n => isActive(n) && movable(n)))
          .sort((a, b) => slots.get(b).filter(isActive).length - slots.get(a).filter(isActive).length);
        const d = donors[0];
        if (!d) return;
        // Der schwaechste bewegliche Aktive geht, die Spender behalten ihre Besten
        const a = slots.get(d).filter(n => isActive(n) && movable(n)).sort((x, y) => pts(x) - pts(y))[0];
        if (freeOf(w) > 0) { pull(a, d); put(a, w); return; }
        const b = slots.get(w).filter(n => !isActive(n) && movable(n)).sort((x, y) => pts(x) - pts(y))[0];
        if (!b) return; // voll und nur ♥-Paare: nichts zu machen
        pull(a, d); pull(b, w); put(a, w); put(b, d);
      });
      // Schritt 5: Anzahl ausgleichen. Solange einer 2+ Ingenieure mehr hat als ein anderer, gibt er einen ab:
      // bevorzugt einen nicht aktiven (den schwaechsten), einen Aktiven nur, wenn ihm dann noch einer bleibt.
      const exhausted = new Set();
      for (let guard = 0; guard < 200; guard++) {
        const count = kh => slots.get(kh).length;
        const donors = warlords.filter(kh => !exhausted.has(kh));
        if (!donors.length) break;
        const hi = Math.max(...donors.map(count));
        const lo = Math.min(...warlords.map(count));
        if (hi - lo < 2) break;
        const d = bpShuffle(donors.filter(kh => count(kh) === hi))[0];
        const r = bpShuffle(warlords.filter(kh => count(kh) === lo))[0];
        const keepsActive = slots.get(d).filter(isActive).length >= 2;
        const pick = slots.get(d)
          .filter(n => movable(n) && (!isActive(n) || keepsActive))
          .sort((x, y) => (isActive(x) - isActive(y)) || (pts(x) - pts(y)))[0];
        if (!pick) { exhausted.add(d); continue; } // nur ♥-Paare/R4/R5: dieser Spender faellt aus
        pull(pick, d);
        put(pick, r);
      }
    }
    // Ergebnis: Unterschiede zum Ausgangszustand
    const engs = [];
    const moves = [];
    warlords.forEach(kh => slots.get(kh).forEach(n => {
      const e = { name: n, kh, pts: pts(n), active: isActive(n) };
      if (origin[n] === null) engs.push(e);
      else if (origin[n] !== kh) moves.push({ ...e, from: origin[n] });
    }));
    return { newKh, engs, moves, stay, noActive: warlords.filter(kh => !hasActive(kh)) };
  }

  function bpRenderFillPreview() {
    const box = document.getElementById('bp-fill-body');
    if (!box) return;
    const withMoves = document.getElementById('bp-fill-move')?.checked !== false;
    const plan = bpFillCurrent = bpPlanFill(withMoves);
    const { threshold, weeks } = bpFillScores;
    const li = s => `<li>${s}</li>`;
    const engTxt = e => `${bpRankShield(e.name)}<b>${escHtml(e.name)}</b> <span class="bp-fill-pts${e.active ? ' on' : ''}">${e.active ? '★ ' : ''}${escHtml(trf('s_bp_fill_pts', { n: e.pts }))}</span>`;
    let h = `<div class="hint" style="margin-bottom:10px">${escHtml(trf('s_bp_fill_hint', { n: Number.isFinite(threshold) ? threshold : '–', w: weeks }))}</div>`;
    if (plan.newKh.length) {
      h += `<div class="bp-fill-h">⚔ ${escHtml(tr('s_bp_fill_new_kh'))} (${plan.newKh.length})</div><ul class="bp-fill-list">`
        + plan.newKh.map(n => li(`${bpRankShield(n)}<b>${escHtml(n)}</b>`)).join('') + '</ul>';
    }
    if (plan.engs.length) {
      const byKh = {};
      plan.engs.forEach(e => (byKh[e.kh] = byKh[e.kh] || []).push(e));
      h += `<div class="bp-fill-h">👷 ${escHtml(tr('s_bp_fill_engs'))} (${plan.engs.length})</div><ul class="bp-fill-list">`
        + Object.keys(byKh).sort((a, b) => a.localeCompare(b, 'de')).map(kh => li(
          `<span class="bp-fill-kh">${escHtml(kh)}</span> ← ` + byKh[kh].map(engTxt).join('<span class="bp-fill-pts">·</span>')
        )).join('') + '</ul>';
    }
    if (plan.moves.length) {
      h += `<div class="bp-fill-h">⇄ ${escHtml(tr('s_bp_fill_moves'))} (${plan.moves.length})</div><ul class="bp-fill-list">`
        + plan.moves.map(e => li(`${engTxt(e)} <span class="bp-fill-pts">${escHtml(e.from)} →</span> <span class="bp-fill-kh">${escHtml(e.kh)}</span>`)).join('') + '</ul>';
    }
    if (plan.stay.length) {
      h += `<div class="bp-fill-h">⏸ ${escHtml(tr('s_bp_fill_stay'))} (${plan.stay.length})</div><ul class="bp-fill-list">`
        + plan.stay.map(s => li(`${bpRankShield(s.name)}${escHtml(s.name)} <span class="bp-fill-pts">${escHtml(tr(s.reason === 'r45' ? 's_bp_fill_reason_r45' : 's_bp_fill_reason_full'))}</span>`)).join('') + '</ul>';
    }
    if (plan.noActive.length) {
      h += `<div class="bp-fill-h warn">⚠ ${escHtml(tr('s_bp_fill_no_active'))} (${plan.noActive.length})</div>`
        + `<div class="bp-fill-warn">${plan.noActive.map(escHtml).join(' · ')}</div>`;
    }
    const nothing = !plan.newKh.length && !plan.engs.length && !plan.moves.length;
    if (nothing) h += `<div class="hint">${escHtml(tr('s_bp_fill_none'))}</div>`;
    box.innerHTML = h;
    const applyBtn = document.getElementById('bp-fill-apply');
    if (applyBtn) applyBtn.disabled = nothing;
  }

  // Knopf sichtbar "beschaeftigt": deaktiviert, halb gedrueckt, mit Spinner
  function bpBusy(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle('bp-busy', on);
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  window.bpFillRest = async function(btn) {
    if (btn?.classList.contains('bp-busy')) return;
    bpBusy(btn, true);
    try {
      // Punkte der letzten 4 Wochen laden dauert einen Moment: Blende zeigen, damit man sieht, dass gerechnet wird
      bpFillScores = await runWithBattleLoader(() => bpLoadFillScores(), 600, 150);
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
      return;
    } finally {
      bpBusy(btn, false);
    }
    bpRenderFillPreview();
    openModal('modal-bp-fill');
  };
  window.bpFillReroll = function() { bpRenderFillPreview(); };

  window.bpFillApply = async function(btn) {
    const plan = bpFillCurrent;
    if (!plan || btn?.classList.contains('bp-busy')) return;
    const modalBtns = [...document.querySelectorAll('#modal-bp-fill .modal-footer button')];
    modalBtns.forEach(b => { b.disabled = true; });
    bpBusy(btn, true);
    const med = n => !!(memberMeta[n] || {}).berufMedHilfe;
    try {
      await runWithBattleLoader(async () => {
        // 1. neue Kriegsanführer, 2. Umgesetzte kurz loesen (der Server prueft die Hoechstzahl, sonst
        // blockiert ein Tausch zwischen zwei vollen Kriegsanführern), 3. alle Ingenieure zuordnen
        for (const n of plan.newKh) await bpSaveBeruf(n, 'kriegsherr', 0, null);
        for (const e of plan.moves) await bpSaveBeruf(e.name, 'ingenieur', med(e.name), null);
        for (const e of [...plan.moves, ...plan.engs]) await bpSaveBeruf(e.name, 'ingenieur', med(e.name), e.kh);
        await loadMembers();
      }, 900, 0);
      closeModal('modal-bp-fill');
      toast(trf('s_bp_fill_done', { n: plan.newKh.length + plan.engs.length + plan.moves.length, rest: plan.stay.length }), 'ok');
    } catch (err) {
      toast(tr('Fehler: ') + err.message, 'err');
      await loadMembers(); // Teilstand anzeigen, falls mittendrin etwas schiefging
    } finally {
      bpBusy(btn, false);
      modalBtns.forEach(b => { b.disabled = false; });
      bpFillCurrent = null;
      window.berufePlannerRender();
    }
  };
})();
