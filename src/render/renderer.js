// renderer.js — Canvas 2D rendering: still cheap art, but real shape.
//
// The visual language is still "simple shapes, not sprites" — no image
// assets, everything is drawn procedurally — but buildings now read as
// buildings (roofs, doors, windows, role-specific silhouettes) and
// villagers read as little people (head/body/limbs, a walk cycle, a
// facing direction) instead of flat rectangles and dots. Atmosphere
// (day/night, weather, lit windows, shadows) is still the main visual
// budget, per the design brief — it's just rendered with more care now.
// Nothing here touches simulation state; it only reads world.clock /
// world.weather / world.npcs / world.map to paint a frame.

export const TILE = 20;

const TERRAIN_BASE = ['#3c4d30', '#6d5d45', '#2a4a5c', '#5c4a2e']; // grass, road, water, farmland

const OCCUPATION_COLORS = {
  child: '#e8d9a0', elder: '#b9b3a8', guard: '#7fa0c9', clergy: '#e6e6e6',
  smith: '#c98a4b', baker: '#e0b878', healer: '#8fbf9f', merchant: '#c9a24b',
  innkeeper: '#b97a5c', farmer: '#8fae5c', clerk: '#a89bc9', default: '#caa27a',
};
const SKIN_TONES = ['#e8c39e', '#c98f65', '#8a5a3c', '#f0d0a8'];

const WEATHER_TINT = {
  clear: 'rgba(0,0,0,0)', overcast: 'rgba(80,85,95,0.16)', rain: 'rgba(40,55,75,0.22)',
  storm: 'rgba(20,25,40,0.4)', fog: 'rgba(200,205,210,0.22)', snow: 'rgba(210,220,230,0.12)',
};

export function canvasSize(world) {
  return { width: world.map.width * TILE, height: world.map.height * TILE };
}

export function renderFrame(ctx, world, { selectedNpcId = null } = {}) {
  const { width, height } = canvasSize(world);
  const t = performance.now() / 1000;
  drawTerrain(ctx, world, t);
  drawBuildings(ctx, world, t);
  drawNpcs(ctx, world, selectedNpcId, t);
  drawDayNightOverlay(ctx, world, width, height);
  drawWeatherOverlay(ctx, world, width, height, t);
}

// --- small deterministic helpers -----------------------------------------

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x9e3779b9;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 10000) / 10000;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000 / 1000;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `rgb(${r},${g},${b})`;
}

// --- terrain --------------------------------------------------------------

function drawTerrain(ctx, world) {
  const { map } = world;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const type = map.tiles[y * map.width + x];
      const base = TERRAIN_BASE[type];
      ctx.fillStyle = base;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);

      const h = hash2(x, y);
      const px = x * TILE, py = y * TILE;
      if (type === 0) { // grass — a couple of blade ticks per tile, cheap and stable
        if (h < 0.55) {
          ctx.strokeStyle = shade(base, h > 0.27 ? 14 : -10);
          ctx.lineWidth = 1;
          const bx = px + 4 + h * (TILE - 8);
          const by = py + 6 + hash2(x + 1, y) * (TILE - 10);
          ctx.beginPath();
          ctx.moveTo(bx, by + 4);
          ctx.lineTo(bx + 1.5, by);
          ctx.stroke();
        }
      } else if (type === 1) { // road — sparse cobble flecks
        if (h < 0.4) {
          ctx.fillStyle = shade(base, h > 0.2 ? 12 : -14);
          const s = 2 + h * 2;
          ctx.fillRect(px + 3 + h * (TILE - 8), py + 3 + hash2(x, y + 2) * (TILE - 8), s, s);
        }
      } else if (type === 3) { // farmland — furrow lines
        ctx.strokeStyle = shade(base, -16);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py + TILE * 0.3);
        ctx.lineTo(px + TILE, py + TILE * 0.3);
        ctx.moveTo(px, py + TILE * 0.7);
        ctx.lineTo(px + TILE, py + TILE * 0.7);
        ctx.stroke();
      }
    }
  }
  // water shimmer as a second pass (needs a time-varying phase, kept out of the per-tile loop's cache-friendliness above)
  drawWaterShimmer(ctx, world);
}

function drawWaterShimmer(ctx, world) {
  const { map } = world;
  const t = performance.now() / 900;
  ctx.strokeStyle = 'rgba(180,210,225,0.35)';
  ctx.lineWidth = 1;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y * map.width + x] !== 2) continue;
      const phase = Math.sin(t + x * 0.7 + y * 0.4);
      if (phase < 0.3) continue;
      const px = x * TILE, py = y * TILE + TILE / 2 + phase * 2;
      ctx.beginPath();
      ctx.moveTo(px + 3, py);
      ctx.lineTo(px + TILE - 3, py);
      ctx.stroke();
    }
  }
}

// --- buildings --------------------------------------------------------------

function drawBuildingShadow(ctx, b) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse((b.x + b.w / 2) * TILE + 3, (b.y + b.h) * TILE + 2, (b.w * TILE) / 2, TILE * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawWindows(ctx, b, lit) {
  const wx1 = b.x * TILE + TILE * 0.5;
  const wx2 = (b.x + b.w) * TILE - TILE * 0.9;
  const wy = b.y * TILE + b.h * TILE * 0.55;
  ctx.fillStyle = lit ? 'rgba(255, 214, 120, 0.9)' : 'rgba(40,35,30,0.55)';
  ctx.fillRect(wx1, wy, TILE * 0.4, TILE * 0.4);
  ctx.fillRect(wx2, wy, TILE * 0.4, TILE * 0.4);
  if (lit) {
    ctx.shadowColor = 'rgba(255,200,100,0.8)';
    ctx.shadowBlur = 6;
    ctx.fillRect(wx1, wy, TILE * 0.4, TILE * 0.4);
    ctx.shadowBlur = 0;
  }
}

function drawRoof(ctx, b, color) {
  const x0 = b.x * TILE - 2, x1 = (b.x + b.w) * TILE + 2, xm = (b.x + b.w / 2) * TILE;
  const yBase = b.y * TILE;
  const yPeak = yBase - TILE * 0.65;
  ctx.fillStyle = shade(color, -50);
  ctx.beginPath();
  ctx.moveTo(x0, yBase + 2);
  ctx.lineTo(xm, yPeak);
  ctx.lineTo(x1, yBase + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
  return { xm, yPeak };
}

function drawDoor(ctx, b) {
  const doorX = (b.x + Math.floor(b.w / 2)) * TILE - TILE * 0.22;
  const doorY = (b.y + b.h) * TILE - TILE * 0.85;
  ctx.fillStyle = 'rgba(35,24,16,0.9)';
  ctx.fillRect(doorX, doorY, TILE * 0.44, TILE * 0.85);
}

const ROLE_ACCENTS = {
  chapel(ctx, b, roof) {
    ctx.strokeStyle = '#e8e0c8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(roof.xm, roof.yPeak - 10); ctx.lineTo(roof.xm, roof.yPeak - 1);
    ctx.moveTo(roof.xm - 4, roof.yPeak - 6); ctx.lineTo(roof.xm + 4, roof.yPeak - 6);
    ctx.stroke();
  },
  forge(ctx, b, roof, t) {
    const cx = b.x * TILE + TILE * 0.7, cy = roof.yPeak + 6;
    ctx.fillStyle = '#3a332e';
    ctx.fillRect(cx - 3, cy - 10, 7, 14);
    for (let i = 0; i < 3; i++) {
      const py = cy - 12 - ((t * 20 + i * 8) % 24);
      ctx.fillStyle = `rgba(180,180,180,${0.3 - i * 0.08})`;
      ctx.beginPath();
      ctx.arc(cx + Math.sin(t + i) * 3, py, 3 + i, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  tavern(ctx, b) {
    const px = (b.x + b.w) * TILE - 6, py = b.y * TILE + 4;
    ctx.strokeStyle = '#3a332e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + 14); ctx.stroke();
    ctx.fillStyle = '#b8934f';
    ctx.fillRect(px - 10, py, 10, 8);
  },
  guardhouse(ctx, b, roof) {
    ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(roof.xm, roof.yPeak); ctx.lineTo(roof.xm, roof.yPeak - 14); ctx.stroke();
    ctx.fillStyle = '#8a3a3a';
    ctx.beginPath();
    ctx.moveTo(roof.xm, roof.yPeak - 14); ctx.lineTo(roof.xm + 8, roof.yPeak - 11); ctx.lineTo(roof.xm, roof.yPeak - 8);
    ctx.closePath(); ctx.fill();
  },
  healer(ctx, b) {
    const dx = (b.x + b.w / 2) * TILE, dy = (b.y + b.h) * TILE - TILE * 0.45;
    ctx.strokeStyle = '#e07a7a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dx, dy - 5); ctx.lineTo(dx, dy + 5);
    ctx.moveTo(dx - 5, dy); ctx.lineTo(dx + 5, dy);
    ctx.stroke();
  },
  market(ctx, b) {
    ctx.fillStyle = '#8a3a3a';
    for (let i = 0; i < b.w; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#8a3a3a' : '#d8c8a8';
      ctx.beginPath();
      const x0 = (b.x + i) * TILE, x1 = x0 + TILE;
      const yBase = b.y * TILE, yPeak = yBase - TILE * 0.5;
      ctx.moveTo(x0, yBase); ctx.lineTo(x0 + TILE / 2, yPeak); ctx.lineTo(x1, yBase);
      ctx.closePath(); ctx.fill();
    }
  },
  farm(ctx, b) {
    ctx.strokeStyle = 'rgba(60,45,20,0.5)'; ctx.lineWidth = 1;
    for (let row = 1; row < b.h; row++) {
      const y = (b.y + row) * TILE;
      ctx.beginPath(); ctx.moveTo(b.x * TILE, y); ctx.lineTo((b.x + b.w) * TILE, y); ctx.stroke();
    }
  },
};

function drawBuildings(ctx, world, t) {
  const isNight = world.clock.isNight();
  for (const b of world.map.buildings) {
    drawBuildingShadow(ctx, b);

    if (b.role === 'farm') {
      // Fields read as farmland, not a house — flat tilled-earth block with furrows, no roof/door.
      const grad = ctx.createLinearGradient(0, b.y * TILE, 0, (b.y + b.h) * TILE);
      grad.addColorStop(0, shade(b.color, 10));
      grad.addColorStop(1, shade(b.color, -20));
      ctx.fillStyle = grad;
      ctx.fillRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
      ROLE_ACCENTS.farm(ctx, b);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
    } else if (b.role === 'market') {
      ROLE_ACCENTS.market(ctx, b);
    } else {
      const grad = ctx.createLinearGradient(0, b.y * TILE, 0, (b.y + b.h) * TILE);
      grad.addColorStop(0, shade(b.color, 14));
      grad.addColorStop(1, shade(b.color, -22));
      ctx.fillStyle = grad;
      ctx.fillRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);

      const roof = drawRoof(ctx, b, b.color);
      drawWindows(ctx, b, isNight && occupied(world, b));
      drawDoor(ctx, b);
      const accent = ROLE_ACCENTS[b.role];
      if (accent) accent(ctx, b, roof, t);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '10px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.name, (b.x + b.w / 2) * TILE, b.y * TILE - TILE * 0.7 - 4);
    ctx.textAlign = 'left';
  }
}

function occupied(world, building) {
  for (const npc of Object.values(world.npcs)) {
    if (npc.indoors && (npc.homeBuildingId === building.id || npc.workBuildingId === building.id)) return true;
  }
  return false;
}

// --- people -----------------------------------------------------------------

const lastPositions = new Map();

function drawNpcs(ctx, world, selectedNpcId, t) {
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive || npc.indoors) { lastPositions.delete(npc.id); continue; }

    const prev = lastPositions.get(npc.id);
    const moving = prev && (prev.x !== npc.position.x || prev.y !== npc.position.y);
    lastPositions.set(npc.id, { x: npc.position.x, y: npc.position.y });

    const facing = npc.facing || { dx: 0, dy: 1 };
    const px = npc.position.x * TILE + TILE / 2;
    const py = npc.position.y * TILE + TILE / 2;
    const gaitPhase = moving ? Math.sin(t * 8 + hashStr(npc.id) * 10) : 0;

    drawPerson(ctx, px, py, {
      isPlayer: npc.isPlayer,
      bodyColor: npc.isPlayer ? '#f4c542' : (OCCUPATION_COLORS[npc.occupation] || OCCUPATION_COLORS.default),
      skinColor: SKIN_TONES[Math.floor(hashStr(npc.id) * SKIN_TONES.length)],
      facing, gaitPhase,
      selected: npc.id === selectedNpcId,
      distressed: npc.emotion.tags.fear > 0.5 || npc.emotion.tags.anger > 0.5,
      scale: npc.isPlayer ? 1.25 : 1,
    });
  }
}

function drawPerson(ctx, px, py, opts) {
  const s = opts.scale;
  // ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(px, py + 6 * s, 4.5 * s, 1.8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs (swing opposite to each other with the gait phase)
  ctx.strokeStyle = shade(opts.bodyColor, -60);
  ctx.lineWidth = 1.6 * s;
  ctx.beginPath();
  ctx.moveTo(px - 1.5 * s, py + 2 * s); ctx.lineTo(px - 1.5 * s + opts.gaitPhase * 2 * s, py + 6.5 * s);
  ctx.moveTo(px + 1.5 * s, py + 2 * s); ctx.lineTo(px + 1.5 * s - opts.gaitPhase * 2 * s, py + 6.5 * s);
  ctx.stroke();

  // body (torso)
  ctx.fillStyle = opts.bodyColor;
  ctx.beginPath();
  ctx.ellipse(px, py, 3.2 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  if (opts.selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // arms
  ctx.strokeStyle = opts.bodyColor;
  ctx.lineWidth = 1.4 * s;
  ctx.beginPath();
  ctx.moveTo(px - 3 * s, py - 1 * s); ctx.lineTo(px - 3.5 * s - opts.gaitPhase * 1.5 * s, py + 3 * s);
  ctx.moveTo(px + 3 * s, py - 1 * s); ctx.lineTo(px + 3.5 * s + opts.gaitPhase * 1.5 * s, py + 3 * s);
  ctx.stroke();

  // head
  ctx.fillStyle = opts.skinColor;
  ctx.beginPath();
  ctx.arc(px, py - 5 * s, 2.6 * s, 0, Math.PI * 2);
  ctx.fill();

  // facing nub — a tiny highlight showing which way they're looking
  ctx.fillStyle = 'rgba(30,20,15,0.8)';
  ctx.beginPath();
  ctx.arc(px + opts.facing.dx * 1.6 * s, py - 5 * s + opts.facing.dy * 1.6 * s, 0.7 * s, 0, Math.PI * 2);
  ctx.fill();

  if (opts.isPlayer) {
    ctx.fillStyle = '#f4c542';
    ctx.beginPath();
    ctx.moveTo(px - 3 * s, py - 7 * s); ctx.lineTo(px + 3 * s, py - 7 * s); ctx.lineTo(px, py - 10 * s);
    ctx.closePath();
    ctx.fill();
  }

  if (opts.distressed) {
    ctx.fillStyle = 'rgba(220,60,60,0.9)';
    ctx.beginPath();
    ctx.moveTo(px, py - 12 * s); ctx.lineTo(px - 2, py - 8 * s); ctx.lineTo(px + 2, py - 8 * s);
    ctx.closePath();
    ctx.fill();
  }
}

// --- day/night + weather -----------------------------------------------------

function darknessFor(hourFraction) {
  const c = Math.cos((hourFraction / 24) * Math.PI * 2); // 1 at midnight, -1 at midday
  return Math.max(0, (c + 0.3) / 1.3) * 0.72;
}

function drawDayNightOverlay(ctx, world, width, height) {
  const alpha = darknessFor(world.clock.hourFraction);
  if (alpha <= 0.01) return;
  const grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.75);
  grad.addColorStop(0, `rgba(10,14,30,${alpha * 0.85})`);
  grad.addColorStop(1, `rgba(5,8,20,${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

let particles = null;
let particleKind = null;

function ensureParticles(kind, width, height, count) {
  if (particleKind === kind && particles && particles.length === count) return;
  particleKind = kind;
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    len: 6 + Math.random() * 10,
    speed: 4 + Math.random() * 4,
    drift: (Math.random() - 0.5) * 0.6,
    size: 1 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
  }));
}

let lastFrameT = null;

function drawWeatherOverlay(ctx, world, width, height, t) {
  ctx.fillStyle = WEATHER_TINT[world.weather.current] || 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, width, height);

  const dt = lastFrameT === null ? 0 : Math.min(0.1, t - lastFrameT);
  lastFrameT = t;

  if (world.weather.current === 'rain' || world.weather.current === 'storm') {
    ensureParticles('rain', width, height, 90);
    ctx.strokeStyle = 'rgba(180,200,230,0.4)';
    ctx.lineWidth = 1;
    for (const d of particles) {
      d.y += d.speed * 60 * dt;
      d.x += 1.2 * 60 * dt;
      if (d.y > height) { d.y = -d.len; d.x = Math.random() * width; }
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.25, d.y + d.len);
      ctx.stroke();
    }
    if (world.weather.current === 'storm' && Math.sin(t * 0.7) > 0.997) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, 0, width, height);
    }
  } else if (world.weather.current === 'snow') {
    ensureParticles('snow', width, height, 70);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const f of particles) {
      f.y += f.speed * 12 * dt;
      f.x += Math.sin(t + f.phase) * 0.3;
      if (f.y > height) { f.y = -4; f.x = Math.random() * width; }
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (world.weather.current === 'fog') {
    for (let i = 0; i < 3; i++) {
      const cx = ((Math.sin(t * 0.05 + i * 2) + 1) / 2) * width;
      const cy = height * (0.25 + i * 0.25);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.35);
      grad.addColorStop(0, 'rgba(210,215,220,0.25)');
      grad.addColorStop(1, 'rgba(210,215,220,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    particles = null;
    particleKind = null;
  }
}
