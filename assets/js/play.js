// PSI — pipe commissioning. Route every medium to its own consumer.
// Mechanics unlock per line: check valves, gate valves + move budget, multiple media,
// leak test (no open ends), pressure drop, hydraulic oil.
const N=1,E=2,S=4,W=8;
const STEPS=[[N,0,-1,S],[E,1,0,W],[S,0,1,N],[W,-1,0,E]]; // [bit, dx, dy, opposite bit]
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

// line configs; the last one repeats with a tightening budget
const LEVELS=[
  {size:[5,4],media:['O3']},
  {size:[6,4],media:['O2']},
  {size:[6,5],media:['N2'],check:1,brief:'<b>New: check valves.</b> Flow only passes in the direction of the arrow. Turn them the right way round.'},
  {size:[6,5],media:['H2O'],check:2,gate:1,budget:8,brief:'<b>New: gate valves and a move budget.</b> Gate valves are fixed and start closed: tap to open. Every tap counts.'},
  {size:[7,5],media:['O2','N2'],check:2,gate:1,budget:8,brief:'<b>New: two media.</b> Oxygen and nitrogen each go to their own consumer. If they touch, the line is rejected.'},
  {size:[7,6],media:['O2','N2'],check:2,gate:2,budget:7,leak:true,brief:'<b>New: leak test.</b> Every pipe that carries flow must be closed off. No open ends, no dead T-branches.'},
  {size:[8,6],media:['O2','N2'],check:3,gate:2,budget:6,leak:true,pressure:true,brief:'<b>New: pressure drop.</b> Every elbow and valve costs pressure. Consumers need a minimum pressure, so take the short route.'},
  {size:[8,6],media:['O2','N2','HYD'],check:3,gate:2,budget:6,leak:true,pressure:true,brief:'<b>New: hydraulic oil at 210 bar.</b> Three media, one rack. Welcome to the big leagues.'},
  {size:[8,7],media:['O2','N2','HYD'],check:4,gate:3,budget:5,leak:true,pressure:true},
];
const RANKS=[[1,'Junior Engineer'],[3,'Engineer'],[6,'Senior Engineer'],[9,'Lead Engineer']];
const rankFor=lvl=>RANKS.filter(r=>lvl+1>=r[0]).pop()[1];

const $=id=>document.getElementById(id);
const rig=$('rig'),board=$('board'),done=$('done');
const rand=n=>Math.floor(Math.random()*n);
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=rand(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
const cfgFor=l=>{const c=LEVELS[Math.min(l,LEVELS.length-1)];return l<LEVELS.length?c:{...c,budget:Math.max(2,c.budget-(l-LEVELS.length+1)),brief:null}};

let level=Math.max(0,+(store.get('psi-level')||0)|0);
let cfg,cols,rows,grid,media,snapshot,moves,budget,t0,timer,over,cheated=false;

/* ---------- level generation ---------- */
function carve(used,startRow,minLen,maxLen){
  const seen=new Set(used),path=[];
  const dfs=(x,y)=>{
    path.push([x,y]);seen.add(x+','+y);
    if(x===cols-1&&path.length>=minLen) return true;
    if(path.length<maxLen){
      const dirs=shuffle([[0,-1],[0,1],[-1,0]]);
      dirs.splice(Math.random()<.55?0:rand(3),0,[1,0]); // lean east
      for(const [dx,dy] of dirs){
        const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=cols||ny>=rows||seen.has(nx+','+ny)) continue;
        if(dfs(nx,ny)) return true;
      }
    }
    path.pop();return false;
  };
  return seen.has('0,'+startRow)?null:(dfs(0,startRow)?path:null);
}
const bitTo=(a,b)=>STEPS.find(s=>a[0]+s[1]===b[0]&&a[1]+s[2]===b[1])[0];
const solveR=(type,want)=>{let r=0;while(rotMask(SHAPES[type].mask,r)!==want) r++;return r};

function build(){
  cfg=cfgFor(level);[cols,rows]=cfg.size;
  const k=cfg.media.length;
  let paths;
  for(let attempt=0;attempt<400&&!paths;attempt++){
    const srcRows=shuffle([...Array(rows).keys()]).slice(0,k).sort((a,b)=>a-b);
    const used=new Set(),out=[];
    for(const r of srcRows){
      const p=carve(used,r,k>1?cols:cols+Math.floor(rows/2),k>1?cols+rows:cols*2+rows);
      if(!p) break;
      p.forEach(([x,y])=>used.add(x+','+y));out.push(p);
    }
    if(out.length===k) paths=out;
  }
  media=shuffle(cfg.media.slice()).map((id,i)=>{
    const p=paths[i],m=MEDIA[id];
    return {...m,id,path:p,srcRow:p[0][1],sinkRow:p[p.length-1][1],scale:m.p/12};
  });
  grid=Array.from({length:rows},()=>Array(cols).fill(null));
  let minMoves=0;
  media.forEach(md=>{
    let cost=0;
    md.path.forEach((p,i)=>{
      const a=i===0?W:bitTo(p,md.path[i-1]);
      const b=i===md.path.length-1?E:bitTo(p,md.path[i+1]);
      const want=a|b,straight=want===(N|S)||want===(E|W);
      grid[p[1]][p[0]]={type:straight?'straight':'elbow',sol:solveR(straight?'straight':'elbow',want),inlet:a,medium:md.id};
    });
    // promote some straight runs to valves
    const straights=shuffle(md.path.filter(([x,y])=>grid[y][x].type==='straight'));
    const nCheck=Math.ceil((cfg.check||0)/media.length),nGate=Math.ceil((cfg.gate||0)/media.length);
    straights.slice(0,nCheck).forEach(([x,y])=>{const t=grid[y][x];t.type='check';let r=0;while(rotMask(N,r)!==t.inlet) r++;t.sol=r});
    straights.slice(nCheck,nCheck+nGate).forEach(([x,y])=>{const t=grid[y][x];t.type='gate';t.fixed=true;t.open=false});
    // scramble and count the minimum moves
    md.path.forEach(([x,y])=>{
      const t=grid[y][x];
      if(t.type==='gate'){t.r=t.sol;minMoves++}
      else{
        t.r=t.sol+1+rand(3);
        const need=((t.sol-t.r)%4+4)%4;
        minMoves+=t.type==='straight'?Math.min(need,((t.sol+2-t.r)%4+4)%4):need;
      }
      cost+=SHAPES[t.type].cost;
    });
    md.req=cfg.pressure?Math.floor((md.p-cost*md.scale-.5*md.scale)*10)/10:null;
  });
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    if(grid[y][x]) continue;
    const q=Math.random();
    const type=cfg.check&&q<.1?'check':q<.45?'elbow':q<.8?'straight':'tee';
    grid[y][x]={type,r:rand(4)};
  }
  budget=cfg.budget!=null?minMoves+cfg.budget:Infinity;
  snapshot=grid.map(row=>row.map(t=>({r:t.r,open:t.open})));
  start();
  if(evaluate().solved) build(); // never hand out a solved board
}
function start(){
  moves=0;over=false;cheated=false;clearInterval(timer);timer=null;t0=0;
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
function stub(parent,row,md,label){
  const s=document.createElement('div');s.className='stub';
  s.style.setProperty('--row',row);s.style.setProperty('--c',md.c);
  const l=document.createElement('span');l.className='mono';l.textContent=label;s.append(l);
  parent.append(s);return s;
}
function render(){
  rig.style.setProperty('--cols',cols);rig.style.setProperty('--rows',rows);
  rig.classList.remove('won');done.hidden=true;done.classList.remove('fail');
  $('lvl').textContent=String(level+1).padStart(2,'0');
  $('moves').textContent=budget===Infinity?'0':`0 / ${budget}`;$('moves').classList.remove('low');
  $('time').textContent='0.0';
  const best=store.get('psi-best-'+level);$('best').textContent=best?best+'s':'—';
  const rank=$('rank'),newRank=rankFor(level);
  if(rank.textContent!==newRank&&level>0){rank.classList.remove('promo');void rank.offsetWidth;rank.classList.add('promo')}
  rank.textContent=newRank;
  const brief=$('brief');
  if(cfg.brief){brief.replaceChildren();const tpl=document.createElement('template');tpl.innerHTML=cfg.brief;brief.append(tpl.content);brief.hidden=false}else brief.hidden=true;
  $('portIn').replaceChildren();$('portOut').replaceChildren();
  media.forEach(md=>{
    stub($('portIn'),md.srcRow,md,md.f+(md.id==='HYD'?' 210 bar':''));
    md.sinkEl=stub($('portOut'),md.sinkRow,md,md.sink);
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
  const sinkOf=row=>media.findIndex(m=>m.sinkRow===row);
  const results=media.map((md,mi)=>{
    const out={reached:false,pressure:null,wrong:false};
    const q=[[0,md.srcRow,W,md.p]],seen=new Set();
    while(q.length){
      const [x,y,e,p]=q.shift(),key=x+','+y,t=grid[y][x],m=maskOf(t);
      if(!(m&e)) continue;
      if(owner.has(key)&&owner.get(key)!==mi){mix.add(key);continue}
      if(seen.has(key)) continue;
      seen.add(key);owner.set(key,mi);
      if(t.type==='gate'&&!t.open){blocked.add(key);continue}
      if(t.type==='check'&&e!==rotMask(N,t.r)){blocked.add(key);continue}
      const pp=p-SHAPES[t.type].cost*md.scale;
      const exits=m&~e;
      for(const [bit,dx,dy,opp] of STEPS){
        if(!(exits&bit)) continue;
        const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=cols||ny>=rows){
          const si=bit===E&&nx===cols?sinkOf(ny):-1;
          if(si===mi){out.reached=true;out.pressure=Math.max(out.pressure??-1e9,pp)}
          else if(si>=0){mix.add(key);out.wrong=true}
          else leaks.add(key);
          continue;
        }
        if(!(maskOf(grid[ny][nx])&opp)){leaks.add(key);continue}
        q.push([nx,ny,opp,pp]);
      }
    }
    out.pOk=!cfg.pressure||(out.reached&&out.pressure>=md.req);
    return out;
  });
  const solved=results.every(r=>r.reached&&!r.wrong&&r.pOk)&&!mix.size&&(!cfg.leak||!leaks.size);
  return {owner,leaks,mix,blocked,results,solved};
}
function paint(){
  const ev=evaluate();
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    const key=x+','+y,t=grid[y][x],b=t.btn,o=ev.owner.get(key);
    b.classList.toggle('on',o!==undefined);
    if(o!==undefined) b.style.setProperty('--flow',media[o].c);
    b.classList.toggle('mix',ev.mix.has(key));
    b.classList.toggle('leak',!!cfg.leak&&ev.leaks.has(key));
    b.classList.toggle('blocked',ev.blocked.has(key));
    b.classList.toggle('open',!!t.open);
  }
  const st=$('status');st.replaceChildren();
  media.forEach((md,i)=>{
    const r=ev.results[i],s=document.createElement('span');
    s.style.setProperty('--c',md.c);
    const dot=document.createElement('i');s.append(dot);
    let txt=`${md.f} → ${md.sink} `;
    if(cfg.pressure) txt+=r.reached?`${r.pressure.toFixed(1)} / ≥${md.req} bar`:`— / ≥${md.req} bar`;
    else txt+=r.reached?'✓':'…';
    s.append(txt);
    s.className=r.reached&&r.pOk&&!r.wrong?'ok':(r.wrong||(r.reached&&!r.pOk))?'bad':'';
    md.sinkEl.classList.toggle('ok',r.reached&&!r.wrong);
    st.append(s);
  });
  if(ev.mix.size){const s=document.createElement('span');s.className='bad';s.textContent='⚠ Media mixing';st.append(s)}
  if(cfg.leak&&ev.leaks.size){const s=document.createElement('span');s.className='bad';s.textContent=`⚠ ${ev.leaks.size} leak${ev.leaks.size>1?'s':''}`;st.append(s)}
  return ev.solved;
}

/* ---------- play ---------- */
function tap(x,y){
  if(over) return;
  if(!timer){t0=performance.now();timer=setInterval(()=>{$('time').textContent=((performance.now()-t0)/1000).toFixed(1)},100)}
  const t=grid[y][x];
  if(t.type==='gate') t.open=!t.open;
  else {t.r++;t.svg.style.transform=`rotate(${t.r*90}deg)`}
  moves++;
  const mv=$('moves');
  mv.textContent=budget===Infinity?moves:`${moves} / ${budget}`;
  mv.classList.toggle('low',budget!==Infinity&&budget-moves<=2);
  if(paint()) return win();
  if(moves>=budget) fail();
}
function finish(){over=true;clearInterval(timer)}
function win(){
  finish();
  const secs=((performance.now()-t0)/1000).toFixed(1);
  const key='psi-best-'+level,best=store.get(key),record=!cheated&&(!best||+secs<+best);
  if(record) store.set(key,secs);
  store.set('psi-level',String(level+1));
  rig.classList.add('won');
  const next=rankFor(level+1),promo=next!==rankFor(level);
  $('doneTitle').textContent='✓ Commissioned';
  $('doneLine').textContent=`Line ${level+1} online in ${secs}s and ${moves} moves.${record?' New personal best.':''}${promo?` Promoted to ${next}!`:''}`;
  $('retry').hidden=true;$('next').hidden=false;
  done.hidden=false;$('next').focus({preventScroll:true});
}
function fail(){
  finish();
  done.classList.add('fail');
  $('doneTitle').textContent='✕ Too many moves';
  $('doneLine').textContent='Out of budget. Same line, fresh start.';
  $('retry').hidden=false;$('next').hidden=true;
  done.hidden=false;$('retry').focus({preventScroll:true});
}
$('next').addEventListener('click',()=>{level++;build()});
$('retry').addEventListener('click',retry);
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
    const ok=paint();
    if(ok&&!over) win();
    return ok;
  },
  jump(line){level=Math.max(0,(line|0)-1);build()},
};

build();
