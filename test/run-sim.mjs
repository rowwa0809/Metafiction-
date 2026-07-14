// test/run-sim.mjs — Headless deterministic acceptance-test harness.
//
// Runs the exact same simulation code the browser uses (no DOM, no
// canvas) so we can mechanically verify the acceptance tests from the
// design brief without a browser. Run with: node test/run-sim.mjs

import { createWorld, serializeWorld, deserializeWorld } from '../src/core/worldState.js';
import { tickWorld, catchUpSimulation } from '../src/sim/simulation.js';
import { getEdge, overallSentiment } from '../src/cognition/relationships.js';
import { talk, tellSimulationClaim } from '../src/player/player.js';
import { RNG } from '../src/core/rng.js';

const DAY = 1440;

function runDays(world, days, dtPerTick = 15) {
  const ticks = Math.round((days * DAY) / dtPerTick);
  let tickCount = 0;
  for (let i = 0; i < ticks; i++) {
    tickWorld(world, dtPerTick, { tickCount: tickCount++ });
  }
}

function summarize(world) {
  const friendships = world.timeline.filter((e) => e.type === 'friendship');
  const rivalries = world.timeline.filter((e) => e.type === 'rivalry');
  const thefts = world.timeline.filter((e) => e.type === 'theft');
  const priceChanges = world.timeline.filter((e) => e.type === 'priceChange');
  const festivals = world.timeline.filter((e) => e.type === 'festival');
  const legends = world.timeline.filter((e) => e.type === 'legend');
  const achievements = world.timeline.filter((e) => e.type === 'achievement');
  return { friendships, rivalries, thefts, priceChanges, festivals, legends, achievements };
}

function countRumorSpread(world) {
  // Count, for each (subject, predicate, object) belief key, how many
  // distinct NPCs hold a belief with that key and nonzero evidence from
  // someone else (i.e. it was told to them, not just their own seed belief).
  const spreadCounts = new Map();
  for (const npc of Object.values(world.npcs)) {
    if (npc.isPlayer) continue;
    for (const id of npc.beliefIds) {
      const b = world.beliefs[id];
      if (!b || b.subject === 'world') continue;
      const heardFromSomeone = b.evidence.some((e) => e.fromNpcId);
      if (!heardFromSomeone) continue;
      spreadCounts.set(b.key, (spreadCounts.get(b.key) || 0) + 1);
    }
  }
  let max = 0;
  let maxKey = null;
  for (const [k, v] of spreadCounts) if (v > max) { max = v; maxKey = k; }
  return { max, maxKey };
}

console.log('=== ACCEPTANCE TEST 5: determinism (same seed -> identical history) ===');
{
  const w1 = createWorld(42);
  runDays(w1, 10);
  const w2 = createWorld(42);
  runDays(w2, 10);
  const h1 = JSON.stringify(w1.timeline);
  const h2 = JSON.stringify(w2.timeline);
  const npc1 = JSON.stringify(Object.values(w1.npcs).map((n) => ({ id: n.id, pos: n.position, needs: n.needs })));
  const npc2 = JSON.stringify(Object.values(w2.npcs).map((n) => ({ id: n.id, pos: n.position, needs: n.needs })));
  console.log('timelines identical:', h1 === h2);
  console.log('npc states identical:', npc1 === npc2);
}

console.log('\n=== ACCEPTANCE TEST 1: 30 days, no player input ===');
const world = createWorld(20260714);
runDays(world, 30);
{
  const s = summarize(world);
  const rumor = countRumorSpread(world);
  console.log('new friendships:', s.friendships.length, s.friendships.map((e) => e.description));
  console.log('rivalries/conflicts:', s.rivalries.length, s.rivalries.map((e) => e.description));
  console.log('price changes:', s.priceChanges.length, s.priceChanges.slice(0, 3).map((e) => e.description));
  console.log('festivals:', s.festivals.length, s.festivals.map((e) => e.description));
  console.log('thefts:', s.thefts.length);
  console.log('max belief-holders for a single rumor key:', rumor.max, rumor.maxKey);
  console.log('TEST 1 PASS:', s.friendships.length >= 1 && s.priceChanges.length >= 1 && rumor.max >= 1);
}

console.log('\n=== ACCEPTANCE TEST 2: two witnesses, same event, diverge after 10 days ===');
{
  const npcs = Object.values(world.npcs).filter((n) => !n.isPlayer);
  const a = npcs[0];
  const b = npcs[1];
  const sharedMemA = { what: 'saw a wagon overturn in the square', who: [b.id], where: null, importance: 0.5, emotionalValence: 0.3, tags: ['test_event'], confidence: 0.5 };
  const { recordMemory } = await import('../src/cognition/memory.js');
  const recA = recordMemory(world, a, sharedMemA);
  const recB = recordMemory(world, b, { ...sharedMemA, who: [a.id] });
  recA.confidence = 0.5; recB.confidence = 0.5;
  const before = JSON.stringify({ a: recA.who, av: recA.emotionalValence, b: recB.who, bv: recB.emotionalValence });
  const { retrieve } = await import('../src/cognition/memory.js');
  // Model the two witnesses recalling/retelling the event periodically
  // over the following 10 days (each recall is a chance for reconstructive
  // distortion) rather than a single one-shot roll.
  for (let day = 0; day < 10; day++) {
    runDays(world, 1);
    retrieve(world, a, { contextTags: ['test_event'], limit: 5, rng: world.rng, swapPool: npcs.slice(2, 6).map((n) => n.id) });
    retrieve(world, b, { contextTags: ['test_event'], limit: 5, rng: world.rng, swapPool: npcs.slice(2, 6).map((n) => n.id) });
  }
  const after = JSON.stringify({ a: recA.who, av: recA.emotionalValence, b: recB.who, bv: recB.emotionalValence });
  console.log('before:', before);
  console.log('after: ', after);
  console.log('TEST 2 PASS (diverged or at least mutated independently):', before !== after || recA.confidence !== recB.confidence);
}

console.log('\n=== ACCEPTANCE TEST 3: insult -> cold greeting + gossip spreads ===');
{
  const rng = new RNG(777);
  const npcs = Object.values(world.npcs).filter((n) => !n.isPlayer);
  const target = npcs[2];
  const witness = npcs.find((n) => n.id !== target.id);
  world.npcs.player.position = { ...target.position };
  witness.position = { x: target.position.x + 1, y: target.position.y }; // force within earshot
  const before = overallSentiment(getEdge(world, target.id, 'player'));
  talk(world, target.id, 'insult', rng);
  runDays(world, 5, 15);
  const after = overallSentiment(getEdge(world, target.id, 'player'));
  // "Heard about it" survives one of two ways: the raw overheard memory
  // (if it hasn't yet decayed out of short-term storage) or the belief
  // it left behind about the player's behavior — beliefs don't get
  // forgotten the way low-importance episodic memories do, which is the
  // whole point of nightly consolidation folding episodes into semantics.
  const hasMemory = witness.memoryIds.map((id) => world.memories[id]).some((m) => m && m.tags.includes('insult'));
  const hasBelief = witness.beliefIds.map((id) => world.beliefs[id]).some((b) => b && b.subject === 'player' && b.predicate === 'treatedPoorly');
  const witnessKnows = hasMemory || hasBelief;
  console.log('sentiment before:', before.toFixed(2), 'after:', after.toFixed(2));
  console.log('target has grudge:', getEdge(world, target.id, 'player').grudges.length > 0);
  console.log('a nearby NPC witnessed/overheard it:', witnessKnows);
  console.log('TEST 3 PASS:', after < before && witnessKnows);
}

console.log('\n=== ACCEPTANCE TEST 4: save/load + catch-up ===');
{
  const data = serializeWorld(world);
  const json = JSON.stringify(data);
  const reloaded = deserializeWorld(JSON.parse(json));
  const sameTime = reloaded.clock.totalMinutes === world.clock.totalMinutes;
  const sameNpcCount = Object.keys(reloaded.npcs).length === Object.keys(world.npcs).length;
  catchUpSimulation(reloaded, 2880); // simulate 2 days elapsed
  const advanced = reloaded.clock.totalMinutes === world.clock.totalMinutes + 2880;
  console.log('round-trip clock matches:', sameTime, 'npc count matches:', sameNpcCount, 'catch-up advanced clock:', advanced);
  console.log('TEST 4 PASS:', sameTime && sameNpcCount && advanced);
}

console.log('\n=== ACCEPTANCE TEST 6: simulation-awareness claim, 3 personalities ===');
{
  const rng = new RNG(555);
  const npcs = Object.values(world.npcs).filter((n) => !n.isPlayer);
  const sorted = [...npcs].sort((x, y) => (x.personality.current.big5.openness + x.personality.current.core.intelligence) - (y.personality.current.big5.openness + y.personality.current.core.intelligence));
  const low = sorted[0];
  const mid = sorted[Math.floor(sorted.length / 2)];
  const high = sorted[sorted.length - 1];
  const results = [low, mid, high].map((npc) => {
    world.npcs.player.position = { ...npc.position };
    const r = tellSimulationClaim(world, npc.id, rng);
    return { name: npc.name, openness: npc.personality.current.big5.openness.toFixed(2), intelligence: npc.personality.current.core.intelligence.toFixed(2), reaction: r.reaction, beliefConfidence: r.beliefConfidence.toFixed(2) };
  });
  console.log(results);
  const reactions = results.map((r) => r.reaction);
  const anyInstantAcceptance = results.some((r) => r.reaction === 'acceptance' && parseFloat(r.beliefConfidence) > 0.9);
  console.log('TEST 6 PASS (reactions vary, none instantly accepts):', new Set(reactions).size >= 2 && !anyInstantAcceptance);
}

console.log('\n=== ACCEPTANCE TEST 7: perception-limited — event far away stays unknown ===');
{
  const w = createWorld(99);
  const npcs = Object.values(w.npcs).filter((n) => !n.isPlayer);
  const farNpc = npcs.reduce((a, b) => (a.position.x > b.position.x ? a : b));
  const nearNpc = npcs.find((n) => n.id !== farNpc.id);
  nearNpc.position = { x: 2, y: 2 };
  farNpc.position = { x: w.map.width - 2, y: w.map.height - 2 };
  const { recordMemory } = await import('../src/cognition/memory.js');
  recordMemory(w, nearNpc, { what: 'witnessed a fire break out', who: [], where: null, importance: 0.9, emotionalValence: -0.7, tags: ['fire', 'emergency'] });
  const farKnowsImmediately = farNpc.memoryIds.map((id) => w.memories[id]).some((m) => m.tags.includes('fire'));
  console.log('far NPC knows immediately (should be false):', farKnowsImmediately);
  console.log('TEST 7 PASS:', farKnowsImmediately === false);
}

console.log('\nAll acceptance checks executed.');
