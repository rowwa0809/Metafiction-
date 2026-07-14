// perception.js — The only door between the world and an NPC's mind.
//
// Psychological model / architectural rule: NO NPC reads global state.
// Ever. Everything an NPC knows about the world had to arrive through
// this module — sight range, hearing range, and an attention filter that
// can make someone miss what's right in front of them if they're
// absorbed in something else. This is what makes "an event on the far
// side of the village stays unknown until gossip physically reaches
// someone" true by construction rather than by convention: the simulation
// loop calls canPerceive() before it ever lets an NPC form a direct
// memory of an event, and everyone else only finds out through
// conversation-based belief/memory transfer (see beliefs.js, dialogue.js).

const SIGHT_RANGE = 9; // tiles
const HEARING_RANGE = 6; // tiles, for overhearing nearby conversation

function dist(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); // chebyshev, cheap for tile grids
}

// Attention: a narrow, task-absorbed NPC perceives less of their
// surroundings; high arousal narrows focus further onto salient/threat
// stimuli but doesn't help with mundane background detail.
export function attentionLevel(npc) {
  const busy = npc.currentAction && npc.currentAction.absorbing ? 0.5 : 1.0;
  const arousalPenalty = Math.max(0, npc.emotion.arousal - 0.6) * 0.4;
  return Math.max(0.15, busy - arousalPenalty);
}

export function nearbyNpcs(world, npc, range = SIGHT_RANGE) {
  const out = [];
  for (const other of Object.values(world.npcs)) {
    if (other.id === npc.id || !other.alive) continue;
    if (dist(npc.position, other.position) <= range) out.push(other);
  }
  return out;
}

// Can this NPC perceive a world event at all, given position, involvement,
// and attention? Events carry a `location` (tile coords) and an optional
// `involved` list of NPC ids who are guaranteed to perceive it directly
// (e.g. participants in a conversation, victims of a theft).
export function canPerceive(world, npc, event, rng = null) {
  if (event.involved && event.involved.includes(npc.id)) return true;
  if (!event.location) return false;
  const range = event.loud ? HEARING_RANGE * 1.8 : SIGHT_RANGE;
  if (dist(npc.position, event.location) > range) return false;
  const chance = attentionLevel(npc) * (event.salience ?? 0.8);
  if (!rng) return chance > 0.5;
  return rng.bool(chance);
}

export function gatherEnvironmentPercept(world, npc) {
  const building = buildingAt(world, npc.position);
  return {
    timeOfDay: world.clock.timeString(),
    isNight: world.clock.isNight(),
    weather: world.weather.current,
    locationName: building ? building.name : 'the road',
    nearbyNpcIds: nearbyNpcs(world, npc).map((n) => n.id),
  };
}

export function buildingAt(world, pos) {
  if (!world.map || !world.map.buildings) return null;
  for (const b of world.map.buildings) {
    if (pos.x >= b.x && pos.x < b.x + b.w && pos.y >= b.y && pos.y < b.y + b.h) return b;
  }
  return null;
}

// Overhearing: someone standing within HEARING_RANGE of a conversation
// they're not a party to may pick up a diluted version of it (lower
// evidence weight than being told directly).
export function overhearers(world, speaker, listener, range = HEARING_RANGE) {
  return nearbyNpcs(world, speaker, range).filter((n) => n.id !== listener.id);
}
