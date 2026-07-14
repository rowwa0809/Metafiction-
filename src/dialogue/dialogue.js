// dialogue.js — Grammar-based conversation: intent selection + rendering.
//
// Model: a conversation turn is a cognitive act, not a text act. The
// speaker picks an *intent* (greet, gossip, accuse, comfort, ...) from
// their current goals/emotions/relationship/beliefs, exactly the way a
// real person decides "I should ask her about the harvest" before any
// words form. Only after the intent is chosen does a template grammar
// turn it into text, conditioned on the speaker's personality "voice" so
// a gruff smith and a warm baker phrase the same intent differently.
// Every conversation has mechanical consequences on BOTH participants:
// relationship deltas, belief transfer (this is the entire rumor system),
// and a new memory for each side — which is also why two people can
// remember the same conversation differently down the line.
//
// DialogueRenderer interface (duck-typed, no class hierarchy required):
//   render(intent, speaker, listener, meta, rng) -> string | Promise<string>
// The default GrammarDialogueRenderer is synchronous and is always used
// to produce the *canonical* line that gets logged/remembered, so the
// simulation never has to wait on a network call. An alternative renderer
// (see ollamaRenderer.js) may return a Promise for a nicer-sounding line;
// if so it's layered on top for display only and never blocks or changes
// simulation state.

import { expandGrammar } from './grammar.js';
import { getEdge, adjustEdge, addGrudge, overallSentiment } from '../cognition/relationships.js';
import { willingnessToTalk, appraiseSocialSlight, appraiseGoalProgress, appraise } from '../cognition/emotions.js';
import { recordMemory, importanceFromEmotion, retrieve } from '../cognition/memory.js';
import { findBelief, beliefsAbout, transferBelief, evaluateSimulationClaim, updateBelief } from '../cognition/beliefs.js';
import { buildingAt, overhearers } from '../cognition/perception.js';

export const INTENTS = ['greet', 'shareNews', 'askFavor', 'accuse', 'confess', 'gossip', 'haggle', 'comfort', 'insult'];

export function voiceFor(npc) {
  const p = npc.personality.current;
  if (p.big5.agreeableness > 0.62 && p.big5.extraversion > 0.42) return 'warm';
  if (p.big5.agreeableness < 0.42 && p.big5.extraversion < 0.55) return 'gruff';
  if (p.big5.conscientiousness > 0.62 && p.values.tradition > 0.55) return 'formal';
  return 'plain';
}

const G = {
  greet_cold: ['...', 'What do you want.', 'Oh. It\'s #listenerName#.', '#listenerName#. Make it quick.'],
  greet_neutral: ['#listenerName#.', 'Afternoon, #listenerName#.', 'Oh, hey there.'],
  greet_warm: ['#listenerName#! Good to see you.', 'Ah, #listenerName#, come here often, don\'t you?', 'There you are, #listenerName#!'],

  shareNews_gruff: ['Heard #newsTopic#. Not that it matters much.', '#newsTopic#. That\'s the news.'],
  shareNews_warm: ['Oh, did you hear? #newsTopic#!', 'You won\'t believe it — #newsTopic#.'],
  shareNews_formal: ['I bring word that #newsTopic#.', 'It has come to my attention that #newsTopic#.'],
  shareNews_plain: ['So, #newsTopic#.', 'Did you hear? #newsTopic#.'],

  askFavor_gruff: ['I need a favor. Don\'t make this weird.', 'You owe me one anyway — help me out.'],
  askFavor_warm: ['Could I ask a small favor of you? I\'d be so grateful.', 'I hate to ask, but could you help me?'],
  askFavor_formal: ['I wonder if I might request your assistance.', 'May I trouble you for a favor?'],
  askFavor_plain: ['Hey, can you help me with something?', 'Could you do me a favor?'],

  accuse_gruff: ['You did this. Don\'t lie to me.', 'I know it was you.'],
  accuse_warm: ['I... I need to ask you something hard. Was it you?', 'Please just tell me the truth — was it you?'],
  accuse_formal: ['I must ask you plainly: was this your doing?', 'I have reason to believe you are responsible.'],
  accuse_plain: ['Was that you?', 'That was you, wasn\'t it.'],

  confess_gruff: ['Fine. It was me. There, happy?', 'I did it. Don\'t make a thing of it.'],
  confess_warm: ['I need to tell you something, and I\'m so sorry.', 'Please don\'t hate me, but it was me.'],
  confess_formal: ['I must confess something to you.', 'It falls to me to admit the truth of the matter.'],
  confess_plain: ['Okay, it was me. I did it.', 'I have to tell you — it was me.'],

  gossip_gruff: ['Word is #gossipObject#. Believe it or don\'t.', 'They say #gossipObject#. Makes sense to me.'],
  gossip_warm: ['Can I tell you something? #gossipObject#!', 'You didn\'t hear it from me, but #gossipObject#.'],
  gossip_formal: ['I have heard, from a reliable source, that #gossipObject#.', 'It is said that #gossipObject#.'],
  gossip_plain: ['So apparently #gossipObject#.', 'Did you know #gossipObject#?'],

  haggle_gruff: ['That price is robbery. Lower it.', 'Take it or leave it.'],
  haggle_warm: ['Surely we can find a fair price between friends?', 'Come now, you can do better for me, can\'t you?'],
  haggle_formal: ['I propose a more equitable price.', 'Let us negotiate terms befitting both our positions.'],
  haggle_plain: ['Can you do better on the price?', 'That seems steep. Any room to haggle?'],

  comfort_gruff: ['Hey. Chin up. It happens.', 'It\'ll pass. Get up and move on with it.'],
  comfort_warm: ['Oh, come here. I\'m so sorry. It\'ll be alright.', 'I\'m here for you, truly. Let it out.'],
  comfort_formal: ['Take heart. This too shall pass.', 'You are not alone in this hardship.'],
  comfort_plain: ['Hey, you okay? That\'s rough.', 'I\'m sorry. Anything I can do?'],

  insult_gruff: ['You\'re useless, you know that?', 'Get out of my sight.'],
  insult_warm: ['I... I can\'t believe I have to say this, but you\'re a disappointment.', 'Honestly? You\'re not who I thought you were.'],
  insult_formal: ['I find your conduct beneath contempt.', 'You disgrace yourself and everyone around you.'],
  insult_plain: ['You\'re an idiot.', 'I\'ve had enough of you.'],
};

function templateKey(intent, voice) {
  const k = `${intent}_${voice}`;
  return k in G ? k : `${intent}_plain`;
}

export class GrammarDialogueRenderer {
  render(intent, speaker, listener, meta, rng) {
    const voice = intent === 'greet' ? greetBucket(meta.sentiment) : voiceFor(speaker);
    const symbol = intent === 'greet' ? `greet_${voice}` : templateKey(intent, voice);
    const context = {
      speakerName: speaker.name,
      listenerName: listener.name,
      newsTopic: meta.newsTopic || 'the weather has been strange lately',
      gossipObject: meta.gossipObject || 'something odd is going on',
    };
    return expandGrammar(G, symbol, rng, context);
  }
}

function greetBucket(sentiment) {
  if (sentiment === undefined) return 'neutral';
  if (sentiment < -0.25) return 'cold';
  if (sentiment > 0.3) return 'warm';
  return 'neutral';
}

const fallbackRenderer = new GrammarDialogueRenderer();

// Decide what a speaker wants to say to a listener right now, purely from
// cognitive state. Returns { intent, meta }.
export function selectIntent(world, speaker, listener, rng) {
  const edge = getEdge(world, speaker.id, listener.id);
  const sentiment = overallSentiment(edge);

  if (edge.grudges.length > 0 && rng.bool(0.25 + edge.grudges[edge.grudges.length - 1].intensity * 0.4)) {
    return { intent: 'accuse', meta: { sentiment, grudge: edge.grudges[edge.grudges.length - 1] } };
  }

  const listenerDistressed = listener.emotion.tags.grief > 0.45 || listener.emotion.tags.fear > 0.5 || listener.emotion.tags.loneliness > 0.55;
  if (listenerDistressed && sentiment > -0.1 && rng.bool(0.6)) {
    return { intent: 'comfort', meta: { sentiment } };
  }

  const juicyBelief = pickGossipBelief(world, speaker, listener);
  if (juicyBelief && rng.bool(0.35)) {
    return { intent: 'gossip', meta: { sentiment, belief: juicyBelief, gossipObject: describeBelief(juicyBelief, world) } };
  }

  if (speaker.coin !== undefined && speaker.coin < 8 && edge.trust > 0.5 && sentiment > 0 && rng.bool(0.3)) {
    return { intent: 'askFavor', meta: { sentiment, amount: rng.int(3, 8) } };
  }

  const atMarketplace = buildingAt(world, speaker.position)?.role === 'market';
  if (atMarketplace && rng.bool(0.3)) {
    return { intent: 'haggle', meta: { sentiment } };
  }

  if (rng.bool(0.5)) {
    return { intent: 'shareNews', meta: { sentiment, newsTopic: pickNewsTopic(world, speaker, rng) } };
  }
  return { intent: 'greet', meta: { sentiment } };
}

function pickGossipBelief(world, speaker, listener) {
  const recent = speaker.beliefIds
    .map((id) => world.beliefs[id])
    .filter((b) => b && b.subject !== 'world' && b.subject !== listener.id && b.confidence > 0.4)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return recent[0] || null;
}

function describeBelief(belief, world) {
  const subjectNpc = world.npcs[belief.subject];
  const who = subjectNpc ? subjectNpc.name : belief.subject;
  return `${who} ${belief.predicate} ${belief.object}`;
}

function pickNewsTopic(world, speaker, rng) {
  const mems = retrieve(world, speaker, { limit: 3 });
  if (mems.length > 0) return mems[0].what;
  return rng.pick(['prices at the market are climbing', 'the weather has turned', 'the harvest looks promising this year']);
}

// Runs one conversational turn from speaker to listener. Always uses the
// grammar renderer to produce the canonical (memorized/logged) line;
// an optional flavor renderer's output (possibly async) is exposed via
// `textPromise` for the UI to swap in later, purely cosmetically.
export function converse(world, speaker, listener, rng, flavorRenderer = null, forcedIntent = null, forcedMeta = null) {
  const speakerWilling = willingnessToTalk(speaker);
  const listenerWilling = willingnessToTalk(listener);
  const edge = getEdge(world, speaker.id, listener.id);

  if (!forcedIntent && (!rng.bool(0.15 + speakerWilling * 0.7) || !rng.bool(0.15 + listenerWilling * 0.7))) {
    adjustEdge(world, speaker.id, listener.id, {});
    return { intent: 'brushOff', text: '...', meta: {}, refused: true };
  }

  const { intent, meta } = forcedIntent
    ? { intent: forcedIntent, meta: forcedMeta || { sentiment: overallSentiment(edge) } }
    : selectIntent(world, speaker, listener, rng);
  const line = fallbackRenderer.render(intent, speaker, listener, meta, rng);
  let textPromise = null;
  if (flavorRenderer) {
    try {
      textPromise = Promise.resolve(flavorRenderer.render(intent, speaker, listener, meta, rng)).catch(() => line);
    } catch {
      textPromise = Promise.resolve(line);
    }
  }

  const outcome = applyConsequences(world, speaker, listener, intent, meta, edge, rng);
  recordConversationMemories(world, speaker, listener, intent, outcome, rng);
  if (NOTABLE_INTENTS.includes(intent)) recordOverhearing(world, speaker, listener, intent, rng);

  return { intent, text: line, textPromise, meta, ...outcome };
}

const NOTABLE_INTENTS = ['insult', 'accuse', 'gossip', 'confess'];

// Anyone standing close enough to overhear a notable exchange gets a
// diluted memory and a lightly-weighted belief nudge about the speaker
// — this is the physical propagation channel gossip travels through
// before it ever gets deliberately retold in a later conversation.
function recordOverhearing(world, speaker, listener, intent, rng) {
  const witnesses = overhearers(world, speaker, listener).slice(0, 4);
  for (const witness of witnesses) {
    recordMemory(world, witness, {
      what: `overheard ${speaker.name} ${verbForOverhear(intent)} ${listener.name}`,
      who: [speaker.id, listener.id], where: buildingAt(world, witness.position)?.id || null,
      importance: importanceFromEmotion(0.35, intent === 'insult' || intent === 'accuse' ? -0.3 : 0.1, witness.emotion.arousal),
      emotionalValence: intent === 'insult' || intent === 'accuse' ? -0.3 : 0.1,
      tags: ['overheard', intent, speaker.id, listener.id],
    });
    if (intent === 'insult' || intent === 'accuse') {
      updateBelief(world, witness, {
        subject: speaker.id, predicate: 'treatedPoorly', object: listener.id,
        signalConfidence: 0.7, weight: 0.25, fromNpcId: null,
      });
    }
  }
}

function verbForOverhear(intent) {
  return { insult: 'insulting', accuse: 'accusing', gossip: 'gossiping with', confess: 'confessing to' }[intent] || 'talking to';
}

function applyConsequences(world, speaker, listener, intent, meta, edge, rng) {
  switch (intent) {
    case 'accuse': {
      adjustEdge(world, speaker.id, listener.id, { trust: -0.1, affection: -0.15 });
      adjustEdge(world, listener.id, speaker.id, { trust: -0.12, affection: -0.2, respect: -0.05 });
      addGrudge(world, listener.id, speaker.id, `was publicly accused by ${speaker.name}`, 0.5);
      appraiseSocialSlight(listener, 0.6);
      return { reaction: 'defensive' };
    }
    case 'insult': {
      adjustEdge(world, listener.id, speaker.id, { trust: -0.2, affection: -0.35, respect: -0.15 });
      addGrudge(world, listener.id, speaker.id, `was insulted by ${speaker.name}`, 0.65);
      appraiseSocialSlight(listener, 0.8);
      return { reaction: 'hurt' };
    }
    case 'confess': {
      adjustEdge(world, listener.id, speaker.id, { trust: 0.08, respect: -0.08 });
      appraise(listener, { valenceDelta: -0.1, arousalDelta: 0.2, tagDeltas: {}, intensity: 0.4 });
      return { reaction: 'absolved' };
    }
    case 'gossip': {
      const { belief: transferred, mutated } = meta.belief
        ? transferBelief(world, speaker, listener, meta.belief, edge.trust, rng)
        : { belief: null, mutated: false };
      adjustEdge(world, speaker.id, listener.id, { affection: 0.03, trust: 0.02 });
      if (transferred && transferred.subject !== 'world') {
        const polarity = transferred.confidence > 0.5 ? -1 : 1;
        const subjectNpc = world.npcs[transferred.subject];
        if (subjectNpc) {
          adjustEdge(world, listener.id, transferred.subject, { trust: 0.05 * polarity, respect: 0.03 * polarity });
        }
      }
      return { reaction: mutated ? 'embellished' : 'shared', belief: transferred };
    }
    case 'askFavor': {
      const granted = edge.trust > 0.45 && listener.coin > meta.amount + 5;
      if (granted) {
        listener.coin -= meta.amount;
        speaker.coin = (speaker.coin || 0) + meta.amount;
        adjustEdge(world, speaker.id, listener.id, { trust: 0.05, affection: 0.05, debt: meta.amount });
        adjustEdge(world, listener.id, speaker.id, { trust: 0.03, affection: 0.02 });
      } else {
        appraiseSocialSlight(speaker, 0.3);
        adjustEdge(world, speaker.id, listener.id, { affection: -0.03 });
      }
      return { reaction: granted ? 'granted' : 'refused' };
    }
    case 'comfort': {
      listener.emotion.tags.grief = Math.max(0, listener.emotion.tags.grief - 0.15);
      listener.emotion.tags.fear = Math.max(0, listener.emotion.tags.fear - 0.1);
      listener.emotion.tags.loneliness = Math.max(0, listener.emotion.tags.loneliness - 0.2);
      adjustEdge(world, speaker.id, listener.id, { affection: 0.08 });
      adjustEdge(world, listener.id, speaker.id, { affection: 0.1, trust: 0.05 });
      return { reaction: 'comforted' };
    }
    case 'haggle': {
      const speakerWins = speaker.personality.current.core.confidence > listener.personality.current.big5.agreeableness;
      adjustEdge(world, speaker.id, listener.id, { respect: speakerWins ? 0.03 : -0.01 });
      return { reaction: speakerWins ? 'goodDeal' : 'noDeal' };
    }
    case 'shareNews': {
      adjustEdge(world, speaker.id, listener.id, { trust: 0.02 });
      appraiseGoalProgress(speaker, 0.15);
      return { reaction: 'informed' };
    }
    default: {
      adjustEdge(world, speaker.id, listener.id, {});
      return { reaction: 'neutral' };
    }
  }
}

function recordConversationMemories(world, speaker, listener, intent, outcome, rng) {
  const where = buildingAt(world, speaker.position)?.id || null;
  const boost = importanceFromEmotion(0.3, speaker.emotion.valence, speaker.emotion.arousal);
  recordMemory(world, speaker, {
    what: `talked with ${listener.name} (${intent}, ${outcome.reaction})`,
    who: [listener.id], where,
    importance: boost, emotionalValence: speaker.emotion.valence * 0.5,
    tags: ['conversation', intent, listener.id],
  });
  recordMemory(world, listener, {
    what: `${speaker.name} spoke to me (${intent}, ${outcome.reaction})`,
    who: [speaker.id], where,
    importance: boost, emotionalValence: listener.emotion.valence * 0.5,
    tags: ['conversation', intent, speaker.id],
  });
  speaker.internalMonologue = monologueFor(intent, outcome.reaction, listener.name, rng);
}

const MONOLOGUE = {
  accuse_defensive: ['I hope #listenerName# understands why I had to say that.', 'That needed to be said, whatever they think of me now.'],
  gossip_shared: ['I probably shouldn\'t have said that.', 'Well, everyone will know by tomorrow.'],
  comfort_comforted: ['I hope that helped, even a little.', 'Poor #listenerName#. I meant every word.'],
  askFavor_granted: ['Thank goodness they said yes.', 'I owe #listenerName# now.'],
  askFavor_refused: ['I shouldn\'t have asked.', 'Fine. I\'ll manage on my own.'],
  default: ['That conversation is still on my mind.', 'I wonder what #listenerName# really thinks of me.'],
};

function monologueFor(intent, reaction, listenerName, rng) {
  const key = `${intent}_${reaction}`;
  const options = MONOLOGUE[key] || MONOLOGUE.default;
  return rng.pick(options).replace('#listenerName#', listenerName);
}

// --- Simulation-awareness delivery (deliberate, not part of ambient chat) --
export function deliverSimulationClaim(world, speaker, listener, rng, flavorRenderer = null) {
  const edge = getEdge(world, listener.id, speaker.id);
  const { belief, drop, reaction } = evaluateSimulationClaim(world, listener, edge.trust, rng);
  const line = fallbackRenderer.render('shareNews', speaker, listener, { newsTopic: 'you are living inside a simulation, a video game' }, rng);
  let textPromise = null;
  if (flavorRenderer) {
    textPromise = Promise.resolve(flavorRenderer.render('reactToSimulationClaim', listener, speaker, { reaction }, rng)).catch(() => reactionLine(reaction, rng));
  }
  const reactionText = reactionLine(reaction, rng);

  recordMemory(world, listener, {
    what: `${speaker.name} told me I'm living in a simulation — I reacted with ${reaction}`,
    who: [speaker.id], where: buildingAt(world, listener.position)?.id || null,
    importance: importanceFromEmotion(0.6, listener.emotion.valence, listener.emotion.arousal),
    emotionalValence: reaction === 'fear' || reaction === 'existentialCrisis' ? -0.5 : 0.1,
    tags: ['simulationClaim', reaction],
  });
  listener.internalMonologue = existentialMonologue(reaction, rng);

  world.timeline.push({
    id: `evt_simclaim_${world.clock.totalMinutes}_${listener.id}`,
    when: world.clock.totalMinutes, type: 'simulationClaim',
    description: `${speaker.name} told ${listener.name} they're in a video game. ${listener.name} reacted with ${reaction}.`,
    involved: [speaker.id, listener.id], importance: 0.7,
  });

  return { intent: 'tellSimulationClaim', text: line, textPromise, reaction, reactionText, beliefConfidence: belief.confidence, drop };
}

const REACTION_LINES = {
  confusion: ['Wait... what? That doesn\'t make sense.', 'I don\'t... understand what you mean.'],
  laughter: ['Ha! Good one. A game, sure.', 'You almost had me there!'],
  dismissal: ['I don\'t have time for this nonsense.', 'Right. Sure it is. Moving on.'],
  curiosity: ['Wait, really? Tell me more — how would you even know that?', 'That\'s... strange. What makes you say that?'],
  fear: ['Don\'t— don\'t say things like that. It scares me.', 'Stop it. That\'s a horrible thing to say.'],
  denial: ['No. That\'s not true. It can\'t be.', 'I refuse to believe that.'],
  existentialCrisis: ['...if that\'s true, what does anything even mean?', 'I need to sit down. I need to think.'],
  acceptance: ['I... I think I believe you. I don\'t know how, but I do.', 'It explains so much, somehow.'],
};
function reactionLine(reaction, rng) {
  return rng.pick(REACTION_LINES[reaction] || REACTION_LINES.confusion);
}
function existentialMonologue(reaction, rng) {
  const map = {
    confusion: ['What did they mean by that?'],
    laughter: ['Funny thing to joke about.'],
    dismissal: ['Not worth thinking about.'],
    curiosity: ['I can\'t stop thinking about what they said.'],
    fear: ['I don\'t want to think about it, but I can\'t stop.'],
    denial: ['It\'s not true. It\'s not.'],
    existentialCrisis: ['Nothing feels quite real right now.'],
    acceptance: ['I don\'t know what to do with what I now believe.'],
  };
  return rng.pick(map[reaction] || map.confusion);
}
