// ids.js — Stable, deterministic ID generation for every table row.
//
// IDs are derived from a monotonic counter stored in world state (not
// Date.now(), not Math.random()) so that two runs with the same seed and
// the same player input produce byte-identical IDs. This matters for the
// relational-schema save format: memories, beliefs, relationships, and
// events all need stable foreign keys.

export function nextId(world, prefix) {
  const n = world.nextIdCounter++;
  return `${prefix}_${n}`;
}
