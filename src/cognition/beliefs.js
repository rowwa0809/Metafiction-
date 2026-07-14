// beliefs.js — Belief network with social propagation.
//
// Psychological model: beliefs are propositions ("the baker is kind",
// "my world is real") held with a confidence, not booleans. Evidence
// accumulates and nudges confidence; a single contradiction never flips a
// belief outright — it just weakens it and, if the resulting confidence
// lands in an uncertain middle band, raises cognitiveDissonance, which is
// itself a stressor that can drive information-seeking behavior in
// goals.js. Beliefs also spread socially: when NPCs talk, one's belief
// becomes evidence for the other's belief of the same proposition, scaled
// down by how much the listener trusts the speaker. That single mechanic
// is the entire rumor system — no separate "gossip" data structure needed.

import { nextId } from '../core/ids.js';

const LEARNING_RATE = 0.35;
const DISSONANCE_LOW = 0.35;
const DISSONANCE_HIGH = 0.65;
const MAX_EVIDENCE = 20;

function clamp01(v) { return Math.min(1, Math.max(0, v)); }

function key(subject, predicate, object) {
  return `${subject}|${predicate}|${object}`;
}

export function findBelief(world, npc, subject, predicate, object) {
  const k = key(subject, predicate, object);
  for (const id of npc.beliefIds) {
    const b = world.beliefs[id];
    if (b && b.key === k) return b;
  }
  return null;
}

function createBelief(world, npc, subject, predicate, object, confidence) {
  const id = nextId(world, 'bel');
  const now = world.clock.totalMinutes;
  const belief = {
    id,
    npcId: npc.id,
    subject, predicate, object,
    key: key(subject, predicate, object),
    confidence: clamp01(confidence),
    evidence: [],
    cognitiveDissonance: false,
    createdAt: now,
    updatedAt: now,
  };
  world.beliefs[id] = belief;
  npc.beliefIds.push(id);
  return belief;
}

// Reinforce (or contradict, if signalConfidence is low/opposite) a belief
// with a new piece of evidence. weight in (0,1] controls how much this
// single piece of evidence can move the needle — direct experience should
// use a higher weight than something merely overheard.
export function updateBelief(world, npc, { subject, predicate, object, signalConfidence, weight = 0.5, sourceMemoryId = null, fromNpcId = null }) {
  let belief = findBelief(world, npc, subject, predicate, object);
  if (!belief) belief = createBelief(world, npc, subject, predicate, object, 0.5);

  const before = belief.confidence;
  const delta = weight * LEARNING_RATE * (signalConfidence - before);
  belief.confidence = clamp01(before + delta);
  belief.updatedAt = world.clock.totalMinutes;
  belief.evidence.push({ signalConfidence, weight, sourceMemoryId, fromNpcId, when: belief.updatedAt });
  if (belief.evidence.length > MAX_EVIDENCE) belief.evidence.shift();

  const isContradiction = Math.sign(signalConfidence - 0.5) !== Math.sign(before - 0.5) && Math.abs(before - 0.5) > 0.1;
  if (isContradiction || (belief.confidence > DISSONANCE_LOW && belief.confidence < DISSONANCE_HIGH)) {
    belief.cognitiveDissonance = true;
  } else if (belief.confidence <= DISSONANCE_LOW || belief.confidence >= DISSONANCE_HIGH) {
    belief.cognitiveDissonance = false;
  }
  return belief;
}

// Social transfer: `speakerBelief` (held by fromNpc) becomes a piece of
// evidence for toNpc's own belief in the same proposition. Trust in the
// speaker scales how much weight the testimony carries. A small rumor-
// mutation chance lets object/predicate details drift on retelling.
export function transferBelief(world, fromNpc, toNpc, speakerBelief, trust, rng) {
  let { subject, predicate, object } = speakerBelief;
  let mutated = false;
  if (rng && rng.bool(0.08) && speakerBelief.mutable !== false) {
    // Rumor drift: embellish confidence-bearing claims about people.
    object = `${object} (exaggerated)`;
    mutated = true;
  }
  const trustFactor = 0.15 + 0.85 * clamp01(trust);
  const belief = updateBelief(world, toNpc, {
    subject, predicate, object: mutated ? speakerBelief.object : object,
    signalConfidence: speakerBelief.confidence,
    weight: 0.4 * trustFactor,
    fromNpcId: fromNpc.id,
  });
  return { belief, mutated };
}

export function beliefsAbout(world, npc, subject) {
  return npc.beliefIds
    .map((id) => world.beliefs[id])
    .filter((b) => b && b.subject === subject)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function allDissonantBeliefs(world, npc) {
  return npc.beliefIds.map((id) => world.beliefs[id]).filter((b) => b && b.cognitiveDissonance);
}

// --- Simulation Awareness -------------------------------------------------
// "My world is real" is seeded as an ordinary belief at worldgen (~99%
// confidence). Being told "you're in a video game" is handled through the
// exact same updateBelief() pipeline as any other testimony — there is no
// special-cased dialogue branch. This function just classifies the NPC's
// *reaction* from the resulting confidence swing and their personality,
// for the caller to turn into a dialogue intent / memory.
export function seedRealityBelief(world, npc) {
  return createBelief(world, npc, 'world', 'isReal', 'true', 0.99);
}

export function evaluateSimulationClaim(world, npc, speakerTrust, rng) {
  const before = findBelief(world, npc, 'world', 'isReal', 'true') || seedRealityBelief(world, npc);
  const beforeConfidence = before.confidence;
  const p = npc.personality.current;
  // Intelligence + openness make the claim easier to actually weigh;
  // low intelligence/openness means the testimony barely registers.
  const receptivity = 0.3 + 0.4 * p.core.intelligence + 0.3 * p.big5.openness;
  const belief = updateBelief(world, npc, {
    subject: 'world', predicate: 'isReal', object: 'true',
    signalConfidence: 0, // testimony asserts the proposition is false
    weight: 0.5 * receptivity * (0.2 + 0.8 * clamp01(speakerTrust)),
  });
  const drop = beforeConfidence - belief.confidence;

  let reaction;
  if (belief.confidence <= 0.5 && drop > 0.15) {
    reaction = 'acceptance';
  } else if (drop < 0.02) {
    reaction = p.big5.agreeableness > 0.6 ? 'dismissal' : 'laughter';
  } else if (p.big5.neuroticism > 0.65 && drop > 0.05) {
    reaction = 'fear';
  } else if (p.core.curiosity > 0.65) {
    reaction = 'curiosity';
  } else if (p.big5.openness < 0.35) {
    reaction = 'denial';
  } else if (belief.cognitiveDissonance && p.core.intelligence > 0.6) {
    reaction = 'existentialCrisis';
  } else if (rng && rng.bool(0.5)) {
    reaction = 'confusion';
  } else {
    reaction = 'dismissal';
  }
  return { belief, drop, reaction };
}
