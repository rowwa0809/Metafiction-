// economy.js — Flow economy with visible shortage cascades.
//
// Model: goods flow through short production chains (grain -> bread,
// ore -> tools). Prices come from local supply vs. demand, further
// skewed by the price-setter's emotional state (a fearful merchant
// hoards and marks up — see emotions.priceFearMultiplier). Businesses
// track a health score that drops when they can't get inputs; a
// business that stays unhealthy lays a worker off. None of this is
// scripted to cascade — it cascades because hunger (goals.js), stress
// (emotions.js), and gossip (beliefs.js) are already wired to react to
// "I couldn't get bread today," which a bad harvest guarantees.

import { priceFearMultiplier } from '../cognition/emotions.js';
import { appraiseGoalBlocked, appraiseThreat } from '../cognition/emotions.js';
import { recordMemory, importanceFromEmotion } from '../cognition/memory.js';
import { buildingsByRole } from '../sim/map.js';
import { addGrudge } from '../cognition/relationships.js';
import { updateBelief } from '../cognition/beliefs.js';
import { nearbyNpcs } from '../cognition/perception.js';

const SEASON_YIELD = { Spring: 1.0, Summer: 1.15, Autumn: 1.3, Winter: 0.45 };

export function initEconomy() {
  return {
    resources: {
      grain: { stock: 300, basePrice: 2 },
      bread: { stock: 120, basePrice: 4 },
      ore: { stock: 60, basePrice: 3 },
      tools: { stock: 40, basePrice: 10 },
    },
    prices: { bread: 4, tools: 10 },
    businessHealth: {},
    demandPressure: { bread: 0, tools: 0 },
  };
}

function workersAt(world, buildingId) {
  return Object.values(world.npcs).filter((n) => n.alive && n.workBuildingId === buildingId);
}

function health(econ, buildingId) {
  if (!(buildingId in econ.businessHealth)) econ.businessHealth[buildingId] = 1.0;
  return econ.businessHealth[buildingId];
}

function nudgeHealth(econ, buildingId, delta) {
  econ.businessHealth[buildingId] = Math.min(1, Math.max(0, health(econ, buildingId) + delta));
}

// Runs once per in-game day (a "slow timer" heavy pass, not per-tick).
export function economyDailyTick(world, rng) {
  const econ = world.economy;
  const season = world.clock.season;
  const seasonMod = SEASON_YIELD[season];

  // --- Production: farms -> grain ---
  const farms = buildingsByRole(world.map, 'farm');
  let grainProduced = 0;
  for (const farm of farms) {
    const workers = workersAt(world, farm.id).filter((n) => n.occupation === 'farmer');
    const yieldPerWorker = 6 * seasonMod;
    grainProduced += workers.length * yieldPerWorker * rng.float(0.85, 1.15);
    nudgeHealth(econ, farm.id, workers.length > 0 ? 0.05 : -0.1);
  }
  econ.resources.grain.stock += grainProduced;

  // --- Production: bakery consumes grain -> bread ---
  const bakeries = buildingsByRole(world.map, 'bakery');
  for (const bakery of bakeries) {
    const workers = workersAt(world, bakery.id).filter((n) => n.occupation === 'baker');
    const desiredGrain = workers.length * 30;
    const usedGrain = Math.min(desiredGrain, econ.resources.grain.stock);
    econ.resources.grain.stock -= usedGrain;
    const breadMade = usedGrain / 2.5;
    econ.resources.bread.stock += breadMade;
    const shortage = desiredGrain > 0 && usedGrain < desiredGrain * 0.5;
    nudgeHealth(econ, bakery.id, shortage ? -0.15 : 0.05);
  }

  // --- Production: forge draws ambient ore -> tools ---
  const forges = buildingsByRole(world.map, 'forge');
  for (const forge of forges) {
    const workers = workersAt(world, forge.id).filter((n) => n.occupation === 'smith');
    econ.resources.ore.stock += workers.length * 4 * rng.float(0.8, 1.2);
    const desiredOre = workers.length * 6;
    const usedOre = Math.min(desiredOre, econ.resources.ore.stock);
    econ.resources.ore.stock -= usedOre;
    econ.resources.tools.stock += usedOre / 2;
    nudgeHealth(econ, forge.id, workers.length > 0 ? 0.05 : -0.05);
  }

  // --- Household consumption: every household needs bread daily, and pays
  // for it — this is what lets a bad harvest actually drain purses instead
  // of just being a number nobody feels.
  const households = groupByHome(world);
  let shortageEvents = 0;
  for (const [homeId, members] of households) {
    const need = members.length * 1.1;
    const got = Math.min(need, econ.resources.bread.stock);
    econ.resources.bread.stock -= got;
    econ.demandPressure.bread += need;
    const cost = got * econ.prices.bread;
    const payers = members.filter((m) => (m.coin || 0) > 0);
    if (payers.length > 0) {
      const share = cost / payers.length;
      for (const payer of payers) payer.coin = Math.max(0, (payer.coin || 0) - share);
    }
    if (got < need * 0.6) {
      shortageEvents++;
      for (const npc of members) {
        if (!npc.alive) continue;
        npc.needs.hunger = Math.max(0, npc.needs.hunger - rng.int(10, 25));
        appraiseThreat(npc, 0.4);
        const rec = recordMemory(world, npc, {
          what: 'went hungry — the bakery had no bread again', who: [], where: homeId,
          importance: importanceFromEmotion(0.5, -0.5, npc.emotion.arousal),
          emotionalValence: -0.5, tags: ['shortage', 'hunger', 'economy'],
        });
        // Desperate, low-coin NPCs may turn to theft — the cascade's next link.
        if (npc.coin < 5 && rng.bool(0.04 + npc.emotion.tags.fear * 0.1)) {
          triggerTheft(world, npc, rng);
        }
      }
    }
  }

  // --- Price update from supply vs. demand, skewed by merchant fear ---
  const merchants = Object.values(world.npcs).filter((n) => n.occupation === 'merchant' && n.alive);
  const fearMult = merchants.length ? Math.max(...merchants.map((m) => priceFearMultiplier(m))) : 1;
  for (const good of ['bread', 'tools']) {
    const res = econ.resources[good];
    const targetBuffer = good === 'bread' ? 100 : 30;
    const scarcity = targetBuffer / Math.max(10, res.stock);
    const newPrice = res.basePrice * Math.min(4, Math.max(0.5, scarcity)) * fearMult;
    const prevPrice = econ.prices[good];
    econ.prices[good] = round2(newPrice);
    if (Math.abs(econ.prices[good] - prevPrice) / prevPrice > 0.25) {
      world.timeline.push({
        id: `evt_price_${world.clock.totalMinutes}_${good}`,
        when: world.clock.totalMinutes, type: 'priceChange',
        description: `The price of ${good} ${econ.prices[good] > prevPrice ? 'rose' : 'fell'} from ${prevPrice} to ${econ.prices[good]} coin, driven by ${scarcity > 1.3 ? 'shortage' : 'a glut'}.`,
      });
    }
  }
  econ.demandPressure.bread *= 0.3; // decay demand pressure signal daily

  // --- Wages ---
  payWages(world, econ);

  return { grainProduced, shortageEvents };
}

function groupByHome(world) {
  const map = new Map();
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive || npc.isPlayer) continue;
    if (!map.has(npc.homeBuildingId)) map.set(npc.homeBuildingId, []);
    map.get(npc.homeBuildingId).push(npc);
  }
  return map;
}

const BASE_WAGE = {
  smith: 14, baker: 12, innkeeper: 10, clergy: 8, merchant: 13,
  farmer: 9, guard: 10, healer: 11, clerk: 9,
};

function payWages(world, econ) {
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive || npc.isPlayer) continue;
    const base = BASE_WAGE[npc.occupation];
    if (!base) continue;
    const h = health(econ, npc.workBuildingId);
    if (npc.coin === undefined) npc.coin = 20;
    npc.coin += base * (0.4 + h * 0.6);
  }
  // Layoffs: any business sitting at rock-bottom health sheds a worker,
  // which shows up immediately as an esteem/purpose hit for that NPC.
  for (const [buildingId, h] of Object.entries(econ.businessHealth)) {
    if (h > 0.12) continue;
    const worker = Object.values(world.npcs).find((n) => n.alive && n.workBuildingId === buildingId && !n.isPlayer);
    if (worker) {
      worker.needs.esteem = Math.max(0, worker.needs.esteem - 20);
      worker.needs.purpose = Math.max(0, worker.needs.purpose - 15);
      appraiseGoalBlocked(worker, 0.6);
      worker.laidOff = true;
    }
  }
}

function triggerTheft(world, npc, rng) {
  const victims = Object.values(world.npcs).filter((n) => n.alive && n.id !== npc.id && n.coin > 10);
  if (victims.length === 0) return;
  const victim = rng.pick(victims);
  const amount = Math.min(victim.coin, rng.int(3, 8));
  victim.coin -= amount;
  npc.coin = (npc.coin || 0) + amount;

  const witnesses = nearbyNpcs(world, npc, 5).filter((n) => n.id !== victim.id);
  const caught = witnesses.length > 0 && rng.bool(0.3 + witnesses.length * 0.1);
  if (caught) {
    addGrudge(world, victim.id, npc.id, `caught ${npc.name} stealing from them out of desperation`, 0.6);
    for (const w of witnesses) {
      updateBelief(world, w, { subject: npc.id, predicate: 'isATheif', object: 'true', signalConfidence: 0.85, weight: 0.5 });
    }
  }
  world.timeline.push({
    id: `evt_theft_${world.clock.totalMinutes}_${npc.id}`,
    when: world.clock.totalMinutes, type: 'theft',
    description: `${npc.name} stole ${amount} coin from ${victim.name} out of desperation${caught ? ' and was caught' : ''}.`,
    location: victim.position, involved: [npc.id, victim.id, ...witnesses.map((w) => w.id)], importance: caught ? 0.6 : 0.4, loud: false, salience: 0.6,
  });
}

function round2(v) { return Math.round(v * 100) / 100; }
