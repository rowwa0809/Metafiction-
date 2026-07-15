// main.js — Wires the DOM to the simulation. No framework, no bundler
// required: this is loaded directly as an ES module by index.html.

import { createWorld, serializeWorld, deserializeWorld } from './core/worldState.js';
import { saveToIndexedDB, loadFromIndexedDB, exportWorldToFile, importWorldFromFile } from './core/save.js';
import { tickWorld, catchUpSimulation } from './sim/simulation.js';
import { renderFrame, canvasSize, TILE } from './render/renderer.js';
import { renderInspector } from './ui/inspector.js';
import { renderTimeline } from './ui/timeline.js';
import { renderInteractionMenu } from './ui/interactionMenu.js';
import { movePlayer } from './player/player.js';
import { OllamaDialogueRenderer, checkOllamaAvailable } from './dialogue/ollamaRenderer.js';
import { RNG } from './core/rng.js';

const canvas = document.getElementById('village-canvas');
const ctx = canvas.getContext('2d');

let world = null;
let selectedNpcId = null;
let paused = false;
let speedMultiplier = 1;
let uiRng = new RNG(1); // drives cosmetic/UI-triggered RNG (menu button ordering etc.), never the sim itself

const els = {
  seedInput: document.getElementById('seed-input'),
  btnNew: document.getElementById('btn-new'),
  btnPause: document.getElementById('btn-pause'),
  speedSelect: document.getElementById('speed-select'),
  btnSave: document.getElementById('btn-save'),
  btnExport: document.getElementById('btn-export'),
  importInput: document.getElementById('import-input'),
  hudDate: document.getElementById('hud-date'),
  hudTime: document.getElementById('hud-time'),
  hudWeather: document.getElementById('hud-weather'),
  panelInspector: document.getElementById('panel-inspector'),
  panelInteract: document.getElementById('panel-interact'),
  panelTimeline: document.getElementById('panel-timeline'),
  ollamaToggle: document.getElementById('ollama-toggle'),
  ollamaStatus: document.getElementById('ollama-status'),
  catchupModal: document.getElementById('catchup-modal'),
  catchupText: document.getElementById('catchup-text'),
  catchupYes: document.getElementById('catchup-yes'),
  catchupNo: document.getElementById('catchup-no'),
};

function setupCanvas() {
  const { width, height } = canvasSize(world);
  canvas.width = width;
  canvas.height = height;
}

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000_000);
}

async function boot() {
  const saved = await loadFromIndexedDB();
  if (saved) {
    world = deserializeWorld(saved);
    window.__genesisWorld = world;
    els.seedInput.value = world.seed;
    setupCanvas();
    maybeOfferCatchUp(saved.savedAtRealTime);
  } else {
    startNewWorld(randomSeed());
  }
  requestAnimationFrame(renderLoop);
  setInterval(simTick, 1000);
  setInterval(updatePanels, 400);
  setInterval(autoSave, 30000);
}

function startNewWorld(seed) {
  world = createWorld(seed);
  els.seedInput.value = seed;
  setupCanvas();
  selectedNpcId = null;
  window.__genesisWorld = world; // exposed for console/debug introspection, matches the inspector's "prove it's alive" ethos
}

function maybeOfferCatchUp(savedAtRealTime) {
  const elapsedMs = Date.now() - (savedAtRealTime || Date.now());
  if (elapsedMs < 30000) return;
  const elapsedMinutesAtSpeed = Math.round((elapsedMs / 1000) * speedMultiplier);
  els.catchupText.textContent = `You were away for ${Math.round(elapsedMs / 1000)}s of real time. Simulate the ${elapsedMinutesAtSpeed} in-game minutes that would have passed, or skip straight to now?`;
  els.catchupModal.classList.remove('hidden');
  els.catchupYes.onclick = () => {
    catchUpSimulation(world, Math.min(elapsedMinutesAtSpeed, 60 * 24 * 14)); // cap at 14 in-game days of catch-up
    els.catchupModal.classList.add('hidden');
  };
  els.catchupNo.onclick = () => {
    els.catchupModal.classList.add('hidden');
  };
}

let tickCounter = 0;
function simTick() {
  if (paused || !world) return;
  tickWorld(world, speedMultiplier, { tickCount: tickCounter++ });
  updateHud();
}

function updateHud() {
  document.getElementById('hud-date').textContent = world.clock.dateString();
  document.getElementById('hud-time').textContent = world.clock.timeString();
  document.getElementById('hud-weather').textContent = `${world.weather.current}${world.clock.isNight() ? ' · night' : ''}`;
}

function renderLoop() {
  if (world) renderFrame(ctx, world, { selectedNpcId });
  requestAnimationFrame(renderLoop);
}

// DOM panels are rebuilt on a slow timer (not every animation frame): the
// canvas needs 60fps for smooth walking, but rebuilding inspector/interact/
// timeline HTML that often is wasteful and — worse — can yank an
// interaction button out from under an in-progress click. A few hundred ms
// of staleness on read-only panels is imperceptible.
function updatePanels() {
  if (!world) return;
  renderInspector(els.panelInspector, world, selectedNpcId);
  renderInteractionMenu(els.panelInteract, world, uiRng, onPlayerAction);
  renderTimeline(els.panelTimeline, world);
}

function onPlayerAction() {
  updatePanels(); // reflect the consequence immediately rather than waiting for the next tick
}

// --- Input ---------------------------------------------------------------
const MOVE_KEYS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
};
let lastMoveAt = 0;
window.addEventListener('keydown', (e) => {
  if (!world) return;
  const dir = MOVE_KEYS[e.key];
  if (!dir) return;
  const now = performance.now();
  if (now - lastMoveAt < 110) return;
  lastMoveAt = now;
  movePlayer(world, dir[0], dir[1]);
});

canvas.addEventListener('click', (e) => {
  if (!world) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const tx = Math.floor(((e.clientX - rect.left) * scaleX) / TILE);
  const ty = Math.floor(((e.clientY - rect.top) * scaleY) / TILE);
  let closest = null;
  let closestDist = Infinity;
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive || npc.indoors) continue;
    const d = Math.hypot(npc.position.x - tx, npc.position.y - ty);
    if (d < closestDist) { closestDist = d; closest = npc; }
  }
  if (closest && closestDist <= 2) selectedNpcId = closest.id;
});

// --- Toolbar ---------------------------------------------------------------
els.btnNew.addEventListener('click', () => {
  const seed = parseInt(els.seedInput.value, 10) || randomSeed();
  startNewWorld(seed);
});
els.btnPause.addEventListener('click', () => {
  paused = !paused;
  els.btnPause.textContent = paused ? 'Resume' : 'Pause';
});
els.speedSelect.addEventListener('change', () => {
  speedMultiplier = parseInt(els.speedSelect.value, 10);
});
els.btnSave.addEventListener('click', async () => {
  const data = serializeWorld(world);
  await saveToIndexedDB(data);
});
els.btnExport.addEventListener('click', () => {
  exportWorldToFile(serializeWorld(world));
});
els.importInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = await importWorldFromFile(file);
  world = deserializeWorld(data);
  window.__genesisWorld = world;
  els.seedInput.value = world.seed;
  setupCanvas();
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

els.ollamaToggle.addEventListener('change', async () => {
  if (!els.ollamaToggle.checked) {
    world.settings.flavorRenderer = null;
    els.ollamaStatus.textContent = 'Off by default. The game is fully playable without it.';
    return;
  }
  els.ollamaStatus.textContent = 'Checking for a local Ollama server...';
  const available = await checkOllamaAvailable();
  if (available) {
    world.settings.flavorRenderer = new OllamaDialogueRenderer();
    els.ollamaStatus.textContent = 'Connected to local Ollama — dialogue flavor text enabled.';
  } else {
    els.ollamaToggle.checked = false;
    els.ollamaStatus.textContent = 'No local Ollama server found at localhost:11434. Falling back to grammar-based dialogue.';
  }
});

async function autoSave() {
  if (!world) return;
  await saveToIndexedDB(serializeWorld(world));
}

boot();
