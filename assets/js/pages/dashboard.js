// LWHub – Dashboard (/stats/dash) und Ranking-Tabelle, Filterleisten
// Ausgelagert aus index.html (docs/konzept-frontend-umbau.html). Normales Script, kein Modul:
// alles bleibt global wie vorher. Die Reihenfolge der <script>-Tags in index.html ist die Ladereihenfolge.

// ── DASHBOARD ──
// Punkte-Empfehlung (Aufsteiger/Absteiger, Tendenz) nur, wenn Raenge nach Punkten vergeben werden: Feature
// "Rang nach Punkten" (ergebnis) an und kein Rangcheck nach Beruf – beides zusammen ergibt keinen Sinn (Handbuch)
function rankByPoints() {
  return isFeatureEnabled('ergebnis') && !isBerufRankCheckOn();
}

function renderDashboard(){
  document.body.classList.toggle('no-points-rank', !rankByPoints());
  if(!rankByPoints() && (activeFilter==='up'||activeFilter==='down')) activeFilter='all';
  if(entriesLoading && entries.length===0){
    document.getElementById('s-count').textContent='...';
    document.getElementById('prog-fill').style.width='0%';
    document.getElementById('prog-pct').textContent=tr('lädt');
    document.getElementById('kw-d').textContent=kw;
    document.getElementById('s-warn').textContent='...';
    document.getElementById('s-up').textContent='...';
    document.getElementById('s-down').textContent='...';
    document.getElementById('warn-ct').textContent=tr('lädt');
    document.getElementById('warn-list').innerHTML='<div class="empty" style="padding:0.5rem 0;">'+escHtml(tr('Warnliste lädt ...'))+'</div>';
    document.getElementById('top-list').innerHTML='<div class="empty" style="padding:0.5rem 0;">'+escHtml(tr('Top Performer werden geladen ...'))+'</div>';
    document.getElementById('field-bars').innerHTML='<div class="empty" style="padding:0.5rem 0;">'+escHtml(tr('Diagramme werden im Hintergrund aktualisiert ...'))+'</div>';
    document.getElementById('rdist').innerHTML='';
    renderTable();
    return;
  }

  const wm=weekMembers(), n=entries.filter(e=>wm.includes(e.name)).length, pct=Math.round(n/wm.length*100);
  document.getElementById('s-count').textContent=n;
  const countSub=document.getElementById('s-count-sub');
  if(countSub) countSub.textContent=trf('von {n} Mitgliedern', { n: wm.length });
  document.getElementById('prog-fill').style.width=pct+'%';
  document.getElementById('prog-pct').textContent=pct+'%';
  document.getElementById('kw-d').textContent=kw;

  const dk=[...DANGER];
  const we=entries.filter(e=>dk.some(k=>e.flags[k]));
  const ue=entries.filter(e=>!isFixed(e.name)&&e.rank<(PREV[e.name]||3));
  const de=entries.filter(e=>!isFixed(e.name)&&e.rank>(PREV[e.name]||3));
  document.getElementById('s-warn').textContent=we.length;
  document.getElementById('s-up').textContent=ue.length;
  document.getElementById('s-down').textContent=de.length;
  document.getElementById('warn-ct').textContent=we.length+' '+tr('Mitglieder');

  document.getElementById('warn-list').innerHTML=we.length===0
    ?'<div class="empty" style="padding:0.5rem 0;">'+escHtml(tr('Keine Warnungen diese Woche.'))+'</div>'
    :we.slice(0,8).map(e=>{
      const wf=dk.filter(k=>e.flags[k]);
      const col=RC[e.rank]||'#888';
      const ini=e.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
      const escName = e.name.replace(/'/g, "\\'");
      return `<div class="warn-row">
        <div class="avatar" style="background:${col}20;color:${col};border:1px solid ${col}40;">${ini}</div>
        <div style="flex:1"><div class="warn-name"><button class="member-jump" type="button" data-action="openMemberMe" data-args="${lwArgs(e.name)}">${e.name}</button></div>
        <div class="tags">${wf.map(k=>`<span class="tag r">${LBL[k]||k}</span>`).join('')}</div></div>
      </div>`;
    }).join('');

  const sc=entries.map(e=>{
    const pos=Object.keys(e.flags).filter(k=>e.flags[k]&&!DANGER.has(k)).length;
    const neg=Object.keys(e.flags).filter(k=>e.flags[k]&&DANGER.has(k)).length;
    return{...e,score:pos-neg*2};
  }).sort((a,b)=>b.score-a.score);
  document.getElementById('top-list').innerHTML=sc.length===0
    ?'<div class="empty" style="padding:0.5rem 0;">'+escHtml(tr('Noch keine Einträge.'))+'</div>'
    :sc.slice(0,8).map((e,i)=>{
      const br=isFixed(e.name)?fixedRank(e.name):(PREV[e.name]||3);
      const escName = e.name.replace(/'/g, "\\'");
      return `<div class="top-row">
      <div class="top-pos ${i===0?'p1':i===1?'p2':i===2?'p3':''}">${i+1}</div>
      <div class="top-name"><button class="member-jump" type="button" data-action="openMemberMe" data-args="${lwArgs(e.name)}">${e.name}</button></div>
      <div class="rank-badge ${rbClass(br)}">${br} · ${RL[br]}</div>
    </div>`;}).join('');

  const dist={1:0,2:0,3:0,4:0,5:0};
  weekMembers().forEach(name=>{
    const r=isFixed(name)?fixedRank(name):(PREV[name]||3);
    dist[r]=(dist[r]||0)+1;
  });
  const maxD=Math.max(...Object.values(dist),1);
  document.getElementById('rdist').innerHTML=[1,2,3,4,5].map(r=>{
    const cnt=dist[r]||0, h=Math.round(cnt/maxD*60);
    return `<div class="rdist-col">
      <div class="rdist-n">${cnt}</div>
      <div class="rdist-bar" style="height:${h}px;background:${RC[r]};opacity:0.85;"></div>
      <div class="rdist-l">R${r}</div>
    </div>`;
  }).join('');

  const freq={};
  entries.forEach(e=>Object.keys(e.flags).forEach(k=>{if(e.flags[k])freq[k]=(freq[k]||0)+1;}));
  const srt=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const mxF=srt.length?srt[0][1]:1;
  document.getElementById('field-bars').innerHTML=srt.length===0
    ?`<div class="empty" style="padding:0.5rem 0;">${escHtml(tr('Noch keine Daten.'))}</div>`
    :srt.map(([k,v])=>`<div class="bar-row">
      <div class="bar-lbl">${LBL[k]||k}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(v/mxF*100)}%;background:${DANGER.has(k)?'#e05545':AMBER.has(k)?'#f0a500':'#4a9eff'};"></div></div>
      <div class="bar-n">${v}</div>
    </div>`).join('');

  renderTable();
}

// ── RANKING TABLE ──
function renderTable(){
  document.querySelectorAll('.flt[data-f]').forEach(b=>b.classList.toggle('on',b.dataset.f===activeFilter));
  const rows=weekMembers().map(name=>{
    const e=entries.find(x=>x.name===name);
    const baseRank=isFixed(name)?fixedRank(name):(PREV[name]||3);
    const newRank=e?e.rank:baseRank;
    const hasEntry=!!e, hasWarn=e?[...DANGER].some(k=>e.flags[k]):false;
    const tend=hasEntry&&!isFixed(name)?newRank-baseRank:0;
    return{name,rank:baseRank,hasEntry,hasWarn,tend,flags:e?e.flags:{}};
  }).filter(r=>{
    if(activeFilter==='warn') return r.hasWarn;
    if(activeFilter==='up') return r.tend<0;
    if(activeFilter==='down') return r.tend>0;
    if(activeFilter==='missing') return !r.hasEntry;
    return true;
  });

  const tbody=document.getElementById('rankingBody');
  if(!rows.length){tbody.innerHTML='<tr><td colspan="6" style="color:var(--softer);text-align:center;padding:1.5rem;">Noch keine Einträge.</td></tr>';return;}

  let pos=0;
  tbody.innerHTML=rows.map(r=>{
    if(r.hasEntry) pos++;
    const rb=`<span class="rank-badge ${rbClass(r.rank)}">${r.rank} · ${RL[r.rank]}</span>`;
    const th=isFixed(r.name)?'<span class="t-eq">—</span>':r.tend<0?`<span class="t-up">↑ ${Math.abs(r.tend)}</span>`:r.tend>0?`<span class="t-dn">↓ ${r.tend}</span>`:'<span class="t-eq">=</span>';
    const af=Object.keys(r.flags).filter(k=>r.flags[k]);
    const fh=af.length
      ?af.slice(0,3).map(k=>`<span class="tag ${DANGER.has(k)?'r':AMBER.has(k)?'a':'b'}">${LBL[k]||k}</span>`).join('')+(af.length>3?`<span class="tag" style="color:var(--softer);border-color:var(--softer);">+${af.length-3}</span>`:'')
      :'<span style="color:var(--softer);font-size:12px;">—</span>';
    const sh=!r.hasEntry
      ?`<span class="sdot sd-mis"></span><span style="color:var(--softer);font-size:12px;">Ausstehend</span>`
      :r.hasWarn
      ?`<span class="sdot sd-warn"></span><span style="color:var(--red);font-size:12px;">Warnung</span>`
      :`<span class="sdot sd-ok"></span><span style="color:var(--green);font-size:12px;">OK</span>`;
    const escName = r.name.replace(/'/g, "\\'");
    return `<tr class="${r.hasEntry?'':'dim'}${formerCls(r.name)}">
      <td style="font-family:'Rajdhani',sans-serif;font-weight:700;color:var(--softer);">${r.hasEntry?pos:'·'}</td>
      <td style="font-weight:500;"><button class="member-jump" type="button" data-action="openMemberMe" data-args="${lwArgs(r.name)}">${r.name}</button>${formerTag(r.name)}${isFixed(r.name)?` <span style="font-size:10px;color:var(--gold);">${R5.has(r.name)?'R5':'R4'}</span>`:''}</td>
      <td>${rb}</td><td class="points-rank">${th}</td><td><div style="display:flex;gap:4px;flex-wrap:wrap;">${fh}</div></td><td>${sh}</td>
    </tr>`;
  }).join('');
}

function initFilterBars() {
  const filterBar = document.getElementById('filterBar');
  if (filterBar && !filterBar._listenerAttached) {
    filterBar._listenerAttached = true;
    filterBar.addEventListener('click', function(e) {
      const btn = e.target.closest('.flt[data-f]');
      if (!btn) return;
      activeFilter = btn.dataset.f;
      renderTable();
    });
  }
}
