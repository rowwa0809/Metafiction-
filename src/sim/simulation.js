// simulation.js — The world tick loop. Nothing waits for the player.
//
// tickWorld() advances the clock, updates weather, ticks every NPC
// (respecting a level-of-detail priority so full cognitive fidelity is
// reserved for NPCs near the player or otherwise involved in something,
// while the rest of the village still moves, just less frequently), and
// triggers the nightly "slow timer" passes: memory consolidation,
// economy, culture/festivals, and relationship-milestone detection
// (new friendships/rivalries). catchUpSimulation() is what runs when the
// player reopens the game after being away — it just calls tickWorld in
// a loop across the elapsed time, same code path as normal play.

import { tickNpc } from '../npc/npc.js';
import { consolidate } from '../cognition/memory.js';
import { updateBelief } from '../cognition/beliefs.js';
import { decayEdge, overallSentiment } from '../cognition/relationships.js';
import { economyDailyTick } from '../economy/economy.js';
import { dailySocietyTick } from '../society/society.js';
import { rollWeather } from '../core/worldState.js';

const NIGHT_CONSOLIDATION_HOUR = 3;
const LOD_NEAR_RADIUS = 24; // tiles — inside this, an NPC gets full per-tick fidelity
const LOD_SLOW_INTERVAL = 4; // otherwise, only update on every Nth tick

export function updatePriorities(world) {
  const player = world.npcs.player;
  for (const npc of Object.values(world.npcs)) {
    if (npc.isPlayer) continue;
    const near = player && dist(npc.position, player.position) <= LOD_NEAR_RADIUS;
    const involved = !!npc.goals.interrupt;
    npc.updatePriority = near || involved ? 2 : 1;
  }
}

function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

export function tickWorld(world, dtMinutes, { tickCount = 0 } = {}) {
  world.clock.advance(dtMinutes);
  if (world.clock.totalMinutes >= world.weather.nextChangeAt) {
    rollWeather(world, world.rng);
  }

  updatePriorities(world);

  for (const npc of Object.values(world.npcs)) {
    if (npc.isPlayer || !npc.alive) continue;
    const dueForSlowUpdate = npc.updatePriority >= 2 || tickCount % LOD_SLOW_INTERVAL === 0;
    if (!dueForSlowUpdate) continue;
    const effectiveDt = npc.updatePriority >= 2 ? dtMinutes : dtMinutes * LOD_SLOW_INTERVAL;
    tickNpc(world, npc, effectiveDt, world.rng);
  }

  if (world.clock.hour === NIGHT_CONSOLIDATION_HOUR && world.clock.day !== world.lastConsolidationDay) {
    runNightlyPass(world);
    world.lastConsolidationDay = world.clock.day;
  }

  return world;
}

function runNightlyPass(world) {
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive) continue;
    const { forgotten } = consolidate(world, npc);
    for (const mem of forgotten) foldIntoSemanticBelief(world, npc, mem);
  }
  detectRelationshipMilestones(world);
  for (const edge of Object.values(world.relationships)) decayEdge(edge, 1440);
  economyDailyTick(world, world.rng);
  dailySocietyTick(world, world.rng);
}

// Nightly consolidation's "compress into a semantic summary" step: a
// forgotten episodic memory about a specific person nudges a lightweight
// trait belief about them ("the baker is friendly") before the episode
// itself is discarded — the gist survives even though the detail doesn't.
function foldIntoSemanticBelief(world, npc, mem) {
  if (!mem.who || mem.who.length === 0) return;
  const trait = mem.emotionalValence > 0.15 ? 'isFriendly' : mem.emotionalValence < -0.15 ? 'isUnpleasant' : null;
  if (!trait) return;
  for (const otherId of mem.who) {
    if (otherId === npc.id) continue;
    updateBelief(world, npc, { subject: otherId, predicate: trait, object: 'true', signalConfidence: 0.7, weight: 0.15 });
  }
}

function detectRelationshipMilestones(world) {
  for (const edge of Object.values(world.relationships)) {
    const sentiment = overallSentiment(edge);
    if (!edge.milestoneFriend && sentiment > 0.35 && edge.familiarity > 0.15) {
      edge.milestoneFriend = true;
      const a = world.npcs[edge.fromId];
      const b = world.npcs[edge.toId];
      if (a && b) {
        world.timeline.push({
          id: `evt_friend_${world.clock.totalMinutes}_${edge.id}`, when: world.clock.totalMinutes, type: 'friendship',
          description: `${a.name} and ${b.name} have become friends.`, involved: [a.id, b.id], importance: 0.6,
        });
      }
    }
    if (!edge.milestoneRival && sentiment < -0.5 && edge.grudges.length > 0) {
      edge.milestoneRival = true;
      const a = world.npcs[edge.fromId];
      const b = world.npcs[edge.toId];
      if (a && b) {
        world.timeline.push({
          id: `evt_rival_${world.clock.totalMinutes}_${edge.id}`, when: world.clock.totalMinutes, type: 'rivalry',
          description: `${a.name} now considers ${b.name} a rival.`, involved: [a.id, b.id], importance: 0.6,
        });
      }
    }
  }
}

// Fast-forwards the world by targetMinutes of in-game time using the same
// tickWorld() code path as live play, in coarse chunks for speed. Used on
// load when real time has passed since the last save.
export function catchUpSimulation(world, targetMinutes, { chunkMinutes = 30, onProgress = null } = {}) {
  let remaining = targetMinutes;
  let tickCount = 0;
  while (remaining > 0) {
    const step = Math.min(chunkMinutes, remaining);
    tickWorld(world, step, { tickCount });
    remaining -= step;
    tickCount += 1;
    if (onProgress && tickCount % 20 === 0) onProgress(1 - remaining / targetMinutes);
  }
  if (onProgress) onProgress(1);
  return world;
}
