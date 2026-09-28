import * as THREE from './three.module.min.js';

document.documentElement.classList.remove('no-js');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = innerWidth < 760;
const clamp01 = v => Math.min(1, Math.max(0, v));

/* ---------- page motion: word-split headlines, reveals, count-ups ---------- */
function splitWords(el){
  const walk=n=>{
    [...n.childNodes].forEach(c=>{
      if(c.nodeType===3){
        const frag=document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach(w=>{
          if(!w) return;
          if(/^\s+$/.test(w)){frag.append(w);return}
          const o=document.createElement('span');o.className='wd';
          const i=document.createElement('span');i.textContent=w;o.append(i);frag.append(o);
        });
        c.replaceWith(frag);
      } else if(c.nodeType===1 && c.tagName!=='BR') walk(c);
    });
  };
  walk(el);
  el.querySelectorAll('.wd>span').forEach((s,i)=>s.style.transitionDelay=(i*70)+'ms');
}
document.querySelectorAll('.split').forEach(splitWords);
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.15});
document.querySelectorAll('.rv,.split').forEach(el=>io.observe(el));

const cio=new IntersectionObserver(es=>es.forEach(e=>{
  if(!e.isIntersecting) return; cio.unobserve(e.target);
  const el=e.target,to=+el.dataset.count,p=el.dataset.prefix||'',s=el.dataset.suffix||'',t0=performance.now();
  if(reduce) return;
  const step=t=>{const k=Math.min(1,(t-t0)/1600);el.textContent=p+Math.round(to*(1-Math.pow(1-k,4)))+s;if(k<1)requestAnimationFrame(step)};
  requestAnimationFrame(step);
}),{threshold:.6});
document.querySelectorAll('[data-count]').forEach(el=>cio.observe(el));

document.querySelectorAll('.ai-card').forEach(c=>c.addEventListener('pointermove',e=>{
  const r=c.getBoundingClientRect();c.style.setProperty('--mx',(e.clientX-r.left)+'px');c.style.setProperty('--my',(e.clientY-r.top)+'px');
}));
const mq=document.getElementById('mq');
[...mq.children].forEach(n=>mq.appendChild(n.cloneNode(true)));

/* ---------- scroll-driven UI ---------- */
const story=document.getElementById('story');
const gaugeBar=document.getElementById('gaugeBar'),gaugeVal=document.getElementById('gaugeVal');
const phaseFill=document.getElementById('phaseFill'),phaseRow=document.getElementById('phaseRow'),phasesEl=document.getElementById('phases');
let mixT=0;
function onScroll(){
  const r=story.getBoundingClientRect();
  const k=clamp01(-r.top/(r.height-innerHeight));
  mixT=THREE.MathUtils.smoothstep(k,.08,.75);
  story.classList.toggle('late',k>.42);
  gaugeBar.style.transform=`scaleX(${k})`;gaugeVal.textContent=(k*12).toFixed(1).padStart(4,'0');
  const r2=phasesEl.getBoundingClientRect();
  const pk=clamp01((innerHeight*.85-r2.top)/(innerHeight*.6));
  phaseFill.style.transform=`scaleX(${pk})`;
  [...phaseRow.children].forEach((d,i)=>d.classList.toggle('on',pk>=i/5+.02));
}
addEventListener('scroll',onScroll,{passive:true});onScroll();

/* ---------- easter egg: type "psi" ---------- */
const toast=document.getElementById('toast');
let buf='',boost=0;
addEventListener('keydown',e=>{
  if(e.key.length!==1) return;
  buf=(buf+e.key.toLowerCase()).slice(-3);
  if(buf!=='psi') return;
  boost=1;
  if(!reduce) document.body.classList.add('shake');
  toast.textContent='⚠ Overpressure. Relief valve opened at 12 bar.';toast.classList.add('on');
  setTimeout(()=>{document.body.classList.remove('shake');toast.classList.remove('on')},3200);
});
console.log('%cHi, curious engineer 👋','font:16px sans-serif;color:#ff5a1f','\nYou found the console. Try typing "psi" on the page.\n— Steven, info@stevendegraaf.com');

/* ---------- WebGL: pipes → neural network ---------- */
let renderer;
try{
  renderer=new THREE.WebGLRenderer({canvas:document.getElementById('gl'),antialias:true,powerPreference:'high-performance'});
}catch(err){
  console.warn('WebGL unavailable, showing static background.');
}
if(renderer) initScene();

function initScene(){
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x101718,1);
  const scene=new THREE.Scene();
  scene.fog=new THREE.Fog(0x101718,30,80);
  const camera=new THREE.PerspectiveCamera(42,1,0.1,200);
  camera.position.set(0,0,38);
  const world=new THREE.Group();scene.add(world);
  const rand=(a,b)=>a+Math.random()*(b-a);
  const SAMPLES=500;

  // industrial pipe routes: straight runs joined by 90° elbows, like real piping
  const PIPE_R=.55,ELBOW_R=1.4;
  function makeRoute(){
    const corners=[new THREE.Vector3(-46,Math.round(rand(-14,14)),Math.round(rand(-12,6)))];
    let prevAxis='x',p=corners[0].clone();
    p.x+=rand(6,14);corners.push(p.clone());
    while(p.x<46){
      const axis=prevAxis!=='x'?'x':(Math.random()<.65?'y':'z');
      const d=new THREE.Vector3();
      if(axis==='x') d.x=rand(10,24);
      else if(axis==='y'){d.y=rand(4,10)*(Math.random()<.5?-1:1);if(Math.abs(p.y+d.y)>16)d.y*=-1}
      else {d.z=rand(3,8)*(Math.random()<.5?-1:1);if(p.z+d.z>8||p.z+d.z<-16)d.z*=-1}
      p=p.clone().add(d);corners.push(p.clone());prevAxis=axis;
    }
    const path=new THREE.CurvePath(),elbows=[];
    let start=corners[0].clone();
    for(let i=1;i<corners.length-1;i++){
      const a=corners[i-1],b=corners[i],c=corners[i+1];
      const dirIn=b.clone().sub(a).normalize(),dirOut=c.clone().sub(b).normalize();
      const r=Math.min(ELBOW_R,a.distanceTo(b)*.45,b.distanceTo(c)*.45);
      const e0=b.clone().addScaledVector(dirIn,-r),e1=b.clone().addScaledVector(dirOut,r);
      path.add(new THREE.LineCurve3(start,e0));
      path.add(new THREE.QuadraticBezierCurve3(e0,b.clone(),e1));
      elbows.push([e0,dirIn],[e1,dirOut]);
      start=e1;
    }
    path.add(new THREE.LineCurve3(start,corners[corners.length-1]));
    return {path,elbows};
  }
  const ROUTES=mobile?7:11;
  const routeSamples=[];
  const pipeMat=new THREE.MeshBasicMaterial({color:0x3b5052,wireframe:true,transparent:true,opacity:.16,depthWrite:false});
  const flangeMat=new THREE.MeshBasicMaterial({color:0x6f8a8c,transparent:true,opacity:.2,depthWrite:false});
  const flangeGeo=new THREE.TorusGeometry(PIPE_R+.08,.07,6,20);
  const Z=new THREE.Vector3(0,0,1);
  for(let i=0;i<ROUTES;i++){
    const {path,elbows}=makeRoute();
    const sp=path.getSpacedPoints(SAMPLES-1);const arr=new Float32Array(SAMPLES*3);
    sp.forEach((v,k)=>{arr[k*3]=v.x;arr[k*3+1]=v.y;arr[k*3+2]=v.z});routeSamples.push(arr);
    world.add(new THREE.Mesh(new THREE.TubeGeometry(path,path.curves.length*24,PIPE_R,8,false),pipeMat));
    elbows.forEach(([pt,dir])=>{const f=new THREE.Mesh(flangeGeo,flangeMat);f.position.copy(pt);f.quaternion.setFromUnitVectors(Z,dir);world.add(f)});
  }

  // neural network layout
  const layers=mobile?[4,7,9,7,3]:[5,9,12,12,9,4];
  const nodes=[],layerNodes=[];
  layers.forEach((n,li)=>{
    const x=THREE.MathUtils.lerp(-24,24,li/(layers.length-1));const arr=[];
    for(let k=0;k<n;k++){const v=new THREE.Vector3(x,(k-(n-1)/2)*(26/Math.max(n,6)),rand(-4,4));nodes.push(v);arr.push(v)}
    layerNodes.push(arr);
  });
  const edges=[];
  for(let li=0;li<layerNodes.length-1;li++) for(const a of layerNodes[li]) for(const b of layerNodes[li+1]) if(Math.random()<.55) edges.push([a,b]);
  const eg=new THREE.BufferGeometry();const ep=new Float32Array(edges.length*6);
  edges.forEach(([a,b],i)=>ep.set([a.x,a.y,a.z,b.x,b.y,b.z],i*6));
  eg.setAttribute('position',new THREE.BufferAttribute(ep,3));
  const edgeMat=new THREE.LineBasicMaterial({color:0x4d8dff,transparent:true,opacity:0,depthWrite:false});
  world.add(new THREE.LineSegments(eg,edgeMat));
  const dotTex=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');const g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'#fff');g.addColorStop(.35,'rgba(255,255,255,.9)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c)})();
  const nodeMat=new THREE.PointsMaterial({color:0xcfefff,size:1.6,map:dotTex,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  world.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(nodes),nodeMat));

  // flowing particles
  const N=mobile?4500:11000;
  const pos=new Float32Array(N*3),seed=new Float32Array(N);
  const pr=new Uint16Array(N),pe=new Uint16Array(N),t0=new Float32Array(N),spd=new Float32Array(N),jit=new Float32Array(N*3),delay=new Float32Array(N);
  for(let i=0;i<N;i++){
    pr[i]=i%ROUTES;pe[i]=Math.floor(Math.random()*edges.length);t0[i]=Math.random();spd[i]=rand(.025,.06);
    const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*.42;jit[i*3]=Math.cos(a)*r;jit[i*3+1]=Math.sin(a)*r;jit[i*3+2]=rand(-.42,.42);
    seed[i]=Math.random();delay[i]=Math.random();
  }
  const pg=new THREE.BufferGeometry();
  pg.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('aSeed',new THREE.BufferAttribute(seed,1));
  const pm=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    uniforms:{uMix:{value:0},uPR:{value:renderer.getPixelRatio()},uSize:{value:mobile?190:180},uBoost:{value:0},uMouse:{value:new THREE.Vector2(9,9)},uAspect:{value:1}},
    vertexShader:`attribute float aSeed;uniform float uPR,uSize,uBoost,uAspect;uniform vec2 uMouse;varying float vSeed,vNear;
      void main(){vSeed=aSeed;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
        vec2 ndc=gl_Position.xy/gl_Position.w;vec2 d=(ndc-uMouse)*vec2(uAspect,1.);float l=length(d);
        float f=smoothstep(.32,0.,l);vNear=f;
        ndc+=normalize(d+1e-5)/vec2(uAspect,1.)*f*(.1+aSeed*.08);gl_Position.xy=ndc*gl_Position.w;
        gl_PointSize=uSize*uPR*(.35+aSeed*.9)*(1.+uBoost*.6+f*.8)/-mv.z;}`,
    fragmentShader:`uniform float uMix,uBoost;varying float vSeed,vNear;
      void main(){vec2 c=gl_PointCoord-.5;float d=length(c);if(d>.5)discard;float a=smoothstep(.5,0.,d);a*=a;
      vec3 hot=mix(vec3(1.,.35,.12),vec3(1.,.78,.5),step(.9,vSeed));
      vec3 cool=mix(vec3(.3,.55,1.),vec3(.7,.92,1.),step(.85,vSeed));
      vec3 col=mix(hot,cool,uMix);col=mix(col,vec3(1.,.2,.1),uBoost*.6);col=mix(col,vec3(1.,.95,.85),vNear*.5);
      gl_FragColor=vec4(col,a*(.9+vNear*.6));}`
  });
  world.add(new THREE.Points(pg,pm));

  function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.position.z=innerWidth<760?60:38;camera.updateProjectionMatrix()}
  addEventListener('resize',resize);resize();

  let mx=0,my=0;const mTarget=new THREE.Vector2(9,9);
  addEventListener('pointermove',e=>{mx=e.clientX/innerWidth-.5;my=e.clientY/innerHeight-.5;mTarget.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight*2-1))});
  document.addEventListener('pointerleave',()=>mTarget.set(9,9));

  // render only while a see-through section is on screen
  const vis=new Set();let visible=true;
  const vio=new IntersectionObserver(es=>{es.forEach(e=>e.isIntersecting?vis.add(e.target):vis.delete(e.target));visible=vis.size>0});
  document.querySelectorAll('.hero,.story,.ai').forEach(el=>vio.observe(el));

  const clock=new THREE.Clock();let time=0,mix=0;
  (function frame(){
    requestAnimationFrame(frame);
    const dt=Math.min(clock.getDelta(),.05);
    if(!visible||document.hidden) return;
    boost=Math.max(0,boost-dt*.35);
    time+=dt*(reduce?.15:1)*(1+boost*5);
    mix+=(mixT-mix)*Math.min(1,dt*3);
    for(let i=0;i<N;i++){
      const t=(t0[i]+time*spd[i])%1;
      const s=routeSamples[pr[i]];const f=t*(SAMPLES-1),k=f|0,fr=f-k,k2=Math.min(k+1,SAMPLES-1);
      const ax=s[k*3]+(s[k2*3]-s[k*3])*fr+jit[i*3],ay=s[k*3+1]+(s[k2*3+1]-s[k*3+1])*fr+jit[i*3+1],az=s[k*3+2]+(s[k2*3+2]-s[k*3+2])*fr+jit[i*3+2];
      const e=edges[pe[i]],A=e[0],B=e[1];
      const bx=A.x+(B.x-A.x)*t+jit[i*3]*.25,by=A.y+(B.y-A.y)*t+jit[i*3+1]*.25,bz=A.z+(B.z-A.z)*t+jit[i*3+2]*.25;
      let m=clamp01(mix*1.6-delay[i]*.6);m=m*m*(3-2*m);
      pos[i*3]=ax+(bx-ax)*m;pos[i*3+1]=ay+(by-ay)*m;pos[i*3+2]=az+(bz-az)*m;
    }
    pg.attributes.position.needsUpdate=true;
    pm.uniforms.uMix.value=mix;pm.uniforms.uBoost.value=boost;
    pm.uniforms.uMouse.value.lerp(mTarget,Math.min(1,dt*10));pm.uniforms.uAspect.value=innerWidth/innerHeight;
    pipeMat.opacity=.16*(1-mix);flangeMat.opacity=.2*(1-mix);edgeMat.opacity=.18*mix;nodeMat.opacity=.9*mix;
    world.rotation.y+=((mx*.15+mix*.25)-world.rotation.y)*.04;
    world.rotation.x+=((my*.1-.05)-world.rotation.x)*.04;
    world.position.y=Math.sin(time*.3)*.4;
    renderer.render(scene,camera);
  })();
}
