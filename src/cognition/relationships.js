// relationships.js — Directed relationship graph.
//
// Psychological model: relationships are asymmetric. A can love B while B
// merely tolerates A; trust, affection, and respect are tracked as
// separate dimensions because a village smith can respect a rival's craft
// while trusting them not at all. Edges are directed (A->B is a distinct
// row from B->A) and evolve purely from interaction history — every
// conversation, favor, insult, or witnessed act nudges the edge a little.
// Grudges are explicit, sticky records (not just a low number) so the
// debug inspector and dialogue system can point to *why* someone is cold
// to the player, not just *that* they are.

const DEFAULTS = { trust: 0.5, affection: 0.0, respect: 0.5, familiarity: 0.0, debt: 0.0 };
const DRIFT_TO_NEUTRAL_PER_DAY = 0.015; // slow fading of unattended relationships

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function clampSigned(v) { return Math.min(1, Math.max(-1, v)); }

function edgeId(fromId, toId) { return `${fromId}->${toId}`; }

export function getEdge(world, fromId, toId) {
  const id = edgeId(fromId, toId);
  let edge = world.relationships[id];
  if (!edge) {
    const now = world.clock.totalMinutes;
    edge = {
      id, fromId, toId,
      trust: DEFAULTS.trust,
      affection: DEFAULTS.affection,
      respect: DEFAULTS.respect,
      familiarity: DEFAULTS.familiarity,
      debt: DEFAULTS.debt,
      grudges: [],
      createdAt: now,
      updatedAt: now,
    };
    world.relationships[id] = edge;
  }
  return edge;
}

export function adjustEdge(world, fromId, toId, deltas = {}) {
  const edge = getEdge(world, fromId, toId);
  if ('trust' in deltas) edge.trust = clamp01(edge.trust + deltas.trust);
  if ('affection' in deltas) edge.affection = clampSigned(edge.affection + deltas.affection);
  if ('respect' in deltas) edge.respect = clamp01(edge.respect + deltas.respect);
  if ('debt' in deltas) edge.debt += deltas.debt;
  edge.familiarity = clamp01(edge.familiarity + 0.05);
  edge.updatedAt = world.clock.totalMinutes;
  return edge;
}

export function addGrudge(world, fromId, toId, reason, intensity = 0.5) {
  const edge = getEdge(world, fromId, toId);
  edge.grudges.push({ reason, intensity: clamp01(intensity), when: world.clock.totalMinutes });
  if (edge.grudges.length > 10) edge.grudges.shift();
  adjustEdge(world, fromId, toId, { trust: -intensity * 0.3, affection: -intensity * 0.4, respect: -intensity * 0.15 });
  return edge;
}

export function decayEdge(edge, dtMinutes) {
  const days = dtMinutes / 1440;
  const pull = 1 - Math.pow(1 - DRIFT_TO_NEUTRAL_PER_DAY, days);
  edge.trust += (DEFAULTS.trust - edge.trust) * pull;
  edge.affection += (0 - edge.affection) * pull * 0.5; // affection fades slower than it forms
  edge.respect += (DEFAULTS.respect - edge.respect) * pull;
  for (const g of edge.grudges) g.intensity *= Math.pow(1 - 0.02, days);
  edge.grudges = edge.grudges.filter((g) => g.intensity > 0.05);
}

export function overallSentiment(edge) {
  const grudgeWeight = edge.grudges.reduce((s, g) => s + g.intensity, 0) * 0.1;
  return clampSigned(edge.affection + (edge.trust - 0.5) * 0.6 + (edge.respect - 0.5) * 0.3 - grudgeWeight);
}

// All outgoing edges from an NPC, sorted by |sentiment| desc — useful for
// "who does this person feel most strongly about" in the inspector.
export function outgoingEdges(world, npcId) {
  return Object.values(world.relationships)
    .filter((e) => e.fromId === npcId)
    .sort((a, b) => Math.abs(overallSentiment(b)) - Math.abs(overallSentiment(a)));
}
