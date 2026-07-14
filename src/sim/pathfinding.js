// pathfinding.js — Grid A* over the village map.
//
// Nothing psychological here; just plumbing so NPCs can actually walk to
// wherever their goal plan says they need to be. 8-directional movement,
// Chebyshev heuristic (matches diagonal-cost-1 movement), small binary
// heap-free priority queue since maps here are tiny (a linear scan over
// a bounded open set is plenty fast at this scale).

import { isWalkable } from './map.js';

function heuristic(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const DIRS = [
  { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
];

export function findPath(map, start, goal) {
  if (start.x === goal.x && start.y === goal.y) return [];
  const key = (p) => `${p.x},${p.y}`;
  const open = new Map();
  const closed = new Set();
  const gScore = new Map();
  const fScore = new Map();
  const cameFrom = new Map();

  gScore.set(key(start), 0);
  fScore.set(key(start), heuristic(start, goal));
  open.set(key(start), start);

  let guard = 0;
  while (open.size > 0 && guard++ < 4000) {
    let currentKey = null;
    let currentF = Infinity;
    for (const [k, p] of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < currentF) { currentF = f; currentKey = k; }
    }
    const current = open.get(currentKey);
    if (current.x === goal.x && current.y === goal.y) {
      return reconstruct(cameFrom, currentKey, current);
    }
    open.delete(currentKey);
    closed.add(currentKey);

    for (const { dx, dy } of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nKey = `${nx},${ny}`;
      if (closed.has(nKey)) continue;
      if (!isWalkable(map, nx, ny)) continue;
      // prevent diagonal squeezing between two blocked corners
      if (dx !== 0 && dy !== 0 && (!isWalkable(map, current.x + dx, current.y) || !isWalkable(map, current.x, current.y + dy))) continue;

      const stepCost = (dx !== 0 && dy !== 0) ? 1.414 : 1;
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + stepCost;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, { key: currentKey, point: current });
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + heuristic({ x: nx, y: ny }, goal));
        if (!open.has(nKey)) open.set(nKey, { x: nx, y: ny });
      }
    }
  }
  return null; // no path found
}

function reconstruct(cameFrom, currentKey, current) {
  const path = [current];
  let k = currentKey;
  while (cameFrom.has(k)) {
    const prev = cameFrom.get(k);
    path.unshift(prev.point);
    k = prev.key;
  }
  path.shift(); // drop the start tile itself
  return path;
}
