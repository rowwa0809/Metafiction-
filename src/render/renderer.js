// renderer.js — Canvas 2D rendering: cheap art, real atmosphere.
//
// The art is intentionally primitive (colored rectangles and dots) — the
// visual blueprint's "believable, living world" comes from dynamic
// day/night lighting, weather states, and lit windows at night, not from
// sprite quality. Nothing here touches simulation state; it only reads
// world.clock/world.weather/world.npcs/world.map to paint a frame.

export const TILE = 15;

const TERRAIN_COLORS = ['#3a4a2e', '#6b5c46', '#2b4a5c', '#5c4a2e']; // grass, road, water, farmland

const OCCUPATION_COLORS = {
  child: '#e8d9a0', elder: '#b9b3a8', guard: '#7fa0c9', clergy: '#e6e6e6',
  smith: '#c98a4b', baker: '#e0b878', healer: '#8fbf9f', default: '#caa27a',
};

const WEATHER_TINT = {
  clear: 'rgba(0,0,0,0)', overcast: 'rgba(80,85,95,0.18)', rain: 'rgba(40,55,75,0.28)',
  storm: 'rgba(20,25,40,0.45)', fog: 'rgba(200,205,210,0.35)', snow: 'rgba(210,220,230,0.15)',
};

export function canvasSize(world) {
  return { width: world.map.width * TILE, height: world.map.height * TILE };
}

export function renderFrame(ctx, world, { selectedNpcId = null } = {}) {
  const { width, height } = canvasSize(world);
  drawTerrain(ctx, world);
  drawBuildings(ctx, world);
  drawNpcs(ctx, world, selectedNpcId);
  drawDayNightOverlay(ctx, world, width, height);
  drawWeatherOverlay(ctx, world, width, height);
}

function drawTerrain(ctx, world) {
  const { map } = world;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      ctx.fillStyle = TERRAIN_COLORS[map.tiles[y * map.width + x]];
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
}

function drawBuildings(ctx, world) {
  const isNight = world.clock.isNight();
  for (const b of world.map.buildings) {
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);

    // Lit windows at night — the cheapest, most effective atmosphere trick.
    if (isNight && occupied(world, b)) {
      ctx.fillStyle = 'rgba(255, 214, 120, 0.85)';
      const wx = b.x * TILE + TILE * 0.6;
      const wy = b.y * TILE + TILE * 0.6;
      ctx.fillRect(wx, wy, TILE * 0.4, TILE * 0.4);
      ctx.fillRect((b.x + b.w - 1) * TILE + TILE * 0.2, wy, TILE * 0.4, TILE * 0.4);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '9px sans-serif';
    ctx.fillText(b.name, b.x * TILE, b.y * TILE - 3);
  }
}

function occupied(world, building) {
  for (const npc of Object.values(world.npcs)) {
    if (npc.indoors && (npc.homeBuildingId === building.id || npc.workBuildingId === building.id)) return true;
  }
  return false;
}

function drawNpcs(ctx, world, selectedNpcId) {
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive || npc.indoors) continue;
    const px = npc.position.x * TILE + TILE / 2;
    const py = npc.position.y * TILE + TILE / 2;
    ctx.beginPath();
    ctx.arc(px, py, npc.isPlayer ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = npc.isPlayer ? '#f4c542' : (OCCUPATION_COLORS[npc.occupation] || OCCUPATION_COLORS.default);
    ctx.fill();
    if (npc.id === selectedNpcId) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (npc.emotion.tags.fear > 0.5 || npc.emotion.tags.anger > 0.5) {
      ctx.fillStyle = 'rgba(220,60,60,0.9)';
      ctx.fillRect(px - 2, py - 9, 4, 2);
    }
  }
}

// Smooth day/night darkness curve keyed to hour-of-day; darkest at
// midnight, fully lit around midday, with dusk/dawn transitions.
function darknessFor(hourFraction) {
  const t = Math.cos((hourFraction / 24) * Math.PI * 2); // 1 at midnight, -1 at midday
  return Math.max(0, (t + 0.3) / 1.3) * 0.72;
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

let rainSeedCache = null;
function drawWeatherOverlay(ctx, world, width, height) {
  ctx.fillStyle = WEATHER_TINT[world.weather.current] || 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, width, height);

  if (world.weather.current === 'rain' || world.weather.current === 'storm') {
    if (!rainSeedCache || rainSeedCache.length !== 60) {
      rainSeedCache = Array.from({ length: 60 }, () => ({ x: Math.random() * width, y: Math.random() * height }));
    }
    ctx.strokeStyle = 'rgba(180,200,230,0.35)';
    ctx.lineWidth = 1;
    for (const drop of rainSeedCache) {
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - 2, drop.y + 8);
      ctx.stroke();
    }
  }
  if (world.weather.current === 'snow') {
    if (!rainSeedCache || rainSeedCache.length !== 40) {
      rainSeedCache = Array.from({ length: 40 }, () => ({ x: Math.random() * width, y: Math.random() * height }));
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const flake of rainSeedCache) {
      ctx.beginPath();
      ctx.arc(flake.x, flake.y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
