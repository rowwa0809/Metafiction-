// worldState.js — The entire world is one serializable object.
//
// Everything the simulation needs — clock, map, every NPC, every memory,
// belief, relationship, and timeline event — lives on a single `world`
// object built by createWorld(seed). This is deliberate: it's what makes
// save/load, catch-up simulation, and "same seed = same history" simple.
// The relational-schema tables (npcs/memories/beliefs/relationships/
// events) are kept as plain id-keyed objects here so a future migration
// to a real database is a mechanical exercise, not a redesign.

import { RNG } from './rng.js';
import { Clock } from './clock.js';
import { generateMap } from '../sim/map.js';
import { generatePopulation } from '../npc/worldgen.js';
import { createPlayer } from '../player/player.js';
import { initEconomy } from '../economy/economy.js';
import { initSociety } from '../society/society.js';

const WEATHER_STATES = ['clear', 'overcast', 'rain', 'storm', 'fog', 'snow'];

export function createWorld(seed) {
  const rng = new RNG(seed);
  const world = {
    seed,
    rng,
    nextIdCounter: 1,
    clock: new Clock(),
    weather: { current: 'clear', nextChangeAt: 0 },
    map: null,
    npcs: {},
    memories: {},
    beliefs: {},
    relationships: {},
    timeline: [],
    economy: initEconomy(),
    society: initSociety(),
    settings: { flavorRenderer: null, speedMinutesPerRealSecond: 1 },
    lastConsolidationDay: -1,
    lastSavedRealTime: Date.now(),
  };

  world.map = generateMap(rng.child('map'));
  generatePopulation(world, rng.child('population'));
  createPlayer(world, rng.child('player_identity'));
  rollWeather(world, rng);

  world.timeline.push({
    id: 'evt_genesis', when: world.clock.totalMinutes, type: 'genesis',
    description: `The village awakens. Seed ${seed}.`, importance: 0.3,
  });

  return world;
}

export function rollWeather(world, rng) {
  const season = world.clock.season;
  const weights = seasonalWeatherWeights(season);
  world.weather.current = rng.weighted(weights.map((w) => ({ item: w.state, weight: w.weight })));
  world.weather.nextChangeAt = world.clock.totalMinutes + rng.int(180, 600);
}

function seasonalWeatherWeights(season) {
  const base = WEATHER_STATES.map((s) => ({ state: s, weight: 1 }));
  const bump = (state, w) => { const e = base.find((b) => b.state === state); if (e) e.weight = w; };
  if (season === 'Summer') { bump('clear', 5); bump('storm', 2); bump('snow', 0.01); }
  if (season === 'Winter') { bump('snow', 4); bump('clear', 2); bump('rain', 0.5); }
  if (season === 'Autumn') { bump('overcast', 3); bump('fog', 3); bump('rain', 2); }
  if (season === 'Spring') { bump('rain', 3); bump('clear', 3); }
  return base;
}

// --- Serialization -------------------------------------------------------
// Only plain-data fields are kept; the RNG collapses to its integer state
// so restoring it resumes the exact same deterministic stream.

export function serializeWorld(world) {
  return {
    version: 1,
    seed: world.seed,
    rngState: world.rng.serialize(),
    nextIdCounter: world.nextIdCounter,
    clock: world.clock.serialize(),
    weather: world.weather,
    map: serializeMap(world.map),
    npcs: world.npcs,
    memories: world.memories,
    beliefs: world.beliefs,
    relationships: world.relationships,
    timeline: world.timeline,
    economy: world.economy,
    society: world.society,
    lastConsolidationDay: world.lastConsolidationDay,
    savedAtRealTime: Date.now(),
  };
}

function serializeMap(map) {
  return { width: map.width, height: map.height, tiles: Array.from(map.tiles), buildings: map.buildings };
}

export function deserializeWorld(data) {
  const world = {
    seed: data.seed,
    rng: RNG.fromState(data.rngState),
    nextIdCounter: data.nextIdCounter,
    clock: Clock.deserialize(data.clock),
    weather: data.weather,
    map: { width: data.map.width, height: data.map.height, tiles: Uint8Array.from(data.map.tiles), buildings: data.map.buildings },
    npcs: data.npcs,
    memories: data.memories,
    beliefs: data.beliefs,
    relationships: data.relationships,
    timeline: data.timeline,
    economy: data.economy,
    society: data.society,
    settings: { flavorRenderer: null, speedMinutesPerRealSecond: 1 },
    lastConsolidationDay: data.lastConsolidationDay ?? -1,
    lastSavedRealTime: data.savedAtRealTime || Date.now(),
  };
  return world;
}
