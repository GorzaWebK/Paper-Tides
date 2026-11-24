// Adjacency scoring. The score of the island is the sum of every tile's score, worked
// out fresh from the board, so a placement can also raise its neighbours' scores and
// the tide can wash points away. Goal bonuses are added on top by game.js.

import { neighbors } from './hex.js';
import { TILES } from './tiles.js';

const count = (tiles, type) => tiles.reduce((n, c) => n + (c.tile.type === type ? 1 : 0), 0);

/**
 * Score one built cell.
 * @returns {{points:number, parts:Array<[string, number]>}}
 */
export function scoreCell(board, cell) {
  const t = cell.tile;
  if (!t) return { points: 0, parts: [] };
  const { q, r } = cell;
  const near = board.neighborTiles(q, r);
  const parts = [];
  const add = (label, pts) => {
    if (pts) parts.push([label, pts]);
  };
  const face = TILES[t.type].directional ? board.facing(q, r, t.rot) : null;
  const faceType = face && face.cell && face.cell.land && face.cell.tile ? face.cell.tile.type : null;

  switch (t.type) {
    case 'meadow': {
      add('Meadow', 1);
      if (board.waterSides(q, r) > 0) add('by the sea', 1);
      break;
    }
    case 'forest': {
      add('Forest', 1);
      const f = count(near, 'forest');
      add(`${f} forest${f === 1 ? '' : 's'} nearby`, f);
      break;
    }
    case 'field': {
      add('Field', 2);
      break;
    }
    case 'cottage': {
      add('Cottage', 1);
      const m = count(near, 'meadow');
      const k = count(near, 'market');
      add(`${m} meadow${m === 1 ? '' : 's'}`, m);
      add(`${k} market${k === 1 ? '' : 's'}`, k * 2);
      if (faceType === 'meadow' || faceType === 'market') add(`door faces ${faceType}`, 1);
      break;
    }
    case 'harbour': {
      if (board.waterSides(q, r) === 0) {
        add('no water', 0);
        break;
      }
      add('Harbour', 2);
      const c = count(near, 'cottage') + count(near, 'market');
      add(`${c} cottage/market`, c);
      if (face && face.water) add('pier faces water', 2);
      break;
    }
    case 'lighthouse': {
      add('Lighthouse', 1);
      const w = Math.min(3, board.waterSides(q, r));
      add(`${w} water side${w === 1 ? '' : 's'}`, w);
      if (face && face.water) add('lamp faces water', 1);
      break;
    }
    case 'windmill': {
      const f = count(near, 'field');
      add(`${f} field${f === 1 ? '' : 's'} × 2`, f * 2);
      break;
    }
    case 'market': {
      const kinds = new Set(near.map((c) => c.tile.type)).size;
      add(`${kinds} kind${kinds === 1 ? '' : 's'} of neighbour`, kinds);
      if (faceType === 'cottage') add('awning faces cottage', 1);
      break;
    }
    default:
      break;
  }
  return { points: parts.reduce((s, p) => s + p[1], 0), parts };
}

/** Total of every tile on the board. */
export function scoreBoard(board) {
  let total = 0;
  for (const c of board.cells.values()) {
    if (c.land && c.tile) total += scoreCell(board, c).points;
  }
  return total;
}

/**
 * Can a tile of this type go on (q, r)?
 * In Zen mode shallow water next to land can be reclaimed and built on.
 */
export function canPlace(board, q, r, type, { reclaim = false } = {}) {
  const c = board.get(q, r);
  if (!c) return { ok: false, reason: 'Off the map' };
  if (c.land && c.tile) return { ok: false, reason: 'Already built' };
  if (!c.land) {
    if (!reclaim) return { ok: false, reason: 'Open water' };
    const touchesLand = neighbors(q, r).some(([nq, nr]) => {
      const n = board.get(nq, nr);
      return n && n.land;
    });
    if (!touchesLand) return { ok: false, reason: 'Too far from shore' };
    // a reclaimed hex always has water around it, harbours are fine
    return { ok: true, reclaim: true };
  }
  if (type === 'harbour' && board.waterSides(q, r) === 0) return { ok: false, reason: 'Harbours must touch water' };
  return { ok: true };
}

/**
 * What would placing this tile here be worth?
 * @returns {{ok:boolean, reason?:string, delta:number, tile:{points:number,parts:Array}, neighbours:number}}
 */
export function previewPlacement(board, q, r, type, rot, opts = {}) {
  const check = canPlace(board, q, r, type, opts);
  if (!check.ok) return { ok: false, reason: check.reason, delta: 0, tile: { points: 0, parts: [] }, neighbours: 0 };
  const c = board.get(q, r);
  const before = opts.before ?? scoreBoard(board);
  const saved = { land: c.land, height: c.height, tile: c.tile };
  if (check.reclaim) {
    c.land = true;
    c.height = 1;
  }
  c.tile = { type, rot };
  const after = scoreBoard(board);
  const tile = scoreCell(board, c);
  c.land = saved.land;
  c.height = saved.height;
  c.tile = saved.tile;
  const delta = after - before;
  return { ok: true, reclaim: !!check.reclaim, delta, tile, neighbours: delta - tile.points };
}

/** Place a tile for real (no checks). */
export function placeTile(board, q, r, type, rot) {
  const c = board.get(q, r);
  if (!c.land) {
    c.land = true;
    c.height = 1;
    c.reclaimed = true;
  }
  c.tile = { type, rot };
  return c;
}
