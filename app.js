// app.js
// Underwell Pit — touch-friendly sandbox with drag-from-toolbar placement

const canvas = document.getElementById('pitCanvas');
const ctx = canvas.getContext('2d');
const toolbar = document.getElementById('toolbar');
const activeToolLabel = document.getElementById('activeTool');
const yearSpan = document.getElementById('year');
const timeSpan = document.getElementById('time');
const everHpSpan = document.getElementById('everHp');
const highSpan = document.getElementById('high');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const clearBtn = document.getElementById('btnClear');

yearSpan.textContent = new Date().getFullYear();

// preview ghost element for drag feedback
const ghost = document.createElement('div');
ghost.id = 'previewGhost';
document.body.appendChild(ghost);

// canvas sizing
function fit() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  draw();
}
window.addEventListener('resize', fit);
fit();

// world state
const world = {
  blocks: [],      // {x,y,w,h,health}
  turrets: [],     // {x,y,rate,cool}
  traps: [],       // {x,y,r,cd}
  bombs: [],       // {x,y,armed}
  conveyors: [],   // {x,y,w,h,dir}
  entities: [],    // monsters {x,y,vx,vy,hp,stunned,progress}
  everstone: null,
  running: false,
  time: 0,
  high: parseFloat(localStorage.getItem('underwell_high')||'0')
};
highSpan.textContent = world.high.toFixed(1);

// build initial level (walls + central platform + everstone)
function initLevel() {
  world.blocks = [];
  world.turrets = [];
  world.traps = [];
  world.bombs = [];
  world.conveyors = [];
  world.entities = [];
  world.time = 0;
  world.running = false;

  const W = canvas.width, H = canvas.height;
  world.blocks.push({x:0,y:H-120,w:W,h:120,health:999}); // ground
  world.blocks.push({x:0,y:0,w:60,h:H-180,health:999}); // left tunnel
  world.blocks.push({x:W-60,y:0,w:60,h:H-180,health:999}); // right tunnel
  world.blocks.push({x:0,y:0,w:W,h:40,health:999}); // back top wall

  const cx = W/2, cy = H/2 + 30;
  world.blocks.push({x:cx-160,y:cy-60,w:320,h:120,health:200});
  world.blocks.push({x:cx-220,y:cy+40,w:60,h:40,health:100});
  world.blocks.push({x:cx+160,y:cy+40,w:60,h:40,health:100});
  world.everstone = {x:cx, y:cy-10, r:34, hp:100, max:100};

  draw();
}
initLevel();

// TOOL STATE
let activeTool = 'select';
activeToolLabel.textContent = 'Select';

// toolbar tool selection & drag-from-toolbar logic
let currentDrag = null; // {tool, originBtn, pointerId, offsetX, offsetY}

toolbar.addEventListener('pointerdown', (ev) => {
  const btn = ev.target.closest('.tool');
  if (!btn) return;
  ev.preventDefault();
  const tool = btn.dataset.tool || null;

  // start drag preview (drag-from-toolbar)
  currentDrag = {
    tool,
    originBtn: btn,
    pointerId: ev.pointerId
  };

  // show ghost near pointer
  ghost.style.display = 'block';
  ghost.textContent = tool ? capitalize(tool) : 'Select';
  positionGhost(ev.clientX, ev.clientY);

  // also set as active visually (so click/tap still selects)
  document.querySelectorAll('.tool').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  if (tool) { activeTool = tool; activeToolLabel.textContent = capitalize(tool); }
  else { activeTool = 'select'; activeToolLabel.textContent = 'Select'; }

  // capture pointer to the origin button so pointerup fires even if pointer leaves it
  btn.setPointerCapture(ev.pointerId);
});

toolbar.addEventListener('pointermove', (ev) => {
  if (currentDrag && currentDrag.pointerId === ev.pointerId) {
    positionGhost(ev.clientX, ev.clientY);
  }
});

toolbar.addEventListener('pointerup', (ev) => {
  // pointerup on toolbar: if release on canvas, place; otherwise if quick click (no move) it's a select toggle
  if (!currentDrag || currentDrag.pointerId !== ev.pointerId) return;
  const btn = currentDrag.originBtn;
  try { btn.releasePointerCapture(ev.pointerId); } catch(e){}
  // find where pointer released
  const elem = document.elementFromPoint(ev.clientX, ev.clientY);
  const overCanvas = elem === canvas || canvas.contains(elem);
  if (overCanvas && currentDrag.tool) {
    // compute canvas local coords
    const rect = canvas.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    placeByTool(currentDrag.tool, cx, cy);
  } else {
    // just a tap on toolbar — keep tool active (handled earlier)
  }
  currentDrag = null;
  ghost.style.display = 'none';
});

toolbar.addEventListener('pointercancel', (ev) => {
  if (currentDrag && currentDrag.pointerId === ev.pointerId) {
    currentDrag = null;
    ghost.style.display = 'none';
  }
});

// also allow direct tap-to-place: click tool then tap canvas
toolbar.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tool');
  if (!btn) return;
  const tool = btn.dataset.tool || 'select';
  // set active tool visually
  document.querySelectorAll('.tool').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  activeTool = tool;
  activeToolLabel.textContent = capitalize(tool);
});

// clear button
clearBtn.addEventListener('click', () => {
  world.blocks = world.blocks.filter(b => b.health===999);
  world.turrets = []; world.traps=[]; world.bombs=[]; world.conveyors=[]; world.entities=[];
  draw();
});

// start/pause/reset
startBtn.addEventListener('click', () => {
  world.running = true;
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  resetBtn.disabled = false;
});
pauseBtn.addEventListener('click', () => {
  world.running = !world.running;
  pauseBtn.textContent = world.running ? 'Pause' : 'Resume';
  if (!world.running) startBtn.disabled = false;
  else startBtn.disabled = true;
});
resetBtn.addEventListener('click', () => {
  initLevel();
  world.time = 0;
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
  everHpSpan.textContent = world.everstone.hp;
  timeSpan.textContent = (0).toFixed(1);
});

// canvas pointer handling: supports tap-to-place when tool selected
let pointer = {down:false,x:0,y:0};

canvas.addEventListener('pointerdown', (ev) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ev.clientX - rect.left;
  pointer.y = ev.clientY - rect.top;
  pointer.down = true;

  // If user selected a tool (tap mode), place the thing
  if (activeTool === 'builder') placeBlock(pointer.x - 30, pointer.y - 18, 60, 36, 120);
  else if (activeTool === 'barrier') placeBlock(pointer.x - 40, pointer.y - 10, 80, 20, 180);
  else if (activeTool === 'conveyor') placeConveyor(pointer.x - 60, pointer.y - 12, 120, 24, 1);
  else if (activeTool === 'laser') placeTurret(pointer.x, pointer.y);
  else if (activeTool === 'shock') placeTrap(pointer.x, pointer.y);
  else if (activeTool === 'bomb') placeBomb(pointer.x, pointer.y);
  else if (activeTool === 'welder') { // welder tap repairs nearest block or everstone
    const b = findNearestBlock(pointer.x,pointer.y,80);
    if (b && b.health !== 999) b.health = Math.min((b.health||100)+35, 200);
    const e = world.everstone;
    if (dist(pointer.x,pointer.y,e.x,e.y) < e.r + 40) e.hp = Math.min(e.hp+20, e.max);
  } else if (activeTool === 'select') {
    // pick block to drag
    const b = findBlockAt(pointer.x,pointer.y);
    if (b) pointer.grab = {type:'block', ref:b, ox: pointer.x - b.x, oy: pointer.y - b.y};
  }
  draw();
});

canvas.addEventListener('pointermove', (ev) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ev.clientX - rect.left;
  pointer.y = ev.clientY - rect.top;
  if (pointer.grab && pointer.grab.type === 'block' && pointer.down) {
    pointer.grab.ref.x = pointer.x - pointer.grab.ox;
    pointer.grab.ref.y = pointer.y - pointer.grab.oy;
    draw();
  }
});

window.addEventListener('pointerup', (ev) => {
  // if releasing after dragging from toolbar over canvas, the toolbar pointerup handled placement
  if (pointer.grab) { pointer.grab = null; }
  pointer.down = false;
});

// placement by tool from drag-from-toolbar
function placeByTool(tool, x, y) {
  if (tool === 'builder') placeBlock(x - 30, y - 18, 60, 36, 120);
  else if (tool === 'barrier') placeBlock(x - 40, y - 10, 80, 20, 180);
  else if (tool === 'conveyor') placeConveyor(x - 60, y - 12, 120, 24, 1);
  else if (tool === 'laser') placeTurret(x, y);
  else if (tool === 'shock') placeTrap(x, y);
  else if (tool === 'bomb') placeBomb(x, y);
  else if (tool === 'welder') {
    // place a small repair station that automatically repairs nearby blocks
    world.blocks.push({x: x-16, y: y-16, w: 32, h: 32, health: 160, isRepairStation: true});
  }
  draw();
}

// helpers: position ghost preview near pointer
function positionGhost(clientX, clientY) {
  ghost.style.left = clientX + 'px';
  ghost.style.top = clientY + 'px';
  ghost.style.display = 'block';
}

// placement helper functions
function placeBlock(x,y,w,h,health=100){
  world.blocks.push({x,y,w,h,health});
  draw();
}
function placeTurret(x,y){
  world.turrets.push({x,y,rate:0.25,cool:0});
}
function placeTrap(x,y){
  world.traps.push({x,y,r:28,cd:0});
}
function placeBomb(x,y){
  world.bombs.push({x,y,armed:60});
}
function placeConveyor(x,y,w,h,dir=1){
  world.conveyors.push({x,y,w,h,dir});
}

// find helpers
function findBlockAt(x,y){
  for (let i=world.blocks.length-1;i>=0;i--){
    const b = world.blocks[i];
    if (x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h) return b;
  }
  return null;
}
function findNearestBlock(x,y,r){
  let best=null,bd=1e9;
  for (const b of world.blocks){
    const cx = b.x + b.w/2, cy = b.y + b.h/2;
    const d = dist(x,y,cx,cy);
    if (d<r && d<bd){ bd=d; best=b; }
  }
  return best;
}
function dist(a,b,c,d){ return Math.hypot(a-c,b-d); }
function capitalize(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

// MONSTER & GAME LOGIC (simplified)
let spawnTimer = 0;

function spawnMonster() {
  const W = canvas.width, H = canvas.height;
  const edge = Math.random()<0.5 ? 'left' : 'right';
  const x = edge==='left' ? 80 : W-80;
  const y = 60 + Math.random()*(H/3);
  const m = {x,y,vx:0,vy:0,hp:20,stunned:0,progress:0};
  world.entities.push(m);
}

function updateAI(m){
  if (m.stunned>0){ m.stunned--; m.vx=0; m.vy=0; return; }
  const ex = world.everstone.x, ey = world.everstone.y;
  let dx = ex - m.x, dy = ey - m.y;
  const d = Math.hypot(dx,dy) || 1;
  // wander noise
  if (Math.random()<0.01) m.vx += (Math.random()-0.5)*0.6;
  // move toward everstone
  const speed = 0.6 + (20 - Math.max(0,m.hp))/20;
  m.vx += (dx/d)*0.05 * speed;
  m.vx = clamp(m.vx, -2.0, 2.0);
  m.vy = clamp(dy/d*0.02, -1.2, 1.2);

  // collision with blocks ahead -> attempt to dig if not wall
  const aheadX = m.x + Math.sign(m.vx)*8;
  const headY = m.y;
  const b = findBlockAt(aheadX, headY);
  if (b && b.health !== 999) {
    m.progress = (m.progress||0) + 1;
    if (m.progress > 45) {
      b.health -= 8;
      m.progress = 0;
      if (b.health <= 0) {
        const idx = world.blocks.indexOf(b); if (idx>=0) world.blocks.splice(idx,1);
      }
    }
    m.vx = 0;
  }
}

function turretLogic(t){
  t.cool -= 1/60;
  if (t.cool <= 0){
    let best=null,bd=1e9;
    for (const m of world.entities){
      const d = dist(t.x,t.y,m.x,m.y);
      if (d<300 && d<bd){bd=d;best=m;}
    }
    if (best){ best.hp -= 8; t.cool = 1/t.rate; }
  }
}
function trapLogic(){
  for (const tr of world.traps){
    if (tr.cd>0) tr.cd--;
    for (const m of world.entities){
      if (dist(tr.x,tr.y,m.x,m.y) < tr.r + 8 && tr.cd===0){
        m.stunned = 90;
        tr.cd = 240;
      }
    }
  }
}
function bombLogic(){
  for (let i=world.bombs.length-1;i>=0;i--){
    const b = world.bombs[i];
    b.armed--;
    if (b.armed<=0){
      for (const m of world.entities){ if (dist(b.x,b.y,m.x,m.y) < 90) m.hp -= 30; }
      for (let j=world.blocks.length-1;j>=0;j--){ if (dist(b.x,b.y, world.blocks[j].x+world.blocks[j].w/2, world.blocks[j].y+world.blocks[j].h/2) < 120){
        world.blocks[j].health -= 80;
        if (world.blocks[j].health <= 0) world.blocks.splice(j,1);
      }}
      if (dist(b.x,b.y, world.everstone.x, world.everstone.y) < 120) world.everstone.hp -= 25;
      world.bombs.splice(i,1);
    }
  }
}

// physics step
function physicsStep() {
  if (world.running){
    spawnTimer -= 1/60;
    if (spawnTimer <= 0){
      spawnTimer = Math.max(30 - Math.floor(world.time/20), 10) * (Math.random()*0.6+0.7);
      spawnMonster();
    }
    world.time += 1/60;
    timeSpan.textContent = world.time.toFixed(1);
  }

  for (const t of world.turrets) turretLogic(t);
  trapLogic();
  bombLogic();

  for (let i=world.entities.length-1;i>=0;i--){
    const m = world.entities[i];
    if (m.hp<=0){ world.entities.splice(i,1); continue; }
    updateAI(m);
    m.x += m.vx; m.y += m.vy;
    m.x = clamp(m.x, 10, canvas.width-10);
    m.y = clamp(m.y, 40, canvas.height-10);
    if (dist(m.x,m.y,world.everstone.x,world.everstone.y) < world.everstone.r + 10){
      world.everstone.hp -= 0.08;
    }
  }

  // repair stations: automatic heal (blocks with isRepairStation)
  for (const b of world.blocks){
    if (b.isRepairStation){
      // heal nearby blocks & everstone
      for (const tb of world.blocks){
        if (tb.health && tb.health < 200 && dist(b.x+16,b.y+16,tb.x+tb.w/2,tb.y+tb.h/2) < 90) tb.health = Math.min(tb.health + 0.15, 200);
      }
      const e = world.everstone;
      if (dist(b.x+16,b.y+16,e.x,e.y) < 90) e.hp = Math.min(e.hp + 0.06, e.max);
    }
  }

  if (world.everstone.hp <= 0){
    world.everstone.hp = 0; world.running = false; gameOver();
  }
  everHpSpan.textContent = Math.round(world.everstone.hp);
}

// game over
function gameOver(){
  const t = world.time;
  if (t > world.high){ world.high = t; localStorage.setItem('underwell_high', t.toFixed(1)); highSpan.textContent = world.high.toFixed(1); }
  setTimeout(()=>{ alert('Everstone destroyed! You survived ' + t.toFixed(1) + 's. Best: ' + world.high.toFixed(1) + 's'); }, 50);
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = false;
}

// draw
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const g = ctx.createLinearGradient(0,0,0,canvas.height);
  g.addColorStop(0,'#061318'); g.addColorStop(1,'#021016');
  ctx.fillStyle = g; ctx.fillRect(0,0,canvas.width,canvas.height);

  // conveyors
  for (const c of world.conveyors){
    ctx.fillStyle = 'rgba(160,160,160,0.06)'; ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.save(); ctx.translate(c.x + 10, c.y + c.h/2); ctx.fillStyle = 'rgba(245,192,107,0.9)';
    for (let i=0;i<c.w/20;i++){ ctx.beginPath(); ctx.moveTo(i*20, -6); ctx.lineTo(i*20+8,0); ctx.lineTo(i*20,6); ctx.fill(); }
    ctx.restore();
  }

  // blocks
  for (const b of world.blocks){
    const ratio = clamp(b.health/200, 0, 1);
    const color = lerpColor('#6fbdd6','#e07b4a', 1 - ratio);
    ctx.fillStyle = color;
    roundRect(ctx, b.x, b.y, b.w, b.h, 6);
    ctx.fill();
    if (b.health !== 999){
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(b.x, b.y-6, b.w, 4);
      ctx.fillStyle = 'rgba(80,200,120,0.9)'; ctx.fillRect(b.x, b.y-6, b.w * clamp(b.health/180,0,1), 4);
    }
    if (b.isRepairStation){
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(b.x+6, b.y+6, b.w-12, b.h-12);
      ctx.fillStyle = 'white'; ctx.fillText('W', b.x + b.w/2 - 3, b.y + b.h/2 + 4);
    }
  }

  // turrets
  for (const t of world.turrets){
    ctx.fillStyle = '#cfe3ff';
    ctx.beginPath(); ctx.arc(t.x, t.y, 12, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillRect(t.x-2, t.y-14, 4, 10);
  }

  // traps
  for (const tr of world.traps){
    ctx.beginPath(); ctx.fillStyle = tr.cd>0 ? 'rgba(255,90,90,0.14)' : 'rgba(245,192,107,0.12)';
    ctx.arc(tr.x, tr.y, tr.r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillRect(tr.x-10, tr.y-4, 20, 8);
  }

  // bombs
  for (const b of world.bombs){
    ctx.beginPath(); ctx.fillStyle = 'rgba(240,100,100,0.95)'; ctx.arc(b.x, b.y, 8, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='white'; ctx.fillText(Math.ceil(b.armed/60), b.x-4, b.y+24);
  }

  // everstone
  const e = world.everstone;
  ctx.beginPath(); ctx.fillStyle = `rgba(245,192,107,${0.08 + (1 - e.hp/e.max)*0.4})`; ctx.arc(e.x, e.y, e.r+18, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.fillStyle = '#ffd77a'; ctx.arc(e.x, e.y, e.r, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#3b2b14'; ctx.fillRect(e.x-8, e.y-6, 16, 12);

  // entities
  for (const m of world.entities){
    ctx.beginPath(); ctx.fillStyle = '#f3d84b'; ctx.arc(m.x, m.y, 10, 0, Math.PI*2); ctx.fill();
    if (m.stunned>0){ ctx.fillStyle='white'; ctx.fillText('Z', m.x-3, m.y-14); }
  }
}

function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function lerpColor(a,b,t){ const pa=hexToRgb(a), pb=hexToRgb(b); const r=Math.round(pa.r+(pb.r-pa.r)*t), g=Math.round(pa.g+(pb.g-pa.g)*t), bl=Math.round(pa.b+(pb.b-pa.b)*t); return `rgb(${r},${g},${bl})`; }
function hexToRgb(hex){ hex=hex.replace('#',''); const bigint=parseInt(hex,16); return {r:(bigint>>16)&255,g:(bigint>>8)&255,b:bigint&255}; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

// main loop
let last = performance.now();
function loop(now){
  const dt = (now - last)/1000; last = now;
  // physics at 60 Hz approximation
  if (world.running) {
    for (let i=0;i<Math.max(1, Math.round(dt*60)); i++) physicsStep();
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// small housekeeping
setInterval(()=>{ world.blocks = world.blocks.filter(b => b.w>4 && b.h>4); }, 3000);

// keyboard quick toggle
window.addEventListener('keydown', (e)=>{ if (e.key===' ') { if (!world.running) startBtn.click(); else pauseBtn.click(); } });

// pointer cursor on canvas
canvas.addEventListener('pointerenter', ()=> canvas.style.cursor = 'crosshair');
canvas.addEventListener('pointerleave', ()=> canvas.style.cursor = 'default');
