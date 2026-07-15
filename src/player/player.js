// player.js — The player is just another person in the belief network.
//
// There is no special "reputation" variable for the player. The player
// entity is a real row in world.npcs (isPlayer: true) with the same
// needs/emotion/memory/belief/relationship records as everyone else.
// NPCs form opinions of the player through the exact same
// dialogue/beliefs/relationships pipeline used for NPC-to-NPC
// interaction — talk() below calls dialogue.converse() with a forced
// intent (chosen from the interaction menu, not auto-selected), and
// giveGift/stealFrom/spreadRumor are just physical-world variants of the
// same "do a thing that changes memories, beliefs, and relationships on
// both sides" pattern.

import { nextId } from '../core/ids.js';
import { generatePersonality } from '../cognition/personality.js';
import { initNeedsSeeded } from '../cognition/goals.js';
import { initEmotion, appraiseGoalProgress, appraiseThreat } from '../cognition/emotions.js';
import { seedRealityBelief, updateBelief } from '../cognition/beliefs.js';
import { adjustEdge, addGrudge, getEdge } from '../cognition/relationships.js';
import { recordMemory, importanceFromEmotion } from '../cognition/memory.js';
import { converse, deliverSimulationClaim } from '../dialogue/dialogue.js';
import { nearbyNpcs, buildingAt } from '../cognition/perception.js';
import { isWalkable, findBuilding } from '../sim/map.js';

export function createPlayer(world, rng, name = 'Traveler') {
  const id = 'player';
  const hall = world.map.buildings.find((b) => b.role === 'hall') || world.map.buildings[0];
  const personality = generatePersonality(rng.child('player'));
  const player = {
    id, name, sex: 'M', age: 27, occupation: 'traveler', education: 'unknown', hometown: 'somewhere beyond the hills',
    isPlayer: true,
    personality,
    fear: 'being forgotten by history', dream: 'finding a place to belong',
    family: { parents: [], siblings: [], spouse: null, children: [] },
    homeBuildingId: hall.id, workBuildingId: hall.id,
    position: { x: hall.door.x, y: hall.door.y }, facing: { dx: 0, dy: 1 }, indoors: false,
    needs: initNeedsSeeded(rng.child('player_needs')),
    emotion: initEmotion(),
    memoryIds: [], beliefIds: [],
    goals: { interrupt: null, ambitions: [], activeGoalType: null, plan: [], planStep: 0 },
    currentAction: null, updatePriority: 1, internalMonologue: '...',
    alive: true, coin: 30,
  };
  seedRealityBelief(world, player);
  world.npcs[id] = player;
  return player;
}

export function movePlayer(world, dx, dy) {
  const player = world.npcs.player;
  const nx = player.position.x + dx;
  const ny = player.position.y + dy;
  if (!isWalkable(world.map, nx, ny)) return false;
  player.position = { x: nx, y: ny };
  player.facing = { dx: Math.sign(dx), dy: Math.sign(dy) };
  player.indoors = false;
  return true;
}

export function nearbyTalkableNpcs(world, range = 2) {
  const player = world.npcs.player;
  return nearbyNpcs(world, player, range);
}

export function talk(world, targetId, intent, rng) {
  const player = world.npcs.player;
  const target = world.npcs[targetId];
  if (!target) return null;
  const renderer = world.settings && world.settings.flavorRenderer;
  const result = converse(world, player, target, rng, renderer, intent);
  return result;
}

export function tellSimulationClaim(world, targetId, rng) {
  const player = world.npcs.player;
  const target = world.npcs[targetId];
  if (!target) return null;
  const renderer = world.settings && world.settings.flavorRenderer;
  return deliverSimulationClaim(world, player, target, rng, renderer);
}

export function giveGift(world, targetId, amount) {
  const player = world.npcs.player;
  const target = world.npcs[targetId];
  if (!target || player.coin < amount) return { ok: false, reason: 'not enough coin' };
  player.coin -= amount;
  target.coin = (target.coin || 0) + amount;
  adjustEdge(world, target.id, player.id, { affection: 0.1 + amount * 0.01, trust: 0.06 });
  adjustEdge(world, player.id, target.id, { affection: 0.05 });
  appraiseGoalProgress(target, 0.5);
  const where = buildingAt(world, player.position)?.id || null;
  recordMemory(world, target, {
    what: `${player.name} gave me a gift of ${amount} coin`, who: [player.id], where,
    importance: importanceFromEmotion(0.6, 0.6, target.emotion.arousal), emotionalValence: 0.6,
    tags: ['gift', player.id],
  });
  recordMemory(world, player, {
    what: `gave ${target.name} a gift of ${amount} coin`, who: [target.id], where,
    importance: 0.4, emotionalValence: 0.3, tags: ['gift', target.id],
  });
  world.timeline.push({
    id: `evt_gift_${world.clock.totalMinutes}_${target.id}`, when: world.clock.totalMinutes, type: 'gift',
    description: `${player.name} gave ${target.name} a gift of ${amount} coin.`, involved: [player.id, target.id], importance: 0.3,
  });
  return { ok: true };
}

export function stealFrom(world, targetId, rng) {
  const player = world.npcs.player;
  const target = world.npcs[targetId];
  if (!target || !target.coin) return { ok: false, reason: 'nothing to steal' };
  const amount = Math.min(target.coin, rng.int(2, 6));
  const witnesses = nearbyNpcs(world, player, 5).filter((n) => n.id !== target.id);
  const caught = witnesses.length > 0 && rng.bool(0.35 + witnesses.length * 0.1);

  target.coin -= amount;
  player.coin = (player.coin || 0) + amount;
  const where = buildingAt(world, player.position)?.id || null;

  if (caught) {
    const witness = witnesses[0];
    addGrudge(world, target.id, player.id, `caught ${player.name} stealing from them`, 0.7);
    for (const w of witnesses) {
      updateBelief(world, w, { subject: player.id, predicate: 'isATheif', object: 'true', signalConfidence: 0.9, weight: 0.6 });
      appraiseThreat(w, 0.3);
      recordMemory(world, w, {
        what: `witnessed ${player.name} steal from ${target.name}`, who: [player.id, target.id], where,
        importance: 0.8, emotionalValence: -0.4, tags: ['theft', 'witnessed', player.id],
      });
    }
    world.timeline.push({
      id: `evt_playertheft_${world.clock.totalMinutes}`, when: world.clock.totalMinutes, type: 'theft',
      description: `${player.name} was caught stealing ${amount} coin from ${target.name}.`,
      involved: [player.id, target.id, ...witnesses.map((w) => w.id)], importance: 0.7,
    });
  } else {
    recordMemory(world, target, {
      what: `noticed ${amount} coin missing — suspects it might have been ${player.name}`, who: [player.id], where,
      importance: 0.5, emotionalValence: -0.3, tags: ['theft', 'suspicion', player.id],
    });
  }
  return { ok: true, caught, amount };
}

export function spreadRumor(world, targetListenerId, aboutNpcId, claimText, rng) {
  const player = world.npcs.player;
  const listener = world.npcs[targetListenerId];
  if (!listener) return null;
  const belief = updateBelief(world, player, {
    subject: aboutNpcId, predicate: 'rumoredTo', object: claimText, signalConfidence: 0.85, weight: 0.5,
  });
  const edge = getEdge(world, listener.id, player.id);
  const meta = { sentiment: edge.trust - 0.5, belief, gossipObject: claimText };
  const result = converse(world, player, listener, rng, world.settings && world.settings.flavorRenderer, 'gossip', meta);
  return { belief, result };
}
