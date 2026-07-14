// interactionMenu.js — The player's action menu: same intents NPCs use.
//
// The player is just another person (see player.js): this menu doesn't
// call any special "player dialogue" system, it calls the exact same
// talk()/giveGift()/stealFrom()/tellSimulationClaim() functions that
// route through dialogue.converse() and the belief/relationship/memory
// pipelines every NPC uses.

import { nearbyTalkableNpcs, talk, giveGift, stealFrom, tellSimulationClaim } from '../player/player.js';
import { INTENTS } from '../dialogue/dialogue.js';

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export function renderInteractionMenu(container, world, rng, onAction) {
  const nearby = nearbyTalkableNpcs(world, 2);
  if (nearby.length === 0) {
    container.innerHTML = '<p class="muted">No one is close enough to interact with. Walk closer (arrow keys / WASD).</p>';
    return;
  }
  container.innerHTML = nearby.map((npc) => `
    <div class="interact-card" data-npc="${npc.id}">
      <h4>${esc(npc.name)} <span class="muted">(${esc(npc.occupation)})</span></h4>
      <div class="btn-row">
        ${INTENTS.map((i) => `<button data-intent="${i}" data-npc="${npc.id}">${i}</button>`).join('')}
        <button data-special="simclaim" data-npc="${npc.id}">tell "you're in a game"</button>
        <button data-special="gift" data-npc="${npc.id}">give gift (5 coin)</button>
        <button data-special="steal" data-npc="${npc.id}">steal</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('button[data-intent]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const result = talk(world, btn.dataset.npc, btn.dataset.intent, rng);
      onAction && onAction({ kind: 'talk', npcId: btn.dataset.npc, result });
    });
  });
  container.querySelectorAll('button[data-special]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const npcId = btn.dataset.npc;
      let result;
      if (btn.dataset.special === 'simclaim') result = tellSimulationClaim(world, npcId, rng);
      else if (btn.dataset.special === 'gift') result = giveGift(world, npcId, 5);
      else if (btn.dataset.special === 'steal') result = stealFrom(world, npcId, rng);
      onAction && onAction({ kind: btn.dataset.special, npcId, result });
    });
  });
}
