// eventBus.js — Engine/UI signal bus. NOT a channel for NPC knowledge.
//
// This exists so the renderer, debug inspector, and audio/UI layers can
// react to simulation ticks without polling. It is deliberately NOT used
// to give NPCs information about the world: an NPC never "subscribes" to
// a global event to learn something happened elsewhere. That would break
// perception-limited world awareness. NPCs only learn things through
// perception.js (sight/hearing/range) or through being told in
// conversation. This bus is for pixels and panels, not minds.

export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  }

  emit(type, payload) {
    const arr = this.listeners.get(type);
    if (!arr || arr.length === 0) return;
    for (const fn of arr.slice()) fn(payload);
  }
}
