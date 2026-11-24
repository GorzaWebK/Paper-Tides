import { Board } from '../src/board.js';
import { hexesInRadius, key } from '../src/hex.js';

/** A small all-land board (radius 3 of land inside a radius 5 grid of water). */
export function landBoard(landRadius = 3, gridRadius = 5) {
  const b = new Board(gridRadius);
  for (const [q, r] of hexesInRadius(gridRadius)) {
    const land = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= landRadius;
    b.cells.set(key(q, r), { q, r, land, height: land ? 3 : 0, tb: 0, tile: null });
  }
  return b;
}

export function put(b, q, r, type, rot = 0) {
  const c = b.get(q, r);
  c.land = true;
  c.tile = { type, rot };
  return c;
}

export function water(b, q, r) {
  const c = b.get(q, r);
  c.land = false;
  c.tile = null;
}
