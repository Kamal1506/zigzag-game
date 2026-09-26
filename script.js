const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const hint = document.getElementById('hint');

let W = 0, H = 0, dpr = 1;
let playing = false, over = false, score = 0;
let best = Number(localStorage.getItem('zigzagBest')) || 0;
let sound = true, last = 0;
let trail = [], particles = [], path = [];
let audioContext = null;

const CONFIG = {
  roadWidth: 56,
  segmentX: 72,
  segmentY: 43,
  startSpeed: 115,
  maxBonusSpeed: 145,
  speedPerPoint: 2.2,
  scoreRate: 7,
  playerRadius: 12,
  pathBufferTop: -H,
  pathBufferBottom: 120,
  turnChance: 0.56
};

const player = { x: 0, y: 0, vx: -1, vy: -1, size: CONFIG.playerRadius };
bestEl.textContent = best;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function currentSpeed() { return CONFIG.startSpeed + Math.min(score * CONFIG.speedPerPoint, CONFIG.maxBonusSpeed); }

function resize() {
  const oldW = W || innerWidth;
  const oldH = H || innerHeight;
  W = innerWidth;
  H = innerHeight;
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!playing) {
    buildPath();
  } else {
    // Preserve the running world proportionally instead of rebuilding it.
    const sx = W / oldW;
    const sy = H / oldH;
    player.x *= sx;
    player.y *= sy;
    path.forEach(p => { p.x *= sx; p.y *= sy; });
    trail.forEach(p => { p.x *= sx; p.y *= sy; });
    ensurePathAhead();
  }
}
addEventListener('resize', resize, { passive: true });

function roadBounds() {
  // Keep generated road centers inside the visible play field on every screen size.
  const margin = Math.max(CONFIG.roadWidth * 0.85, Math.min(W * 0.10, 110));
  return { min: margin, max: Math.max(margin + CONFIG.segmentX, W - margin) };
}

function nextDirection(lastX, currentDir) {
  const { min, max } = roadBounds();
  const nextX = lastX + currentDir * CONFIG.segmentX;

  // Hard viewport guard: a segment can never be generated off-screen.
  if (nextX < min) return 1;
  if (nextX > max) return -1;

  // Random turns are allowed only when both resulting positions are safe.
  if (Math.random() < CONFIG.turnChance) {
    const flipped = -currentDir;
    const flippedX = lastX + flipped * CONFIG.segmentX;
    if (flippedX >= min && flippedX <= max) return flipped;
  }
  return currentDir;
}

function appendSegment() {
  if (path.length < 2) return;
  const lastP = path[path.length - 1];
  const prev = path[path.length - 2];
  let dir = Math.sign(lastP.x - prev.x) || -1;
  dir = nextDirection(lastP.x, dir);
  path.push({ x: lastP.x + dir * CONFIG.segmentX, y: lastP.y - CONFIG.segmentY });
}

function ensurePathAhead() {
  if (path.length < 2) return;
  // Always maintain more than a screen of road ahead of the player.
  const targetY = -Math.max(H * 0.8, 500);
  let guard = 0;
  while (path[path.length - 1].y > targetY && guard++ < 200) appendSegment();

  // Remove only segments that are safely behind the viewport/player.
  while (path.length > 6 && path[1].y > H + 160) path.shift();
}

function buildPath() {
  path = [];
  const startX = W * 0.56;
  const startY = H * 0.76;
  // A short straight runway makes every restart deterministic and fair.
  path.push({ x: startX + CONFIG.segmentX, y: startY + CONFIG.segmentY });
  path.push({ x: startX, y: startY });
  ensurePathAhead();
  player.x = startX;
  player.y = startY;
  player.vx = -1;
  player.vy = -1;
}

function reset() {
  score = 0;
  scoreEl.textContent = '0';
  trail = [];
  particles = [];
  over = false;
  buildPath();
  playing = true;
  startScreen.classList.remove('active');
  gameOverScreen.classList.remove('active');
  hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 1800);
  last = performance.now();
}

function turn() {
  if (over) { reset(); return; }
  if (!playing) return;
  player.vx *= -1;
  beep(360, 0.035);
}

function beep(freq, dur) {
  if (!sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioContext.createOscillator();
    const g = audioContext.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.setValueAtTime(0.035, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + dur);
    o.connect(g); g.connect(audioContext.destination);
    o.start(); o.stop(audioContext.currentTime + dur);
  } catch (_) {}
}

function project(x, y) { return { x, y }; }

function drawPath() {
  if (path.length < 2) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  path.forEach((p, i) => {
    const q = project(p.x, p.y);
    if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
  });
  ctx.strokeStyle = '#151d31';
  ctx.lineWidth = CONFIG.roadWidth;
  ctx.shadowBlur = 28;
  ctx.shadowColor = '#000';
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#24304a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((px - a.x) * dx + (py - a.y) * dy) / len2, 0, 1) : 0;
  const x = a.x + t * dx, y = a.y + t * dy;
  return Math.hypot(px - x, py - y);
}

function safe() {
  // Account for player radius instead of checking only its center point.
  const safeRadius = CONFIG.roadWidth / 2 - player.size * 0.58;
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    // Ignore distant segments for stable, cheap collision checks.
    if (Math.abs(path[i].y - player.y) > 170 && Math.abs(path[i + 1].y - player.y) > 170) continue;
    min = Math.min(min, distToSegment(player.x, player.y, path[i], path[i + 1]));
  }
  return min <= safeRadius;
}

function update(dt) {
  if (!playing) return;
  const speed = currentSpeed();
  const verticalSpeed = speed * 0.6;

  // Player travels diagonally while the world scroll exactly cancels vertical motion.
  player.x += player.vx * speed * dt;
  player.y += player.vy * verticalSpeed * dt;

  trail.push({ x: player.x, y: player.y, a: 1 });
  if (trail.length > 18) trail.shift();

  for (const p of path) p.y += verticalSpeed * dt;
  player.y += verticalSpeed * dt;
  for (const p of trail) p.y += verticalSpeed * dt;

  ensurePathAhead();

  if (!safe()) { end(); return; }

  score += dt * CONFIG.scoreRate;
  scoreEl.textContent = String(Math.floor(score));
}

function end() {
  playing = false;
  over = true;
  const s = Math.floor(score);
  const isBest = s > best;
  if (isBest) {
    best = s;
    localStorage.setItem('zigzagBest', String(best));
  }
  bestEl.textContent = String(best);
  document.getElementById('finalScore').textContent = String(s);
  document.getElementById('finalBest').textContent = String(best);
  document.getElementById('newBest').classList.toggle('show', isBest);
  gameOverScreen.classList.add('active');
  beep(120, 0.22);
  for (let i = 0; i < 24; i++) {
    particles.push({ x: player.x, y: player.y, vx: (Math.random() - .5) * 180, vy: (Math.random() - .5) * 180, a: 1 });
  }
}

function drawPlayer() {
  trail.forEach((t, i) => {
    const q = project(t.x, t.y);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 2 + i * .25, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(111,255,233,${i / trail.length * .22})`;
    ctx.fill();
  });
  const q = project(player.x, player.y);
  ctx.save();
  ctx.shadowBlur = 28;
  ctx.shadowColor = '#6fffe9';
  ctx.fillStyle = '#6fffe9';
  ctx.beginPath();
  ctx.arc(q.x, q.y, player.size, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dffff9';
  ctx.beginPath();
  ctx.arc(q.x - 3, q.y - 4, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles(dt) {
  particles.forEach(p => {
    p.x += p.vx * dt; p.y += p.vy * dt; p.a -= dt * 1.8;
    ctx.fillStyle = `rgba(111,255,233,${Math.max(0, p.a)})`;
    ctx.fillRect(p.x, p.y, 3, 3);
  });
  particles = particles.filter(p => p.a > 0);
}

function grid() {
  ctx.strokeStyle = '#ffffff06';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 70) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 70) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

function loop(t) {
  const dt = Math.min((t - last) / 1000, 0.03) || 0;
  last = t;
  ctx.clearRect(0, 0, W, H);
  grid();
  if (playing) update(dt);
  drawPath();
  drawPlayer();
  drawParticles(dt);
  requestAnimationFrame(loop);
}

document.getElementById('startBtn').onclick = reset;
document.getElementById('restartBtn').onclick = reset;
document.getElementById('soundBtn').onclick = e => {
  sound = !sound;
  e.currentTarget.textContent = sound ? '♪' : '×';
};

addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault();
    if (!playing && over) reset(); else turn();
  }
});
canvas.addEventListener('pointerdown', turn);

resize();
requestAnimationFrame(loop);
