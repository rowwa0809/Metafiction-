// ollamaRenderer.js — Optional local-LLM flavor layer. OFF by default.
//
// Implements the same duck-typed DialogueRenderer interface as
// GrammarDialogueRenderer (render(intent, speaker, listener, meta, rng)),
// but returns a Promise, since it hits a local Ollama server. It is only
// ever used to *decorate* the text shown in the UI after the grammar
// renderer has already produced the canonical line used for memory and
// consequences (see dialogue.js:converse) — so a slow/unavailable Ollama
// can never stall or desync the simulation. If the request fails or the
// user hasn't started Ollama, callers already fall back to the grammar
// line (see the `.catch(() => line)` in dialogue.js).
//
// Requires nothing installed beyond Ollama itself running locally
// (https://ollama.com), which is free and never leaves the user's
// machine — no API keys, no accounts, no cost.

const DEFAULT_ENDPOINT = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = 'llama3.2';
const TIMEOUT_MS = 4000;

export class OllamaDialogueRenderer {
  constructor({ endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL } = {}) {
    this.endpoint = endpoint;
    this.model = model;
  }

  async render(intent, speaker, listener, meta, rng) {
    const prompt = buildPrompt(intent, speaker, listener, meta);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt, stream: false, options: { temperature: 0.8 } }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      const text = (data.response || '').trim().split('\n')[0].slice(0, 240);
      if (!text) throw new Error('empty Ollama response');
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildPrompt(intent, speaker, listener, meta) {
  const p = speaker.personality.current;
  const traits = `openness ${p.big5.openness.toFixed(2)}, agreeableness ${p.big5.agreeableness.toFixed(2)}, neuroticism ${p.big5.neuroticism.toFixed(2)}`;
  return [
    `You are ${speaker.name}, a ${speaker.age}-year-old ${speaker.occupation} in a small village.`,
    `Personality traits (0-1 scale): ${traits}. Speech style tic: ${speaker.personality.quirks.speechTic}.`,
    `You are about to speak to ${listener.name}. Your conversational intent is: "${intent}".`,
    meta.newsTopic ? `The news/topic is: ${meta.newsTopic}.` : '',
    meta.gossipObject ? `The rumor is: ${meta.gossipObject}.` : '',
    `Write ONE short in-character line of dialogue (under 25 words). Output only the line, no quotes, no narration.`,
  ].filter(Boolean).join('\n');
}

// Quick reachability probe used by the settings UI to show whether Ollama
// is actually available before letting the user flip the toggle on.
export async function checkOllamaAvailable(endpoint = 'http://localhost:11434/api/tags') {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
