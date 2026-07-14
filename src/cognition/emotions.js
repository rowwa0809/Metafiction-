// emotions.js — Appraisal-based affect.
//
// Psychological model: appraisal theory. Emotions arise from evaluating
// events against one's own goals — a goal blocked provokes anger or fear,
// a goal advanced provokes joy, a loss provokes grief, a social slight
// provokes jealousy or loneliness. State is kept as a continuous
// valence/arousal core (the circumplex model) plus discrete tagged
// emotions that decay at different rates (grief lingers, surprise fades
// fast). Personality modulates both the size of the emotional swing
// (neuroticism amplifies, emotionalStability dampens) and the decay speed.
// Emotion, in turn, gates almost everything else: utility scoring in
// goals.js, market pricing in economy.js, willingness to converse in
// dialogue.js, and how strongly a memory gets encoded in memory.js.

const TAGS = ['fear', 'anger', 'grief', 'joy', 'jealousy', 'loneliness'];

const DECAY_PER_DAY = {
  fear: 0.55,
  anger: 0.6,
  grief: 0.92, // grief lingers for a long time
  joy: 0.5,
  jealousy: 0.7,
  loneliness: 0.75,
};
const AROUSAL_DECAY_PER_DAY = 0.4;
const VALENCE_DECAY_PER_DAY = 0.5;
const BASELINE_AROUSAL = 0.15;

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function clampSigned(v) { return Math.min(1, Math.max(-1, v)); }

export function initEmotion() {
  const tags = {};
  for (const t of TAGS) tags[t] = 0;
  return { valence: 0, arousal: BASELINE_AROUSAL, tags };
}

// Apply an appraisal result to an NPC's emotional state. `intensity` is
// 0..1 (how big a deal this is), `valenceDelta`/`arousalDelta` are signed
// nudges before personality modulation, `tagDeltas` is a partial map of
// { fear: 0.4, anger: 0.2, ... } additive bumps (pre-modulation).
export function appraise(npc, { valenceDelta = 0, arousalDelta = 0, tagDeltas = {}, intensity = 0.5 }) {
  const p = npc.personality.current;
  const sensitivity = 0.6 + p.big5.neuroticism * 0.8 - p.core.emotionalStability * 0.4;
  const e = npc.emotion;

  e.valence = clampSigned(e.valence + valenceDelta * intensity * sensitivity);
  e.arousal = clamp01(e.arousal + arousalDelta * intensity * sensitivity);

  for (const [tag, delta] of Object.entries(tagDeltas)) {
    if (!(tag in e.tags)) continue;
    let mod = sensitivity;
    if (tag === 'joy' && p.big5.extraversion) mod *= 0.7 + p.big5.extraversion * 0.6;
    if (tag === 'anger' && p.big5.agreeableness) mod *= 1.3 - p.big5.agreeableness * 0.6;
    e.tags[tag] = clamp01(e.tags[tag] + delta * intensity * mod);
  }
  return e;
}

// Convenience appraisal presets driven by goal-relevant event categories.
export function appraiseGoalBlocked(npc, intensity = 0.5) {
  return appraise(npc, { valenceDelta: -0.4, arousalDelta: 0.3, tagDeltas: { anger: 0.4, fear: 0.15 }, intensity });
}
export function appraiseGoalProgress(npc, intensity = 0.4) {
  return appraise(npc, { valenceDelta: 0.35, arousalDelta: 0.1, tagDeltas: { joy: 0.4 }, intensity });
}
export function appraiseLoss(npc, intensity = 0.8) {
  return appraise(npc, { valenceDelta: -0.6, arousalDelta: 0.2, tagDeltas: { grief: 0.6 }, intensity });
}
export function appraiseThreat(npc, intensity = 0.6) {
  return appraise(npc, { valenceDelta: -0.3, arousalDelta: 0.5, tagDeltas: { fear: 0.55 }, intensity });
}
export function appraiseSocialSlight(npc, intensity = 0.4) {
  return appraise(npc, { valenceDelta: -0.25, arousalDelta: 0.15, tagDeltas: { loneliness: 0.3, anger: 0.15 }, intensity });
}
export function appraiseJealousProvocation(npc, intensity = 0.5) {
  return appraise(npc, { valenceDelta: -0.3, arousalDelta: 0.25, tagDeltas: { jealousy: 0.5 }, intensity });
}
export function appraiseAchievement(npc, intensity = 0.6) {
  return appraise(npc, { valenceDelta: 0.5, arousalDelta: 0.2, tagDeltas: { joy: 0.5 }, intensity });
}

export function decayEmotion(npc, dtMinutes) {
  const days = dtMinutes / 1440;
  const e = npc.emotion;
  e.valence *= Math.pow(1 - VALENCE_DECAY_PER_DAY, days);
  e.arousal = BASELINE_AROUSAL + (e.arousal - BASELINE_AROUSAL) * Math.pow(1 - AROUSAL_DECAY_PER_DAY, days);
  for (const t of TAGS) {
    e.tags[t] *= Math.pow(1 - DECAY_PER_DAY[t], days);
  }
}

export function dominantEmotion(npc) {
  const e = npc.emotion;
  let best = null;
  let bestVal = 0.08; // noise floor
  for (const t of TAGS) {
    if (e.tags[t] > bestVal) { best = t; bestVal = e.tags[t]; }
  }
  return best;
}

// --- Downstream gates --------------------------------------------------

// How much this NPC's current state should boost memory-encoding
// importance for whatever is happening right now.
export function encodingBoost(npc) {
  return npc.emotion.arousal * 0.5 + Math.abs(npc.emotion.valence) * 0.3;
}

// Fearful/anxious merchants hoard stock and mark prices up.
export function priceFearMultiplier(npc) {
  return 1 + npc.emotion.tags.fear * 0.6 + npc.emotion.tags.jealousy * 0.1;
}

// Low willingness to talk when angry/grieving/afraid; extraversion and joy
// raise it. Used by dialogue.js to gate whether an NPC will engage at all.
export function willingnessToTalk(npc) {
  const p = npc.personality.current;
  const e = npc.emotion;
  let w = 0.5 + p.big5.extraversion * 0.3 + e.valence * 0.2 + e.tags.joy * 0.15;
  w -= e.tags.anger * 0.35 + e.tags.grief * 0.3 + e.tags.fear * 0.2 + e.tags.loneliness * -0.1;
  return clamp01(w);
}

// Guards get more aggressive/suspicious with fear and anger in the village.
export function guardAggression(npc) {
  return clamp01(npc.emotion.tags.fear * 0.5 + npc.emotion.tags.anger * 0.5);
}
