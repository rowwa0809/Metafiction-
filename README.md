# Project Genesis: Village Zero

A living-world village simulation where every NPC believes it is a real
person living a real life. This is a systems-driven civilization
simulator, not a scripted game: nothing waits for the player, nothing is
authored dialogue, and every relationship, rumor, and grudge is the
output of a cognitive model, not a script.

**$0 forever.** No API calls, no servers, no accounts, no build service.
It's `index.html` + ES module JavaScript, opened through a static file
server, saving to your browser's IndexedDB.

## Running it

Because the game is organized as ES modules (`import`/`export`), browsers
block loading them over the bare `file://` protocol (a CORS restriction on
modules, not a cost or install requirement). Serve the folder with any
static file server — nothing to install beyond what most systems already
have:

```bash
# Python (usually already installed)
python3 -m http.server 8080

# or, if you have Node:
npx serve .
```

Then open `http://localhost:8080/` in a browser. That's it — no build
step, no `npm install`, no database.

There is nothing to compile: `src/**/*.js` is plain, clean ES module
JavaScript, loaded directly by `index.html` via `<script type="module">`.

## Controls

- **Move**: WASD or arrow keys.
- **Click an NPC** on the map to open their dossier in the Inspector tab.
- **Interact tab**: lists NPCs within talking range and lets you choose
  any conversational intent (greet, gossip, accuse, comfort, insult, ...),
  or give a gift, steal, or tell them "you are in a video game."
- **Timeline tab**: a running log of emergent events — friendships,
  rivalries, thefts, price swings, festivals, legends, achievements.
- **Settings tab**: optional local-Ollama dialogue flavor toggle (see below).
- **Save / Export .json / Import**: manual persistence controls. The game
  also autosaves to IndexedDB every 30 seconds and on an interval tick.

## Architecture

Everything lives in one plain, serializable `world` object (see
`src/core/worldState.js`). There is no hidden state anywhere else — the
whole simulation is a pure function of `world` plus a deterministic RNG
stream, which is what makes save/load, catch-up simulation, and "same
seed -> same history" all fall out for free.

```
src/
  core/         RNG (mulberry32), clock/calendar, event bus, ids,
                worldState (the one serializable object), save (IndexedDB
                + JSON export/import fallback)
  sim/          map + building layout, A* pathfinding, daily routines,
                simulation.js (the world tick loop, nightly consolidation,
                catch-up simulation)
  cognition/    memory (tiered episodic/semantic), beliefs (confidence +
                social propagation = rumors), emotions (appraisal-based),
                personality (Big Five + values + quirks + backstory),
                relationships (directed trust/affection/respect graph),
                goals (utility AI + a lightweight GOAP action-recipe
                planner), perception (the ONLY channel through which an
                NPC learns anything about the world)
  dialogue/     grammar.js (Tracery-style template expansion), dialogue.js
                (intent selection + conversation consequences), the
                optional ollamaRenderer.js flavor layer
  economy/      flow economy: grain -> bread, ore -> tools, supply/demand
                pricing, wages, shortage -> hunger -> theft cascades
  society/      culture drift, festivals, reputation, legend generation
  npc/          worldgen (identity-card generation, families, jobs),
                npc.js (per-NPC tick: the orchestration glue)
  player/       the player is a normal row in world.npcs (isPlayer: true)
                that runs through the exact same pipelines as any NPC
  render/       Canvas 2D rendering: terrain, buildings, day/night
                lighting, weather
  ui/           debug inspector, world timeline panel, interaction menu
  main.js       wires the DOM to the simulation
test/
  run-sim.mjs   headless (no DOM) deterministic acceptance-test harness
```

### The cognitive pipeline, in one sentence per module

- **personality.js** rolls Big Five traits, values, quirks, and a
  formative backstory event once per NPC from the seed, and lets them
  drift (slowly, capped) in response to major life events.
- **memory.js** files perceived events into immediate -> short-term ->
  long-term tiers with decay, emotional-weighting-boosted promotion, and
  reconstructive distortion on retrieval (recalling a memory can subtly
  change it — this is why two witnesses to one event diverge over time).
- **beliefs.js** holds propositions with a confidence and an evidence
  trail; contradiction weakens rather than flips a belief, and
  conversation transfers beliefs at a discount set by trust in the
  speaker — that single mechanic *is* the rumor system.
- **emotions.js** is appraisal theory: goal-blocked events provoke
  anger/fear, goal-progress provokes joy, loss provokes grief; the
  resulting state gates utility scoring, market pricing, willingness to
  talk, and memory-encoding strength.
- **relationships.js** is a directed graph (A can love B who resents A)
  with trust/affection/respect/familiarity/debt and explicit grudge
  records, so the inspector can point at *why* someone is cold to you.
- **goals.js** turns decaying needs, standing ambitions, and emergencies
  into a scored candidate list; the winner gets a short GOAP-style action
  recipe (see `planForGoal`).
- **perception.js** is the only door between the world and an NPC's
  mind — sight/hearing range and an attention filter. No NPC ever reads
  global state; an event on the far side of the village stays unknown
  until gossip (or being an actual witness) carries it there.
- **dialogue.js** picks a conversational intent from cognitive state,
  renders it through a personality-conditioned template grammar
  (`grammar.js`), and applies mechanical consequences (relationship
  deltas, belief transfer, new memories on both sides) — text is a
  side-effect of the decision, not the decision itself.

### Simulation-awareness as an ordinary belief

Telling an NPC "you're living in a video game" is not a special dialogue
branch. It's evidence against their ordinary belief `world.isReal`
(seeded at ~99% confidence at worldgen). `beliefs.evaluateSimulationClaim`
runs it through the same `updateBelief` pipeline as any other testimony,
then classifies a reaction (confusion / laughter / dismissal / curiosity /
fear / denial / existential crisis / acceptance) from the resulting
confidence swing and the listener's own intelligence, openness, and
neuroticism. Acceptance only becomes possible after repeated strong
evidence drops confidence below 50% — nobody instantly believes it.

### Determinism

`core/rng.js` implements mulberry32. Every stochastic decision in the
simulation goes through `world.rng` (or a `.child(key)` sub-stream derived
from it at worldgen, so per-NPC trait rolls don't perturb the shared
tick-time stream). Cosmetic-only randomness (which pixel a raindrop starts
at) intentionally uses `Math.random()` in the renderer, since it has no
bearing on world history — everything that touches `world` state goes
through the seeded stream. `test/run-sim.mjs` verifies that two runs of
the same seed with no player input produce byte-identical timelines.

### Level of detail

`sim/simulation.js#updatePriorities` gives NPCs near the player (or
involved in an active interrupt) full per-tick fidelity; everyone else
still ticks, just at a coarser interval (see `LOD_SLOW_INTERVAL`). Nothing
in the codebase assumes every NPC updates every tick — this is meant to
scale toward the 1,000/10,000-NPC tiers described in the design brief by
tightening that interval and compressing memory detail further for
low-priority NPCs, without restructuring the core loop.

### Save schema

`serializeWorld`/`deserializeWorld` (in `core/worldState.js`) mirror a
relational schema on purpose: `npcs`, `memories`, `beliefs`,
`relationships`, and `timeline` (events) are plain id-keyed tables with
stable ids and timestamps, even though today they're just serialized to
IndexedDB/JSON. Migrating to a real database later is a mechanical
exercise, not a redesign.

## Optional: local Ollama dialogue flavor

Off by default; the game is 100% playable with only the grammar-based
renderer. To try it:

1. Install and run [Ollama](https://ollama.com) locally (free, runs on
   your own machine, no account).
2. Pull a small model, e.g. `ollama pull llama3.2`.
3. In the game's **Settings** tab, check "Use local Ollama for flavor
   text." The game pings `localhost:11434` and only enables the toggle if
   it's reachable; otherwise it tells you and falls back automatically.

`dialogue/ollamaRenderer.js` implements the same duck-typed
`DialogueRenderer` interface as the default grammar renderer
(`render(intent, speaker, listener, meta, rng) -> string | Promise<string>`).
Critically, the grammar renderer's line is *always* computed first and is
what gets memorized/logged and used for every mechanical consequence —
Ollama's (possibly slow, possibly unavailable) response only ever
decorates the displayed text after the fact. The simulation never blocks
on it and never desyncs if it's absent or times out.

## Acceptance tests

See `test/run-sim.mjs` (a headless, DOM-free harness using the same
simulation code as the browser) and `EMERGENCE_REPORT.md` for the actual
results of running the seven acceptance tests from the design brief.

```bash
node test/run-sim.mjs
```
