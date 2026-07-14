// schedule.js — Routine as a low-priority default, not a script.
//
// NPCs are not puppeted through a schedule; the schedule only supplies a
// *routine candidate goal* that competes in the same utility pool as
// hunger, rest, ambition, and emergencies (see cognition/goals.js). Most
// of the time nothing else outscores it, so from the outside it looks
// like NPCs keep a believable daily rhythm — but a hungry NPC will break
// off to eat, and an emergency always wins. Conscientious personalities
// stick to routine harder than impulsive ones.

const ROUTINES = {
  smith: [
    { start: 6, end: 8, activity: 'errand', buildingRole: 'home' },
    { start: 8, end: 12, activity: 'work', buildingRole: 'forge' },
    { start: 12, end: 13, activity: 'errand', buildingRole: 'market' },
    { start: 13, end: 18, activity: 'work', buildingRole: 'forge' },
    { start: 18, end: 21, activity: 'social', buildingRole: 'tavern' },
    { start: 21, end: 6, activity: 'sleep', buildingRole: 'home' },
  ],
  baker: [
    { start: 4, end: 9, activity: 'work', buildingRole: 'bakery' },
    { start: 9, end: 13, activity: 'work', buildingRole: 'bakery' },
    { start: 13, end: 15, activity: 'errand', buildingRole: 'market' },
    { start: 15, end: 19, activity: 'work', buildingRole: 'bakery' },
    { start: 19, end: 21, activity: 'social', buildingRole: 'tavern' },
    { start: 21, end: 4, activity: 'sleep', buildingRole: 'home' },
  ],
  farmer: [
    { start: 5, end: 12, activity: 'work', buildingRole: 'farm' },
    { start: 12, end: 13, activity: 'errand', buildingRole: 'home' },
    { start: 13, end: 19, activity: 'work', buildingRole: 'farm' },
    { start: 19, end: 21, activity: 'social', buildingRole: 'tavern' },
    { start: 21, end: 5, activity: 'sleep', buildingRole: 'home' },
  ],
  merchant: [
    { start: 7, end: 12, activity: 'work', buildingRole: 'market' },
    { start: 12, end: 13, activity: 'errand', buildingRole: 'home' },
    { start: 13, end: 19, activity: 'work', buildingRole: 'market' },
    { start: 19, end: 22, activity: 'social', buildingRole: 'tavern' },
    { start: 22, end: 7, activity: 'sleep', buildingRole: 'home' },
  ],
  guard: [
    { start: 6, end: 18, activity: 'work', buildingRole: 'guardhouse' },
    { start: 18, end: 21, activity: 'social', buildingRole: 'tavern' },
    { start: 21, end: 6, activity: 'sleep', buildingRole: 'home' },
  ],
  clergy: [
    { start: 6, end: 9, activity: 'work', buildingRole: 'chapel' },
    { start: 9, end: 12, activity: 'errand', buildingRole: 'market' },
    { start: 12, end: 18, activity: 'work', buildingRole: 'chapel' },
    { start: 18, end: 20, activity: 'social', buildingRole: 'hall' },
    { start: 20, end: 6, activity: 'sleep', buildingRole: 'home' },
  ],
  healer: [
    { start: 7, end: 12, activity: 'work', buildingRole: 'healer' },
    { start: 12, end: 13, activity: 'errand', buildingRole: 'market' },
    { start: 13, end: 19, activity: 'work', buildingRole: 'healer' },
    { start: 19, end: 21, activity: 'social', buildingRole: 'tavern' },
    { start: 21, end: 7, activity: 'sleep', buildingRole: 'home' },
  ],
  innkeeper: [
    { start: 6, end: 12, activity: 'work', buildingRole: 'tavern' },
    { start: 12, end: 13, activity: 'errand', buildingRole: 'market' },
    { start: 13, end: 23, activity: 'work', buildingRole: 'tavern' },
    { start: 23, end: 6, activity: 'sleep', buildingRole: 'home' },
  ],
  clerk: [
    { start: 8, end: 12, activity: 'work', buildingRole: 'hall' },
    { start: 12, end: 13, activity: 'errand', buildingRole: 'market' },
    { start: 13, end: 18, activity: 'work', buildingRole: 'hall' },
    { start: 18, end: 21, activity: 'social', buildingRole: 'tavern' },
    { start: 21, end: 8, activity: 'sleep', buildingRole: 'home' },
  ],
  laborer: [
    { start: 6, end: 12, activity: 'work', buildingRole: 'farm' },
    { start: 12, end: 13, activity: 'errand', buildingRole: 'market' },
    { start: 13, end: 18, activity: 'work', buildingRole: 'farm' },
    { start: 18, end: 21, activity: 'social', buildingRole: 'tavern' },
    { start: 21, end: 6, activity: 'sleep', buildingRole: 'home' },
  ],
  child: [
    { start: 7, end: 12, activity: 'social', buildingRole: 'hall' },
    { start: 12, end: 13, activity: 'errand', buildingRole: 'home' },
    { start: 13, end: 18, activity: 'social', buildingRole: 'market' },
    { start: 18, end: 20, activity: 'errand', buildingRole: 'home' },
    { start: 20, end: 7, activity: 'sleep', buildingRole: 'home' },
  ],
  elder: [
    { start: 7, end: 11, activity: 'social', buildingRole: 'hall' },
    { start: 11, end: 13, activity: 'errand', buildingRole: 'market' },
    { start: 13, end: 18, activity: 'social', buildingRole: 'chapel' },
    { start: 18, end: 20, activity: 'social', buildingRole: 'tavern' },
    { start: 20, end: 7, activity: 'sleep', buildingRole: 'home' },
  ],
};

function findBlock(occupation, hour) {
  const routine = ROUTINES[occupation] || ROUTINES.laborer;
  for (const block of routine) {
    if (block.start <= block.end) {
      if (hour >= block.start && hour < block.end) return block;
    } else if (hour >= block.start || hour < block.end) {
      return block; // wraps past midnight
    }
  }
  return routine[routine.length - 1];
}

const HARSH_WEATHER = new Set(['storm', 'snow']);

// Bad weather doesn't cancel routines outright — it makes NPCs less eager
// to be out and about for anything that isn't home, work, or shelter.
export function routineCandidate(npc, hour, weather = 'clear') {
  const block = findBlock(npc.occupation, hour);
  const conscientiousness = npc.personality.current.big5.conscientiousness;
  let utility = 0.32 + conscientiousness * 0.18;
  if (HARSH_WEATHER.has(weather) && (block.activity === 'social' || block.activity === 'errand')) {
    utility *= 0.55;
  }
  return { type: 'routine', utility, meta: { activity: block.activity, buildingRole: block.buildingRole } };
}
