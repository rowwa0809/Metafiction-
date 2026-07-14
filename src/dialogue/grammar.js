// grammar.js — Tiny Tracery-style template expander.
//
// Not a psychological model in itself — it's the rendering layer that
// turns a cognitive-state decision ("speaker wants to gossip about X with
// low confidence") into English, deterministically, with zero network
// calls. `#symbol#` tokens expand recursively either from the supplied
// context (concrete values like speaker/listener names) or from further
// grammar rules (so a single top-level rule can pull in "voice" flavor).

export function expandGrammar(grammar, startSymbol, rng, context = {}) {
  function exp(sym, depth) {
    if (depth > 16) return '';
    if (Object.prototype.hasOwnProperty.call(context, sym)) return String(context[sym]);
    const rules = grammar[sym];
    if (!rules || rules.length === 0) return `#${sym}#`;
    const chosen = rng.pick(rules);
    return chosen.replace(/#([a-zA-Z0-9_]+)#/g, (_, inner) => exp(inner, depth + 1));
  }
  return exp(startSymbol, 0).trim();
}
