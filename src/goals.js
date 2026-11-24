// Run goals. Three are picked per run (from the run's seed). Each one reports its
// progress as { value, target }; once a goal is reached its bonus is kept for good,
// even if the tide later takes the tiles that earned it.

import { neighbors, key } from './hex.js';
import { RNG } from './rng.js';

/** Sizes of connected groups of built cells whose type passes `inGroup`. */
function groups(board, inGroup) {
  const seen = new Set();
  const out = [];
  for (const c of board.builtCells()) {
    const k = key(c.q, c.r);
    if (seen.has(k) || !inGroup(c.tile.type)) continue;
    const members = [];
    const stack = [c];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop();
      members.push(cur);
      for (const [nq, nr] of neighbors(cur.q, cur.r)) {
        const n = board.get(nq, nr);
        const nk = key(nq, nr);
        if (n && n.land && n.tile && !seen.has(nk) && inGroup(n.tile.type)) {
          seen.add(nk);
          stack.push(n);
        }
      }
    }
    out.push(members);
  }
  return out;
}

const countType = (board, type) => board.builtCells().filter((c) => c.tile.type === type).length;

export const GOALS = [
  {
    id: 'harbours',
    text: 'Connect 3 Harbours',
    note: 'joined by a chain of built tiles',
    target: 3,
    bonus: 10,
    value: (b) => Math.max(0, ...groups(b, () => true).map((g) => g.filter((c) => c.tile.type === 'harbour').length)),
  },
  {
    id: 'village',
    text: 'Build a village of 6 Cottages',
    note: 'touching each other (Markets can join them)',
    target: 6,
    bonus: 12,
    value: (b) =>
      Math.max(0, ...groups(b, (t) => t === 'cottage' || t === 'market').map((g) => g.filter((c) => c.tile.type === 'cottage').length)),
  },
  {
    id: 'wood',
    text: 'Grow a wood of 5 Forests',
    note: 'all touching',
    target: 5,
    bonus: 8,
    value: (b) => Math.max(0, ...groups(b, (t) => t === 'forest').map((g) => g.length)),
  },
  {
    id: 'mill',
    text: 'A Windmill beside 3 Fields',
    target: 3,
    bonus: 8,
    value: (b) =>
      Math.max(
        0,
        ...b
          .builtCells()
          .filter((c) => c.tile.type === 'windmill')
          .map((c) => b.neighborTiles(c.q, c.r).filter((n) => n.tile.type === 'field').length),
      ),
  },
  {
    id: 'lights',
    text: 'Light the coast with 2 Lighthouses',
    target: 2,
    bonus: 6,
    value: (b) => countType(b, 'lighthouse'),
  },
  {
    id: 'marketday',
    text: 'A Market with 4 kinds of neighbour',
    target: 4,
    bonus: 8,
    value: (b) =>
      Math.max(
        0,
        ...b
          .builtCells()
          .filter((c) => c.tile.type === 'market')
          .map((c) => new Set(b.neighborTiles(c.q, c.r).map((n) => n.tile.type)).size),
      ),
  },
  {
    id: 'harvest',
    text: 'Sow 6 Fields',
    target: 6,
    bonus: 6,
    value: (b) => countType(b, 'field'),
  },
  {
    id: 'shore',
    text: '4 Meadows by the sea',
    target: 4,
    bonus: 6,
    value: (b) => b.builtCells().filter((c) => c.tile.type === 'meadow' && b.waterSides(c.q, c.r) > 0).length,
  },
];

export const GOAL_BY_ID = Object.fromEntries(GOALS.map((g) => [g.id, g]));

/** Three different goals for a run. */
export function pickGoals(seed, n = 3) {
  const rng = new RNG(seed ^ 0x90a15);
  return rng.shuffled(GOALS).slice(0, n).map((g) => g.id);
}
