// map.js — The village's physical layout.
//
// Not a gameplay-critical module psychologically, but it's what perception
// and pathfinding hang off of: buildings have a footprint (impassable) and
// a door tile (walkable, the point NPCs actually path to and "enter"
// through). Layout is generated from the seeded RNG so the same seed
// always produces the same village.

export const TERRAIN = { GRASS: 0, ROAD: 1, WATER: 2, FARMLAND: 3 };

const BUILDING_DEFS = [
  { role: 'bakery', name: 'The Bakery', w: 4, h: 3, color: '#c98a4b' },
  { role: 'forge', name: 'The Forge', w: 4, h: 4, color: '#5a4a42' },
  { role: 'tavern', name: 'The Wandering Boar Tavern', w: 5, h: 4, color: '#8a5a3c' },
  { role: 'chapel', name: 'Chapel of the Vigil', w: 5, h: 5, color: '#9aa5b1' },
  { role: 'market', name: 'Market Square', w: 5, h: 3, color: '#b8934f' },
  { role: 'farm', name: 'North Farm', w: 6, h: 4, color: '#7c9a4a' },
  { role: 'farm', name: 'South Farm', w: 6, h: 4, color: '#7c9a4a' },
  { role: 'guardhouse', name: 'Guardhouse', w: 4, h: 3, color: '#6b6f76' },
  { role: 'healer', name: 'Healer\'s Hut', w: 3, h: 3, color: '#7a8f8a' },
  { role: 'hall', name: 'Village Hall', w: 5, h: 4, color: '#a3875a' },
  { role: 'home', name: 'Miller House', w: 3, h: 3, color: '#946b4d' },
  { role: 'home', name: 'Carter House', w: 3, h: 3, color: '#946b4d' },
  { role: 'home', name: 'Fisher House', w: 3, h: 3, color: '#946b4d' },
  { role: 'home', name: 'Weaver House', w: 3, h: 3, color: '#946b4d' },
  { role: 'home', name: 'Shepherd House', w: 3, h: 3, color: '#946b4d' },
  { role: 'home', name: 'Cooper House', w: 3, h: 3, color: '#946b4d' },
  { role: 'home', name: 'Fletcher House', w: 3, h: 3, color: '#946b4d' },
  { role: 'home', name: 'Tanner House', w: 3, h: 3, color: '#946b4d' },
];

export const MAP_WIDTH = 52;
export const MAP_HEIGHT = 40;

// Fixed candidate lots, laid out on an explicit non-overlapping grid with
// generous gaps for road frontage. Each category has EXACTLY as many lots
// as BUILDING_DEFS has buildings of that category, so assignment can never
// wrap around and double up two buildings on one lot. The seeded RNG only
// decides *which* building def goes in which lot within its category, so
// layouts vary by seed without ever producing broken geometry.
const LOTS_LARGE = [ // biggest footprints (forge/tavern/chapel/hall/farm x2)
  { x: 3, y: 3 }, { x: 21, y: 3 }, { x: 39, y: 3 },
  { x: 3, y: 21 }, { x: 21, y: 21 }, { x: 39, y: 21 },
];
const LOTS_WORKSHOP = [ // bakery/market/guardhouse/healer — sit in the gap between the two large rows
  { x: 3, y: 13 }, { x: 13, y: 13 }, { x: 23, y: 13 }, { x: 33, y: 13 },
];
const LOTS_HOME = [ // the 8 households, below the second large row
  { x: 3, y: 30 }, { x: 10, y: 30 }, { x: 17, y: 30 }, { x: 24, y: 30 }, { x: 31, y: 30 }, { x: 38, y: 30 },
  { x: 3, y: 34 }, { x: 10, y: 34 },
];

function isLarge(def) { return def.w * def.h >= 16; }
function isHome(def) { return def.role === 'home'; }

export function generateMap(rng) {
  const tiles = new Uint8Array(MAP_WIDTH * MAP_HEIGHT).fill(TERRAIN.GRASS);
  const buildings = [];

  const large = BUILDING_DEFS.filter((b) => isLarge(b));
  const homes = BUILDING_DEFS.filter((b) => !isLarge(b) && isHome(b));
  const workshops = BUILDING_DEFS.filter((b) => !isLarge(b) && !isHome(b));

  const largeSlots = rng.shuffle(LOTS_LARGE);
  const workshopSlots = rng.shuffle(LOTS_WORKSHOP);
  const homeSlots = rng.shuffle(LOTS_HOME);

  let idx = 0;
  large.forEach((def, i) => placeBuilding(buildings, tiles, def, largeSlots[i], idx++));
  workshops.forEach((def, i) => placeBuilding(buildings, tiles, def, workshopSlots[i], idx++));
  homes.forEach((def, i) => placeBuilding(buildings, tiles, def, homeSlots[i], idx++));

  // A simple road spine connecting the middle of the map, cosmetic only.
  for (let x = 0; x < MAP_WIDTH; x++) setTerrain(tiles, x, Math.floor(MAP_HEIGHT / 2), TERRAIN.ROAD);
  for (let y = 0; y < MAP_HEIGHT; y++) setTerrain(tiles, Math.floor(MAP_WIDTH / 2), y, TERRAIN.ROAD);

  // A small pond for atmosphere, tucked in the clear strip to the right of
  // the building grid (rightmost lots end at x=45, map is 52 wide).
  for (let y = 4; y < 9; y++) for (let x = 47; x < 51; x++) setTerrain(tiles, x, y, TERRAIN.WATER);

  return { width: MAP_WIDTH, height: MAP_HEIGHT, tiles, buildings };
}

function setTerrain(tiles, x, y, t) {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return;
  tiles[y * MAP_WIDTH + x] = t;
}

function placeBuilding(buildings, tiles, def, lot, index) {
  const b = {
    id: `bldg_${index}`,
    name: def.name,
    role: def.role,
    x: lot.x, y: lot.y, w: def.w, h: def.h,
    color: def.color,
    door: { x: lot.x + Math.floor(def.w / 2), y: lot.y + def.h },
  };
  buildings.push(b);
}

export function isWalkable(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  if (map.tiles[y * map.width + x] === TERRAIN.WATER) return false;
  for (const b of map.buildings) {
    const insideFootprint = x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    if (insideFootprint) return false; // interiors are abstracted, not walked through
  }
  return true;
}

export function buildingsByRole(map, role) {
  return map.buildings.filter((b) => b.role === role);
}

export function findBuilding(map, id) {
  return map.buildings.find((b) => b.id === id) || null;
}
