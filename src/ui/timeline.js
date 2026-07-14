// timeline.js — The world timeline: a running log of emergent events.
//
// Everything pushed to world.timeline (friendships, rivalries, thefts,
// price changes, festivals, legends, achievements, simulation-awareness
// reactions...) is rendered here, most recent first. This is the other
// half of "proof the world is alive" alongside the per-NPC inspector.

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const ICONS = {
  genesis: '✨', friendship: '🤝', rivalry: '⚔️', theft: '🧹',
  priceChange: '💰', festival: '🎉', legend: '📜', achievement: '🏆',
  conversation: '💬', simulationClaim: '🤯', gift: '🎁', emergency: '⚠️',
};

export function renderTimeline(container, world, { limit = 40 } = {}) {
  const entries = world.timeline.slice(-limit).reverse();
  container.innerHTML = `
    <ul class="timeline">
      ${entries.map((e) => `<li><span class="icon">${ICONS[e.type] || '•'}</span> <span class="tstamp">${dayLabel(world, e.when)}</span> ${esc(e.description)}</li>`).join('') || '<li class="muted">Nothing has happened yet.</li>'}
    </ul>
  `;
}

function dayLabel(world, whenMinutes) {
  const day = Math.floor(whenMinutes / 1440);
  const hour = Math.floor(whenMinutes / 60) % 24;
  const minute = whenMinutes % 60;
  return `D${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
