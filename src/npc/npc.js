// npc.js — Per-NPC tick: the glue between all the cognition modules.
//
// Each tick an NPC: decays needs/emotion/memory, periodically reconsiders
// its goal (utility AI + routine, unless an emergency interrupt
// preempts), walks toward wherever that goal requires (A*), and performs
// the goal's action once there (eat/sleep/work/converse/...). This file
// intentionally contains no "psychological model" of its own — it is
// pure orchestration wiring goals.js, emotions.js, memory.js, beliefs.js,
// relationships.js, and perception.js together into one believable loop.

import { decayNeeds, satisfyNeed, candidateGoals, planForGoal } from '../cognition/goals.js';
import { decayEmotion, appraiseAchievement, appraiseGoalProgress } from '../cognition/emotions.js';
import { decayMemories, drainImmediate, recordMemory, importanceFromEmotion } from '../cognition/memory.js';
import { routineCandidate } from '../sim/schedule.js';
import { findPath } from '../sim/pathfinding.js';
import { findBuilding, buildingsByRole } from '../sim/map.js';
import { converse } from '../dialogue/dialogue.js';
import { nearbyNpcs } from '../cognition/perception.js';

const MOVE_TICKS_PER_TILE = 1; // 1 sim-minute per tile at normal walking pace
const RECONSIDER_MIN_MINUTES = 25;
const RECONSIDER_MAX_MINUTES = 45;

function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

function nearestBuilding(world, npc, role) {
  const options = buildingsByRole(world.map, role);
  if (options.length === 0) return null;
  return options.reduce((best, b) => (dist(npc.position, b.door) < dist(npc.position, best.door) ? b : best), options[0]);
}

function resolveTarget(world, npc, goalType, meta, rng) {
  if (goalType === 'need:hunger') {
    const roll = rng.next();
    const role = roll < 0.6 ? 'home' : roll < 0.8 ? 'bakery' : 'tavern';
    const b = role === 'home' ? findBuilding(world.map, npc.homeBuildingId) : nearestBuilding(world, npc, role);
    return b || findBuilding(world.map, npc.homeBuildingId);
  }
  if (goalType === 'need:rest') return findBuilding(world.map, npc.homeBuildingId);
  if (goalType === 'need:safety') return findBuilding(world.map, npc.homeBuildingId);
  if (goalType === 'need:social') return nearestBuilding(world, npc, 'tavern') || findBuilding(world.map, npc.homeBuildingId);
  if (goalType === 'need:esteem' || goalType === 'need:purpose' || goalType.startsWith('ambition:')) {
    return findBuilding(world.map, npc.workBuildingId) || findBuilding(world.map, npc.homeBuildingId);
  }
  if (goalType === 'routine') {
    return nearestBuilding(world, npc, meta.buildingRole) || findBuilding(world.map, npc.homeBuildingId);
  }
  if (goalType === 'interrupt') {
    return { door: meta.location || npc.position, id: null, role: 'event' };
  }
  return findBuilding(world.map, npc.homeBuildingId);
}

function reconsiderGoal(world, npc, rng) {
  const candidates = candidateGoals(world, npc, rng);
  candidates.push(routineCandidate(npc, world.clock.hour, world.weather.current));
  candidates.sort((a, b) => b.utility - a.utility);
  const chosen = candidates[0];

  npc.goals.activeGoalType = chosen.type;
  npc.goals.activeMeta = chosen.meta;
  const target = resolveTarget(world, npc, chosen.type, chosen.meta, rng);
  npc.goals.targetBuildingId = target.id || null;
  npc.goals.targetTile = target.door;
  if (dist(npc.position, target.door) > 0) {
    npc.goals.path = findPath(world.map, npc.position, target.door) || [];
  } else {
    npc.goals.path = [];
  }
  npc.goals.nextReconsiderAt = world.clock.totalMinutes + rng.int(RECONSIDER_MIN_MINUTES, RECONSIDER_MAX_MINUTES);
}

function moveAlongPath(npc) {
  if (!npc.goals.path || npc.goals.path.length === 0) return false;
  npc.indoors = false;
  npc.position = npc.goals.path.shift();
  return true;
}

function performActivity(world, npc, rng) {
  const goalType = npc.goals.activeGoalType;
  const meta = npc.goals.activeMeta || {};
  npc.indoors = true;
  npc.currentAction = { type: goalType, absorbing: true };

  if (goalType === 'need:hunger') {
    satisfyNeed(npc, 'hunger', 18);
    if (npc.needs.hunger >= 70) npc.goals.nextReconsiderAt = world.clock.totalMinutes;
  } else if (goalType === 'need:rest') {
    satisfyNeed(npc, 'rest', world.clock.isNight() ? 12 : 4);
    if (npc.needs.rest >= 85) npc.goals.nextReconsiderAt = world.clock.totalMinutes;
    if (rng.bool(0.12)) attemptConversation(world, npc, rng); // a word with the housemates before/after sleep
  } else if (goalType === 'need:safety') {
    satisfyNeed(npc, 'safety', 15);
    npc.emotion.tags.fear = Math.max(0, npc.emotion.tags.fear - 0.1);
  } else if (goalType === 'need:esteem' || goalType === 'need:purpose' || goalType === 'routine') {
    satisfyNeed(npc, 'esteem', 3);
    satisfyNeed(npc, 'purpose', 3);
    // Coworkers and neighbors chat while working or running errands too,
    // not only during dedicated "social" time — that's how relationships
    // between people who merely share a workplace or a market actually form.
    const chatChance = meta.activity === 'social' ? 1 : meta.activity === 'work' || meta.activity === 'errand' ? 0.35 : 0.1;
    if (rng.bool(chatChance)) attemptConversation(world, npc, rng);
  } else if (goalType === 'need:social') {
    satisfyNeed(npc, 'social', 10);
    attemptConversation(world, npc, rng);
  } else if (goalType.startsWith('ambition:')) {
    const amb = meta.ambition;
    amb.progress = Math.min(1, amb.progress + rng.float(0.002, 0.01));
    satisfyNeed(npc, 'purpose', 4);
    appraiseGoalProgress(npc, 0.2);
    if (amb.progress >= 1 && !amb.achieved) {
      amb.achieved = true;
      appraiseAchievement(npc, 0.9);
      recordMemory(world, npc, {
        what: `finally achieved a lifelong ambition: to ${amb.description}`,
        who: [], where: npc.workBuildingId,
        importance: 0.95, emotionalValence: 0.9, tags: ['ambition', 'achievement'],
      });
      world.timeline.push({
        id: `evt_ambition_${world.clock.totalMinutes}_${npc.id}`,
        when: world.clock.totalMinutes, type: 'achievement',
        description: `${npc.name} achieved their ambition: ${amb.description}.`,
        involved: [npc.id], importance: 0.85,
      });
    }
  } else if (goalType === 'interrupt') {
    respondToEmergency(world, npc, meta, rng);
    npc.goals.interrupt = null;
    npc.goals.nextReconsiderAt = world.clock.totalMinutes;
  }
}

function attemptConversation(world, npc, rng) {
  const others = nearbyNpcs(world, npc, 3).filter((n) => !n.busyThisTick);
  if (others.length === 0) return;
  const partner = rng.pick(others);
  if (partner.busyThisTick || npc.busyThisTick) return;
  npc.busyThisTick = true;
  partner.busyThisTick = true;
  const renderer = world.settings && world.settings.flavorRenderer;
  const result = converse(world, npc, partner, rng, renderer);
  satisfyNeed(partner, 'social', 8);
  if (['accuse', 'gossip', 'confess'].includes(result.intent)) {
    world.timeline.push({
      id: `evt_convo_${world.clock.totalMinutes}_${npc.id}_${partner.id}`,
      when: world.clock.totalMinutes, type: 'conversation',
      description: `${npc.name} ${verbFor(result.intent)} with ${partner.name}.`,
      involved: [npc.id, partner.id], importance: result.intent === 'accuse' ? 0.55 : 0.4,
    });
  }
}

function verbFor(intent) {
  return { accuse: 'had a confrontation', gossip: 'gossiped', confess: 'confessed something' }[intent] || 'talked';
}

function respondToEmergency(world, npc, meta, rng) {
  recordMemory(world, npc, {
    what: `responded to an emergency: ${meta.type || 'trouble'}`,
    who: meta.involved || [], where: npc.workBuildingId,
    importance: 0.75, emotionalValence: -0.3, tags: ['emergency', meta.type || 'unknown'],
  });
}

export function tickNpc(world, npc, dtMinutes, rng) {
  npc.busyThisTick = false;
  decayNeeds(npc, dtMinutes);
  decayEmotion(npc, dtMinutes);
  decayMemories(world, npc, dtMinutes);
  drainImmediate(world, npc);

  if (!npc.goals.activeGoalType || npc.goals.interrupt || world.clock.totalMinutes >= (npc.goals.nextReconsiderAt || 0)) {
    reconsiderGoal(world, npc, rng);
  }

  const arrived = !npc.goals.path || npc.goals.path.length === 0;
  if (!arrived) {
    moveAlongPath(npc);
  } else {
    performActivity(world, npc, rng);
  }
}
