// worldgen.js — Generates the village's population, once, from the seed.
//
// This is where the "Identity Engine" card from the design blueprint gets
// assembled: name, age, occupation, education, family links, hometown,
// personality, values, fears, dreams, a formative trauma/triumph,
// favorites, speech style, and the core stats, all rolled from
// per-NPC child RNG streams (so adding/removing one NPC's rolls never
// reshuffles anyone else's). Family trees are built first (households
// around the village's houses), then occupations are assigned to fill
// out the workplaces, then starting relationship edges and the seed
// belief "my world is real" are created.

import { generatePersonality, driftPersonality } from '../cognition/personality.js';
import { generateAmbitions, initNeedsSeeded } from '../cognition/goals.js';
import { initEmotion } from '../cognition/emotions.js';
import { seedRealityBelief, updateBelief } from '../cognition/beliefs.js';
import { adjustEdge } from '../cognition/relationships.js';
import { buildingsByRole, findBuilding } from './../sim/map.js';
import { nextId } from '../core/ids.js';

const FIRST_NAMES_M = ['Aldric', 'Boren', 'Corwin', 'Doran', 'Edmund', 'Fenric', 'Garrick', 'Harlan', 'Ivo', 'Jorah', 'Konrad', 'Lucan', 'Merek', 'Nolan', 'Osric', 'Piers'];
const FIRST_NAMES_F = ['Aleth', 'Brenna', 'Ciri', 'Delia', 'Elowen', 'Fira', 'Gwyn', 'Hesper', 'Isolde', 'Jessa', 'Kira', 'Liora', 'Maren', 'Nessa', 'Orla', 'Petra'];
const SURNAMES = ['Miller', 'Carter', 'Fisher', 'Weaver', 'Shepherd', 'Cooper', 'Fletcher', 'Tanner'];
const HOMETOWNS = ['this village', 'a hamlet upriver', 'the coastal town', 'the eastern hills', 'the city, long ago'];
const EDUCATIONS = ['none, learned by doing', 'a few years of chapel schooling', 'an apprenticeship', 'tutored privately', 'self-taught from borrowed books'];
const FEARS = ['being forgotten', 'losing a child', 'poverty', 'fire', 'the dark woods', 'being exposed as a fraud', 'illness', 'betrayal'];
const DREAMS = ['a peaceful old age', 'wealth enough to never worry', 'being remembered fondly', 'seeing the city before they die', 'a family of their own', 'mastery of their craft'];

const JOB_POOL = [
  'smith', 'baker', 'innkeeper', 'innkeeper', 'clergy', 'merchant', 'merchant',
  'farmer', 'farmer', 'farmer', 'farmer', 'guard', 'guard', 'guard', 'healer', 'clerk',
];

function pickFirstName(rng, sex) {
  return sex === 'M' ? rng.pick(FIRST_NAMES_M) : rng.pick(FIRST_NAMES_F);
}

function makePerson(world, rng, { surname, age, sex, homeBuildingId }) {
  const id = nextId(world, 'npc');
  const childRng = rng.child(id);
  const personality = generatePersonality(childRng);
  const occupation = age < 16 ? 'child' : age >= 65 ? 'elder' : null; // working occupation assigned later for adults
  const npc = {
    id,
    name: `${pickFirstName(childRng, sex)} ${surname}`,
    sex, age, surname,
    occupation,
    education: age < 16 ? 'currently in chapel schooling' : childRng.pick(EDUCATIONS),
    hometown: childRng.bool(0.85) ? 'this village' : childRng.pick(HOMETOWNS),
    personality,
    fear: childRng.pick(FEARS),
    dream: childRng.pick(DREAMS),
    family: { parents: [], siblings: [], spouse: null, children: [] },
    homeBuildingId,
    workBuildingId: null,
    position: { x: 0, y: 0 },
    indoors: true,
    needs: initNeedsSeeded(childRng),
    emotion: initEmotion(),
    memoryIds: [],
    beliefIds: [],
    goals: { interrupt: null, ambitions: [], activeGoalType: null, plan: [], planStep: 0 },
    currentAction: null,
    updatePriority: 1,
    internalMonologue: '...',
    alive: true,
    coin: childRng.int(15, 40),
  };
  return npc;
}

export function generatePopulation(world, rng) {
  const npcs = [];
  const houses = buildingsByRole(world.map, 'home');

  houses.forEach((house, i) => {
    const surname = SURNAMES[i % SURNAMES.length];
    const householdRng = rng.child(`household_${i}`);
    const father = makePerson(world, householdRng, { surname, age: householdRng.int(28, 55), sex: 'M', homeBuildingId: house.id });
    const mother = makePerson(world, householdRng, { surname, age: householdRng.int(26, 53), sex: 'F', homeBuildingId: house.id });
    father.family.spouse = mother.id;
    mother.family.spouse = father.id;
    npcs.push(father, mother);

    const childCount = householdRng.int(1, 3);
    const kids = [];
    for (let c = 0; c < childCount; c++) {
      const kid = makePerson(world, householdRng, {
        surname, age: householdRng.int(2, 17), sex: householdRng.bool() ? 'M' : 'F', homeBuildingId: house.id,
      });
      kid.family.parents = [father.id, mother.id];
      kids.push(kid);
      npcs.push(kid);
    }
    for (const kid of kids) kid.family.siblings = kids.filter((k) => k.id !== kid.id).map((k) => k.id);
    father.family.children = kids.map((k) => k.id);
    mother.family.children = kids.map((k) => k.id);

    if (householdRng.bool(0.4)) {
      const elder = makePerson(world, householdRng, { surname, age: householdRng.int(66, 84), sex: householdRng.bool() ? 'M' : 'F', homeBuildingId: house.id });
      elder.family.children = [father.sex === 'M' ? father.id : mother.id];
      npcs.push(elder);
    }
  });

  // Assign working occupations to adults who don't already have one
  // ('child'/'elder' were set at creation) so every workplace gets staffed.
  const adults = npcs.filter((n) => !n.occupation);
  const jobs = rng.shuffle(JOB_POOL);
  adults.forEach((npc, i) => {
    npc.occupation = jobs[i % jobs.length];
  });

  assignWorkplaces(world, npcs);
  seedStartingRelationshipsAndBeliefs(world, npcs, rng);

  for (const npc of npcs) {
    world.npcs[npc.id] = npc;
    const home = findBuilding(world.map, npc.homeBuildingId);
    npc.position = { x: home.door.x, y: home.door.y };
  }
  return npcs;
}

const ROLE_BY_OCCUPATION = {
  smith: 'forge', baker: 'bakery', innkeeper: 'tavern', clergy: 'chapel',
  merchant: 'market', farmer: 'farm', guard: 'guardhouse', healer: 'healer', clerk: 'hall',
};

function assignWorkplaces(world, npcs) {
  const roleCounters = {};
  for (const npc of npcs) {
    const role = ROLE_BY_OCCUPATION[npc.occupation];
    if (!role) { npc.workBuildingId = npc.homeBuildingId; continue; } // child/elder "work" at home
    const options = buildingsByRole(world.map, role);
    if (options.length === 0) { npc.workBuildingId = npc.homeBuildingId; continue; }
    const idx = (roleCounters[role] || 0) % options.length;
    roleCounters[role] = (roleCounters[role] || 0) + 1;
    npc.workBuildingId = options[idx].id;
  }
}

function seedStartingRelationshipsAndBeliefs(world, npcs, rng) {
  for (const npc of npcs) {
    seedRealityBelief(world, npc);
    npc.goals.ambitions = generateAmbitions(rng.child(`amb_${npc.id}`), npc.personality, npc.occupation);

    if (npc.family.spouse) {
      adjustEdge(world, npc.id, npc.family.spouse, { trust: 0.35, affection: 0.6, respect: 0.2 });
    }
    for (const cid of npc.family.children) {
      adjustEdge(world, npc.id, cid, { trust: 0.4, affection: 0.7, respect: 0.1 });
    }
    for (const pid of npc.family.parents) {
      adjustEdge(world, npc.id, pid, { trust: 0.4, affection: 0.55, respect: 0.35 });
    }
    for (const sid of npc.family.siblings) {
      adjustEdge(world, npc.id, sid, { trust: 0.3, affection: 0.4, respect: 0.15 });
    }
  }
}
