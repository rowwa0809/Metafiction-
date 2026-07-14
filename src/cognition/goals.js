// goals.js — Utility AI + a lightweight GOAP hybrid.
//
// Psychological model: Maslow-flavored needs (hunger, rest, safety,
// social, esteem, purpose) constantly decay and generate candidate goals;
// a utility function scores each candidate by urgency x personality
// weight x current emotional state, and the highest scorer becomes the
// active goal. Long-term ambitions (from personality/backstory) compete
// in the same utility pool as a standing low-urgency, high-weight option,
// so someone driven and ambitious will drop chores to pursue their dream
// more often than someone who isn't. Once a goal is chosen, a small GOAP
// step turns it into a concrete action sequence — not a full STRIPS
// planner, but goal -> ordered action recipe with preconditions checked
// at execution time so finished steps are skipped. Emergencies bypass all
// of this: they set an interrupt that outscores everything until resolved.

import { RNG } from '../core/rng.js';

export const NEEDS = ['hunger', 'rest', 'safety', 'social', 'esteem', 'purpose'];

const DECAY_PER_DAY = { hunger: 70, rest: 55, safety: 8, social: 35, esteem: 15, purpose: 12 };

function clamp0100(v) { return Math.min(100, Math.max(0, v)); }

export function initNeeds() {
  const n = {};
  for (const k of NEEDS) n[k] = 70 + Math.random() * 0; // placeholder overwritten by worldgen w/ seeded rng
  return n;
}

export function initNeedsSeeded(rng) {
  const n = {};
  for (const k of NEEDS) n[k] = rng.int(55, 90);
  return n;
}

export function decayNeeds(npc, dtMinutes) {
  const days = dtMinutes / 1440;
  for (const k of NEEDS) {
    npc.needs[k] = clamp0100(npc.needs[k] - DECAY_PER_DAY[k] * days);
  }
}

export function satisfyNeed(npc, need, amount) {
  npc.needs[need] = clamp0100(npc.needs[need] + amount);
}

const AMBITION_TEMPLATES = {
  smith: ['become the village\'s master smith', 'forge a legendary blade'],
  baker: ['open a second bakery', 'win the harvest festival baking contest'],
  farmer: ['own the largest farm in the valley', 'breed the finest livestock in the region'],
  merchant: ['become the wealthiest trader in the village', 'establish a trade route to the city'],
  guard: ['be named captain of the guard', 'root out corruption in the council'],
  clergy: ['build a grand new chapel', 'convert every doubter in the village'],
  healer: ['discover a cure for the fever', 'train an apprentice worthy of the craft'],
  laborer: ['leave this village and see the world', 'save enough to buy their own land'],
};
const PERSONAL_AMBITIONS = [
  'win back a love once lost', 'clear their family name', 'find their long-lost sibling',
  'prove themself to a disapproving parent', 'settle an old score', 'raise their children better than they were raised',
];

export function generateAmbitions(rng, personality, occupation) {
  const list = [];
  const pool = AMBITION_TEMPLATES[occupation] || AMBITION_TEMPLATES.laborer;
  list.push({ id: 'amb_career', description: rng.pick(pool), progress: 0, active: true, weight: 0.3 + personality.baseline.values.ambition * 0.5 });
  if (rng.bool(0.6)) {
    list.push({ id: 'amb_personal', description: rng.pick(PERSONAL_AMBITIONS), progress: 0, active: true, weight: 0.2 + personality.baseline.values.family * 0.4 });
  }
  return list;
}

function needWeight(npc, need) {
  const p = npc.personality.current;
  switch (need) {
    case 'social': return 0.6 + p.big5.extraversion * 0.6;
    case 'esteem': return 0.5 + p.values.ambition * 0.6;
    case 'purpose': return 0.5 + p.values.ambition * 0.4 + p.big5.conscientiousness * 0.3;
    case 'safety': return 0.7 + p.big5.neuroticism * 0.5;
    case 'rest': return 0.8 + p.core.emotionalStability * 0.2;
    case 'hunger': return 1.0;
    default: return 0.6;
  }
}

export function candidateGoals(world, npc, rng) {
  const candidates = [];

  if (npc.goals.interrupt) {
    candidates.push({ type: 'interrupt', utility: 999, meta: npc.goals.interrupt });
  }

  for (const need of NEEDS) {
    const urgency = 1 - npc.needs[need] / 100;
    const jitter = rng ? rng.float(-0.03, 0.03) : 0;
    const utility = urgency * needWeight(npc, need) + jitter;
    if (urgency > 0.15) candidates.push({ type: `need:${need}`, utility, meta: { need } });
  }

  for (const amb of npc.goals.ambitions) {
    if (!amb.active || amb.progress >= 1) continue;
    const utility = amb.weight * (0.5 + npc.emotion.valence * 0.2);
    candidates.push({ type: `ambition:${amb.id}`, utility, meta: { ambition: amb } });
  }

  candidates.sort((a, b) => b.utility - a.utility);
  return candidates;
}

export function selectGoal(world, npc, rng) {
  const candidates = candidateGoals(world, npc, rng);
  return candidates[0] || { type: 'need:purpose', utility: 0, meta: { need: 'purpose' } };
}

export function raiseInterrupt(npc, type, meta = {}) {
  npc.goals.interrupt = { type, meta, raisedAt: null };
}

export function clearInterrupt(npc) {
  npc.goals.interrupt = null;
}

// --- Lightweight GOAP: goal -> ordered action recipe --------------------
// Each action is { type, target } consumed one at a time by the sim loop.
// `target` is a building-role string resolved to a concrete building by
// the caller (npc.js/simulation.js), since goals.js has no map knowledge.

export function planForGoal(goalType, meta) {
  switch (true) {
    case goalType === 'need:hunger':
      return [{ type: 'walkTo', target: 'food' }, { type: 'eat' }];
    case goalType === 'need:rest':
      return [{ type: 'walkTo', target: 'home' }, { type: 'sleep' }];
    case goalType === 'need:social':
      return [{ type: 'walkTo', target: 'social' }, { type: 'converse' }];
    case goalType === 'need:esteem' || goalType === 'need:purpose':
      return [{ type: 'walkTo', target: 'work' }, { type: 'work' }];
    case goalType === 'need:safety':
      return [{ type: 'walkTo', target: 'home' }, { type: 'seekSafety' }];
    case goalType.startsWith('ambition:'):
      return [{ type: 'walkTo', target: 'work' }, { type: 'pursueAmbition', target: meta.ambition } ];
    case goalType === 'interrupt':
      return [{ type: 'walkTo', target: 'event' }, { type: 'respondToEmergency', target: meta } ];
    default:
      return [{ type: 'idle' }];
  }
}
