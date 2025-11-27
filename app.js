// app.js
// Underwell Pit — Option C with Resonators + top device UI + drag-from-toolbar placement
// Matches HTML IDs: pitCanvas, time, everHp, highscore, startBtn, pauseBtn, resetBtn, toolbar, btnClear, activeTool, year

(() => {
  // DOM
  const canvas = document.getElementById('pitCanvas');
  const ctx = canvas.getContext('2d');
  const toolbar = document.getElementById('toolbar');
  const activeToolLabel = document.getElementById('activeTool');
  const yearSpan = document.getElementById('year');
  const timeSpan = document.getElementById('time');
  const everHpSpan = document.getElementById('everHp');
  const highSpan = document.getElementById('highscore');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const clearBtn = document.getElementById('btnClear');

  yearSpan.textContent = new Date().getFullYear();

  // Ghost preview for drag-from-toolbar
  const ghost = document.createElement('div');
  ghost.id = 'previewGhost';
  Object.assign(ghost.style, {
    position: 'fixed', pointerEvents: 'none', transform: 'translate(-50%,-50%)',
    zIndex: 9999, display: 'none', padding: '6px 8px', borderRadius: '8px',
    background: 'rgba(20,20,20,0.9)', color: '#fff', fontSize: '13px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.6)'
  });
  document.body.appendChild(ghost);

  // Canvas fit
  function fit() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    draw();
  }
  window.addEventListener('resize', fit);
  fit();

  // World state
  const world = {
    blocks: [],      // {x,y,w,h,health,isRepairStation}
    turrets: [],     // {x,y,rate,cool}
    traps: [],       // {x,y,r,cd}
    bombs: [],       // {x,y,armed}
    conveyors: [],   // {x,y,w,h,dir}
    entities: [],    // monsters {x,y,vx,vy,hp,stunned,progress}
    resonators: [],  // {x,y,hp,alive,produceCooldown,produceTimer,producedCount}
    everstones: [],  // {x,y,r,hp,resonatorId}
    running: false,
    time: 0,
    high: parseFloat(localStorage.getItem('underwell_highscore') || '0'),
    productionStartedAt: null // timestamp when production started
  };
  highSpan.textContent = world.high.toFixed(1);

  // Initialize level (walls, tunnels, 2 resonators in center)
  function initLevel() {
    world.blocks = [];
    world.turrets = [];
    world.traps = [];
    world.bombs = [];
    world.conveyors = [];
    world.entities = [];
    world.resonators = [];
    world.everstones = [];
    world.time = 0;
    world.running = false;
    world.productionStartedAt = null;

    const W = canvas.width, H = canvas.height;
    world.blocks.push({x:0,y:H-120,w:W,h:120,health:999}); // ground
    world.blocks.push({x:0,y:0,w:60,h:H-180,health:999}); // left tunnel
    world.blocks.push({x:W-60,y:0,w:60,h:H-180,health:999}); // right tunnel
    world.blocks.push({x:0,y:0,w:W,h:40,health:999}); // back top wall

    // central spiral platform-ish (simplified)
    const cx = W/2, cy = H/2 + 20;
    world.blocks.push({x:cx-160,y:cy-60,w:320,h:120,health:200});
    world.blocks.push({x:cx-220,y:cy+40,w:60,h:40,health:100});
    world.blocks.push({x:cx+160,y:cy+40,w:60,h:40,health:100});

    // place two Resonators near center (left and right)
    const r1 = { id: 0, x: cx-60, y: cy-10, hp: 120, alive: true, produceCooldown: 12, produceTimer: 6 + Math.random()*4, producedCount: 0 };
    const r2 = { id: 1, x: cx+60, y: cy-10, hp: 120, alive: true, produceCooldown: 12, produceTimer: 2 + Math.random()*4, producedCount: 0 };
    world.resonators.push(r1, r2);

    // optionally spawn initial everstones immediately
    // none at init; production will create them when running

    updateHUD();
    draw();
  }
  initLevel();

  // Helpers
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function dist(ax,ay,bx,by){ return Math.hypot(ax-bx, ay-by); }
  function capitalize(s){ if(!s) return ''; return s.charAt(0).toUpperCase()+s.slice(1); }
  function hexToRgb(hex){ hex=hex.replace('#',''); const bigint=parseInt(hex,16); return {r:(bigint>>16)&255,g:(bigint>>8)&255,b:bigint&255}; }
  function lerpColor(a,b,t){ const pa=hexToRgb(a), pb=hexToRgb(b); const r=Math.round(pa.r+(pb.r-pa.r)*t), g=Math.round(pa.g+(pb.g-pa.g)*t), bl=Math.round(pa.b+(pb.b-pa.b)*t); return `rgb(${r},${g},${bl})`; }

  // TOOL STATE + drag-from-toolbar
  let activeTool = 'select';
  activeToolLabel.textContent = 'Select';
  let currentDrag = null; // {tool, originBtn, pointerId}

  // Toolbar pointer handling (start drag or select)
  toolbar.addEventListener('pointerdown', (ev) => {
    const btn = ev.target.closest('.tool');
    if (!btn) return;
    ev.preventDefault();
    const tool = btn.dataset.tool || 'select';
    currentDrag = { tool, originBtn: btn, pointerId: ev.pointerId };
    ghost.style.display = 'block';
    ghost.textContent = capitalize(tool);
    positionGhost(ev.clientX, ev.clientY);

    // set active visually
    document.querySelectorAll('.tool').forEach(t=>t.classList.remove('active'));
    btn.classList.add('active');
    activeTool = tool;
    activeToolLabel.textContent = capitalize(tool);
    try { btn.setPointerCapture(ev.pointerId); } catch(e){}
  });

  toolbar.addEventListener('pointermove', (ev) => {
    if (currentDrag && currentDrag.pointerId === ev.pointerId) positionGhost(ev.clientX, ev.clientY);
  });

  toolbar.addEventListener('pointerup', (ev) => {
    if (!currentDrag || currentDrag.pointerId !== ev.pointerId) return;
    const btn = currentDrag.originBtn;
    try { btn.releasePointerCapture(ev.pointerId); } catch(e){}
    const elem = document.elementFromPoint(ev.clientX, ev.clientY);
    const overCanvas = elem === canvas || canvas.contains(elem);
    if (overCanvas && currentDrag.tool) {
      const rect = canvas.getBoundingClientRect();
      const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
      placeByTool(currentDrag.tool, cx, cy);
    } else {
      // just selected the tool (no placement)
    }
    currentDrag = null;
    ghost.style.display = 'none';
  });

  toolbar.addEventListener('pointercancel', () => { currentDrag = null; ghost.style.display='none'; });

  // Also allow click selection (tap-to-place mode)
  toolbar.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.tool');
    if (!btn) return;
    document.querySelectorAll('.tool').forEach(t=>t.classList.remove('active'));
    btn.classList.add('active');
    activeTool = btn.dataset.tool || 'select';
    activeToolLabel.textContent = capitalize(activeTool);
  });

  // Clear button
  clearBtn && clearBtn.addEventListener('click', () => {
    world.blocks = world.blocks.filter(b=>b.health===999);
    world.turrets = []; world.traps = []; world.bombs = []; world.conveyors = []; world.entities = [];
    // Keep resonators intact (they are part of map); don't clear everstones either
    draw();
  });

  // Start / Pause / Reset
  startBtn.addEventListener('click', () => {
    if (!world.productionStartedAt) world.productionStartedAt = Date.now();
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
    timeSpan.textContent = (0).toFixed(1);
  });

  // Pointer handling on canvas (tap-to-place + dragging blocks)
  let pointer = { down:false, x:0, y:0, grab:null };

  canvas.addEventListener('pointerdown', (ev) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ev.clientX - rect.left; pointer.y = ev.clientY - rect.top;
    pointer.down = true;

    if (activeTool === 'builder') placeBlock(pointer.x - 30, pointer.y - 18, 60, 36, 120);
    else if (activeTool === 'barrier') placeBlock(pointer.x - 40, pointer.y - 10, 80, 20, 180);
    else if (activeTool === 'conveyor') placeConveyor(pointer.x - 60, pointer.y - 12, 120, 24, 1);
    else if (activeTool === 'laser') placeTurret(pointer.x, pointer.y);
    else if (activeTool === 'shock') placeTrap(pointer.x, pointer.y);
    else if (activeTool === 'bomb') placeBomb(pointer.x, pointer.y);
    else if (activeTool === 'welder') {
      // Repair nearest block or resonator
      const b = findNearestBlock(pointer.x, pointer.y, 80);
      if (b && b.health !== 999) b.health = Math.min(b.health + 35, 220);
      const r = findNearestResonator(pointer.x, pointer.y, 80);
      if (r && r.alive) r.hp = Math.min(r.hp + 25, 150);
    } else if (activeTool === 'select') {
      const b = findBlockAt(pointer.x, pointer.y);
      if (b) pointer.grab = { type:'block', ref:b, ox: pointer.x - b.x, oy: pointer.y - b.y };
    }
    draw();
  });

  canvas.addEventListener('pointermove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ev.clientX - rect.left; pointer.y = ev.clientY - rect.top;
    if (pointer.grab && pointer.grab.type === 'block' && pointer.down) {
      pointer.grab.ref.x = pointer.x - pointer.grab.ox;
      pointer.grab.ref.y = pointer.y - pointer.grab.oy;
      draw();
    }
  });

  window.addEventListener('pointerup', () => { pointer.down = false; pointer.grab = null; });

  // Placement helpers
  function placeByTool(tool,x,y){
    if (tool === 'builder') placeBlock(x - 30, y - 18, 60, 36, 120);
    else if (tool === 'barrier') placeBlock(x - 40, y - 10, 80, 20, 180);
    else if (tool === 'conveyor') placeConveyor(x - 60, y - 12, 120, 24, 1);
    else if (tool === 'laser') placeTurret(x, y);
    else if (tool === 'shock') placeTrap(x, y);
    else if (tool === 'bomb') placeBomb(x, y);
    else if (tool === 'welder') {
      // place a repair station block
      world.blocks.push({x: x-16, y: y-16, w: 32, h: 32, health: 160, isRepairStation: true});
    }
    draw();
  }
  function placeBlock(x,y,w,h,health=100){ world.blocks.push({x,y,w,h,health}); }
  function placeTurret(x,y){ world.turrets.push({x,y,rate:0.25,cool:0}); }
  function placeTrap(x,y){ world.traps.push({x,y,r:28,cd:0}); }
  function placeBomb(x,y){ world.bombs.push({x,y,armed:60}); }
  function placeConveyor(x,y,w,h,dir=1){ world.conveyors.push({x,y,w,h,dir}); }

  // find helpers
  function findBlockAt(x,y){ for (let i=world.blocks.length-1;i>=0;i--){ const b=world.blocks[i]; if (x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h) return b; } return null; }
  function findNearestBlock(x,y,r){ let best=null,bd=1e9; for (const b of world.blocks){ const cx=b.x+b.w/2, cy=b.y+b.h/2, d=dist(x,y,cx,cy); if (d<r && d<bd){bd=d;best=b;} } return best; }
  function findNearestResonator(x,y,r){ let best=null,bd=1e9; for (const r of world.resonators){ if (!r.alive) continue; const d=dist(x,y,r.x,r.y); if (d<r && d<bd){bd=d;best=r;} } return best; }

  // Spawning monsters
  let spawnTimer = 0;
  function spawnMonster() {
    const W = canvas.width, H = canvas.height;
    const edge = Math.random()<0.5 ? 'left' : 'right';
    const x = edge==='left' ? 80 : W-80;
    const y = 60 + Math.random()*(H/3);
    const m = {x,y,vx:0,vy:0,hp:20,stunned:0,progress:0};
    world.entities.push(m);
  }

  // Resonator & Everstone logic
  function updateResonators(dt) {
    for (const r of world.resonators) {
      if (!r.alive) continue;
      // if there is no everstone produced by this resonator, tick down to produce
      const hasStone = world.everstones.some(s => s.resonatorId === r.id && s.hp>0);
      if (!hasStone) {
        r.produceTimer -= dt;
        if (r.produceTimer <= 0) {
          // produce an Everstone at resonator position
          const stone = { x: r.x, y: r.y - 40, r: 26, hp: 100, resonatorId: r.id };
          world.everstones.push(stone);
          r.producedCount = (r.producedCount||0) + 1;
          r.produceTimer = r.produceCooldown;
        }
      }
    }
  }

  // Monster AI: target nearest everstone; if none then target nearest resonator; dig blocks if blocked
  function updateAI(m) {
    if (m.stunned > 0) { m.stunned--; m.vx = 0; m.vy = 0; return; }
    // find target
    let target = null, targetType = null;
    if (world.everstones.length > 0) {
      // pick closest everstone
      let bd = 1e9;
      for (const s of world.everstones) {
        if (s.hp <= 0) continue;
        const d = dist(m.x, m.y, s.x, s.y);
        if (d < bd) { bd = d; target = s; targetType = 'stone'; }
      }
    }
    if (!target) {
      // choose nearest alive resonator
      let bd = 1e9;
      for (const r of world.resonators) {
        if (!r.alive) continue;
        const d = dist(m.x, m.y, r.x, r.y);
        if (d < bd) { bd = d; target = r; targetType = 'resonator'; }
      }
    }
    if (!target) {
      // nothing to target -> wander toward center
      const cx = canvas.width/2, cy = canvas.height/2;
      const dx = cx - m.x, dy = cy - m.y, d = Math.hypot(dx,dy) || 1;
      m.vx += (dx/d) * 0.02;
      m.vy += (dy/d) * 0.01;
    } else {
      const dx = target.x - m.x, dy = target.y - m.y, d = Math.hypot(dx,dy) || 1;
      if (Math.random() < 0.01) m.vx += (Math.random()-0.5)*0.6;
      const speed = 0.6 + (20 - m.hp)/20;
      m.vx += (dx/d) * 0.05 * speed;
      m.vy += (dy/d) * 0.02 * speed;
      m.vx = clamp(m.vx, -2.0, 2.0);
      m.vy = clamp(m.vy, -1.2, 1.2);

      // if close to target, damage it
      if (targetType === 'stone' && dist(m.x,m.y,target.x,target.y) < target.r + 10) {
        target.hp -= 0.12; // continuous damage while in contact
      } else if (targetType === 'resonator' && dist(m.x,m.y,target.x,target.y) < 28) {
        target.hp -= 0.15;
        if (target.hp <= 0) { target.alive = false; target.hp = 0; }
      }
    }

    // collision with blocks ahead -> attempt to dig (if not indestructible wall)
    const aheadX = m.x + Math.sign(m.vx)*8;
    const headY = m.y;
    const b = findBlockAt(aheadX, headY);
    if (b && b.health !== 999) {
      m.progress = (m.progress || 0) + 1;
      if (m.progress > 45) {
        b.health -= 8;
        m.progress = 0;
        if (b.health <= 0) {
          const idx = world.blocks.indexOf(b); if (idx >= 0) world.blocks.splice(idx,1);
        }
      }
      m.vx = 0;
    }
  }

  // Turrets, traps, bombs, conveyors logic (simplified)
  function turretLogic(t) {
    t.cool -= 1/60;
    if (t.cool <= 0) {
      let best = null, bd = 1e9;
      for (const m of world.entities) { const d=dist(t.x,t.y,m.x,m.y); if (d<300 && d<bd){bd=d;best=m;} }
      if (best) { best.hp -= 8; t.cool = 1/t.rate; }
    }
  }
  function trapLogic() {
    for (const tr of world.traps) {
      if (tr.cd>0) tr.cd--;
      for (const m of world.entities) {
        if (dist(tr.x,tr.y,m.x,m.y) < tr.r + 8 && tr.cd === 0) { m.stunned = 90; tr.cd = 240; }
      }
    }
  }
  function bombLogic() {
    for (let i=world.bombs.length-1;i>=0;i--) {
      const b = world.bombs[i]; b.armed--;
      if (b.armed <= 0) {
        for (const m of world.entities) if (dist(b.x,b.y,m.x,m.y) < 90) m.hp -= 30;
        for (let j=world.blocks.length-1;j>=0;j--) {
          if (dist(b.x,b.y, world.blocks[j].x+world.blocks[j].w/2, world.blocks[j].y+world.blocks[j].h/2) < 120) {
            world.blocks[j].health -= 80;
            if (world.blocks[j].health <= 0) world.blocks.splice(j,1);
          }
        }
        // damage resonators & everstones nearby
        for (const r of world.resonators) if (dist(b.x,b.y,r.x,r.y) < 120) { r.hp -= 30; if (r.hp <=0) r.alive=false; }
        for (const s of world.everstones) if (dist(b.x,b.y,s.x,s.y) < 120) { s.hp -= 40; }
        world.bombs.splice(i,1);
      }
    }
  }

  // Physics & game logic step (60Hz-ish)
  function physicsStep() {
    const dt = 1/60;
    // spawn when running
    if (world.running) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = Math.max(30 - Math.floor(world.time/20), 10) * (Math.random()*0.6+0.7);
        spawnMonster();
      }
      world.time += dt;
      timeSpan.textContent = world.time.toFixed(1);
    }

    // resonators produce stones if needed
    updateResonators(dt);

    // turrets/traps/bombs
    for (const t of world.turrets) turretLogic(t);
    trapLogic();
    bombLogic();

    // entities update
    for (let i = world.entities.length-1; i>=0; i--) {
      const m = world.entities[i];
      if (m.hp <= 0) { world.entities.splice(i,1); continue; }
      updateAI(m);
      m.x += m.vx; m.y += m.vy;
      m.x = clamp(m.x, 10, canvas.width-10); m.y = clamp(m.y, 40, canvas.height-10);

      // if close to any everstone, do continuous damage handled in updateAI
    }

    // clean up dead everstones & resonators
    for (let i=world.everstones.length-1;i>=0;i--) {
      const s = world.everstones[i];
      if (s.hp <=0) world.everstones.splice(i,1);
    }
    for (const r of world.resonators) if (r.alive && r.hp<=0) r.alive = false;

    // check productionStartedAt for display
    if (world.productionStartedAt && !world.running) {
      // production timer frozen until start; keep timestamp but do not increment
    }

    // check game over: if ALL resonators destroyed and no everstones left -> game over
    const anyResAlive = world.resonators.some(r => r.alive);
    if (!anyResAlive && world.everstones.length === 0 && world.running) {
      // game lost, stop
      world.running = false;
      gameOver();
    }
    updateHUD();
  }

  // Game over handling and highscore
  function gameOver() {
    const t = world.time;
    if (t > world.high) { world.high = t; localStorage.setItem('underwell_highscore', t.toFixed(1)); highSpan.textContent = world.high.toFixed(1); }
    setTimeout(()=>{ alert(`Production failed! You survived ${t.toFixed(1)}s. Best: ${world.high.toFixed(1)}s`); }, 50);
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    resetBtn.disabled = false;
  }

  // Draw everything (background, top device, map, blocks, resonators, everstones, monsters, UI)
  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // background
    const g = ctx.createLinearGradient(0,0,0,canvas.height);
    g.addColorStop(0,'#061318'); g.addColorStop(1,'#021016');
    ctx.fillStyle = g; ctx.fillRect(0,0,canvas.width,canvas.height);

    // top device area - draw a panel with production info
    drawTopDevice();

    // map conveyors
    for (const c of world.conveyors) {
      ctx.fillStyle = 'rgba(160,160,160,0.06)'; ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.save(); ctx.translate(c.x + 10, c.y + c.h/2); ctx.fillStyle = 'rgba(245,192,107,0.9)';
      for (let i=0;i<c.w/20;i++){ ctx.beginPath(); ctx.moveTo(i*20, -6); ctx.lineTo(i*20+8,0); ctx.lineTo(i*20,6); ctx.fill(); }
      ctx.restore();
    }

    // blocks
    for (const b of world.blocks) {
      const ratio = clamp(b.health/200, 0, 1);
      const color = lerpColor('#6fbdd6','#e07b4a', 1 - ratio);
      ctx.fillStyle = color;
      roundRect(ctx, b.x, b.y, b.w, b.h, 6);
      ctx.fill();
      if (b.health !== 999) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(b.x, b.y-6, b.w, 4);
        ctx.fillStyle = 'rgba(80,200,120,0.9)'; ctx.fillRect(b.x, b.y-6, b.w * clamp(b.health/180,0,1), 4);
      }
      if (b.isRepairStation) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(b.x+6, b.y+6, b.w-12, b.h-12);
        ctx.fillStyle = 'white'; ctx.fillText('W', b.x + b.w/2 - 3, b.y + b.h/2 + 4);
      }
    }

    // resonators
    for (const r of world.resonators) {
      ctx.save();
      ctx.translate(r.x, r.y);
      // base
      ctx.beginPath(); ctx.fillStyle = r.alive ? '#4aa0ff' : '#333'; ctx.rect(-18, -12, 36, 24); ctx.fill();
      // top gem
      ctx.beginPath(); ctx.fillStyle = r.alive ? '#ffd77a' : '#666'; ctx.arc(0, -20, 10, 0, Math.PI*2); ctx.fill();
      // hp bar
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-22, 18, 44, 6);
      ctx.fillStyle = 'rgba(80,200,120,0.9)'; ctx.fillRect(-22, 18, 44 * clamp(r.hp/150, 0,1), 6);
      ctx.restore();
    }

    // everstones
    for (const s of world.everstones) {
      ctx.beginPath();
      ctx.fillStyle = '#ffd77a';
      ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#3b2b14'; ctx.fillRect(s.x-6, s.y-4, 12, 8);
      // hp ring
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 4;
      ctx.arc(s.x, s.y, s.r+8, 0, Math.PI*2); ctx.stroke();
    }

    // turrets
    for (const t of world.turrets) {
      ctx.fillStyle = '#cfe3ff';
      ctx.beginPath(); ctx.arc(t.x, t.y, 12, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillRect(t.x-2, t.y-14, 4, 10);
    }

    // traps
    for (const tr of world.traps) {
      ctx.beginPath(); ctx.fillStyle = tr.cd>0 ? 'rgba(255,90,90,0.14)' : 'rgba(245,192,107,0.12)';
      ctx.arc(tr.x, tr.y, tr.r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillRect(tr.x-10, tr.y-4, 20, 8);
    }

    // bombs
    for (const b of world.bombs) {
      ctx.beginPath(); ctx.fillStyle = 'rgba(240,100,100,0.95)'; ctx.arc(b.x, b.y, 8, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle='white'; ctx.fillText(Math.ceil(b.armed/60), b.x-4, b.y+24);
    }

    // entities (monsters)
    for (const m of world.entities) {
      ctx.beginPath(); ctx.fillStyle = '#f3d84b'; ctx.arc(m.x, m.y, 10, 0, Math.PI*2); ctx.fill();
      if (m.stunned>0) { ctx.fillStyle='white'; ctx.fillText('Z', m.x-3, m.y-14); }
    }

    // HUD overlays (Active tool handled by DOM)
  }

  // draw top device panel (shows produced count, survival time, production started)
  function drawTopDevice() {
    const padding = 12;
    const w = canvas.width;
    // panel background
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, w, 48);
    ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.textBaseline = 'middle';
    // left: produced count (sum of all resonators produced)
    const produced = world.resonators.reduce((s,r)=>s+(r.producedCount||0),0);
    ctx.fillText(`Everstones produced: ${produced}`, padding, 24);
    // center: survival time
    ctx.fillText(`Survived: ${world.time.toFixed(1)}s`, w/2 - 60, 24);
    // right: production started + next production timers for each resonator (mm:ss since production started)
    if (world.productionStartedAt) {
      const elapsedSec = Math.floor((Date.now() - world.productionStartedAt)/1000);
      const mm = String(Math.floor(elapsedSec/60)).padStart(2,'0');
      const ss = String(elapsedSec%60).padStart(2,'0');
      ctx.fillText(`Production started: ${mm}:${ss}`, w - 240, 24);
    } else {
      ctx.fillText(`Production not started`, w - 160, 24);
    }
    // small per-resonator next timers
    let rx = w - 420;
    for (const r of world.resonators) {
      const next = Math.max(0, r.produceTimer || 0);
      ctx.fillStyle = r.alive ? '#ffd77a' : '#888';
      ctx.fillText(`R${r.id} next: ${next.toFixed(1)}s`, rx, 12);
      rx += 120;
      ctx.fillStyle = '#fff';
    }
  }

  // roundRect helper
  function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  // HUD updates (DOM)
  function updateHUD() {
    // everHp: show total HP left across everstones (sum) or 0
    const totalHP = world.everstones.reduce((s,sn)=>s+(sn.hp>0?sn.hp:0),0);
    everHpSpan.textContent = Math.round(totalHP) || 0;
    highSpan.textContent = world.high.toFixed(1);
    timeSpan.textContent = world.time.toFixed(1);
  }

  // game loop
  let last = performance.now();
  function loop(now) {
    const dt = (now - last)/1000; last = now;
    // physics step approx 60Hz
    if (world.running) {
      // run multiple physics steps if dt large to keep stable
      const steps = Math.max(1, Math.round(dt * 60));
      for (let i=0;i<steps;i++) physicsStep();
    }
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // spawn timer initial
  spawnTimer = 2.0;

  // utility: spawn monster
  function spawnMonster() {
    const W = canvas.width, H = canvas.height;
    const edge = Math.random() < 0.5 ? 'left' : 'right';
    const x = edge === 'left' ? 80 : W - 80;
    const y = 60 + Math.random()*(H/3);
    world.entities.push({x,y,vx:0,vy:0,hp:20,stunned:0,progress:0});
  }

  // helpers to find objects
  function findBlockAt(x,y){ for (let i=world.blocks.length-1;i>=0;i--){ const b=world.blocks[i]; if (x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h) return b; } return null; }
  function findNearestResonator(x,y,r){ let best=null,bd=1e9; for (const res of world.resonators){ if (!res.alive) continue; const d=dist(x,y,res.x,res.y); if (d<r && d<bd){bd=d;best=res;} } return best; }

  // small housekeeping
  setInterval(()=>{ world.blocks = world.blocks.filter(b => b.w>4 && b.h>4); }, 3000);

  // pointer cursor hint
  canvas.addEventListener('pointerenter', ()=> canvas.style.cursor = 'crosshair');
  canvas.addEventListener('pointerleave', ()=> canvas.style.cursor = 'default');

  // position ghost
  function positionGhost(clientX, clientY){ ghost.style.left = clientX + 'px'; ghost.style.top = clientY + 'px'; ghost.style.display = 'block'; }

  // Expose a debug function on window for convenience (optional)
  window.__underwell_world = world;

  // done
})();
