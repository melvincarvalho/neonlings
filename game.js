'use strict';
// NEONLINGS — Copyright © 2026 Melvin Carvalho — AGPL-3.0-or-later (see LICENSE)
// A tribute to Lemmings. No assets: every pixel and sound generated from code.
// ?shot=<name>[&f=N] renders deterministic frames for the critic harness.
// ?verify=<level>&mode=solution|null replays the authored solution (or nothing)
// headlessly and reports via document.title — every level ships with a proof.

const W = 1280, H = 720;
const MQ = 40, HUD_H = 110;
const VW = W, VH = H - MQ - HUD_H;
const LW = 1600, LH = 570;            // level terrain space
const STEP = 1 / 60;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * DPR; canvas.height = H * DPR;
ctx.scale(DPR, DPR);

// ---------- seeded RNG ----------
let _seed = 1;
function srand(s) { _seed = s >>> 0; }
function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
function rng(a, b) { return a + rnd() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
const MONO = '"Courier New", monospace';

// ---------- audio ----------
let AUDIO_ON = true, actx = null, master = null;
function audio() {
  if (!AUDIO_ON) return null;
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = actx.createDynamicsCompressor();
    master = actx.createGain(); master.gain.value = 0.4;
    master.connect(comp); comp.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(f, dur, type = 'square', vol = 0.15, slideTo = 0, delay = 0) {
  const a = audio(); if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur);
}
function noise(dur, vol = 0.2, freq = 900) {
  const a = audio(); if (!a) return;
  const n = a.sampleRate * dur | 0, buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = buf;
  const flt = a.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = freq;
  const g = a.createGain(); g.gain.value = vol;
  src.connect(flt); flt.connect(g); g.connect(master); src.start();
}
const SFX = {
  spawn: () => tone(500, 0.08, 'square', 0.1, 900),
  assign: () => tone(900, 0.06, 'square', 0.12, 1400),
  build: () => tone(700, 0.05, 'triangle', 0.1),
  bash: () => noise(0.07, 0.16, 1200),
  dig: () => noise(0.08, 0.16, 700),
  pop: () => { noise(0.3, 0.3, 700); tone(90, 0.25, 'sine', 0.24, 45); },
  splat: () => noise(0.12, 0.25, 400),
  exit: () => { tone(880, 0.07, 'square', 0.1); tone(1320, 0.1, 'square', 0.09, 0, 0.06); },
  win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.12, 'square', 0.13, 0, i * 0.08)); },
  fail: () => tone(400, 0.7, 'sawtooth', 0.18, 60),
  tick: () => tone(1200, 0.04, 'square', 0.09),
  oh: () => tone(300, 0.15, 'square', 0.1, 150),
};

// ---------- terrain: canvas + synced solidity mask ----------
// mask values: 0 empty, 1 diggable, 2 steel
const terrC = document.createElement('canvas');
terrC.width = LW; terrC.height = LH;
const tctx = terrC.getContext('2d');
let MASK = new Uint8Array(LW * LH);
function maskAt(x, y) {
  x |= 0; y |= 0;
  if (x < 0 || x >= LW || y < 0 || y >= LH) return (y >= LH) ? 2 : 0;
  return MASK[y * LW + x];
}
function solidAt(x, y) { return maskAt(x, y) > 0; }
let PAINT_RIM = '#33d6ff';
function paintRect(x, y, w, h, fill, steel) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  const g = tctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shade(fill, 0.22)); g.addColorStop(0.12, fill); g.addColorStop(1, shade(fill, -0.45));
  tctx.fillStyle = steel ? '#2a3242' : g;
  tctx.fillRect(x, y, w, h);
  // baked speckle, accent rim on top, dark underside
  tctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 0; i < (w * h) / 300; i++) tctx.fillRect(x + rng(0, w - 3) | 0, y + rng(0, h - 3) | 0, 2, 2);
  tctx.fillStyle = hexA(PAINT_RIM, steel ? 0.06 : 0.2);
  tctx.fillRect(x, y, w, h);
  tctx.fillStyle = steel ? 'rgba(200,220,245,0.6)' : hexA(shade(PAINT_RIM, 0.5), 0.95);
  tctx.fillRect(x, y, w, 2);
  if (!steel) {
    tctx.fillStyle = hexA(shade(PAINT_RIM, 0.2), 0.5);
    tctx.fillRect(x, y + 2, w, 1);
    tctx.fillStyle = hexA(PAINT_RIM, 0.18);
    tctx.fillRect(x, y + 3, w, 2);
  } else {
    tctx.fillStyle = hexA(PAINT_RIM, 0.4);
    tctx.fillRect(x, y, 2, h);
    tctx.fillRect(x + w - 2, y, 2, h);
    for (let sy = y + 8; sy < y + h - 4; sy += 14) { tctx.fillStyle = 'rgba(200,220,245,0.18)'; tctx.fillRect(x + 2, sy, w - 4, 2); }
  }
  tctx.fillStyle = 'rgba(0,0,0,0.45)';
  tctx.fillRect(x, y + h - 2, w, 2);
  if (steel) {
    tctx.strokeStyle = 'rgba(0,0,0,0.5)'; tctx.lineWidth = 2;
    tctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    for (let bx = x + 8; bx < x + w - 4; bx += 24) { tctx.fillStyle = 'rgba(255,255,255,0.14)'; tctx.fillRect(bx, y + 5, 3, 3); }
  }
  const v = steel ? 2 : 1;
  for (let yy = y; yy < y + h; yy++) {
    if (yy < 0 || yy >= LH) continue;
    MASK.fill(v, yy * LW + Math.max(0, x), yy * LW + Math.min(LW, x + w));
  }
}
function roughEdge(x, y, w, h) {
  // chew the cut line so destruction looks worked, and leave a hot edge
  srand((x * 31 + y * 57) >>> 0);
  for (let i = 0; i < 10; i++) {
    const ex2 = x + rng(0, w), ey2 = y + rng(0, h);
    tctx.clearRect(ex2 - 3, ey2 - 3, rng(3, 8), rng(3, 8));
  }
  tctx.fillStyle = hexA(shade(PAINT_RIM, 0.5), 0.55);
  tctx.fillRect(x, y + h - 1, w, 1);
  tctx.fillRect(x, y, 1, h); tctx.fillRect(x + w - 1, y, 1, h);
  // debris chunks come to rest below
  tctx.fillStyle = 'rgba(96,86,74,0.75)';
  for (let i = 0; i < 6; i++) { const cw2 = rng(2, 5) | 0; tctx.fillRect(x + rng(0, w) | 0, (y + h + rng(2, 14)) | 0, cw2, cw2); }
}
function carveRect(x, y, w, h) {
  x |= 0; y |= 0;
  tctx.clearRect(x, y, w, h);
  roughEdge(x, y, w, h);
  for (let yy = Math.max(0, y); yy < Math.min(LH, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(LW, x + w); xx++)
      if (MASK[yy * LW + xx] === 1) { MASK[yy * LW + xx] = 0; }
      else if (MASK[yy * LW + xx] === 2) { /* steel resists */ redrawSteelPixel(xx, yy); }
}
function carveCircle(cx, cy, r) {
  cx |= 0; cy |= 0; r |= 0;
  tctx.save();
  tctx.beginPath(); tctx.arc(cx, cy, r, 0, 7); tctx.clip();
  tctx.clearRect(cx - r, cy - r, r * 2, r * 2);
  tctx.restore();
  for (let yy = Math.max(0, cy - r); yy < Math.min(LH, cy + r); yy++)
    for (let xx = Math.max(0, cx - r); xx < Math.min(LW, cx + r); xx++) {
      if ((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) > r * r) continue;
      if (MASK[yy * LW + xx] === 1) MASK[yy * LW + xx] = 0;
      else if (MASK[yy * LW + xx] === 2) redrawSteelPixel(xx, yy);
    }
}
function redrawSteelPixel(x, y) {
  tctx.fillStyle = '#2a3242';
  tctx.fillRect(x, y, 1, 1);
}
function buildBrick(x, y, dir, color) {
  const bw = 10, bh = 4;
  const bx = dir > 0 ? x : x - bw;
  tctx.fillStyle = shade(color, 0.25);
  tctx.fillRect(bx | 0, (y - bh) | 0, bw, bh);
  tctx.fillStyle = hexA('#ffffff', 0.5);
  tctx.fillRect(bx | 0, (y - bh) | 0, bw, 1.5);
  for (let yy = Math.max(0, y - bh) | 0; yy < Math.min(LH, y) | 0; yy++)
    for (let xx = Math.max(0, bx) | 0; xx < Math.min(LW, bx + bw) | 0; xx++)
      if (MASK[yy * LW + xx] === 0) MASK[yy * LW + xx] = 1;
}

// ---------- levels ----------
const SKILLS = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'];
const SKILL_KEY = { climber: 'C', floater: 'F', bomber: 'O', blocker: 'K', builder: 'B', basher: 'H', miner: 'M', digger: 'D' };
const SKILL_COL = { climber: '#3dffc8', floater: '#5fd4ff', bomber: '#ff4545', blocker: '#ff2ee6', builder: '#ffd12a', basher: '#ff8c42', miner: '#b06bff', digger: '#aaff4d' };
const LEVELS = [
  {
    name: 'JUST DIG', rim: '#33d6ff', earth: '#3a4252', time: 100,
    total: 10, quota: 8, rate: 1.6,
    hatch: [300, 118], exit: [1100, 252],
    pool: { digger: 3 },
    paint: () => {
      paintRect(60, 160, 1480, 44, '#3a4252');           // upper deck
      paintRect(60, 100, 18, 104, '#3a4252', true);      // steel end walls
      paintRect(1522, 100, 18, 104, '#3a4252', true);
      paintRect(60, 260, 1480, 70, '#3a4252');           // lower floor, a survivable drop below
      paintRect(60, 204, 18, 126, '#3a4252', true);
      paintRect(1522, 204, 18, 126, '#3a4252', true);
    },
    solution: [{ t: 24.5, skill: 'digger', at: { x0: 1040, x1: 1140 } }],
  },
  {
    name: 'BRIDGE THE GAP', rim: '#ffd12a', earth: '#4c4030', time: 110,
    total: 10, quota: 8, rate: 1.6,
    hatch: [240, 358], exit: [1330, 392],
    pool: { builder: 3, blocker: 1, bomber: 1 },
    paint: () => {
      paintRect(80, 400, 640, 60, '#4c4030');            // left shelf
      paintRect(80, 340, 18, 120, '#4c4030', true);
      paintRect(780, 400, 660, 60, '#4c4030');           // right shelf (60px gap: a 12-brick bridge, no slack)
      paintRect(1442, 340, 18, 120, '#4c4030', true);
      // the pit floor far below: a fall from the shelves is lethal
      paintRect(60, 540, 1480, 30, '#4c4030');
    },
    solution: [
      { t: 4.0, skill: 'blocker', at: { n: 1 } },
      { t: 15, skill: 'builder', at: { x0: 710, x1: 719 } },
      { t: 42, skill: 'bomber', at: { state: 'blocker' } },
    ],
  },
  {
    name: 'BLOCK AND BASH', rim: '#aaff4d', earth: '#40502e', time: 110,
    total: 12, quota: 9, rate: 1.4,
    hatch: [200, 358], exit: [1300, 497],
    pool: { basher: 2, blocker: 1, bomber: 1, miner: 1 },
    paint: () => {
      paintRect(80, 400, 700, 60, '#40502e');            // upper walk
      paintRect(80, 260, 18, 200, '#40502e', true);
      paintRect(640, 240, 70, 160, '#40502e');           // the wall
      paintRect(80, 505, 1380, 60, '#40502e');           // lower floor
      paintRect(1442, 380, 18, 190, '#40502e', true);
      paintRect(760, 400, 120, 60, '#40502e');           // ledge after wall
      paintRect(880, 340, 18, 120, '#40502e', true);      // dead end at ledge height: dig or bounce forever
    },
    solution: [
      { t: 4.5, skill: 'blocker', at: { n: 1 } },
      { t: 13.5, skill: 'basher', at: { x0: 626, x1: 639 } },
      { t: 20, skill: 'miner', at: { x0: 780, x1: 850, dir: 1 } },
      { t: 44, skill: 'bomber', at: { state: 'blocker' } },
    ],
  },
  {
    name: 'HIGH DIVE', rim: '#5fd4ff', earth: '#36455a', time: 110,
    total: 10, quota: 8, rate: 1.8,
    hatch: [260, 78], exit: [1240, 492],
    pool: { floater: 10 },
    paint: () => {
      paintRect(160, 120, 380, 40, '#36455a');           // diving board
      paintRect(160, 40, 18, 120, '#36455a', true);
      paintRect(80, 500, 1380, 70, '#36455a');           // distant floor
      paintRect(80, 420, 18, 150, '#36455a', true);
      paintRect(1442, 420, 18, 150, '#36455a', true);
    },
    solution: Array.from({ length: 10 }, (_, i) => ({ t: 1.0 + i * 1.8, skill: 'floater', at: { n: i } })),
  },
  {
    name: 'THE ASCENT', rim: '#ff2ee6', earth: '#4a3050', time: 150,
    total: 10, quota: 9, rate: 1.2,
    hatch: [200, 398], exit: [1330, 282],
    pool: { climber: 10, builder: 2, blocker: 1, bomber: 1 },
    paint: () => {
      paintRect(80, 440, 560, 60, '#4a3050');            // start shelf
      paintRect(80, 340, 18, 160, '#4a3050', true);
      paintRect(80, 340, 34, 12, '#4a3050', true);       // overhang lip: climbers get knocked back down
      paintRect(700, 440, 400, 60, '#4a3050');           // far shelf, 60px gap
      paintRect(1100, 310, 60, 190, '#4a3050');          // the tower
      paintRect(1100, 290, 400, 40, '#4a3050');          // summit ledge to exit
      paintRect(1482, 230, 18, 100, '#4a3050', true);
    },
    solution: [
      { t: 2.5, skill: 'blocker', at: { n: 1 } },
      { t: 13, skill: 'builder', at: { x0: 630, x1: 639 } },
      { t: 27, skill: 'bomber', at: { state: 'blocker' } },
      ...Array.from({ length: 10 }, (_, i) => ({ t: 1.2 + i * 1.8, skill: 'climber', at: { n: i } })),
    ],
  },
];

// ---------- game state ----------
let G = null;
const keys = {};
let mouse = { x: 0, y: 0, down: false, clicked: false };

function newGame(seed, attract) {
  srand(seed);
  G = {
    mode: 'play', modeT: 0, time: 0, attract: !!attract, showTitle: !!attract,
    level: 0, saved: 0, out: 0, spawned: 0, dead: 0,
    lings: [], parts: [], pops: [],
    cam: 0, selSkill: 'digger', pool: {},
    levelTime: 0, spawnT: 0.5, hintT: 8, nuked: false,
  };
  loadLevel(0);
}
function loadLevel(li) {
  const L = LEVELS[li];
  srand(9000 + li * 61);
  tctx.clearRect(0, 0, LW, LH);
  MASK = new Uint8Array(LW * LH);
  PAINT_RIM = L.rim;
  L.paint();
  G.level = li;
  G.lings = []; G.parts = []; G.pops = [];
  G.saved = 0; G.spawned = 0; G.dead = 0;
  G.pool = { ...L.pool };
  G.levelTime = L.time;
  G.spawnT = 0.8;
  G.cam = clamp(L.hatch[0] - VW / 2, 0, LW - VW);
  G.selSkill = SKILLS.find(s => (G.pool[s] || 0) > 0) || 'digger';
  G.mode = 'play'; G.modeT = 0;
  G.levelClock = 0;
}
function makeLing() {
  const L = LEVELS[G.level];
  return {
    x: L.hatch[0], y: L.hatch[1] + 6, dir: 1, vy: 0,
    state: 'faller', fallFrom: L.hatch[1], t: 0,
    climber: false, floater: false, bomberT: -1,
    bricks: 0, workT: 0, id: G.spawned,
    spawnT: 0.2, squashT: 0, saveT: 0,
  };
}

// ---------- lemming physics ----------
const WALK = 32, FALL = 96, FLOAT = 42, SPLAT = 115;   // FALL = 3×WALK, max survivable fall ≈ 1.2s (canon ratios)
function groundAt(l) { return solidAt(l.x, l.y + 1) || solidAt(l.x - 2, l.y + 1) || solidAt(l.x + 2, l.y + 1); }
function blockerBounce(l) {
  for (const o of G.lings) {
    if (o.state === 'blocker' && o !== l && Math.abs(o.x - l.x) < 7 && Math.abs(o.y - l.y) < 12) {
      if ((l.x < o.x && l.dir > 0) || (l.x > o.x && l.dir < 0)) l.dir *= -1;
    }
  }
}
function simLing(l, dt) {
  l.t += dt;
  if (l.spawnT > 0) l.spawnT -= dt;
  if (l.squashT > 0) l.squashT -= dt;
  if (l.bomberT >= 0) {
    l.bomberT -= dt;
    if (l.bomberT <= 0.7 && l.state !== 'ohno' && l.state !== 'faller' && l.state !== 'climbing') {
      l.state = 'ohno';           // stop, hands on head: oh no
      SFX.oh();
    }
    if (l.bomberT <= 0) {
      // pop: crater + gone
      carveCircle(l.x, l.y - 2, 26);
      // scorch halo baked into the terrain
      tctx.save();
      const sg = tctx.createRadialGradient(l.x, l.y - 2, 20, l.x, l.y - 2, 42);
      sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      tctx.fillStyle = sg;
      tctx.beginPath(); tctx.arc(l.x, l.y - 2, 42, 0, 7); tctx.fill();
      tctx.restore();
      addBoom(l.x, l.y - 4);
      G.shake = 7;
      SFX.pop();
      l.state = 'dead';
      G.dead++;
      return;
    }
  }
  switch (l.state) {
    case 'faller': {
      const vy = l.floater && (l.y - l.fallFrom) > 24 ? FLOAT : FALL;
      l.y += vy * dt;
      if (groundAt(l)) {
        l.y = Math.round(l.y);
        while (groundAt(l) && solidAt(l.x, l.y)) l.y--;
        const fell = l.y - l.fallFrom;
        if (fell > SPLAT && !l.floater) {
          l.state = 'dead'; G.dead++;
          SFX.splat();
          G.shake = Math.max(G.shake || 0, 4);
          addSplat(l.x, l.y);
          bakeSmear(l.x, l.y);
        } else { l.state = 'walker'; if (fell > 40) l.squashT = 0.12; }
      }
      break;
    }
    case 'walker': {
      if (!groundAt(l)) { l.state = 'faller'; l.fallFrom = l.y; break; }
      blockerBounce(l);
      const nx = l.x + l.dir * WALK * dt;
      // step logic: up to 5px up, else wall
      let ny = l.y;
      let blocked = false;
      if (solidAt(nx + l.dir * 2, ny - 2)) {
        let step = 0;
        while (step < 9 && solidAt(nx + l.dir * 2, ny - 2 - step)) step++;
        if (step < 9) ny -= step;
        else blocked = true;
      } else {
        // walk down small slopes
        let drop = 0;
        while (drop < 4 && !solidAt(nx, ny + 1 + drop)) drop++;
        if (drop < 4) ny += drop;
      }
      if (blocked) {
        if (l.climber) { l.state = 'climbing'; break; }
        l.dir *= -1;
      } else { l.x = nx; l.y = ny; }
      break;
    }
    case 'climbing': {
      const wx = l.x + l.dir * 3;
      if (!solidAt(wx, l.y - 12)) {
        // top reached: pull up onto the surface
        l.x += l.dir * 4;
        l.y -= 12;
        let guard = 0;
        while (solidAt(l.x, l.y) && guard++ < 30) l.y--;
        l.state = 'walker';
        break;
      }
      if (solidAt(l.x, l.y - 12)) {      // overhang: bonk — fall away from the wall, turned around (canon)
        l.dir *= -1;
        l.x += l.dir * 3;
        l.state = 'faller'; l.fallFrom = l.y;
        break;
      }
      l.y -= 32 * dt;
      break;
    }
    case 'blocker': {
      if (!groundAt(l)) { l.state = 'faller'; l.fallFrom = l.y; G.released = (G.released || 0) + 1; }
      break;
    }
    case 'ohno': {
      if (!groundAt(l)) { l.state = 'faller'; l.fallFrom = l.y; }
      break;
    }
    case 'builder': {
      l.workT += dt;
      if (l.workT > 0.55) {
        l.workT = 0;
        buildBrick(l.x + l.dir * 4, l.y + 1, l.dir, LEVELS[G.level].rim);
        l.x += l.dir * 6;
        l.y -= 3;
        l.bricks++;
        if (l.bricks > 9) SFX.tick(); else SFX.build();      // the last three bricks clink a warning
        if (solidAt(l.x + l.dir * 6, l.y - 8)) { l.dir *= -1; l.state = 'walker'; l.bricks = 0; }  // head-bump: turn back
        else if (l.bricks >= 12) { l.state = 'walker'; l.bricks = 0; }
      }
      break;
    }
    case 'basher': {
      blockerBounce(l);
      l.workT += dt;
      if (l.workT > 0.4) {
        l.workT = 0;
        if (maskAt(l.x + l.dir * 8, l.y - 6) === 2) { l.state = 'walker'; break; }  // steel resists
        const biting = solidAt(l.x + l.dir * 10, l.y - 6) || solidAt(l.x + l.dir * 16, l.y - 6);
        if (biting) {
          carveRect(l.x + l.dir * (l.dir > 0 ? 2 : 22), l.y - 17, 20, 16);
          addChips(l.x + l.dir * 10, l.y - 8, LEVELS[G.level].earth);
          SFX.bash();
          l.x += l.dir * 7;
        } else { l.state = 'walker'; }      // one empty stroke, then back to walking
        if (!groundAt(l)) { l.state = 'faller'; l.fallFrom = l.y; }
      }
      break;
    }
    case 'miner': {
      blockerBounce(l);
      l.workT += dt;
      if (l.workT > 0.45) {
        l.workT = 0;
        if (maskAt(l.x + l.dir * 8, l.y + 2) === 2) { l.state = 'walker'; break; }  // steel stops the pick
        // bore centered at foot level: no floor slivers survive under the tunnel
        carveCircle(l.x + l.dir * 8, l.y - 2, 14);
        addChips(l.x + l.dir * 8, l.y, LEVELS[G.level].earth);
        SFX.dig();
        l.x += l.dir * 5;
        l.y += 5;
        let open = true;
        for (let dy2 = 1; dy2 <= 14; dy2++) if (solidAt(l.x, l.y + dy2)) { open = false; break; }
        if (open) { l.state = 'faller'; l.fallFrom = l.y; }   // genuinely nothing below: break through
      }
      break;
    }
    case 'digger': {
      l.workT += dt;
      if (l.workT > 0.42) {
        l.workT = 0;
        if (maskAt(l.x, l.y + 3) === 2) { l.state = 'walker'; break; }
        carveRect(l.x - 11, l.y - 1, 22, 9);
        addChips(l.x, l.y + 4, LEVELS[G.level].earth);
        SFX.dig();
        l.y += 7;
        if (!solidAt(l.x - 6, l.y + 2) && !solidAt(l.x + 6, l.y + 2) && !solidAt(l.x, l.y + 2)) {
          l.state = 'faller'; l.fallFrom = l.y;
        }
      }
      break;
    }
  }
  // exit check
  const [ex, ey] = LEVELS[G.level].exit;
  if (l.state === 'walker' && groundAt(l) && Math.abs(l.x - ex) < 12 && Math.abs(l.y - ey) < 24) {
    l.state = 'saving'; l.saveT = 0;
    G.saved++;
    SFX.exit();
    addSparkle(ex, ey - 14, LEVELS[G.level].rim);
    G.parts.push({ kind: 'flash', x: ex, y: ey - 14, r: 52, color: LEVELS[G.level].rim, life: 0.25, t: 0 });
    addPop(ex, ey - 42, '+1', LEVELS[G.level].rim);
  }
  if (l.y > LH + 20) { l.state = 'dead'; G.dead++; }
}
function assignSkill(l, skill) {
  if ((G.pool[skill] || 0) <= 0) return false;
  if (l.state === 'dead' || l.state === 'saved' || l.state === 'saving') return false;
  let ok = false;
  if (skill === 'climber' && !l.climber) { l.climber = true; ok = true; }
  else if (skill === 'floater' && !l.floater) { l.floater = true; ok = true; }
  else if (skill === 'bomber' && l.bomberT < 0) { l.bomberT = 5; ok = true; }
  else if (skill === 'blocker' && (l.state === 'walker')) { l.state = 'blocker'; ok = true; }
  else if (skill === 'builder' && l.state === 'walker') { l.state = 'builder'; l.workT = 0; l.bricks = 0; ok = true; }
  else if (skill === 'basher' && l.state === 'walker') { l.state = 'basher'; l.workT = 0; ok = true; }
  else if (skill === 'miner' && l.state === 'walker') { l.state = 'miner'; l.workT = 0; ok = true; }
  else if (skill === 'digger' && l.state === 'walker') { l.state = 'digger'; l.workT = 0; ok = true; }
  if (ok) {
    if (G.events) G.events.push({ t: Math.round(G.levelClock * 10) / 10, skill, x: l.x | 0, id: l.id });
    G.pool[skill]--;
    SFX.assign();
    addPop(l.x, l.y - 20, skill.toUpperCase(), SKILL_COL[skill]);
  }
  return ok;
}

// ---------- particles ----------
function addChips(x, y, color) {
  for (let i = 0; i < 5; i++)
    G.parts.push({ kind: 'chip', x: x + rng(-8, 8), y: y + rng(-4, 4), vx: rng(-70, 70), vy: rng(-110, -20), color: shade(color, rng(-0.2, 0.3)), life: rng(0.3, 0.6), t: 0 });
}
function bakeSmear(x, y) {
  tctx.save();
  tctx.globalAlpha = 0.55;
  tctx.fillStyle = '#0d2a38';
  tctx.beginPath(); tctx.ellipse(x, y, 9, 2.5, 0, 0, 7); tctx.fill();
  tctx.fillStyle = '#2b90b8';
  srand((x * 13 + y * 7) >>> 0);
  for (let i = 0; i < 6; i++) tctx.fillRect((x + rng(-8, 8)) | 0, (y + rng(-3, 1)) | 0, 2, 1);
  tctx.restore();
}
function addBoom(x, y) {
  for (let i = 0; i < 10; i++) {
    G.parts.push({ kind: 'smoke', x: x + rng(-8, 8), y: y + rng(-8, 4), vx: rng(-20, 20), vy: rng(-45, -15), color: '#5a5a66', life: rng(0.6, 1.1), t: 0 });
  }
  for (let i = 0; i < 16; i++) {
    const a = rng(0, 6.28), s = rng(120, 320);
    G.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, color: i % 2 ? '#ffd12a' : '#ff8c42', life: rng(0.2, 0.45), t: 0 });
  }
  for (let i = 0; i < 14; i++) {
    const a = rng(0, Math.PI * 2), s = rng(90, 420);
    G.parts.push({ kind: 'chip', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, color: i % 2 ? '#ff8c42' : '#ffd12a', life: rng(0.4, 0.8), t: 0 });
  }
  G.parts.push({ kind: 'flash', x, y, r: 70, color: '#ffffff', life: 0.2, t: 0 });
  G.parts.push({ kind: 'flash', x, y, r: 110, color: '#ff8c42', life: 0.3, t: 0 });
  G.parts.push({ kind: 'ring', x, y, r: 8, color: '#ff8c42', life: 0.3, t: 0 });
}
function addSplat(x, y) {
  for (let i = 0; i < 8; i++)
    G.parts.push({ kind: 'chip', x, y, vx: rng(-90, 90), vy: rng(-140, -20), color: '#5fd4ff', life: rng(0.3, 0.6), t: 0 });
}
function addSparkle(x, y, color) {
  for (let i = 0; i < 8; i++) {
    const a = rng(0, Math.PI * 2), s = rng(50, 200);
    G.parts.push({ kind: 'chip', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, color, life: rng(0.3, 0.55), t: 0 });
  }
  G.parts.push({ kind: 'flash', x, y, r: 36, color, life: 0.2, t: 0 });
}
function addPop(x, y, txt, color) { G.pops.push({ x, y, txt, color, t: 0, life: 0.9 }); }

// ---------- simulation ----------
function sim(dt) {
  G.time += dt; G.modeT += dt;
  if (G.paused && G.mode === 'play') { camTick(dt); return; }
  G.hintT = Math.max(0, G.hintT - dt);
  if (G.mode === 'won' || G.mode === 'lost') {
    tickFX(dt);
    return;
  }
  const L = LEVELS[G.level];
  G.levelClock += dt;
  G.levelTime -= dt;
  if (G.levelTime <= 10.2 && G.levelTime > 0 && ((G.levelTime | 0) !== ((G.levelTime + dt) | 0))) SFX.tick();
  // spawn
  if (G.spawned < L.total) {
    G.spawnT -= dt;
    if (G.spawnT <= 0) {
      G.spawnT = Math.max(0.5, L.rate * (G.rateBoost ? 0.4 : 1));
      G.lings.push(makeLing());
      G.spawned++;
      SFX.spawn();
    }
  }
  // replay authored solution
  if (G.replay) {
    for (const step of G.replay) {
      if (step.done || G.levelClock < step.t) continue;
      const cand = G.lings.filter(l => l.state !== 'dead' && l.state !== 'saved' && l.state !== 'saving');
      let target = null;
      if (step.at.n !== undefined) target = G.lings.find(l => l.id === step.at.n && l.state !== 'dead' && l.state !== 'saved');
      else if (step.at.state) target = cand.find(l => l.state === step.at.state);
      else target = cand.find(l => l.x >= step.at.x0 && l.x <= step.at.x1 && (step.at.dir === undefined || l.dir === step.at.dir) && (l.state === 'walker' || step.skill === 'bomber'));
      if (target && assignSkill(target, step.skill)) step.done = true;
      else if (G.levelClock > step.t + 14) step.done = true;   // give up rather than hang
    }
  }
  for (const l of G.lings) {
    if (l.state === 'saving') { l.saveT += dt; if (l.saveT > 0.3) l.state = 'saved'; continue; }
    if (l.state !== 'dead' && l.state !== 'saved') simLing(l, dt);
  }
  G.out = G.lings.filter(l => l.state !== 'dead' && l.state !== 'saved' && l.state !== 'saving').length;
  // end conditions
  const finished = (G.spawned >= L.total && G.out === 0) || (G.saved + G.dead >= L.total) || G.levelTime <= 0;
  if (finished && G.mode === 'play') {
    if (G.saved >= L.quota) {
      G.mode = 'won'; G.modeT = 0;
      SFX.win();
    } else {
      G.mode = 'lost'; G.modeT = 0;
      SFX.fail();
    }
  }
  tickFX(dt);
}
function tickFX(dt) {
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.t += dt;
    if (p.t >= p.life) { G.parts.splice(i, 1); continue; }
    if (p.kind === 'chip') { p.vy += 380 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    else if (p.kind === 'spark') { p.vy += 120 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    else if (p.kind === 'smoke') { p.vy -= 30 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    else if (p.kind === 'ring') p.r += 380 * dt;
  }
  for (let i = G.pops.length - 1; i >= 0; i--) { const o = G.pops[i]; o.t += dt; o.y -= 30 * dt; if (o.t >= o.life) G.pops.splice(i, 1); }
  if (G.shake > 0) G.shake = Math.max(0, G.shake - 26 * dt);
  camTick(dt);
}
function camTick(dt) {
  if (keys.ArrowLeft || keys.a) G.cam -= 420 * dt;
  if (keys.ArrowRight || keys.d) G.cam += 420 * dt;
  if (mouse.x < 30) G.cam -= 420 * dt;
  if (mouse.x > W - 30) G.cam += 420 * dt;
  G.cam = clamp(G.cam, 0, LW - VW);
}

// ---------- render ----------
const VIGNETTE = (() => {
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const x = c.getContext('2d'); x.scale(2, 2);
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.9);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,6,0.4)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return c;
})();
function draw() {
  const L = LEVELS[G.level];
  if (G.showTitle) { drawTitle(); return; }
  ctx.save();
  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, MQ, VW, VH); ctx.clip();
  ctx.translate(0, MQ);
  if (G.shake > 0) ctx.translate(Math.sin(G.time * 47) * G.shake, Math.cos(G.time * 61) * G.shake * 0.6);
  // backdrop: deep cavern gradient + accent haze
  const bg = ctx.createLinearGradient(0, 0, 0, VH);
  bg.addColorStop(0, '#0a0c16'); bg.addColorStop(1, '#06070d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VW, VH);
  srand(777 + G.level);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(200,220,255,${rng(0.05, 0.2)})`;
    const sx = (rng(0, LW) - G.cam * 0.4 % LW + LW) % LW;
    ctx.fillRect(sx, rng(0, VH), 1.5, 1.5);
  }
  // parallax silhouette strata behind the level
  srand(555 + G.level);
  for (const [par, lum, n2] of [[0.2, 0.05, 10], [0.45, 0.09, 7]]) {
    ctx.save();
    ctx.translate(-G.cam * par, 0);
    ctx.fillStyle = hexA(L.rim, lum);
    ctx.beginPath();
    for (let i = 0; i < n2; i++) {
      const bx = rng(0, LW), bw2 = rng(70, 240), bh2 = rng(120, 420);
      ctx.rect(bx, VH - bh2, bw2, bh2);                        // towers rising through the sky
      ctx.rect(bx + bw2 * 0.3, VH - bh2 - rng(15, 50), bw2 * 0.4, 30);
      const sx2 = rng(0, LW), sw2 = rng(30, 90);
      ctx.rect(sx2, 0, sw2, rng(24, 90));                      // stalactite masses from the ceiling
      ctx.rect(sx2 + sw2 * 0.3, 0, sw2 * 0.4, rng(60, 140));
    }
    ctx.fill();   // one path: overlaps merge instead of double-brightening
    ctx.fillStyle = hexA(L.rim, lum * 5);
    srand(777 + G.level * 3 + (par * 100 | 0));
    for (let i = 0; i < 5; i++) ctx.fillRect(rng(0, LW) | 0, (VH - rng(150, 380)) | 0, 2, 2);
    ctx.restore();
  }
  // haze band across the midfield
  const hz2 = ctx.createLinearGradient(0, VH * 0.35, 0, VH * 0.75);
  hz2.addColorStop(0, 'rgba(0,0,0,0)'); hz2.addColorStop(0.5, hexA(L.rim, 0.035)); hz2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hz2;
  ctx.fillRect(0, VH * 0.35, VW, VH * 0.4);
  ctx.translate(-G.cam, 0);
  const hz = ctx.createRadialGradient(LW / 2, VH / 2, 100, LW / 2, VH / 2, 900);
  hz.addColorStop(0, hexA(L.rim, 0.05)); hz.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hz;
  ctx.fillRect(0, 0, LW, VH);
  // fog rising from every surface
  const fg = ctx.createLinearGradient(0, VH - 220, 0, VH);
  fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, hexA(L.rim, 0.14));
  ctx.fillStyle = fg;
  ctx.fillRect(0, VH - 220, LW, 220);
  // terrain
  ctx.drawImage(terrC, 0, 0);
  // hatch
  drawHatch(L);
  drawExit(L);
  // light pools: the world is lit by its inhabitants
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of G.lings) {
    if (l.state === 'dead' || l.state === 'saved') continue;
    const lp = ctx.createRadialGradient(l.x, l.y - 4, 0, l.x, l.y - 4, 64);
    lp.addColorStop(0, hexA('#5fd4ff', 0.13)); lp.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lp;
    ctx.beginPath(); ctx.arc(l.x, l.y - 4, 64, 0, 7); ctx.fill();
  }
  const hpool = ctx.createRadialGradient(L.hatch[0], L.hatch[1] + 20, 0, L.hatch[0], L.hatch[1] + 20, 130);
  hpool.addColorStop(0, hexA(L.rim, 0.16)); hpool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hpool;
  ctx.beginPath(); ctx.arc(L.hatch[0], L.hatch[1] + 20, 130, 0, 7); ctx.fill();
  const xpulse = 0.7 + Math.sin(G.time * 3) * 0.3;
  const xpool = ctx.createRadialGradient(L.exit[0], L.exit[1] - 10, 0, L.exit[0], L.exit[1] - 10, 170);
  xpool.addColorStop(0, hexA(L.rim, 0.2 * xpulse)); xpool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = xpool;
  ctx.beginPath(); ctx.arc(L.exit[0], L.exit[1] - 10, 170, 0, 7); ctx.fill();
  ctx.restore();
  for (const l of G.lings) drawLing(l);
  drawParticles();
  drawPops();
  ctx.restore();
  drawMarquee(L);
  drawHUD(L);
  if (G.mode === 'play' && !G.attract && mouse.y > MQ && mouse.y < H - HUD_H) {
    const wx = mouse.x + G.cam, wy = mouse.y - MQ;
    let best = null, bd = 24;
    for (const l of G.lings) {
      if (l.state === 'dead' || l.state === 'saved') continue;
      const d = Math.hypot(l.x - wx, l.y - 8 - wy);
      if (d < bd) { bd = d; best = l; }
    }
    const canSpend = (G.pool[G.selSkill] || 0) > 0;
    ctx.save();
    ctx.translate(0, MQ);
    ctx.translate(-G.cam, 0);
    if (best && canSpend) {
      ctx.strokeStyle = hexA(SKILL_COL[G.selSkill], 0.9);
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.lineDashOffset = -G.time * 30;
      ctx.beginPath(); ctx.arc(best.x, best.y - 10, 18, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (canSpend) {
      ctx.fillStyle = hexA(SKILL_COL[G.selSkill], 0.9);
      ctx.beginPath(); ctx.arc(wx + 12, wy + 12, 3, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  if (G.mode === 'won') {
    banner('THEY MADE IT', L.rim, `RESCUED ${G.saved} OF ${LEVELS[G.level].total} · QUOTA WAS ${LEVELS[G.level].quota}`);
    for (let i = 0; i < Math.min(G.saved, 12); i++) {
      const px2 = ((i * 111.7 + G.time * 40) % (W + 60)) - 30;
      const ph2 = px2 * 0.55 + i * 2.4;
      const wob2 = Math.sin(ph2) * 2.2;
      ctx.save();
      ctx.translate(px2, H / 2 + 52);
      ctx.scale(2, 2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gp = ctx.createRadialGradient(0, -8, 0, 0, -8, 16);
      gp.addColorStop(0, hexA('#3dffc8', 0.25)); gp.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gp;
      ctx.beginPath(); ctx.arc(0, -8, 16, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#1f8fc0';
      ctx.beginPath(); ctx.roundRect(-3.5, -10, 7, 10, 2.5); ctx.fill();
      ctx.fillStyle = '#e8f4ff';
      ctx.beginPath(); ctx.arc(1, -12.5, 3.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#3dffc8';
      ctx.beginPath(); ctx.arc(1, -15, 2.4, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#c8e8ff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-1.5, -2); ctx.lineTo(-1.5 - wob2, 0.5); ctx.moveTo(1.5, -2); ctx.lineTo(1.5 + wob2, 0.5); ctx.stroke();
      ctx.strokeStyle = '#a8d4f0'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-1, -8); ctx.lineTo(-1 + wob2 * 0.7, -4.5); ctx.moveTo(1, -8); ctx.lineTo(1 - wob2 * 0.7, -4.5); ctx.stroke();
      ctx.restore();
    }
    bannerButton(G.level + 1 >= LEVELS.length ? 'FINISH  ·  SPACE' : 'NEXT LEVEL  ·  SPACE', L.rim);
  }
  if (G.mode === 'lost') {
    banner('TOO FEW SAVED', '#ff4545', `SAVED ${G.saved} — NEEDED ${L.quota}`);
    // the ones you failed: slumped, glow guttering
    for (let i = 0; i < 6; i++) {
      const px2 = W / 2 - 330 + i * 132;
      const gutter = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(G.time * 7 + i * 1.7)) * (0.6 + 0.4 * Math.sin(G.time * 23 + i * 3.1));
      ctx.save();
      ctx.translate(px2, H / 2 + 56);
      ctx.scale(2.2, 2.2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gp2 = ctx.createRadialGradient(0, -6, 0, 0, -6, 14);
      gp2.addColorStop(0, hexA('#ff4545', 0.1 * gutter)); gp2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gp2;
      ctx.beginPath(); ctx.arc(0, -6, 14, 0, 7); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = gutter;
      ctx.rotate(i % 2 ? 0.55 : -0.45);
      ctx.fillStyle = '#1a6d94';
      ctx.beginPath(); ctx.roundRect(-3.5, -8, 7, 9, 2.5); ctx.fill();
      ctx.fillStyle = '#d8ecfa';
      ctx.beginPath(); ctx.arc(1, -10, 3.4, 0, 7); ctx.fill();
      ctx.strokeStyle = '#9cc4dc'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-1.5, 1); ctx.lineTo(-4, 3); ctx.moveTo(1.5, 1); ctx.lineTo(4, 2.5); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    bannerButton('RETRY  ·  SPACE', '#ff4545');
  }
  ctx.restore();
  ctx.drawImage(VIGNETTE, 0, 0, W, H);
}
function drawHatch(L) {
  const [hx, hy] = L.hatch;
  const open = G.spawned < L.total;
  ctx.save();
  // downlight shaft — always lit, dimmer once the door is spent
  ctx.globalCompositeOperation = 'lighter';
  const sg = ctx.createLinearGradient(0, hy - 8, 0, hy + 70);
  sg.addColorStop(0, hexA(L.rim, open ? 0.24 : 0.08)); sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(hx - 12, hy - 6); ctx.lineTo(hx + 12, hy - 6); ctx.lineTo(hx + 26, hy + 70); ctx.lineTo(hx - 26, hy + 70);
  ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // housing
  const hg = ctx.createLinearGradient(0, hy - 34, 0, hy);
  hg.addColorStop(0, '#2a3242'); hg.addColorStop(1, '#161c28');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(hx - 28, hy - 4); ctx.lineTo(hx - 16, hy - 30); ctx.lineTo(hx + 16, hy - 30); ctx.lineTo(hx + 28, hy - 4);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = hexA(L.rim, 0.9); ctx.lineWidth = 2.5;
  ctx.shadowColor = L.rim; ctx.shadowBlur = 12;
  ctx.stroke();
  // animated iris
  const iris = open ? 0.5 + Math.sin(G.time * 4) * 0.35 : 0.08;
  ctx.shadowBlur = 0;
  ctx.fillStyle = hexA(L.rim, iris);
  ctx.beginPath(); ctx.ellipse(hx, hy - 8, 12, 6 * (open ? 1 : 0.3), 0, 0, 7); ctx.fill();
  ctx.restore();
}
function drawExit(L) {
  const [ex, ey] = L.exit;
  const pulse = 0.6 + Math.sin(G.time * 5) * 0.4;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(ex, ey - 14, 0, ex, ey - 14, 46);
  g.addColorStop(0, hexA(L.rim, 0.35 * pulse)); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(ex, ey - 14, 46, 0, 7); ctx.fill();
  ctx.restore();
  ctx.save();
  // portal interior with rising drift
  const ig = ctx.createLinearGradient(0, ey - 38, 0, ey);
  ig.addColorStop(0, hexA(L.rim, 0.5)); ig.addColorStop(1, hexA(shade(L.rim, -0.25), 0.35));
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.moveTo(ex - 18, ey); ctx.lineTo(ex - 18, ey - 26); ctx.arc(ex, ey - 26, 18, Math.PI, 0); ctx.lineTo(ex + 18, ey);
  ctx.closePath(); ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const py2 = ey - ((G.time * 26 + i * 17) % 44);
    ctx.fillStyle = hexA('#ffffff', 0.35 * (1 - (ey - py2) / 44));
    ctx.fillRect(ex - 12 + (i * 7) % 24, py2, 2, 4);
  }
  ctx.restore();
  ctx.strokeStyle = hexA(L.rim, 0.95);
  ctx.lineWidth = 3.5;
  ctx.shadowColor = L.rim; ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(ex - 18, ey); ctx.lineTo(ex - 18, ey - 26); ctx.arc(ex, ey - 26, 18, Math.PI, 0); ctx.lineTo(ex + 18, ey);
  ctx.stroke();
  // ground pulse pad
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = hexA(L.rim, 0.32 * (0.6 + Math.sin(G.time * 3) * 0.4));
  ctx.beginPath(); ctx.ellipse(ex, ey + 2, 30, 6, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function drawLing(l) {
  if (l.state === 'dead' || l.state === 'saved') return;
  ctx.save();
  ctx.translate(l.x + (l.state === 'ohno' ? Math.sin(l.t * 55) * 1.4 : 0), l.y);
  ctx.scale(1.5, 1.5);
  if (l.state === 'saving') {                       // absorbed into the exit: shrink, rise, streak
    const k = 1 - Math.min(1, l.saveT / 0.3);
    ctx.globalAlpha = k;
    ctx.translate(0, -14 * (1 - k));
    ctx.scale(k, k + 0.3 * (1 - k));
  }
  if (l.spawnT > 0) ctx.scale(0.7 + 0.3 * (1 - l.spawnT / 0.2), 1.3 - 0.3 * (1 - l.spawnT / 0.2));
  if (l.squashT > 0) { const s2 = l.squashT / 0.12 * 0.28; ctx.scale(1 + s2, 1 - s2); }
  // glow
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const col = l.state === 'blocker' ? SKILL_COL.blocker : l.bomberT >= 0 ? '#ff4545' : '#5fd4ff';
  const gl = ctx.createRadialGradient(0, -8, 0, 0, -8, 18);
  gl.addColorStop(0, hexA(col, 0.35)); gl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(0, -8, 18, 0, 7); ctx.fill();
  ctx.restore();
  const phase = l.x * 0.55 + l.id * 2.39;               // stride keyed to ground covered: feet plant
  const wob = (l.state === 'walker') ? Math.sin(phase) * 2.6 : 0;
  const bob = (l.state === 'walker') ? Math.abs(Math.sin(phase)) * 2.2 : 0;
  if (l.state === 'walker') ctx.rotate(l.dir * 0.14);   // lean into the walk
  if (l.state === 'builder') { ctx.rotate(l.dir * 0.3); ctx.translate(0, 2); }  // kneeling at the brickwork
  if (l.state === 'digger') { ctx.scale(1, 0.85); ctx.translate(0, 1); }        // crouched over the shovel
  if (l.state === 'miner') ctx.rotate(l.dir * 0.28);                            // leaning into the pick
  if (l.state === 'climbing') ctx.translate(l.dir * 2, 0);                      // hugging the wall
  // body
  ctx.fillStyle = '#1f8fc0';
  ctx.beginPath(); ctx.roundRect(-3.5, -10 + bob * 0.4, 7, 10 - bob * 0.4, 2.5); ctx.fill();
  // head + neon hair, offset to the facing side
  ctx.fillStyle = '#e8f4ff';
  ctx.beginPath(); ctx.arc(l.dir * 1.2, -12.5 + bob * 0.3, 3.6, 0, 7); ctx.fill();
  // facing eye
  ctx.fillStyle = '#0a2030';
  ctx.beginPath(); ctx.arc(l.dir * 2.8, -12.7, 1.0, 0, 7); ctx.fill();
  ctx.save();
  ctx.shadowColor = '#3dffc8'; ctx.shadowBlur = 6;
  ctx.fillStyle = '#3dffc8';
  ctx.beginPath(); ctx.arc(l.dir * 1.0, -15 + bob * 0.3, 2.4, Math.PI, 0); ctx.fill();
  ctx.restore();
  // striding legs, opposed
  ctx.strokeStyle = '#c8e8ff'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-1.5, -2); ctx.lineTo(-1.5 - wob, 0.5);
  ctx.moveTo(1.5, -2); ctx.lineTo(1.5 + wob, 0.5);
  ctx.stroke();
  // arms: every state holds a pose
  ctx.strokeStyle = '#a8d4f0'; ctx.lineWidth = 2.1;
  ctx.beginPath();
  if (l.state === 'walker') {
    ctx.moveTo(-1, -8); ctx.lineTo(-1 + wob * 0.7, -4.5);
    ctx.moveTo(1, -8); ctx.lineTo(1 - wob * 0.7, -4.5);
  } else if (l.state === 'faller' && !(l.floater && (l.y - l.fallFrom) > 24)) {
    const fl = Math.sin(l.t * 30) * 1.5;
    ctx.moveTo(-1, -8); ctx.lineTo(-4 - fl, -13);
    ctx.moveTo(1, -8); ctx.lineTo(4 + fl, -13);
  } else if (l.state === 'climbing') {
    const grip = Math.sin(l.t * 12) > 0 ? 1 : 0;
    ctx.moveTo(1, -9); ctx.lineTo(l.dir * 4.5, -13 - grip * 3);
    ctx.moveTo(0, -6); ctx.lineTo(l.dir * 4.5, -3 - (1 - grip) * 3);
  } else if (l.state === 'digger') {
    const dg = Math.sin(l.t * 14) * 2;
    ctx.moveTo(-1, -7); ctx.lineTo(-2.5, -1 + dg);
    ctx.moveTo(1, -7); ctx.lineTo(2.5, -1 + dg);
  } else if (l.state === 'basher') {
    const sw = Math.sin(l.t * 15) * 3;
    ctx.moveTo(0, -7.5); ctx.lineTo(l.dir * (5 + sw * 0.6), -7 + sw);
  } else if (l.state === 'builder') {
    const lay = Math.abs(Math.sin(l.t * 11)) * 3;
    ctx.moveTo(0, -7); ctx.lineTo(l.dir * (3 + lay), -2 + lay * 0.5);
  } else if (l.state === 'miner') {
    const pk = Math.sin(l.t * 13) * 2.5;
    ctx.moveTo(0, -8); ctx.lineTo(l.dir * 6, -3 + pk);
  }
  ctx.stroke();
  // working badges: dust fountain / spark arc / ground stripe
  if (l.state === 'digger') {
    ctx.fillStyle = 'rgba(200,190,170,0.7)';
    for (let d2 = 0; d2 < 4; d2++) ctx.fillRect(-6 + ((l.id + d2 * 7 + (l.t * 30 | 0)) % 12), 2 - ((l.t * 40 + d2 * 9) % 14), 2, 2);
  }
  if (l.state === 'basher') {
    ctx.strokeStyle = hexA(SKILL_COL.basher, 0.85); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(l.dir * 8, -7, 6, l.dir > 0 ? -1 : Math.PI - 1, l.dir > 0 ? 1 : Math.PI + 1); ctx.stroke();
  }
  if (l.state === 'miner') {
    ctx.strokeStyle = hexA(SKILL_COL.miner, 0.9); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(l.dir * 7, 0, 6, l.dir > 0 ? 0.3 : Math.PI - 1.7, l.dir > 0 ? 1.7 : Math.PI - 0.3); ctx.stroke();
    ctx.fillStyle = 'rgba(200,190,170,0.7)';
    for (let d2 = 0; d2 < 3; d2++) ctx.fillRect(l.dir * (4 + ((l.id + d2 * 5 + (l.t * 26 | 0)) % 9)), 2 - ((l.t * 30 + d2 * 7) % 10), 2, 2);
  }
  if (l.state === 'ohno') {
    ctx.strokeStyle = '#ffd12a'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(-2, -16); ctx.moveTo(4, -8); ctx.lineTo(2, -16); ctx.stroke();
  }
  // state dressing
  if (l.state === 'blocker') {
    const bp = 0.6 + Math.sin(G.time * 6) * 0.4;
    ctx.strokeStyle = '#a8d4f0'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-3, -8); ctx.lineTo(-8.5, -8.5); ctx.moveTo(3, -8); ctx.lineTo(8.5, -8.5); ctx.stroke();
    ctx.strokeStyle = hexA(SKILL_COL.blocker, bp); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8.5, -11); ctx.lineTo(-8.5, -6); ctx.moveTo(8.5, -11); ctx.lineTo(8.5, -6); ctx.stroke();
    ctx.fillStyle = hexA(SKILL_COL.blocker, bp * 0.7);
    ctx.fillRect(-8, 1, 16, 1.5);
  }
  if (l.floater && l.state === 'faller' && (l.y - l.fallFrom) > 24) {
    // a real umbrella: canopy, ribs, handle
    ctx.strokeStyle = SKILL_COL.floater; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -24, 11, Math.PI, 0); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-11, -24); ctx.quadraticCurveTo(-5.5, -21, 0, -24); ctx.quadraticCurveTo(5.5, -21, 11, -24);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, -30); ctx.lineTo(-6, -24); ctx.moveTo(6, -30); ctx.lineTo(6, -24); ctx.moveTo(0, -35); ctx.lineTo(0, -24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(0, -16); ctx.stroke();
  }
  if (l.climber) {
    ctx.fillStyle = SKILL_COL.climber;
    ctx.fillRect(-4.5, -11, 2, 2.5);
  }
  if (l.state === 'builder') {
    ctx.fillStyle = SKILL_COL.builder;
    ctx.fillRect(l.dir * 4 - 2, -4, 5, 2.5);
  }
  if (l.bomberT >= 0) {
    ctx.font = `800 12px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.save();
    ctx.shadowColor = '#ff4545'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#ff4545';
    ctx.fillText(String(Math.ceil(l.bomberT)), 0, -21);
    ctx.restore();
  }
  ctx.restore();
}
function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.parts) {
    const k = 1 - p.t / p.life;
    if (p.kind === 'chip') {
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    } else if (p.kind === 'spark') {
      ctx.globalAlpha = k;
      ctx.strokeStyle = p.color; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
      ctx.stroke();
    } else if (p.kind === 'smoke') {
      ctx.globalAlpha = k * 0.4;
      ctx.fillStyle = p.color;
      const r2 = 4 + (1 - k) * 7;
      ctx.beginPath(); ctx.arc(p.x, p.y, r2, 0, 7); ctx.fill();
    } else if (p.kind === 'flash') {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = k * 0.9;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    } else if (p.kind === 'ring') {
      ctx.globalAlpha = k * 0.8;
      ctx.strokeStyle = p.color; ctx.lineWidth = 5 * k + 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
function drawPops() {
  for (const o of G.pops) {
    const k = o.t < o.life * 0.6 ? 1 : 1 - (o.t - o.life * 0.6) / (o.life * 0.4);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.globalAlpha = k;
    ctx.font = `800 11px ${MONO}`;
    ctx.textAlign = 'center';
    const tw = ctx.measureText(o.txt).width + 10;
    ctx.fillStyle = 'rgba(5,8,14,0.8)';
    ctx.beginPath(); ctx.roundRect(-tw / 2, -11, tw, 15, 4); ctx.fill();
    ctx.fillStyle = o.color;
    ctx.fillText(o.txt, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function drawMarquee(L) {
  ctx.fillStyle = '#07090f';
  ctx.fillRect(0, 0, W, MQ);
  ctx.fillStyle = hexA(L.rim, 0.5);
  ctx.fillRect(0, MQ - 2, W, 2);
  ctx.textAlign = 'center';
  ctx.font = '800 17px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillStyle = shade(L.rim, 0.35);
  ctx.save();
  ctx.shadowColor = L.rim; ctx.shadowBlur = 10;
  ctx.fillText(L.name, W / 2, 27);
  ctx.restore();
  ctx.letterSpacing = '2px';
  ctx.font = '700 13px Verdana, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(220,238,255,1)';
  ctx.fillText(`SAVE ${L.quota} OF ${L.total}`, 24, 27);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(190,215,240,0.95)';
  ctx.fillText(`LEVEL ${G.level + 1}/${LEVELS.length}`, W - 24, 27);
  ctx.letterSpacing = '0px';
  if (G.hintT > 0 && !G.attract && G.mode === 'play') {
    ctx.globalAlpha = clamp(G.hintT, 0, 1);
    ctx.textAlign = 'center';
    ctx.font = '600 10px Verdana, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(200,225,250,0.9)';
    ctx.fillText('PICK A SKILL BELOW · CLICK A NEONLING TO ASSIGN IT · A/D OR SCREEN EDGE SCROLLS', W / 2, MQ + 16);
    ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
  }
}
function drawHUD(L) {
  const HY = H - HUD_H;
  ctx.fillStyle = '#080d17';
  ctx.fillRect(0, HY, W, HUD_H);
  ctx.save();
  ctx.shadowColor = L.rim; ctx.shadowBlur = 6;
  ctx.fillStyle = hexA(L.rim, 0.7);
  ctx.fillRect(0, HY, W, 2);
  ctx.restore();
  // skill palette
  SKILLS.forEach((s, i) => {
    const bx = 24 + i * 92, by = HY + 14, bw = 82, bh = 82;
    const n = G.pool[s] || 0;
    const armed = G.selSkill === s;
    const hov = mouse.x > bx && mouse.x < bx + bw && mouse.y > by && mouse.y < by + bh;
    // one axis: dim = empty, outline = available, filled theme = armed; armed+empty is hollow
    if (armed && n > 0) {
      ctx.save();
      ctx.shadowColor = L.rim; ctx.shadowBlur = 10;
      ctx.fillStyle = hexA(L.rim, 0.28);
      ctx.strokeStyle = L.rim; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill(); ctx.stroke();
      ctx.restore();
    } else if (armed) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.strokeStyle = hexA(L.rim, 0.55); ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = hov && n > 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)';
      ctx.strokeStyle = n > 0 ? (hov ? 'rgba(200,230,255,0.8)' : 'rgba(160,195,230,0.45)') : 'rgba(160,195,230,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill(); ctx.stroke();
    }
    drawSkillIcon(s, bx + bw / 2, by + 24, n > 0 || armed);
    ctx.font = '700 8.5px Verdana, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'center';
    ctx.fillStyle = n > 0 || armed ? 'rgba(210,232,255,0.95)' : 'rgba(160,195,230,0.4)';
    ctx.fillText(s.toUpperCase(), bx + bw / 2, by + 48);
    ctx.letterSpacing = '0px';
    ctx.font = `800 20px ${MONO}`;
    ctx.fillStyle = n > 0 ? '#ffffff' : 'rgba(200,220,245,0.45)';
    ctx.fillText(String(n), bx + bw / 2, by + 72);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = 'rgba(160,195,230,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx + bw - 17, by + 4, 13, 13, 3); ctx.fill(); ctx.stroke();
    ctx.font = `800 9px ${MONO}`;
    ctx.fillStyle = 'rgba(225,240,255,0.9)';
    ctx.fillText(String(i + 1), bx + bw - 10.5, by + 13.5);
  });
  // right zones: OUT / SAVED / TIME
  function label(txt, x) {
    ctx.font = '700 11px Verdana, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(190,218,245,1)';
    ctx.fillText(txt, x, HY + 30);
    ctx.letterSpacing = '0px';
  }
  ctx.fillStyle = 'rgba(160,195,230,0.26)';
  for (const zx of [772, 900, 1035, 1160]) ctx.fillRect(zx, HY + 14, 1, 80);
  label('OUT', 800);
  ctx.font = `800 26px ${MONO}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(G.out), 800, HY + 66);
  label('SAVED', 962);
  const okQ = G.saved >= L.quota;
  ctx.font = `800 26px ${MONO}`;
  ctx.fillStyle = okQ ? '#3ae374' : '#ffffff';
  ctx.save();
  if (okQ) { ctx.shadowColor = '#3ae374'; ctx.shadowBlur = 8; }
  ctx.fillText(`${Math.min(G.saved, L.quota)}/${L.quota}${G.saved > L.quota ? ' +' + (G.saved - L.quota) : ''}`, 962, HY + 66);
  ctx.restore();
  label('TIME', 1098);
  const tcol = (G.mode === 'play' && G.levelTime < 15) ? '#ff4545' : (G.mode === 'play' && G.levelTime < 35) ? '#ffd12a' : '#eef4ff';
  ctx.font = `800 26px ${MONO}`;
  ctx.fillStyle = tcol;
  if (G.levelTime < 15 && Math.sin(G.time * 8) > 0) ctx.globalAlpha = 0.55;
  ctx.fillText(String(Math.max(0, Math.ceil(G.levelTime))), 1098, HY + 66);
  ctx.globalAlpha = 1;
  label('CONTROL', 1188);
  const btns = [['P', 'PAUSE', G.paused], ['+-', 'RATE', !!G.rateBoost], ['N', 'NUKE', !!G.nuked]];
  btns.forEach(([k2, name, on], i) => {
    const dx = 1188, dy = HY + 46 + i * 21;
    const kw = k2.length > 1 ? 24 : 18;
    ctx.fillStyle = on ? hexA(L.rim, 0.3) : 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = on ? L.rim : 'rgba(160,195,230,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(dx, dy - 12, kw, 16, 3); ctx.fill(); ctx.stroke();
    ctx.font = `800 10px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = on ? '#ffffff' : 'rgba(200,225,250,0.85)';
    ctx.fillText(k2, dx + kw / 2, dy);
    ctx.font = '700 8.5px Verdana, sans-serif';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(180,210,240,0.75)';
    ctx.fillText(name, dx + kw + 7, dy - 1);
    ctx.letterSpacing = '0px';
  });
}
function drawSkillIcon(s, cx2, cy2, lit) {
  ctx.save();
  ctx.translate(cx2, cy2);
  ctx.strokeStyle = lit ? SKILL_COL[s] : 'rgba(160,195,230,0.35)';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  if (s === 'climber') {
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(6, -9); ctx.lineTo(6, 9); ctx.stroke();   // the wall
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-2, -5, 2.4, 0, 7); ctx.stroke();            // head
    ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(-2, 4); ctx.stroke(); // body
    ctx.beginPath(); ctx.moveTo(-2, -1); ctx.lineTo(6, -5); ctx.moveTo(-2, 3); ctx.lineTo(6, 1); ctx.stroke(); // grips
  } else if (s === 'floater') {
    ctx.beginPath(); ctx.arc(0, -2, 8, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, -2); ctx.lineTo(0, 8); ctx.moveTo(8, -2); ctx.lineTo(0, 8); ctx.stroke();
  } else if (s === 'bomber') {
    ctx.beginPath(); ctx.arc(0, 2, 6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(3, -3); ctx.quadraticCurveTo(7, -8, 9, -6); ctx.stroke();
  } else if (s === 'blocker') {
    ctx.beginPath(); ctx.arc(0, -6, 2.4, 0, 7); ctx.stroke();             // head
    ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, 4); ctx.stroke();   // body
    ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(8, -3); ctx.stroke(); // arms barring the way
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(-4, 9); ctx.moveTo(0, 4); ctx.lineTo(4, 9); ctx.stroke();
  } else if (s === 'builder') {
    ctx.fillRect(-9, 4, 7, 3); ctx.fillRect(-3, 0, 7, 3); ctx.fillRect(3, -4, 7, 3);
  } else if (s === 'basher') {
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(6, 0); ctx.moveTo(2, -4); ctx.lineTo(6, 0); ctx.lineTo(2, 4); ctx.stroke();
    ctx.fillRect(7, -6, 3, 12);
  } else if (s === 'miner') {
    ctx.beginPath(); ctx.moveTo(-5, 8); ctx.lineTo(4, -4); ctx.stroke();                 // handle
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-2, -8); ctx.quadraticCurveTo(6, -6, 8, 1); ctx.stroke(); // pick head
  } else if (s === 'digger') {
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 6); ctx.moveTo(-4, 2); ctx.lineTo(0, 6); ctx.lineTo(4, 2); ctx.stroke();
  }
  ctx.restore();
}
function banner(title, color, sub) {
  ctx.save();
  const by = H / 2 - 78, bh = 140;
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, by, W, bh);
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillRect(0, by, W, 2);
  ctx.fillRect(0, by + bh - 2, W, 2);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.font = '900 40px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.shadowColor = color; ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.fillText(title, W / 2, by + 58);
  ctx.shadowBlur = 0;
  ctx.font = '600 15px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(225,240,255,0.92)';
  ctx.fillText(sub, W / 2, by + 96);
  ctx.letterSpacing = '0px';
  ctx.restore();
}
function bannerButton(label2, color) {
  const bw2 = 250, bh2 = 40, bx2 = W / 2 - bw2 / 2, by2 = H / 2 + 76;
  const hov = mouse.x > bx2 && mouse.x < bx2 + bw2 && mouse.y > by2 && mouse.y < by2 + bh2;
  ctx.save();
  ctx.fillStyle = hov ? hexA(color, 0.3) : hexA(color, 0.12);
  ctx.strokeStyle = color; ctx.lineWidth = hov ? 2.5 : 1.5;
  if (hov) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
  ctx.beginPath(); ctx.roundRect(bx2, by2, bw2, bh2, 8); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = '800 15px Verdana, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label2, W / 2, by2 + 26);
  ctx.letterSpacing = '0px';
  ctx.restore();
  return { bx2, by2, bw2, bh2 };
}
function drawTitle() {
  ctx.save();
  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, W, H);
  // a procession of neonlings marching along the bottom
  const gy = 560;
  ctx.fillStyle = '#101422';
  ctx.fillRect(0, gy, W, H - gy);
  ctx.fillStyle = hexA('#33d6ff', 0.4);
  ctx.fillRect(0, gy, W, 2);
  for (let i = 0; i < 12; i++) {
    const lx = ((i * 111.7 + G.time * 34) % (W + 60)) - 30;
    ctx.save();
    ctx.translate(lx, gy);
    ctx.scale(2.4, 2.4);
    const wob = Math.sin(G.time * 16 + i) * 1.4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(0, -8, 0, 0, -8, 20);
    gl.addColorStop(0, 'rgba(95,212,255,0.3)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(0, -8, 20, 0, 7); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#1f8fc0';
    ctx.beginPath(); ctx.roundRect(-3.5, -10, 7, 10, 2.5); ctx.fill();
    ctx.fillStyle = '#e8f4ff';
    ctx.beginPath(); ctx.arc(0, -12.5, 3.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#3dffc8';
    ctx.beginPath(); ctx.arc(0, -15, 2.4, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = '#c8e8ff'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-1.5, 0); ctx.lineTo(-1.5 - wob, 0); ctx.moveTo(1.5, 0); ctx.lineTo(1.5 + wob, 0); ctx.stroke();
    ctx.restore();
  }
  const by = 130, bh = 300;
  ctx.fillStyle = 'rgba(5,8,15,0.92)';
  ctx.fillRect(0, by, W, bh);
  ctx.save();
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 9;
  ctx.fillStyle = 'rgba(51,214,255,0.6)';
  ctx.fillRect(0, by, W, 1.5);
  ctx.fillRect(0, by + bh - 1.5, W, 1.5);
  ctx.restore();
  ctx.textAlign = 'center';
  const ly = 258;
  ctx.font = '900 96px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '10px';
  ctx.save();
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 16;
  ctx.fillStyle = '#7fdcff'; ctx.fillText('NEONLINGS', W / 2, ly);
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff'; ctx.fillText('NEONLINGS', W / 2, ly);
  ctx.restore();
  ctx.letterSpacing = '5px';
  ctx.font = '600 17px Verdana, sans-serif';
  ctx.fillStyle = '#7fb0d0';
  ctx.fillText('A TRIBUTE TO LEMMINGS', W / 2, ly + 50);
  const a = (Math.sin(G.time * 4) + 1) / 2 * 0.45 + 0.55;
  ctx.globalAlpha = a;
  ctx.font = '900 24px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 12;
  ctx.fillText('PRESS SPACE TO START', W / 2, ly + 122);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.font = '600 13px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(180,210,235,0.95)';
  ctx.fillText('THEY MARCH. THEY FALL. THEY TRUST YOU. SAVE THE QUOTA.', W / 2, 470);
  ctx.fillStyle = 'rgba(160,190,220,0.85)';
  ctx.fillText('PICK A SKILL · CLICK A NEONLING · EVERY LEVEL HAS A PROVEN SOLUTION', W / 2, 498);
  ctx.letterSpacing = '0px';
  ctx.restore();
  ctx.drawImage(VIGNETTE, 0, 0, W, H);
}

// ---------- input ----------
window.addEventListener('keydown', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys[k] = true;
  if (e.key === ' ') e.preventDefault();
  audio();
  if (G.showTitle && (e.key === ' ' || e.key === 'Enter')) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, false); return; }
  if (G.mode === 'won' && e.key === ' ' && G.modeT > 0.6) bannerAdvance();
  else if (G.mode === 'lost' && e.key === ' ' && G.modeT > 0.6) bannerAdvance();
  if (k === 'p' && !e.repeat) G.paused = !G.paused;
  if (k === '=' || k === '+') G.rateBoost = true;
  if (k === '-') G.rateBoost = false;
  if (k === 'n' && !G.nuked) {
    G.nuked = true;
    let d2 = 0;
    for (const l of G.lings) if (l.state !== 'dead' && l.state !== 'saved' && l.bomberT < 0) { l.bomberT = 5 + d2; d2 += 0.15; }
  }
  const idx = Number(e.key) - 1;
  if (idx >= 0 && idx < SKILLS.length) G.selSkill = SKILLS[idx];
});
window.addEventListener('keyup', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys[k] = false;
});
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (W / r.width);
  mouse.y = (e.clientY - r.top) * (H / r.height);
  let cur = 'crosshair';
  if (G && !G.showTitle) {
    if (mouse.y > H - HUD_H) cur = 'pointer';
    else if ((G.mode === 'won' || G.mode === 'lost') &&
             mouse.x > W / 2 - 125 && mouse.x < W / 2 + 125 && mouse.y > H / 2 + 76 && mouse.y < H / 2 + 116) cur = 'pointer';
  }
  canvas.style.cursor = cur;
});
function bannerAdvance() {
  if (G.mode === 'won') {
    if (G.level + 1 >= LEVELS.length) newGame((Math.random() * 1e9) >>> 0, true);
    else loadLevel(G.level + 1);
  } else if (G.mode === 'lost') loadLevel(G.level);
}
canvas.addEventListener('mousedown', e => {
  audio();
  if (G.showTitle) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, false); return; }
  if ((G.mode === 'won' || G.mode === 'lost') && G.modeT > 0.6) {
    const bw2 = 250, bh2 = 40, bx2 = W / 2 - bw2 / 2, by2 = H / 2 + 76;
    if (mouse.x > bx2 && mouse.x < bx2 + bw2 && mouse.y > by2 && mouse.y < by2 + bh2) { bannerAdvance(); return; }
  }
  const HY = H - HUD_H;
  if (mouse.y > HY) {
    SKILLS.forEach((s, i) => {
      const bx = 24 + i * 92;
      if (mouse.x > bx && mouse.x < bx + 82 && (G.pool[s] || 0) > 0) G.selSkill = s;
    });
    return;
  }
  if (G.mode !== 'play') return;
  // click a neonling: nearest within 20px
  const wx = mouse.x + G.cam, wy = mouse.y - MQ;
  let best = null, bd = 24;
  for (const l of G.lings) {
    if (l.state === 'dead' || l.state === 'saved') continue;
    const d = Math.hypot(l.x - wx, l.y - 8 - wy);
    if (d < bd) { bd = d; best = l; }
  }
  if (best) assignSkill(best, G.selSkill);
});

// ---------- main loop ----------
let last = 0, acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - last) / 1000, 1 / 20);
  last = t;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 8) { sim(STEP); acc -= STEP; n++; }
  draw();
}

// ---------- harnesses ----------
function stepFor(s) { const n = Math.round(s / STEP); for (let i = 0; i < n; i++) sim(STEP); }
function stepUntil(cond, cap) { let n = 0; while (!cond() && n < cap) { sim(STEP); n++; } }
function camOn(x) { G.cam = clamp(x - VW / 2, 0, LW - VW); }
function armReplay() {
  G.replay = LEVELS[G.level].solution.map(s => ({ ...s, at: { ...s.at }, done: false }));
}
function runShot(name, f) {
  AUDIO_ON = false;
  newGame(112233, false);
  G.hintT = 0;
  const L0 = LEVELS[0];
  if (name === 'title') {
    G.showTitle = true;
    stepFor(1.7);
  } else if (name === 'level1') {
    G.hintT = 6;
    armReplay();
    stepFor(4);
    camOn(500);
  } else if (name === 'crowd') {
    stepFor(14);       // no skills: the crowd paces between the walls
    camOn(700);
  } else if (name === 'digger') {
    armReplay();
    stepUntil(() => G.lings.some(l => l.state === 'digger'), 60 * 30);
    stepFor(2.5);
    const d = G.lings.find(l => l.state === 'digger' || l.state === 'faller');
    if (d) camOn(d.x);
  } else if (name === 'builder') {
    loadLevel(1);
    armReplay();
    stepUntil(() => G.lings.some(l => l.state === 'builder'), 60 * 40);
    stepFor(3.5);
    camOn(760);
  } else if (name === 'blocker') {
    loadLevel(2);
    armReplay();
    stepUntil(() => G.lings.some(l => l.state === 'blocker'), 60 * 30);
    stepFor(6);
    camOn(420);
  } else if (name === 'basher') {
    loadLevel(2);
    armReplay();
    stepUntil(() => G.lings.some(l => l.state === 'basher'), 60 * 30);
    stepFor(1.6);
    camOn(660);
  } else if (name === 'miner') {
    loadLevel(2);
    armReplay();
    stepUntil(() => G.lings.some(l => l.state === 'miner'), 60 * 40);
    stepFor(2.4);
    camOn(830);
  } else if (name === 'floater') {
    loadLevel(3);
    armReplay();
    stepUntil(() => G.lings.some(l => l.floater && l.state === 'faller' && (l.y - l.fallFrom) > 60), 60 * 30);
    const fl = G.lings.find(l => l.floater && l.state === 'faller');
    if (fl) camOn(fl.x);
  } else if (name === 'bomber') {
    loadLevel(1);
    armReplay();
    stepUntil(() => G.parts.some(p => p.kind === 'ring'), 60 * 55);
    stepFor(0.12);
    camOn(300);
  } else if (name === 'exit') {
    armReplay();
    stepUntil(() => G.saved >= 1, 60 * 60);
    stepFor(0.15);
    camOn(L0.exit[0]);
  } else if (name === 'ascent') {
    loadLevel(4);
    armReplay();
    stepUntil(() => G.lings.some(l => l.state === 'climbing'), 60 * 60);
    const c = G.lings.find(l => l.state === 'climbing');
    if (c) camOn(c.x);
  } else if (name === 'win') {
    armReplay();
    stepUntil(() => G.mode === 'won', 60 * 110);
    stepFor(0.2);
  } else if (name === 'fail') {
    stepUntil(() => G.mode === 'lost', 60 * 110);
    stepFor(0.2);
  } else {
    stepFor(2);
  }
  draw();
  document.title = 'shot-ready';
}
function runVerify(levelIdx, mode, ablateSkill) {
  AUDIO_ON = false;
  newGame(112233, false);
  loadLevel(levelIdx);
  G.events = [];
  G.released = 0;
  if (mode === 'mechrelease') {
    // mechanism proof on L1 geometry: a blocker must be released by digging away its ground
    G.pool = { blocker: 1, digger: 1 };
    G.replay = [
      { t: 3, skill: 'blocker', at: { n: 0 }, done: false },
      { t: 20, skill: 'digger', at: { x0: 351, x1: 362 }, done: false },
    ];
  } else if (mode !== 'null') armReplay();
  if (mode === 'ablate' && ablateSkill) {
    G.pool[ablateSkill] = 0;
    G.replay = G.replay.filter(s => s.skill !== ablateSkill);
  }
  let simTime = 0;
  const simCap = Number(new URLSearchParams(location.search).get('t') || 200);
  while (simTime < simCap && G.mode === 'play') {
    sim(STEP);
    simTime += STEP;
  }
  const L = LEVELS[levelIdx];
  const report = {
    level: levelIdx + 1, name: L.name,
    mode: mode === 'ablate' ? 'ablate-' + ablateSkill : mode,
    margin: G.saved - L.quota,
    outcome: mode === 'mechrelease' ? ((G.released >= 1 && G.saved >= 2) ? 'SOLVED' : 'FAILED') : G.mode === 'won' ? 'SOLVED' : 'FAILED',
    saved: G.saved, quota: L.quota, total: L.total,
    dead: G.dead, timeLeft: Math.max(0, G.levelTime) | 0, released: G.released || 0,
    events: G.events,
    snap: G.lings.map(l2 => ({ id: l2.id, s: l2.state, x: l2.x | 0, y: l2.y | 0 })),
  };
  document.title = 'VERIFY:' + JSON.stringify(report);
  const el = document.createElement('pre');
  el.id = 'verify-report';
  el.textContent = document.title;
  document.body.appendChild(el);
  draw();
}

const q = new URLSearchParams(location.search);
const shotName = q.get('shot');
const verifyLevel = q.get('verify');
if (shotName) runShot(shotName, Number(q.get('f') || 0));
else if (verifyLevel !== null) runVerify(Number(verifyLevel || 0), q.get('mode') || 'solution', q.get('skill'));
else { newGame(445566, true); requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); }); }
