// PSI — pipe commissioning. Route every medium to its own consumer.
// Mechanics unlock per line: ports on every edge, check valves, gate valves + move budget,
// multiple media, leak test, pressure drop, hydraulic oil, blind commissioning.
const N=1,E=2,S=4,W=8;
const DIRS=[N,E,S,W];
const OPP={[N]:S,[E]:W,[S]:N,[W]:E};
const STEP={[N]:[0,-1],[E]:[1,0],[S]:[0,1],[W]:[-1,0]};
const rotMask=(m,r)=>{r=((r%4)+4)%4;for(let i=0;i<r;i++)m=((m<<1)|(m>>3))&15;return m};

// base shapes point north; elbows have a real bend radius. cost = pressure drop in bar (at 12 bar scale)
const SHAPES={
  straight:{mask:N|S,d:'M50 0V100',cost:.2},
  elbow:{mask:N|E,d:'M50 0V28Q50 50 72 50H100',cost:.5},
  tee:{mask:N|E|S,d:'M50 0V100M50 50H100',cost:.4},
  check:{mask:N|S,d:'M50 0V100',cost:.6},  // flow enters at N, leaves at S
  gate:{mask:N|S,d:'M50 0V100',cost:.3},
};

const MEDIA={
  O3:{f:'O₃',name:'Ozone',c:'#b48cff',p:10,sink:'deNOx'},
  O2:{f:'O₂',name:'Oxygen',c:'#ff5a1f',p:12,sink:'deNOx'},
  N2:{f:'N₂',name:'Nitrogen',c:'#4d8dff',p:10,sink:'Purge'},
  H2O:{f:'H₂O',name:'Cooling water',c:'#8fd8ff',p:6,sink:'Cooler'},
  CA:{f:'CA',name:'Compressed air',c:'#c9cbbe',p:8,sink:'Actuators'},
  HYD:{f:'HYD',name:'Hydraulic oil',c:'#f2c14e',p:210,sink:'Cylinder'},
};

// bends = minimum 90° turns per line; slack = spare moves on top of the minimum (never punishing)
const THREE=['O2','N2','HYD'];
const LEVELS=[
  {size:[5,4],media:['O3'],bends:2},
  {size:[6,4],media:['O2'],bends:3,edges:true,brief:'<b>New: connections on every side.</b> Supplies and consumers can sit on any edge of the rack now.'},
  {size:[6,5],media:['N2'],bends:4,edges:true,check:1,brief:'<b>New: check valves.</b> Flow only passes in the direction of the arrow. Turn them the right way round.'},
  {size:[6,5],media:['H2O'],bends:5,edges:true,check:2,gate:1,slack:8,brief:'<b>New: gate valves and a move budget.</b> Gate valves are fixed in place and start closed: tap one to open it. There is room for a few misclicks, but not for guessing.'},
  {size:[7,5],media:['O2','N2'],bends:3,edges:true,check:2,gate:1,slack:8,brief:'<b>New: two media.</b> Oxygen and nitrogen each go to their own consumer. If they touch, the line is rejected.'},
  {size:[7,6],media:['O2','N2'],bends:4,edges:true,check:2,gate:2,slack:8,leak:true,brief:'<b>New: leak test.</b> Every pipe that carries flow must be closed off. No open ends, no dead-end T-branches.'},
  {size:[8,6],media:['O2','N2'],bends:5,edges:true,check:3,gate:2,slack:8,leak:true,pressure:true,brief:'<b>New: pressure drop.</b> Every elbow and valve costs pressure. Consumers need a minimum pressure, so no detours.'},
  {size:[8,6],media:THREE,bends:3,edges:true,check:3,gate:2,slack:9,leak:true,pressure:true,brief:'<b>New: hydraulic oil at 210 bar.</b> Three media, one rack. Welcome to the big leagues.'},
  {size:[8,7],media:THREE,bends:4,edges:true,check:4,gate:3,slack:8,leak:true,pressure:true},
  {size:[8,7],media:THREE,bends:5,edges:true,check:4,gate:3,slack:8,leak:true,pressure:true},
  {size:[8,7],media:THREE,bends:5,edges:true,check:4,gate:3,slack:8,leak:true,pressure:true,blind:3,brief:'<b>New: blind commissioning.</b> The flow is hidden. You get 3 pressure tests, so solve it in your head first.'},
  {size:[8,7],media:THREE,bends:6,edges:true,check:4,gate:3,slack:7,leak:true,pressure:true,blind:3},
];
const MAX_RUN=3,CANDIDATES=30;
const RANKS=[[1,'Junior Engineer'],[3,'Engineer'],[6,'Senior Engineer'],[9,'Lead Engineer']];
const rankFor=lvl=>RANKS.filter(r=>lvl+1>=r[0]).pop()[1];
const cfgFor=l=>{const c=LEVELS[Math.min(l,LEVELS.length-1)];return l<LEVELS.length?c:{...c,brief:null}};

const $=id=>document.getElementById(id);
const rig=$('rig'),board=$('board'),done=$('done');
const rand=n=>Math.floor(Math.random()*n);
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=rand(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};

let level=Math.max(0,+(store.get('psi-level')||0)|0);
let cfg,cols,rows,grid,media,snapshot,moves,budget,t0,timer,over,cheated=false,tests=0,testing=false;

/* ---------- level generation ---------- */
function edgePorts(sides){
  const out=[];
  for(const side of sides){
    if(side===W||side===E) for(let y=0;y<rows;y++) out.push({x:side===W?0:cols-1,y,side});
    else for(let x=0;x<cols;x++) out.push({x,y:side===N?0:rows-1,side});
  }
  return out;
}
// randomised backtracking search from a supply port to a consumer port,
// with a minimum number of bends and no long straight runs
function carve(src,dst,blocked,minBends,maxLen){
  const inUse=new Set(blocked),path=[],dstKey=dst.x+','+dst.y;
  let steps=0;
  const dfs=(x,y,entry,bends,run)=>{
    if(++steps>2500) return false;
    const key=x+','+y;
    path.push({x,y,entry});inUse.add(key);
    if(key===dstKey){
      const straight=dst.side===OPP[entry];
      if(bends+(straight?0:1)>=minBends&&(straight?run+1:0)<=MAX_RUN){path[path.length-1].exit=dst.side;return true}
    } else if(path.length<maxLen){
      for(const d of shuffle(DIRS.slice())){
        if(d===entry) continue;
        const [dx,dy]=STEP[d],nx=x+dx,ny=y+dy,nk=nx+','+ny;
        if(nx<0||ny<0||nx>=cols||ny>=rows||inUse.has(nk)) continue;
        const bend=d!==OPP[entry],nr=bend?0:run+1;
        if(nr>MAX_RUN) continue;
        path[path.length-1].exit=d;
        if(dfs(nx,ny,OPP[d],bends+(bend?1:0),nr)) return true;
      }
    }
    path.pop();inUse.delete(key);return false;
  };
  return dfs(src.x,src.y,src.side,0,0)?path:null;
}
function pickPorts(k){
  const srcs=shuffle(edgePorts(cfg.edges?[W,N,S]:[W])),dsts=shuffle(edgePorts(cfg.edges?[E,N,S]:[E]));
  const taken=new Set(),pairs=[],minDist=Math.max(3,Math.floor((cols+rows)/2));
  for(let i=0;i<k;i++){
    const s=srcs.find(p=>!taken.has(p.x+','+p.y));if(!s) return null;
    taken.add(s.x+','+s.y);
    const d=dsts.find(p=>!taken.has(p.x+','+p.y)&&Math.abs(p.x-s.x)+Math.abs(p.y-s.y)>=minDist);if(!d) return null;
    taken.add(d.x+','+d.y);pairs.push([s,d]);
  }
  return pairs;
}
const solveR=(type,want)=>{let r=0;while(rotMask(SHAPES[type].mask,r)!==want) r++;return r};

function makeCandidate(minBends){
  const k=cfg.media.length,pairs=pickPorts(k);if(!pairs) return null;
  const portCells=new Set(pairs.flatMap(([s,d])=>[s.x+','+s.y,d.x+','+d.y]));
  const used=new Set(),paths=[];
  for(const [s,d] of pairs){
    const blocked=new Set([...used,...[...portCells].filter(c=>c!==s.x+','+s.y&&c!==d.x+','+d.y)]);
    const p=carve(s,d,blocked,minBends,Math.floor(cols*rows/k)+2);
    if(!p) return null;
    p.forEach(c=>used.add(c.x+','+c.y));paths.push(p);
  }
  const g=Array.from({length:rows},()=>Array(cols).fill(null));
  const md=shuffle(cfg.media.slice()).map((id,i)=>{const m=MEDIA[id];return {...m,id,path:paths[i],src:pairs[i][0],dst:pairs[i][1],scale:m.p/12}});
  let minMoves=0,bends=0;
  md.forEach(m=>{
    let cost=0;
    m.path.forEach(c=>{
      const want=c.entry|c.exit,straight=want===(N|S)||want===(E|W);
      if(!straight) bends++;
      g[c.y][c.x]={type:straight?'straight':'elbow',sol:solveR(straight?'straight':'elbow',want),inlet:c.entry,medium:m.id};
    });
    const straights=shuffle(m.path.filter(c=>g[c.y][c.x].type==='straight'));
    const nCheck=Math.ceil((cfg.check||0)/md.length),nGate=Math.ceil((cfg.gate||0)/md.length);
    straights.slice(0,nCheck).forEach(c=>{const t=g[c.y][c.x];t.type='check';let r=0;while(rotMask(N,r)!==t.inlet) r++;t.sol=r});
    straights.slice(nCheck,nCheck+nGate).forEach(c=>{const t=g[c.y][c.x];t.type='gate';t.fixed=true;t.open=false});
    m.path.forEach(c=>{
      const t=g[c.y][c.x];
      if(t.type==='gate'){t.r=t.sol;minMoves++}
      else{
        t.r=t.sol+1+rand(3);
        const need=((t.sol-t.r)%4+4)%4;
        minMoves+=t.type==='straight'?Math.min(need,((t.sol+2-t.r)%4+4)%4):need;
      }
      cost+=SHAPES[t.type].cost;
    });
    m.req=cfg.pressure?Math.floor((m.p-cost*m.scale-.5*m.scale)*10)/10:null;
  });
  // how tangled are the media: neighbouring cells that belong to different lines
  let tangle=0;
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    const a=g[y][x];if(!a) continue;
    if(x+1<cols&&g[y][x+1]&&g[y][x+1].medium!==a.medium) tangle++;
    if(y+1<rows&&g[y+1][x]&&g[y+1][x].medium!==a.medium) tangle++;
  }
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    if(g[y][x]) continue;
    const q=Math.random();
    g[y][x]={type:cfg.check&&q<.1?'check':q<.5?'elbow':q<.78?'tee':'straight',r:rand(4)};
  }
  return {grid:g,media:md,minMoves,score:bends*3+minMoves+tangle*2};
}

function build(){
  cfg=cfgFor(level);[cols,rows]=cfg.size;
  let best=null;
  // best of N: generate candidates and keep the hardest; relax the bend rule only if nothing fits
  for(let minBends=cfg.bends;minBends>=0&&!best;minBends--){
    let found=0;
    for(let attempt=0,want=Math.min(CANDIDATES,4+level*6);attempt<220&&found<want;attempt++){
      const c=makeCandidate(minBends);if(!c) continue;
      found++;if(!best||c.score>best.score) best=c;
    }
  }
  grid=best.grid;media=best.media;
  budget=cfg.slack?best.minMoves+Math.max(cfg.slack,Math.ceil(best.minMoves*.2)):Infinity;
  snapshot=grid.map(row=>row.map(t=>({r:t.r,open:t.open})));
  start();
  if(evaluate().solved) build(); // never hand out a solved board
}
function start(){
  moves=0;over=false;cheated=false;testing=false;tests=cfg.blind||0;
  clearInterval(timer);timer=null;t0=0;
  render();
}
function retry(){
  grid.forEach((row,y)=>row.forEach((t,x)=>{t.r=snapshot[y][x].r;t.open=snapshot[y][x].open}));
  start();
}

/* ---------- rendering ---------- */
const NS='http://www.w3.org/2000/svg';
const el=(tag,attrs)=>{const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);return e};
function tileSvg(t){
  const svg=el('svg',{viewBox:'0 0 100 100','aria-hidden':'true'});
  const s=SHAPES[t.type],d=s.d;
  svg.append(el('path',{class:'wall',d}),el('path',{class:'body',d}),el('path',{class:'flow',d}));
  if(s.mask&N) svg.append(el('rect',{class:'flange',x:33,y:0,width:34,height:5,rx:1}));
  if(s.mask&E) svg.append(el('rect',{class:'flange',x:95,y:33,width:5,height:34,rx:1}));
  if(s.mask&S) svg.append(el('rect',{class:'flange',x:33,y:95,width:34,height:5,rx:1}));
  if(t.type==='check') svg.append(el('path',{class:'sym',d:'M32 36H68L50 60Z'}),el('path',{class:'sym',d:'M32 64H68'}));
  if(t.type==='gate') svg.append(el('path',{class:'stem',d:'M50 50H80'}),el('circle',{class:'wheel',cx:84,cy:50,r:9}),el('path',{class:'gate-sym',d:'M32 30H68L50 50ZM32 70H68L50 50Z'}));
  return svg;
}
const PORT_EL={[N]:'portN',[E]:'portE',[S]:'portS',[W]:'portW'};
function stub(port,md,label,kind){
  const s=document.createElement('div');s.className='stub '+kind;
  s.style.setProperty('--row',port.y);s.style.setProperty('--col',port.x);s.style.setProperty('--c',md.c);
  const l=document.createElement('span');l.className='mono';l.textContent=label;s.append(l);
  $(PORT_EL[port.side]).append(s);return s;
}
function render(){
  rig.style.setProperty('--cols',cols);rig.style.setProperty('--rows',rows);
  rig.classList.remove('won','testing');rig.classList.toggle('blind',!!cfg.blind);
  done.hidden=true;done.classList.remove('fail');
  $('lvl').textContent=String(level+1).padStart(2,'0');
  $('moves').textContent=budget===Infinity?'0':`0 / ${budget}`;$('moves').classList.remove('low');
  $('time').textContent='0.0';
  const best=store.get('psi-best-'+level);$('best').textContent=best?best+'s':'—';
  const test=$('test');test.hidden=!cfg.blind;test.disabled=false;$('tests').textContent=tests;
  const rank=$('rank'),newRank=rankFor(level);
  if(rank.textContent!==newRank&&level>0){rank.classList.remove('promo');void rank.offsetWidth;rank.classList.add('promo')}
  rank.textContent=newRank;
  const brief=$('brief');
  if(cfg.brief){brief.replaceChildren();const tpl=document.createElement('template');tpl.innerHTML=cfg.brief;brief.append(tpl.content);brief.hidden=false}else brief.hidden=true;
  Object.values(PORT_EL).forEach(id=>$(id).replaceChildren());
  media.forEach(md=>{
    stub(md.src,md,md.f+(md.id==='HYD'?' 210 bar':''),'src');
    md.sinkEl=stub(md.dst,md,md.sink,'snk');
  });
  board.replaceChildren();
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    const t=grid[y][x];
    const b=document.createElement('button');
    b.className='cell'+(t.fixed?' fixed':'');b.type='button';
    b.setAttribute('aria-label',`${t.type==='check'?'check valve':t.type==='gate'?'gate valve':t.type+' pipe'}, row ${y+1}, column ${x+1}`);
    const svg=tileSvg(t);svg.style.transform=`rotate(${t.r*90}deg)`;
    b.append(svg);b.addEventListener('click',()=>tap(x,y));
    t.btn=b;t.svg=svg;board.append(b);
  }
  paint();
}

/* ---------- flow, leaks, mixing, pressure ---------- */
const maskOf=t=>rotMask(SHAPES[t.type].mask,t.r);
function evaluate(){
  const owner=new Map(),leaks=new Set(),mix=new Set(),blocked=new Set();
  const sinkIdx=(x,y,side)=>media.findIndex(m=>m.dst.x===x&&m.dst.y===y&&m.dst.side===side);
  const results=media.map((md,mi)=>{
    const out={reached:false,pressure:null,wrong:false};
    const q=[[md.src.x,md.src.y,md.src.side,md.p]],seen=new Set();
    while(q.length){
      const [x,y,e,p]=q.shift(),key=x+','+y,t=grid[y][x],m=maskOf(t);
      if(!(m&e)) continue;
      if(owner.has(key)&&owner.get(key)!==mi){mix.add(key);continue}
      if(seen.has(key)) continue;
      seen.add(key);owner.set(key,mi);
      if(t.type==='gate'&&!t.open){blocked.add(key);continue}
      if(t.type==='check'&&e!==rotMask(N,t.r)){blocked.add(key);continue}
      const pp=p-SHAPES[t.type].cost*md.scale;
      for(const d of DIRS){
        if(!(m&d)||d===e) continue;
        const [dx,dy]=STEP[d],nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=cols||ny>=rows){
          const si=sinkIdx(x,y,d);
          if(si===mi){out.reached=true;out.pressure=Math.max(out.pressure??-1e9,pp)}
          else if(si>=0){mix.add(key);out.wrong=true}
          else leaks.add(key);
          continue;
        }
        if(!(maskOf(grid[ny][nx])&OPP[d])){leaks.add(key);continue}
        q.push([nx,ny,OPP[d],pp]);
      }
    }
    out.pOk=!cfg.pressure||(out.reached&&out.pressure>=md.req);
    return out;
  });
  const solved=results.every(r=>r.reached&&!r.wrong&&r.pOk)&&!mix.size&&(!cfg.leak||!leaks.size);
  return {owner,leaks,mix,blocked,results,solved};
}
function paint(){
  const ev=evaluate(),hide=cfg.blind&&!testing&&!over;
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    const key=x+','+y,t=grid[y][x],b=t.btn,o=ev.owner.get(key);
    b.classList.toggle('on',!hide&&o!==undefined);
    if(o!==undefined) b.style.setProperty('--flow',media[o].c);
    b.classList.toggle('mix',!hide&&ev.mix.has(key));
    b.classList.toggle('leak',!hide&&!!cfg.leak&&ev.leaks.has(key));
    b.classList.toggle('blocked',!hide&&ev.blocked.has(key));
    b.classList.toggle('open',!!t.open);
  }
  const st=$('status');st.replaceChildren();
  media.forEach((md,i)=>{
    const r=ev.results[i],s=document.createElement('span');
    s.style.setProperty('--c',md.c);
    s.append(document.createElement('i'));
    let txt=`${md.f} → ${md.sink} `;
    if(hide) txt+=cfg.pressure?`≥${md.req} bar`:'';
    else if(cfg.pressure) txt+=r.reached?`${r.pressure.toFixed(1)} / ≥${md.req} bar`:`— / ≥${md.req} bar`;
    else txt+=r.reached?'✓':'…';
    s.append(txt);
    s.className=hide?'':r.reached&&r.pOk&&!r.wrong?'ok':(r.wrong||(r.reached&&!r.pOk))?'bad':'';
    md.sinkEl.classList.toggle('ok',!hide&&r.reached&&!r.wrong);
    st.append(s);
  });
  if(hide){const s=document.createElement('span');s.textContent='Flow hidden · run a pressure test';st.append(s)}
  else{
    if(ev.mix.size){const s=document.createElement('span');s.className='bad';s.textContent='⚠ Media mixing';st.append(s)}
    if(cfg.leak&&ev.leaks.size){const s=document.createElement('span');s.className='bad';s.textContent=`⚠ ${ev.leaks.size} leak${ev.leaks.size>1?'s':''}`;st.append(s)}
  }
  return ev.solved;
}

/* ---------- play ---------- */
function startTimer(){if(!timer){t0=performance.now();timer=setInterval(()=>{$('time').textContent=((performance.now()-t0)/1000).toFixed(1)},100)}}
function tap(x,y){
  if(over) return;
  startTimer();
  const t=grid[y][x];
  if(t.type==='gate') t.open=!t.open;
  else {t.r++;t.svg.style.transform=`rotate(${t.r*90}deg)`}
  moves++;
  const mv=$('moves');
  mv.textContent=budget===Infinity?moves:`${moves} / ${budget}`;
  mv.classList.toggle('low',budget!==Infinity&&budget-moves<=2);
  const solved=paint();
  if(solved&&!cfg.blind) return win();
  if(moves>=budget&&!solved) fail('✕ Too many moves','Out of budget. Same line, fresh start.');
}
// blind mode: reveal the flow for a moment; a solved rack commissions on the spot
function pressureTest(){
  if(over||testing||tests<=0) return;
  startTimer();
  tests--;$('tests').textContent=tests;
  testing=true;rig.classList.add('testing');
  if(paint()) return win();
  $('test').disabled=true;
  setTimeout(()=>{
    testing=false;rig.classList.remove('testing');
    if(over) return;
    paint();$('test').disabled=tests<=0;
    if(tests<=0) fail('✕ Pressure test failed','No tests left. Same line, fresh start.');
  },2200);
}
function finish(){over=true;clearInterval(timer)}
function win(){
  finish();paint();
  const secs=((performance.now()-t0)/1000).toFixed(1);
  const key='psi-best-'+level,best=store.get(key),record=!cheated&&(!best||+secs<+best);
  if(record) store.set(key,secs);
  store.set('psi-level',String(level+1));
  rig.classList.add('won');rig.classList.remove('blind');
  const next=rankFor(level+1),promo=next!==rankFor(level);
  $('doneTitle').textContent='✓ Commissioned';
  $('doneLine').textContent=`Line ${level+1} online in ${secs}s and ${moves} ${moves===1?'move':'moves'}.${record?' New personal best.':''}${promo?` Promoted to ${next}!`:''}`;
  $('retry').hidden=true;$('next').hidden=false;
  done.hidden=false;$('next').focus({preventScroll:true});
}
function fail(title,line){
  finish();rig.classList.remove('blind');paint();
  done.classList.add('fail');
  $('doneTitle').textContent=title;$('doneLine').textContent=line;
  $('retry').hidden=false;$('next').hidden=true;
  done.hidden=false;$('retry').focus({preventScroll:true});
}
$('next').addEventListener('click',()=>{level++;build()});
$('retry').addEventListener('click',retry);
$('test').addEventListener('click',pressureTest);
$('restart').addEventListener('click',()=>{level=0;store.set('psi-level','0');build()});

// dev hook (#dev): apply the generated solution, to prove every line is solvable
if(location.hash==='#dev') window.psiDev={
  solve(){
    grid.forEach(row=>row.forEach(t=>{
      if(t.sol===undefined) return;
      if(t.type==='gate') t.open=true;
      else {t.r+=((t.sol-t.r)%4+4)%4;t.svg.style.transform=`rotate(${t.r*90}deg)`}
    }));
    cheated=true;if(!t0) t0=performance.now();
    const ok=evaluate().solved;
    if(ok&&!over) win(); else paint();
    return ok;
  },
  jump(line){level=Math.max(0,(line|0)-1);build()},
  stats(){return {level:level+1,budget,media:media.map(m=>({id:m.id,bends:m.path.filter(c=>(c.entry|c.exit)!==(N|S)&&(c.entry|c.exit)!==(E|W)).length,len:m.path.length,src:m.src,dst:m.dst}))}},
};

build();
