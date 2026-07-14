// society.js — Institutions, culture drift, festivals, and legends.
//
// Model: culture is just slow-moving aggregate statistics over the
// population (average piety, openness, prosperity) — nothing here is
// hand-scripted "lore." Festivals are calendar events that create a
// shared, high-importance memory for everyone who attends, which is
// exactly the kind of memory that survives nightly consolidation into
// long-term storage. Legends are what happens when a highly-retold,
// high-importance memory/event gets old enough that society.js folds it
// into village lore — and because memory distortion already mutates
// retold memories, legends are naturally embellished versions of what
// actually happened, not authored myths.

import { overallSentiment, outgoingEdges } from '../cognition/relationships.js';
import { appraise } from '../cognition/emotions.js';
import { recordMemory, importanceFromEmotion } from '../cognition/memory.js';
import { buildingsByRole } from '../sim/map.js';

const FESTIVALS = [
  { season: 'Spring', day: 4, name: 'The Planting Festival' },
  { season: 'Summer', day: 9, name: 'Midsummer Fair' },
  { season: 'Autumn', day: 0, name: 'Harvest Festival' },
  { season: 'Winter', day: 14, name: 'Vigil Night' },
];

const LEGEND_MIN_AGE_DAYS = 20;
const LEGEND_EMBELLISHMENTS = [
  'Some now say it happened during a storm, though it didn\'t.',
  'The story grows a little taller with every telling.',
  'Children in the village now tell it as if it happened to a hero of old.',
  'No two elders agree anymore on exactly how it ended.',
];

export function initSociety() {
  return {
    culture: { piety: 0.5, openness: 0.5, prosperity: 0.5 },
    legends: [],
    lastFestivalDay: -1,
  };
}

export function computeReputation(world, npcId) {
  const inbound = Object.values(world.relationships).filter((e) => e.toId === npcId);
  if (inbound.length === 0) return 0;
  let weighted = 0;
  let weightSum = 0;
  for (const e of inbound) {
    const w = 0.1 + e.familiarity;
    weighted += overallSentiment(e) * w;
    weightSum += w;
  }
  return weightSum > 0 ? weighted / weightSum : 0;
}

export function dailySocietyTick(world, rng) {
  const npcs = Object.values(world.npcs).filter((n) => n.alive && !n.isPlayer);
  if (npcs.length > 0) {
    const avgOpenness = avg(npcs.map((n) => n.personality.current.big5.openness));
    const avgFaith = avg(npcs.map((n) => n.personality.current.values.faith));
    const avgCoinDelta = avg(npcs.map((n) => (n.coin || 0)));
    const c = world.society.culture;
    c.openness += (avgOpenness - c.openness) * 0.05;
    c.piety += (avgFaith - c.piety) * 0.03;
    c.prosperity += (clamp01(avgCoinDelta / 200) - c.prosperity) * 0.04;
  }

  checkFestival(world, rng);
  legendify(world, rng);
}

function checkFestival(world, rng) {
  const festival = FESTIVALS.find((f) => f.season === world.clock.season && f.day === world.clock.dayOfSeason);
  if (!festival || world.society.lastFestivalDay === world.clock.day) return;
  world.society.lastFestivalDay = world.clock.day;

  const hall = buildingsByRole(world.map, 'hall')[0];
  const attendees = Object.values(world.npcs).filter((n) => n.alive);
  for (const npc of attendees) {
    appraise(npc, { valenceDelta: 0.5, arousalDelta: 0.3, tagDeltas: { joy: 0.5 }, intensity: 0.7 });
    npc.needs.social = Math.min(100, npc.needs.social + 30);
    recordMemory(world, npc, {
      what: `celebrated ${festival.name} with the whole village`,
      who: attendees.filter((a) => a.id !== npc.id).slice(0, 6).map((a) => a.id),
      where: hall ? hall.id : null,
      importance: importanceFromEmotion(0.7, 0.5, 0.3),
      emotionalValence: 0.6,
      tags: ['festival', festival.name.toLowerCase().replace(/\s+/g, '_')],
    });
  }
  world.timeline.push({
    id: `evt_festival_${world.clock.totalMinutes}`,
    when: world.clock.totalMinutes, type: 'festival',
    description: `The village gathered for ${festival.name}.`,
    importance: 0.8,
  });
}

function legendify(world, rng) {
  const candidates = world.timeline.filter((e) => {
    if (e.legend) return false;
    const ageDays = (world.clock.totalMinutes - e.when) / 1440;
    return ageDays >= LEGEND_MIN_AGE_DAYS && (e.importance ?? 0) >= 0.65;
  });
  if (candidates.length === 0) return;
  const chosen = candidates[0];
  chosen.legend = true;
  const embellishment = rng.pick(LEGEND_EMBELLISHMENTS);
  const legend = {
    id: `legend_${chosen.id}`,
    text: `${chosen.description} ${embellishment}`,
    sourceEventId: chosen.id,
    when: world.clock.totalMinutes,
  };
  world.society.legends.push(legend);
  world.timeline.push({
    id: `evt_legend_${world.clock.totalMinutes}`,
    when: world.clock.totalMinutes, type: 'legend',
    description: `A legend has taken root: "${legend.text}"`,
    importance: 0.5,
  });
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function clamp01(v) { return Math.min(1, Math.max(0, v)); }
