// inspector.js — The debug inspector: proof the world is alive, not faked.
//
// Renders a live dossier for whichever NPC is selected: identity card,
// current goal/action, emotional state, hidden internal monologue, top
// retrieved memories, beliefs about the player, and relationship edges.
// Pure read/render — it never mutates world state, so opening it can
// never change what it's showing.

import { retrieve, tierCounts } from '../cognition/memory.js';
import { beliefsAbout } from '../cognition/beliefs.js';
import { outgoingEdges, overallSentiment } from '../cognition/relationships.js';
import { dominantEmotion } from '../cognition/emotions.js';
import { computeReputation } from '../society/society.js';
import { driftMagnitude } from '../cognition/personality.js';

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export function renderInspector(container, world, npcId) {
  const npc = world.npcs[npcId];
  if (!npc) { container.innerHTML = '<p class="muted">Click an NPC to inspect them.</p>'; return; }

  const p = npc.personality;
  const tiers = tierCounts(world, npc);
  const topMemories = retrieve(world, npc, { limit: 6 });
  const beliefsAboutPlayer = beliefsAbout(world, npc, 'player');
  const edges = outgoingEdges(world, npc.id).slice(0, 8);
  const reputation = computeReputation(world, npc.id);
  const dom = dominantEmotion(npc) || 'calm';

  container.innerHTML = `
    <div class="dossier">
      <h2>${esc(npc.name)} ${npc.isPlayer ? '(You)' : ''}</h2>
      <p class="muted">${esc(npc.age)}yo ${esc(npc.occupation)} &middot; from ${esc(npc.hometown)} &middot; rep ${reputation.toFixed(2)}</p>
      <div class="grid2">
        <div><b>Education</b><br>${esc(npc.education)}</div>
        <div><b>Family</b><br>spouse: ${npc.family.spouse ? esc(world.npcs[npc.family.spouse]?.name || '?') : '—'}, children: ${npc.family.children.length}</div>
        <div><b>Fear</b><br>${esc(npc.fear)}</div>
        <div><b>Dream</b><br>${esc(npc.dream)}</div>
        <div><b>Favorite food</b><br>${esc(p.quirks.favoriteFood)}</div>
        <div><b>Speech tic</b><br>${esc(p.quirks.speechTic)}</div>
        <div><b>Formative event</b><br>${esc(npc.personality.backstory.formativeEvent)} (${npc.personality.backstory.formativeIsTrauma ? 'trauma' : 'triumph'})</div>
        <div><b>Trait drift</b><br>${(driftMagnitude(p) * 100).toFixed(1)}% from baseline</div>
      </div>

      <h3>Current Goal</h3>
      <p>${esc(npc.goals.activeGoalType || 'undecided')} ${npc.goals.interrupt ? '<span class="tag urgent">INTERRUPT</span>' : ''}</p>
      <p class="muted">${npc.indoors ? 'indoors' : 'walking'} at (${npc.position.x}, ${npc.position.y})</p>

      <h3>Emotional State <span class="tag">${dom}</span></h3>
      <p>valence ${npc.emotion.valence.toFixed(2)} &middot; arousal ${npc.emotion.arousal.toFixed(2)}</p>
      <div class="bars">
        ${Object.entries(npc.emotion.tags).map(([k, v]) => `<div class="bar-row"><span>${k}</span><div class="bar"><div class="bar-fill" style="width:${Math.round(v * 100)}%"></div></div></div>`).join('')}
      </div>

      <h3>Internal Monologue <span class="tag">hidden</span></h3>
      <p class="monologue">&ldquo;${esc(npc.internalMonologue)}&rdquo;</p>

      <h3>Memory (${tiers.immediate} immediate / ${tiers.shortTerm} short-term / ${tiers.longTerm} long-term)</h3>
      <ul class="memlist">
        ${topMemories.map((m) => `<li>${esc(m.what)} <span class="muted">(imp ${m.importance.toFixed(2)}, conf ${m.confidence.toFixed(2)}, tier ${m.tier})</span></li>`).join('') || '<li class="muted">No memories yet.</li>'}
      </ul>

      <h3>Beliefs About the Player</h3>
      <ul class="memlist">
        ${beliefsAboutPlayer.map((b) => `<li>${esc(b.predicate)} ${esc(b.object)} <span class="muted">(conf ${b.confidence.toFixed(2)}${b.cognitiveDissonance ? ', dissonant' : ''})</span></li>`).join('') || '<li class="muted">No opinion formed yet.</li>'}
      </ul>

      <h3>Relationships</h3>
      <ul class="memlist">
        ${edges.map((e) => `<li>${esc(world.npcs[e.toId]?.name || e.toId)}: sentiment ${overallSentiment(e).toFixed(2)} (trust ${e.trust.toFixed(2)}, affection ${e.affection.toFixed(2)})${e.grudges.length ? ` <span class="tag urgent">${e.grudges.length} grudge(s)</span>` : ''}</li>`).join('') || '<li class="muted">No one they know well yet.</li>'}
      </ul>
    </div>
  `;
}
