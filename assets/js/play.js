// PSI — pipe commissioning. Rotate tiles until supply connects to the deNOx unit.
const N=1,E=2,S=4,W=8;
const STEPS=[[N,0,-1,S],[E,1,0,W],[S,0,1,N],[W,-1,0,E]]; // [bit, dx, dy, opposite bit]
const rotMask=(m,r)=>{r=((r%4)+4)%4;for(let i=0;i<r;i++)m=((m<<1)|(m>>3))&15;return m};

// base shapes, drawn pointing north (+ east); real elbows with a bend radius
const SHAPES={
  straight:{mask:N|S,d:'M50 0V100'},
  elbow:{mask:N|E,d:'M50 0V28Q50 50 72 50H100'},
  tee:{mask:N|E|S,d:'M50 0V100M50 50H100'},
};
const SIZES=[[5,4],[6,4],[6,5],[7,5],[7,6],[8,6]];
const MEDIA=[['O₃','Ozone'],['O₂','Oxygen'],['N₂','Nitrogen'],['H₂O','Cooling water'],['CA','Compressed air']];

const $=id=>document.getElementById(id);
const rig=$('rig'),board=$('board'),done=$('done');
const rand=n=>Math.floor(Math.random()*n);
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=rand(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const store={
  get(k){try{return localStorage.getItem(k)}catch{return null}},
  set(k,v){try{localStorage.setItem(k,v)}catch{}}
};

let level=0,cols,rows,grid,startRow,endRow,moves,t0,timer,won;

/* ---------- level generation ---------- */
function carvePath(){
  // randomised DFS from the west edge to the east edge, biased to wander
  for(let attempt=0;attempt<50;attempt++){
    const sr=rand(rows),seen=new Set(),path=[];
    const minLen=cols+Math.floor(rows/2);
    const dfs=(x,y)=>{
      path.push([x,y]);seen.add(x+','+y);
      if(x===cols-1&&path.length>=minLen) return true;
      const dirs=shuffle([[1,0],[0,-1],[0,1],[-1,0]]);
      for(const [dx,dy] of dirs){
        const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=cols||ny>=rows||seen.has(nx+','+ny)) continue;
        if(dfs(nx,ny)) return true;
      }
      path.pop();return false;
    };
    if(dfs(0,sr)) return path;
  }
  // fallback: straight line
  const r=rand(rows);return Array.from({length:cols},(_,x)=>[x,r]);
}
const bitTo=(a,b)=>STEPS.find(s=>a[0]+s[1]===b[0]&&a[1]+s[2]===b[1])[0];

function build(){
  [cols,rows]=SIZES[Math.min(level,SIZES.length-1)];
  const path=carvePath();
  startRow=path[0][1];endRow=path[path.length-1][1];
  grid=Array.from({length:rows},()=>Array(cols).fill(null));
  path.forEach((p,i)=>{
    const a=i===0?W:bitTo(p,path[i-1]);
    const b=i===path.length-1?E:bitTo(p,path[i+1]);
    const want=a|b;
    const type=(want===(N|S)||want===(E|W))?'straight':'elbow';
    let r=0;while(rotMask(SHAPES[type].mask,r)!==want) r++;
    grid[p[1]][p[0]]={type,r:r+1+rand(3)}; // scrambled away from the solution
  });
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    if(grid[y][x]) continue;
    const q=Math.random();
    grid[y][x]={type:q<.4?'elbow':q<.8?'straight':'tee',r:rand(4)};
  }
  moves=0;won=false;clearInterval(timer);timer=null;t0=0;
  render();
  if(connected().solved) build(); // never hand out a solved board
}

/* ---------- rendering ---------- */
const NS='http://www.w3.org/2000/svg';
const el=(tag,attrs)=>{const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);return e};
function tileSvg(type){
  const svg=el('svg',{viewBox:'0 0 100 100','aria-hidden':'true'});
  const d=SHAPES[type].d;
  svg.append(el('path',{class:'wall',d}),el('path',{class:'body',d}),el('path',{class:'flow',d}));
  const m=SHAPES[type].mask;
  if(m&N) svg.append(el('rect',{class:'flange',x:33,y:0,width:34,height:5,rx:1}));
  if(m&E) svg.append(el('rect',{class:'flange',x:95,y:33,width:5,height:34,rx:1}));
  if(m&S) svg.append(el('rect',{class:'flange',x:33,y:95,width:34,height:5,rx:1}));
  return svg;
}
function render(){
  rig.style.setProperty('--cols',cols);rig.style.setProperty('--rows',rows);
  $('portIn').style.setProperty('--row',startRow);$('portOut').style.setProperty('--row',endRow);
  rig.classList.remove('won');done.hidden=true;
  const [f,name]=MEDIA[level%MEDIA.length];
  $('lvl').textContent=String(level+1).padStart(2,'0');$('medium').textContent=f;$('inLabel').textContent=f+' supply';
  $('moves').textContent='0';$('time').textContent='0.0';
  const best=store.get('psi-best-'+level);$('best').textContent=best?best+'s':'—';
  board.replaceChildren();
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    const t=grid[y][x];
    const b=document.createElement('button');
    b.className='cell';b.type='button';b.setAttribute('aria-label',`${t.type} pipe, row ${y+1}, column ${x+1}`);
    const svg=tileSvg(t.type);svg.style.transform=`rotate(${t.r*90}deg)`;
    b.append(svg);
    b.addEventListener('click',()=>turn(x,y,b));
    t.btn=b;t.svg=svg;
    board.append(b);
  }
  paint();
}

/* ---------- flow check ---------- */
function connected(){
  const on=new Set();
  const mask=(x,y)=>rotMask(SHAPES[grid[y][x].type].mask,grid[y][x].r);
  if(!(mask(0,startRow)&W)) return {on,solved:false};
  const q=[[0,startRow]];on.add('0,'+startRow);
  while(q.length){
    const [x,y]=q.shift(),m=mask(x,y);
    for(const [bit,dx,dy,opp] of STEPS){
      if(!(m&bit)) continue;
      const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=cols||ny>=rows) continue;
      if(!(mask(nx,ny)&opp)||on.has(nx+','+ny)) continue;
      on.add(nx+','+ny);q.push([nx,ny]);
    }
  }
  const solved=on.has((cols-1)+','+endRow)&&!!(mask(cols-1,endRow)&E);
  return {on,solved};
}
function paint(){
  const {on,solved}=connected();
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) grid[y][x].btn.classList.toggle('on',on.has(x+','+y));
  return solved;
}

/* ---------- play ---------- */
function turn(x,y,b){
  if(won) return;
  if(!timer){t0=performance.now();timer=setInterval(()=>{$('time').textContent=((performance.now()-t0)/1000).toFixed(1)},100)}
  const t=grid[y][x];t.r++;t.svg.style.transform=`rotate(${t.r*90}deg)`;
  moves++;$('moves').textContent=moves;
  if(paint()) win();
}
function win(){
  won=true;clearInterval(timer);
  const secs=((performance.now()-t0)/1000).toFixed(1);
  const key='psi-best-'+level,best=store.get(key);
  const record=!best||+secs<+best;
  if(record) store.set(key,secs);
  rig.classList.add('won');
  const [f,name]=MEDIA[level%MEDIA.length];
  $('doneLine').textContent=`${name} line online in ${secs}s and ${moves} moves.${record?' New personal best.':''}`;
  done.hidden=false;$('next').focus({preventScroll:true});
}
$('next').addEventListener('click',()=>{level++;build()});

build();
