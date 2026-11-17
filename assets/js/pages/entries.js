// LWHub – Eintragen-Liste (/list) und Tastatur-Shortcuts für die Mitglied-Suche
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html). Normales Script, kein Modul:
// alles bleibt global wie vorher. Die Reihenfolge der <script>-Tags in index.html ist die Ladereihenfolge.

// ── MEMBER LIST ──
function toggleDoneMode(){
  doneMode=(doneMode+1)%3;
  const btn=document.getElementById('btn-done-bottom');
  if(doneMode===0){btn.classList.remove('on');btn.textContent='↓ '+tr('Erfasste ans Ende');}
  else if(doneMode===1){btn.classList.add('on');btn.textContent='↓ '+tr('Erfasste ans Ende');}
  else{btn.classList.add('on');btn.textContent='○ '+tr('Erfasste ausblenden');}
  renderList();
}
window.toggleDoneMode=toggleDoneMode;

function renderList(){
  const wm=weekMembers(), n=entries.filter(e=>wm.includes(e.name)).length, pct=Math.round(n/wm.length*100);
  document.getElementById('listCounter').textContent=`${n} / ${wm.length} ${tr('erfasst')} (${pct}%)`;

  const shown=wm.filter(name=>{
    if(search&&!name.toLowerCase().includes(search)) return false;
    const e=entries.find(x=>x.name===name);
    if(listFilter==='missing') return !e;
    if(listFilter==='done') return !!e;
    // doneMode===2: hide done entirely
    if(doneMode===2 && !!e) return false;
    return true;
  });

  const list=document.getElementById('memberList');
  if(!shown.length){list.innerHTML=`<div class="empty">Keine Mitglieder gefunden.</div>`;return;}

  // doneMode===1: sort done to bottom (only when listFilter==='all')
  let displayList=shown;
  let splitAt=-1;
  if(doneMode===1 && listFilter==='all'){
    const undone=shown.filter(name=>!entries.find(x=>x.name===name));
    const done=shown.filter(name=>!!entries.find(x=>x.name===name));
    displayList=[...undone,...done];
    if(undone.length>0 && done.length>0) splitAt=undone.length;
  }

  list.innerHTML=displayList.map((name,i)=>{
    const e=entries.find(x=>x.name===name);
    const rank=isFixed(name)?fixedRank(name):(PREV[name]||3);
    const hasWarn=e?[...DANGER].some(k=>e.flags[k]):false;
    const af=e?Object.keys(e.flags).filter(k=>e.flags[k]):[];

    const statusIcon=!e?'<span class="entries-status-none">○</span>':hasWarn?'<span class="entries-status-warn">⚠</span>':'<span class="entries-status-ok">✓</span>';
    const rankBadge=`<span class="rank-badge ${rbClass(rank)}">${rank} · ${RL[rank]}</span>`;
    const fixedBadge=isFixed(name)?` <span class="entries-fixed-badge">${R5.has(name)?'R5':'R4'}</span>`:'';
    const tags=af.slice(0,3).map(k=>{
      const cls=DANGER.has(k)?'r':AMBER.has(k)?'a':NEUTRAL.has(k)?'n':'b';
      return `<span class="tag ${cls}">${LBL[k]||k}</span>`;
    }).join('')+(af.length>3?`<span class="tag entries-tag-more">+${af.length-3}</span>`:'');

    const dimCls=(doneMode===1 && !!e)?' done-dim':'';
    const divider=(i===splitAt)?'<div class="done-divider">✓ Bereits erfasst</div>':'';

    return divider+`<div class="member-row${dimCls}${formerCls(name)}" data-name="${name.replace(/"/g,'&quot;')}" data-action="openEditor" data-args="${lwArgs(name)}">
      <span class="m-status">${statusIcon}</span>
      <span class="m-name">${name}${fixedBadge}${formerTag(name)}</span>
      <span class="m-rank">${rankBadge}</span>
      <span class="m-tags">${tags}</span>
    </div>`;
  }).join('');
}

// ── TASTATUR-SHORTCUTS (Mitglied-Suche per Buchstabe) ──
(function(){
  let keyChain='';

  function clearHighlights(){
    document.querySelectorAll('.flash-match').forEach(r=>r.classList.remove('flash-match'));
  }

  function clearKeyChain(){
    keyChain='';
    clearHighlights();
  }

  function applyChainedHighlight(){
    const pageE=document.getElementById('page-e').classList.contains('active');
    const pageW=document.getElementById('page-w').classList.contains('active');
    if(!pageE && !pageW) return;
    if(!keyChain){
      clearHighlights();
      return;
    }

    clearHighlights();
    let first=null;
    if(pageE){
      document.querySelectorAll('#memberList .member-row').forEach(row=>{
        const name=(row.dataset.name||'').toLowerCase();
        const parts=name.split(/[\s_\-]+/);
        if(parts.some(p=>p.startsWith(keyChain))){
          row.classList.add('flash-match');
          if(!first) first=row;
        }
      });
    } else {
      document.querySelectorAll('.event-section.active .wache-tile').forEach(tile=>{
        const name=(tile.querySelector('.wt-name')?.textContent||'').toLowerCase();
        const parts=name.split(/[\s_\-]+/);
        if(parts.some(p=>p.startsWith(keyChain))){
          tile.classList.add('flash-match');
          if(!first) first=tile;
        }
      });
    }

    if(first) first.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  document.addEventListener('keydown',function(e){
    const pageE=document.getElementById('page-e')?.classList.contains('active');
    const pageW=document.getElementById('page-w')?.classList.contains('active');
    if(!pageE && !pageW) return;
    const tag=(document.activeElement?.tagName||'').toLowerCase();
    if(tag==='input'||tag==='textarea'||tag==='select') return;
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    const key=e.key;

    if(key===' '){
      if(keyChain){
        e.preventDefault();
        clearKeyChain();
      }
      return;
    }

    if(key==='Backspace'){
      if(!keyChain) return;
      e.preventDefault();
      keyChain = keyChain.slice(0, -1);
      applyChainedHighlight();
      return;
    }

    if(!/^[a-zA-Z\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df]$/.test(key)) return;
    keyChain += key.toLowerCase();
    applyChainedHighlight();
  });

  document.addEventListener('click',function(){
    if(!keyChain) return;
    clearKeyChain();
  });
})();
