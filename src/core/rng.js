// rng.js — Deterministic pseudo-randomness.
//
// Psychological/design model: none — this is the bedrock of determinism.
// Every stochastic decision any NPC ever makes (which memory mutates, which
// goal wins a near-tie, which rumor gets embellished) must trace back to
// this single seeded stream so that "same seed = same world history" holds.
// Never call Math.random() anywhere else in the simulation.

const MULT = 0x6D2B79F5;

export class RNG {
  constructor(seed) {
    this.state = (seed >>> 0) || 1;
  }

  // Returns a float in [0, 1).
  next() {
    let a = this.state;
    a |= 0;
    a = (a + MULT) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this.state = a;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Integer in [min, max] inclusive.
  int(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min, max) {
    return this.next() * (max - min) + min;
  }

  bool(p = 0.5) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }

  // Weighted pick: items = [{item, weight}]
  weighted(items) {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = this.next() * total;
    for (const i of items) {
      r -= i.weight;
      if (r <= 0) return i.item;
    }
    return items[items.length - 1].item;
  }

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Gaussian-ish via sum of uniforms (cheap, good enough for trait rolls).
  gauss(mean = 0, stdev = 1) {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += this.next();
    return mean + (sum - 3) * stdev;
  }

  serialize() {
    return this.state;
  }

  static fromState(state) {
    const r = new RNG(1);
    r.state = state >>> 0;
    return r;
  }

  // Derive an independent-looking child stream from a string key, so e.g.
  // "npc_12's wardrobe roll" doesn't perturb the main world stream.
  child(key) {
    let h = 2166136261 ^ this.state;
    for (let i = 0; i < key.length; i++) {
      h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    }
    return new RNG(h >>> 0);
  }
}
