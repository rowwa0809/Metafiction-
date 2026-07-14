// personality.js — Identity Engine.
//
// Psychological model: Big Five trait theory (OCEAN) plus a small set of
// personal values and quirks gives each NPC a stable "shape" that colors
// every downstream decision: which goals feel urgent, how utility scores
// weigh risk vs. reward, how dialogue is phrased, how fast beliefs change.
// Traits are generated once from the world seed, then stored as both a
// `baseline` (who they were "born" as) and a `current` value that drifts
// slowly in response to major life events (grief hardens neuroticism,
// triumph raises confidence, betrayal lowers agreeableness). Drift is
// capped per event so identity stays recognizable — people change slowly,
// not on every interaction.

const FOODS = ['fresh bread', 'roast venison', 'honey cakes', 'barley stew', 'salted fish', 'apple tart', 'goat cheese', 'spiced cider'];
const MUSIC = ['fiddle reels', 'temple chants', 'tavern ballads', 'lone flute songs', 'drum circles', 'lullabies'];
const WEATHER = ['crisp autumn mornings', 'thunderstorms', 'first snow', 'warm summer rain', 'clear starry nights', 'foggy dawns'];
const SPEECH_TICS = ['trails off mid-sentence', 'repeats the last word for emphasis', 'always asks a question back', 'clears throat before bad news', 'uses old proverbs', 'talks with their hands', 'is a person of very few words'];
const HUMOR_STYLES = ['dry and understated', 'broad and physical', 'dark and gallows', 'gentle self-deprecation', 'sharp and teasing', 'earnest, doesn\'t really joke'];

const CHILDHOOD_EVENTS = [
  'was the one who found their grandfather\'s body',
  'nearly drowned in the river and was pulled out by a stranger',
  'won every footrace in the village as a child',
  'was falsely blamed for a fire they didn\'t start',
  'spent a whole summer alone caring for a sick parent',
  'was the favorite of the whole village as a small child',
  'watched their family\'s harvest fail two years running',
  'was taught a trade by a demanding, distant parent',
];

const FORMATIVE_EVENTS = [
  { text: 'lost a sibling to fever', trauma: true },
  { text: 'was betrayed by their closest friend over money', trauma: true },
  { text: 'survived a bandit raid on the road', trauma: true },
  { text: 'was publicly humiliated for a mistake at work', trauma: true },
  { text: 'built their trade from nothing after arriving penniless', trauma: false },
  { text: 'saved a neighbor\'s life during a flood', trauma: false },
  { text: 'won recognition from the village council for their craft', trauma: false },
  { text: 'married for love against their family\'s wishes', trauma: false },
];

function rollTrait(rng) {
  // Beta-ish distribution via averaged uniforms, clamped 0..1, biased to center.
  return Math.min(1, Math.max(0, rng.gauss(0.5, 0.18)));
}

export function rollBig5(rng) {
  return {
    openness: rollTrait(rng),
    conscientiousness: rollTrait(rng),
    extraversion: rollTrait(rng),
    agreeableness: rollTrait(rng),
    neuroticism: rollTrait(rng),
  };
}

export function rollValues(rng) {
  return {
    tradition: rollTrait(rng),
    ambition: rollTrait(rng),
    family: rollTrait(rng),
    wealth: rollTrait(rng),
    faith: rollTrait(rng),
  };
}

export function rollQuirks(rng) {
  return {
    favoriteFood: rng.pick(FOODS),
    favoriteMusic: rng.pick(MUSIC),
    favoriteWeather: rng.pick(WEATHER),
    speechTic: rng.pick(SPEECH_TICS),
    humorStyle: rng.pick(HUMOR_STYLES),
  };
}

export function generateBackstory(rng) {
  const childhoodEvent = rng.pick(CHILDHOOD_EVENTS);
  const formative = rng.pick(FORMATIVE_EVENTS);
  return {
    childhoodEvent,
    formativeEvent: formative.text,
    formativeIsTrauma: formative.trauma,
  };
}

export function rollCoreStats(rng) {
  return {
    intelligence: rollTrait(rng),
    confidence: rollTrait(rng),
    curiosity: rollTrait(rng),
    emotionalStability: rollTrait(rng),
  };
}

// Generates the full "Identity Engine" trait bundle for one NPC. Called
// once at worldgen from a per-NPC child RNG stream so trait rolls never
// perturb the shared world stream (determinism-preserving).
export function generatePersonality(rng) {
  const big5 = rollBig5(rng);
  const values = rollValues(rng);
  const quirks = rollQuirks(rng);
  const backstory = generateBackstory(rng);
  const core = rollCoreStats(rng);
  // Trauma nudges neuroticism up and confidence down at birth-of-character;
  // triumph does the opposite. This is baseline shaping, not runtime drift.
  if (backstory.formativeIsTrauma) {
    big5.neuroticism = clamp01(big5.neuroticism + 0.12);
    core.confidence = clamp01(core.confidence - 0.08);
  } else {
    core.confidence = clamp01(core.confidence + 0.08);
  }
  const baseline = { big5, values, core };
  return {
    baseline: deepClone(baseline),
    current: deepClone(baseline),
    quirks,
    backstory,
  };
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

// Slow drift toward a target nudge in response to a major life event.
// `deltas` is a partial { big5: {...}, values: {...}, core: {...} } of
// signed nudges; magnitude is capped so no single event reshapes someone.
export function driftPersonality(personality, deltas, maxStep = 0.03) {
  for (const group of ['big5', 'values', 'core']) {
    if (!deltas[group]) continue;
    for (const key of Object.keys(deltas[group])) {
      const raw = deltas[group][key];
      const step = Math.max(-maxStep, Math.min(maxStep, raw));
      const cur = personality.current[group][key];
      personality.current[group][key] = clamp01(cur + step);
    }
  }
}

// How far current has drifted from baseline, per group — useful for the
// debug inspector to show measurable identity drift over a lifetime.
export function driftMagnitude(personality) {
  let total = 0;
  let n = 0;
  for (const group of ['big5', 'values', 'core']) {
    for (const key of Object.keys(personality.baseline[group])) {
      total += Math.abs(personality.current[group][key] - personality.baseline[group][key]);
      n++;
    }
  }
  return n === 0 ? 0 : total / n;
}
