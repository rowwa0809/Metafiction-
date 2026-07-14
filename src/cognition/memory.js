// memory.js — Tiered episodic + semantic memory.
//
// Psychological model: human memory is not a database. It has working
// memory (seconds-minutes) that drains into short-term storage
// (hours-days), which in turn is either consolidated into durable
// long-term memory during sleep or quietly forgotten. Unrehearsed
// memories lose salience over time (decay). Weakly-held memories are
// reconstructive, not photographic — recalling them can subtly change
// them (distortion), which is why two witnesses to the same event
// diverge over time. Emotionally charged and frequently-retold memories
// are far more likely to survive into long-term storage than mundane
// ones (emotional weighting).
//
// A memory record lives in the world.memories table (relational-schema
// style, stable id + timestamps). An NPC only holds a list of memoryIds
// pointing into that table — the table is the source of truth.

import { nextId } from '../core/ids.js';

export const TIER = { IMMEDIATE: 'immediate', SHORT_TERM: 'shortTerm', LONG_TERM: 'longTerm' };

const CAPACITY = { immediate: 15, shortTerm: 60, longTerm: 150 };
const IMMEDIATE_TO_SHORT_MINUTES = 180; // ~3 hours of "still thinking about it"
const MIN_AGE_BEFORE_CONSOLIDATION = 1440; // 1 day
const FORGET_AGE_MINUTES = 4320; // 3 days of shortTerm life before forgetting is considered

const SHORT_TERM_DECAY_PER_DAY = 0.82; // unrehearsed short-term memories fade fast
const LONG_TERM_DECAY_PER_DAY = 0.997; // long-term memories are nearly permanent

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function clampSigned(v) { return Math.min(1, Math.max(-1, v)); }

export function recordMemory(world, npc, { what, who = [], where = null, importance = 0.4, emotionalValence = 0, tags = [] }) {
  const id = nextId(world, 'mem');
  const now = world.clock.totalMinutes;
  const record = {
    id,
    npcId: npc.id,
    what,
    who: who.slice(),
    where,
    when: now,
    createdAt: now,
    lastAccessed: now,
    emotionalValence: clampSigned(emotionalValence),
    importance: clamp01(importance),
    confidence: 1.0,
    tags: tags.slice(),
    tier: TIER.IMMEDIATE,
    rehearsals: 0,
  };
  world.memories[id] = record;
  npc.memoryIds.push(id);
  enforceCapacity(world, npc, TIER.IMMEDIATE);
  return record;
}

function tierIds(world, npc, tier) {
  return npc.memoryIds.filter((id) => world.memories[id] && world.memories[id].tier === tier);
}

function enforceCapacity(world, npc, tier) {
  const cap = CAPACITY[tier];
  const ids = tierIds(world, npc, tier);
  if (ids.length <= cap) return;
  const scored = ids
    .map((id) => world.memories[id])
    .sort((a, b) => a.importance * a.confidence - b.importance * b.confidence);
  const toRemove = scored.slice(0, ids.length - cap);
  for (const rec of toRemove) forgetMemory(world, npc, rec.id);
}

export function forgetMemory(world, npc, id) {
  delete world.memories[id];
  const idx = npc.memoryIds.indexOf(id);
  if (idx >= 0) npc.memoryIds.splice(idx, 1);
}

// Working-memory drain: immediate memories older than a few hours move
// into short-term storage regardless of importance (everyone's brain
// files away "what just happened" whether or not it mattered).
export function drainImmediate(world, npc) {
  const now = world.clock.totalMinutes;
  for (const id of tierIds(world, npc, TIER.IMMEDIATE)) {
    const rec = world.memories[id];
    if (now - rec.createdAt >= IMMEDIATE_TO_SHORT_MINUTES) {
      rec.tier = TIER.SHORT_TERM;
    }
  }
  enforceCapacity(world, npc, TIER.SHORT_TERM);
}

// Continuous decay applied on each simulation pass. dtMinutes is however
// much sim-time has elapsed since the last call.
export function decayMemories(world, npc, dtMinutes) {
  const days = dtMinutes / 1440;
  for (const id of npc.memoryIds) {
    const rec = world.memories[id];
    if (rec.tier === TIER.SHORT_TERM) {
      rec.importance *= Math.pow(SHORT_TERM_DECAY_PER_DAY, days);
    } else if (rec.tier === TIER.LONG_TERM) {
      rec.importance *= Math.pow(LONG_TERM_DECAY_PER_DAY, days);
    }
  }
}

// Nightly sleep pass. Returns { promoted: [], forgotten: [] } so the
// orchestrator (society.js / simulation loop) can fold forgotten episodes
// into semantic summaries ("the baker is friendly") before they vanish.
export function consolidate(world, npc) {
  const now = world.clock.totalMinutes;
  const promoted = [];
  const forgotten = [];
  for (const id of tierIds(world, npc, TIER.SHORT_TERM)) {
    const rec = world.memories[id];
    const age = now - rec.createdAt;
    if (age < MIN_AGE_BEFORE_CONSOLIDATION) continue;
    const score = rec.importance * 0.6 + Math.abs(rec.emotionalValence) * 0.4 + Math.min(rec.rehearsals, 5) * 0.03;
    if (score >= 0.55) {
      rec.tier = TIER.LONG_TERM;
      promoted.push(rec);
    } else if (age >= FORGET_AGE_MINUTES && score < 0.25) {
      forgotten.push({ ...rec });
      forgetMemory(world, npc, id);
    }
  }
  enforceCapacity(world, npc, TIER.LONG_TERM);
  return { promoted, forgotten };
}

function tagOverlap(a, b) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let n = 0;
  for (const t of a) if (setB.has(t)) n++;
  return n;
}

// Retrieval scored by recency x importance x relevance-to-context. This
// is the "no embeddings needed" relevance model: plain tag overlap.
// Retrieval also triggers rehearsal (strengthens the memory slightly) and,
// for low-confidence memories, a chance of reconstructive distortion —
// recalling something can change it. `swapPool` is an optional array of
// {id} candidates distortion may substitute in as a mistaken participant.
export function retrieve(world, npc, { contextTags = [], limit = 5, rng = null, swapPool = null } = {}) {
  const now = world.clock.totalMinutes;
  const scored = npc.memoryIds
    .map((id) => world.memories[id])
    .filter(Boolean)
    .map((rec) => {
      const ageDays = Math.max(0, (now - rec.when) / 1440);
      const recency = 1 / (1 + ageDays);
      const relevance = 1 + tagOverlap(contextTags, rec.tags);
      return { rec, score: recency * (0.2 + rec.importance) * relevance };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.rec);

  if (rng) {
    for (const rec of scored) {
      rec.lastAccessed = now;
      rec.rehearsals += 1;
      rec.importance = clamp01(rec.importance + 0.02);
      if (rec.confidence < 0.6 && rng.bool(0.15)) {
        distort(rec, rng, swapPool);
      }
    }
  }
  return scored;
}

export function distort(rec, rng, swapPool) {
  if (swapPool && swapPool.length > 0 && rng.bool(0.5)) {
    rec.who = rec.who.map((w) => (rng.bool(0.3) ? rng.pick(swapPool) : w));
  } else {
    rec.emotionalValence = clampSigned(rec.emotionalValence * rng.float(1.1, 1.4));
  }
  rec.confidence = Math.max(0, rec.confidence - rng.float(0.02, 0.08));
}

// Emotional events are "remembered harder" — call this instead of a flat
// importance number when recording something the NPC felt strongly about.
export function importanceFromEmotion(baseImportance, emotionalValence, arousal) {
  return clamp01(baseImportance + Math.abs(emotionalValence) * 0.3 + arousal * 0.2);
}

export function tierCounts(world, npc) {
  return {
    immediate: tierIds(world, npc, TIER.IMMEDIATE).length,
    shortTerm: tierIds(world, npc, TIER.SHORT_TERM).length,
    longTerm: tierIds(world, npc, TIER.LONG_TERM).length,
  };
}
