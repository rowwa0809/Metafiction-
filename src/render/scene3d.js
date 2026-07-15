// scene3d.js — Real-time 3D presentation layer (Three.js/WebGL).
//
// This is a straight swap of the *presentation* layer only: it reads the
// exact same world.clock / world.weather / world.npcs / world.map that
// the old Canvas 2D renderer read, and touches no simulation state. The
// village is still built from primitive geometry (boxes, extruded
// prisms, capsules) rather than authored art assets — there are no
// external models or textures — but it now has real depth, real
// per-pixel lighting and shadows, fog, and a day/night sky, which is as
// far as procedural geometry can reasonably chase the mood board's
// "natural lighting, believable, atmospheric" direction without actual
// 3D art production.

import * as THREE from '../vendor/three/three.module.js';

const WALL_H = 1.7;
const ROOF_H = 1.1;

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return (r << 16) | (g << 8) | b;
}

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

const TERRAIN_COLORS = ['#3c4d30', '#6d5d45', '#274357', '#5c4a2e'];

// --- ground: one baked texture instead of thousands of tile meshes -------

function bakeGroundTexture(world) {
  const { map } = world;
  const PX = 10;
  const canvas = document.createElement('canvas');
  canvas.width = map.width * PX;
  canvas.height = map.height * PX;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const type = map.tiles[y * map.width + x];
      ctx.fillStyle = TERRAIN_COLORS[type];
      ctx.fillRect(x * PX, y * PX, PX, PX);
      const h = hash2(x, y);
      const px = x * PX, py = y * PX;
      if (type === 0 && h < 0.5) {
        ctx.strokeStyle = h > 0.25 ? '#57683f' : '#2c3a22';
        ctx.beginPath();
        ctx.moveTo(px + 3 + h * (PX - 6), py + 3 + hash2(x + 1, y) * (PX - 6));
        ctx.lineTo(px + 4 + h * (PX - 6), py + 1 + hash2(x + 1, y) * (PX - 6));
        ctx.stroke();
      } else if (type === 1 && h < 0.4) {
        ctx.fillStyle = h > 0.2 ? '#7d6d55' : '#5c4e3a';
        ctx.fillRect(px + 2 + h * (PX - 5), py + 2 + hash2(x, y + 2) * (PX - 5), 2, 2);
      } else if (type === 3) {
        ctx.strokeStyle = '#3c3018';
        ctx.beginPath();
        ctx.moveTo(px, py + PX * 0.5); ctx.lineTo(px + PX, py + PX * 0.5);
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --- buildings --------------------------------------------------------------

function doorFace(b) {
  if (b.door.y >= b.y + b.h) return { dz: 1, dx: 0 };
  if (b.door.y <= b.y) return { dz: -1, dx: 0 };
  if (b.door.x >= b.x + b.w) return { dz: 0, dx: 1 };
  return { dz: 0, dx: -1 };
}

function buildFarm(b) {
  const group = new THREE.Group();
  const field = new THREE.Mesh(
    new THREE.BoxGeometry(b.w - 0.05, 0.14, b.h - 0.05),
    new THREE.MeshStandardMaterial({ color: shade(b.color, -6), roughness: 1 }),
  );
  field.position.y = 0.07;
  field.receiveShadow = true;
  group.add(field);
  const rowMat = new THREE.MeshStandardMaterial({ color: 0x2a2210, roughness: 1 });
  for (let i = 1; i < b.h; i++) {
    const row = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.2, 0.03, 0.08), rowMat);
    row.position.set(0, 0.15, -b.h / 2 + i);
    group.add(row);
  }
  return group;
}

function buildMarket(b) {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.9 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x8a3a3a, roughness: 0.7 });
  const corners = [[-b.w / 2 + 0.3, -b.h / 2 + 0.3], [b.w / 2 - 0.3, -b.h / 2 + 0.3], [-b.w / 2 + 0.3, b.h / 2 - 0.3], [b.w / 2 - 0.3, b.h / 2 - 0.3]];
  for (const [cx, cz] of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), postMat);
    post.position.set(cx, 0.7, cz);
    post.castShadow = true;
    group.add(post);
  }
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.2, 0.1, b.h - 0.2), canopyMat);
  canopy.position.y = 1.45;
  canopy.castShadow = true;
  group.add(canopy);
  return group;
}

function addRoleAccent(group, b, t) {
  if (b.role === 'chapel' || b.role === 'healer') {
    const crossMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.5 });
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.06), crossMat);
    const hz = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.06), crossMat);
    v.position.set(0, WALL_H + ROOF_H + 0.15, 0);
    hz.position.set(0, WALL_H + ROOF_H + 0.22, 0);
    group.add(v, hz);
  }
  if (b.role === 'forge') {
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), new THREE.MeshStandardMaterial({ color: 0x2e2925, roughness: 0.9 }));
    chimney.position.set(b.w * 0.25, WALL_H + ROOF_H * 0.6, -b.h * 0.15);
    chimney.castShadow = true;
    group.add(chimney);
    group.userData.smokeOrigin = chimney.position.clone().add(new THREE.Vector3(0, 0.4, 0));
  }
  if (b.role === 'tavern') {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2e2925 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5), postMat);
    post.position.set(b.w / 2 + 0.05, WALL_H - 0.1, b.h / 2 - 0.3);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.03), new THREE.MeshStandardMaterial({ color: 0xb8934f }));
    sign.position.set(b.w / 2 + 0.2, WALL_H - 0.3, b.h / 2 - 0.3);
    group.add(post, sign);
  }
  if (b.role === 'guardhouse') {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a5a5a });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5), poleMat);
    pole.position.set(-b.w / 2 + 0.15, WALL_H + ROOF_H + 0.2, -b.h / 2 + 0.15);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.02), new THREE.MeshStandardMaterial({ color: 0x8a3a3a }));
    flag.position.set(-b.w / 2 + 0.28, WALL_H + ROOF_H + 0.45, -b.h / 2 + 0.15);
    group.add(pole, flag);
  }
}

function buildBuilding(b) {
  const group = new THREE.Group();
  group.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
  group.userData.buildingId = b.id;
  group.userData.role = b.role;

  if (b.role === 'farm') { group.add(buildFarm(b)); return group; }
  if (b.role === 'market') { group.add(buildMarket(b)); return group; }

  const wallMat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.85 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.1, WALL_H, b.h - 0.1), wallMat);
  wall.position.y = WALL_H / 2;
  wall.castShadow = true; wall.receiveShadow = true;
  group.add(wall);

  const roofShape = new THREE.Shape();
  const rw = b.w / 2 + 0.2;
  roofShape.moveTo(-rw, 0);
  roofShape.lineTo(0, ROOF_H);
  roofShape.lineTo(rw, 0);
  roofShape.lineTo(-rw, 0);
  const roofDepth = b.h + 0.4;
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: roofDepth, bevelEnabled: false });
  // The shape's winding order leaves the extruded side-face normals flipped
  // (they render essentially unlit/black otherwise) — DoubleSide sidesteps
  // needing to fight ExtrudeGeometry's normal convention.
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: shade(b.color, -60), roughness: 0.8, side: THREE.DoubleSide }));
  roof.position.set(0, WALL_H, -roofDepth / 2);
  roof.castShadow = true;
  group.add(roof);

  const face = doorFace(b);
  const halfW = (b.w - 0.1) / 2, halfD = (b.h - 0.1) / 2;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, 0.06), new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.9 }));
  door.position.set(face.dx * (halfW + 0.02), 0.42, face.dz * (halfD + 0.02));
  group.add(door);

  const winMatBase = { color: 0x3a2f22, roughness: 0.6 };
  const winGeo = new THREE.BoxGeometry(0.3, 0.3, 0.05);
  const winMat1 = new THREE.MeshStandardMaterial({ ...winMatBase, emissive: 0xffd678, emissiveIntensity: 0 });
  const winMat2 = new THREE.MeshStandardMaterial({ ...winMatBase, emissive: 0xffd678, emissiveIntensity: 0 });
  const winL = new THREE.Mesh(winGeo, winMat1);
  const winR = new THREE.Mesh(winGeo, winMat2);
  if (face.dz !== 0) {
    winL.position.set(-b.w * 0.26, WALL_H * 0.58, face.dz * (halfD + 0.02));
    winR.position.set(b.w * 0.26, WALL_H * 0.58, face.dz * (halfD + 0.02));
  } else {
    winL.position.set(face.dx * (halfW + 0.02), WALL_H * 0.58, -b.h * 0.26);
    winR.position.set(face.dx * (halfW + 0.02), WALL_H * 0.58, b.h * 0.26);
  }
  group.add(winL, winR);
  group.userData.windowMats = [winMat1, winMat2];

  addRoleAccent(group, b);
  return group;
}

// --- people -------------------------------------------------------------

function buildPerson(isPlayer) {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8c39e, roughness: 0.8 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcaa27a, roughness: 0.85 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), skinMat);
  head.position.y = 1.02;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.32, 3, 8), bodyMat);
  torso.position.y = 0.64;
  const legMat = new THREE.MeshStandardMaterial({ color: shade('#cfae86', -60), roughness: 0.85 });
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.3, 2, 6), legMat);
  legL.position.set(-0.08, 0.2, 0);
  const legR = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.3, 2, 6), legMat.clone());
  legR.position.set(0.08, 0.2, 0);
  const armMat = bodyMat.clone();
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.28, 2, 6), armMat);
  armL.position.set(-0.22, 0.64, 0);
  const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.28, 2, 6), armMat.clone());
  armR.position.set(0.22, 0.64, 0);

  for (const m of [head, torso, legL, legR, armL, armR]) { m.castShadow = true; group.add(m); }

  let hat = null;
  if (isPlayer) {
    hat = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.22, 4), new THREE.MeshStandardMaterial({ color: 0xf4c542, roughness: 0.5 }));
    hat.position.y = 1.22; hat.rotation.y = Math.PI / 4;
    hat.castShadow = true;
    group.add(hat);
  }

  const distressMat = new THREE.MeshBasicMaterial({ color: 0xdc3c3c });
  const distress = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 6), distressMat);
  distress.position.y = 1.3;
  distress.visible = false;
  group.add(distress);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.28, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  group.add(ring);

  group.userData = { legL, legR, armL, armR, distress, ring, phaseOffset: Math.random() * 10 };
  return group;
}

// --- weather particles ----------------------------------------------------

// Rain reads as streaks (short line segments), not dots — each drop is a
// pair of vertices (top, bottom) a fixed streak-length apart, both moved
// down together each frame.
function buildRain(count, area) {
  const positions = new Float32Array(count * 2 * 3);
  const streakLen = 0.5;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * area.w;
    const y = Math.random() * 18;
    const z = Math.random() * area.h;
    positions[i * 6] = x; positions[i * 6 + 1] = y; positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x - 0.15; positions[i * 6 + 4] = y - streakLen; positions[i * 6 + 5] = z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xbcd8ec, transparent: true, opacity: 0.55 });
  const lines = new THREE.LineSegments(geo, mat);
  lines.userData = { speeds: Float32Array.from({ length: count }, () => 8 + Math.random() * 6), streakLen };
  return lines;
}

function buildSnow(count, area) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.random() * area.w;
    positions[i * 3 + 1] = Math.random() * 14;
    positions[i * 3 + 2] = Math.random() * area.h;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.85 });
  const points = new THREE.Points(geo, mat);
  points.userData = { speeds: Float32Array.from({ length: count }, () => 0.8 + Math.random() * 0.8), phase: Float32Array.from({ length: count }, () => Math.random() * Math.PI * 2) };
  return points;
}

// --- day/night sky helpers -----------------------------------------------

const SKY_NIGHT = new THREE.Color(0x0a0e1c);
const SKY_DAWN = new THREE.Color(0xe8a45c);
const SKY_DAY = new THREE.Color(0x9fc4e0);
const SKY_DUSK = new THREE.Color(0xd97a4a);

// Fill-light colors are deliberately brighter than the horizon sky color —
// a moonlit village should read as dim and blue, not silhouetted black.
const NIGHT_HEMI_SKY = new THREE.Color(0x2c3a5c);
const NIGHT_HEMI_GROUND = new THREE.Color(0x1c1812);
const DAY_HEMI_GROUND = new THREE.Color(0x4a3a24);

function skyColorFor(hourFraction) {
  const c = new THREE.Color();
  if (hourFraction < 5 || hourFraction >= 21) return c.copy(SKY_NIGHT);
  if (hourFraction < 7) return c.copy(SKY_NIGHT).lerp(SKY_DAWN, (hourFraction - 5) / 2);
  if (hourFraction < 9) return c.copy(SKY_DAWN).lerp(SKY_DAY, (hourFraction - 7) / 2);
  if (hourFraction < 17) return c.copy(SKY_DAY);
  if (hourFraction < 19) return c.copy(SKY_DAY).lerp(SKY_DUSK, (hourFraction - 17) / 2);
  return c.copy(SKY_DUSK).lerp(SKY_NIGHT, (hourFraction - 19) / 2);
}

const WEATHER_FOG_DENSITY = { clear: 0.007, overcast: 0.012, rain: 0.016, storm: 0.024, fog: 0.04, snow: 0.014 };

// --- public API -------------------------------------------------------------

export function createScene3D(canvas, world, width, height) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // NoToneMapping (not ACES): ACES's filmic S-curve is tuned for HDR scenes
  // with bright highlights and crushes dim/moody scenes toward black. Direct
  // control over light intensity gives a more predictable "moody, not
  // invisible" night without fighting a curve designed for something else.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);

  const center = { x: world.map.width / 2, z: world.map.height / 2 };

  const groundTex = bakeGroundTexture(world);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(world.map.width, world.map.height),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, 0, center.z);
  ground.receiveShadow = true;
  scene.add(ground);

  const buildingMeshes = new Map();
  for (const b of world.map.buildings) {
    const mesh = buildBuilding(b);
    scene.add(mesh);
    buildingMeshes.set(b.id, mesh);
  }

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -32; sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.002;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x9fc4e0, 0x33291c, 0.7);
  scene.add(hemi);

  const moonFill = new THREE.AmbientLight(0x445577, 0);
  scene.add(moonFill);

  scene.fog = new THREE.FogExp2(0x1a2233, 0.015);

  const area = { w: world.map.width, h: world.map.height };
  const rain = buildRain(500, area);
  const snow = buildSnow(350, area);
  rain.visible = false; snow.visible = false;
  scene.add(rain, snow);

  const camOffset = new THREE.Vector3(9, 11, 9);
  camera.position.set(center.x + camOffset.x, camOffset.y, center.z + camOffset.z);

  return {
    renderer, scene, camera, sun, hemi, moonFill, ground, groundTex,
    buildingMeshes, peopleMeshes: new Map(), rain, snow, center, camOffset,
    lastT: null, lightningUntil: 0,
  };
}

function updatePerson(mesh, npc, t) {
  const speed = mesh.userData._prevPos && (mesh.userData._prevPos.x !== npc.position.x || mesh.userData._prevPos.y !== npc.position.y);
  mesh.userData._prevPos = { x: npc.position.x, y: npc.position.y };
  mesh.visible = npc.alive && !npc.indoors;
  if (!mesh.visible) return;

  mesh.position.set(npc.position.x + 0.5, 0, npc.position.y + 0.5);
  const facing = npc.facing || { dx: 0, dy: 1 };
  mesh.rotation.y = Math.atan2(facing.dx, facing.dy);

  const phase = speed ? Math.sin(t * 8 + mesh.userData.phaseOffset) : 0;
  mesh.userData.legL.rotation.x = phase * 0.6;
  mesh.userData.legR.rotation.x = -phase * 0.6;
  mesh.userData.armL.rotation.x = -phase * 0.5;
  mesh.userData.armR.rotation.x = phase * 0.5;

  const distressed = npc.emotion.tags.fear > 0.5 || npc.emotion.tags.anger > 0.5;
  mesh.userData.distress.visible = distressed;
}

function isOccupied(world, buildingId) {
  for (const npc of Object.values(world.npcs)) {
    if (npc.indoors && (npc.homeBuildingId === buildingId || npc.workBuildingId === buildingId)) return true;
  }
  return false;
}

export function updateScene3D(handle, world, selectedNpcId) {
  const t = performance.now() / 1000;
  const dt = handle.lastT === null ? 0 : Math.min(0.1, t - handle.lastT);
  handle.lastT = t;

  const isNight = world.clock.isNight();
  const hf = world.clock.hourFraction;

  // sky + sun
  const sky = skyColorFor(hf);
  handle.scene.background = sky;
  const theta = ((hf - 6) / 24) * Math.PI * 2;
  const sunHeight = Math.sin(theta) * 40;
  const sunHoriz = Math.cos(theta) * 40;
  handle.sun.position.set(handle.center.x + sunHoriz, Math.max(3, sunHeight), handle.center.z + 6);
  handle.sun.target.position.set(handle.center.x, 0, handle.center.z);
  // Night is moody, not pitch black — the directional light becomes cool
  // moonlight rather than dropping to zero, and the hemisphere fill uses a
  // fixed dim night tint instead of tracking the near-black horizon-fade
  // sky color (which would otherwise light every upward-facing surface
  // with almost no light at all).
  const dayAmount = Math.max(0, Math.min(1, sunHeight / 20));
  const moonColor = new THREE.Color(0x7d92b8);
  handle.sun.intensity = 1.2 + dayAmount * 1.8;
  handle.sun.color.copy(moonColor).lerp(new THREE.Color(0xfff2d8), dayAmount);
  handle.hemi.intensity = 2.0 + dayAmount * 1.5;
  handle.hemi.color.copy(NIGHT_HEMI_SKY).lerp(sky, Math.max(dayAmount, 0.25));
  handle.hemi.groundColor.copy(NIGHT_HEMI_GROUND).lerp(DAY_HEMI_GROUND, dayAmount);
  handle.moonFill.intensity = isNight ? 1.3 : 0;

  // fog
  const weather = world.weather.current;
  handle.scene.fog.color.copy(sky);
  const targetDensity = WEATHER_FOG_DENSITY[weather] ?? 0.015;
  handle.scene.fog.density += (targetDensity - handle.scene.fog.density) * 0.05;

  // lit windows
  for (const [id, mesh] of handle.buildingMeshes) {
    if (!mesh.userData.windowMats) continue;
    const lit = isNight && isOccupied(world, id);
    for (const m of mesh.userData.windowMats) m.emissiveIntensity += ((lit ? 1.4 : 0) - m.emissiveIntensity) * 0.1;
  }

  // people
  for (const npc of Object.values(world.npcs)) {
    let mesh = handle.peopleMeshes.get(npc.id);
    if (!mesh) {
      mesh = buildPerson(npc.isPlayer);
      mesh.castShadow = true;
      handle.scene.add(mesh);
      handle.peopleMeshes.set(npc.id, mesh);
    }
    mesh.userData.ring.visible = npc.id === selectedNpcId;
    updatePerson(mesh, npc, t);
  }

  // camera follows the player with a fixed isometric-style offset
  const player = world.npcs.player;
  if (player) {
    const target = new THREE.Vector3(player.position.x + 0.5 + handle.camOffset.x, handle.camOffset.y, player.position.y + 0.5 + handle.camOffset.z);
    handle.camera.position.lerp(target, 0.06);
    handle.camera.lookAt(player.position.x + 0.5, 0.6, player.position.y + 0.5);
  }

  // weather particles
  const rainOn = weather === 'rain' || weather === 'storm';
  const snowOn = weather === 'snow';
  handle.rain.visible = rainOn;
  handle.snow.visible = snowOn;
  if (rainOn) {
    const pos = handle.rain.geometry.attributes.position;
    const speeds = handle.rain.userData.speeds;
    const streakLen = handle.rain.userData.streakLen;
    for (let i = 0; i < speeds.length; i++) {
      let y = pos.getY(i * 2) - speeds[i] * dt;
      if (y < 0) y = 18;
      pos.setY(i * 2, y);
      pos.setY(i * 2 + 1, y - streakLen);
    }
    pos.needsUpdate = true;
    handle.rain.position.set(handle.camera.position.x - handle.camOffset.x, 0, handle.camera.position.z - handle.camOffset.z);
  }
  if (snowOn) {
    const pos = handle.snow.geometry.attributes.position;
    const speeds = handle.snow.userData.speeds;
    const phase = handle.snow.userData.phase;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - speeds[i] * dt;
      let x = pos.getX(i) + Math.sin(t + phase[i]) * 0.01;
      if (y < 0) y = 14;
      pos.setY(i, y); pos.setX(i, x);
    }
    pos.needsUpdate = true;
    handle.snow.position.set(handle.camera.position.x - handle.camOffset.x, 0, handle.camera.position.z - handle.camOffset.z);
  }

  // storm lightning flash
  if (weather === 'storm' && t > handle.lightningUntil && Math.random() < 0.003) {
    handle.lightningUntil = t + 0.15;
  }
  if (t < handle.lightningUntil) {
    handle.hemi.intensity += 3;
  }

  handle.renderer.render(handle.scene, handle.camera);
}

// Raycast-based NPC picking for click-to-inspect, replacing the old flat
// tile-math approach (which doesn't make sense once the camera is angled).
export function pickNpcAt(handle, world, ndcX, ndcY) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), handle.camera);

  const idByMesh = new Map();
  const candidates = [];
  for (const [id, mesh] of handle.peopleMeshes) {
    if (!mesh.visible) continue;
    idByMesh.set(mesh.id, id);
    candidates.push(mesh);
  }
  const hits = raycaster.intersectObjects(candidates, true);
  if (hits.length === 0) return null;

  // intersectObjects with recursive=true returns individual child meshes
  // (head/torso/limbs); walk each hit up to its top-level group to find
  // which NPC it belongs to.
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && !idByMesh.has(obj.id)) obj = obj.parent;
    if (obj) return idByMesh.get(obj.id);
  }
  return null;
}
