// The tide. Every TIDE_EVERY turns the sea rises and floods the lowest coastal land
// that no Lighthouse is watching over. Flooded hexes (and whatever was built on them)
// become water, so the coast moves inland and the island changes shape.

import { distance } from './hex.js';

export const TIDE_EVERY = 8;
export const LIGHTHOUSE_RANGE = 2;

/** How many hexes the k-th tide (1-based) floods. */
export function tideSize(k) {
  return 2 + k;
}

/** Keys of every cell a Lighthouse protects. */
export function protectedKeys(board) {
  const lights = board.builtCells().filter((c) => c.tile.type === 'lighthouse');
  const out = new Set();
  if (!lights.length) return out;
  for (const c of board.cells.values()) {
    if (!c.land) continue;
    for (const l of lights) {
      if (distance(c.q, c.r, l.q, l.r) <= LIGHTHOUSE_RANGE) {
        out.add(`${c.q},${c.r}`);
        break;
      }
    }
  }
  return out;
}

/**
 * The cells the next tide will take: unprotected coastal land, lowest first. Ties go to
 * the most exposed cell (more water sides), then a fixed per-cell random number so the
 * result is the same for everyone playing the same island.
 */
export function floodCandidates(board, count) {
  const safe = protectedKeys(board);
  const coast = [];
  for (const c of board.cells.values()) {
    if (!c.land || safe.has(`${c.q},${c.r}`)) continue;
    const w = board.waterSides(c.q, c.r);
    if (w > 0) coast.push({ c, w });
  }
  coast.sort((a, b) => a.c.height - b.c.height || b.w - a.w || a.c.tb - b.c.tb);
  return coast.slice(0, count).map((x) => x.c);
}

/** Flood the given cells. Returns what was lost. */
export function applyTide(board, cells) {
  const lost = [];
  for (const c of cells) {
    if (c.tile) lost.push({ q: c.q, r: c.r, type: c.tile.type });
    c.land = false;
    c.tile = null;
    c.height = 0;
    c.flooded = true;
  }
  return lost;
}
