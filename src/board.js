// The map: a hex grid of land and water cells, and the island generator.
// Anything off the grid counts as open sea.

import { key, neighbors, neighbor, hexesInRadius, distance } from './hex.js';
import { RNG, hash2 } from './rng.js';

export const GRID_RADIUS = 8;

export class Board {
  constructor(radius = GRID_RADIUS) {
    this.radius = radius;
    /** @type {Map<string, {q:number,r:number,land:boolean,height:number,tb:number,tile:null|{type:string,rot:number}}>} */
    this.cells = new Map();
  }

  get(q, r) {
    return this.cells.get(key(q, r));
  }

  /** True for water cells and for anything off the grid. */
  isWater(q, r) {
    const c = this.get(q, r);
    return !c || !c.land;
  }

  inGrid(q, r) {
    return distance(q, r, 0, 0) <= this.radius;
  }

  /** Built neighbour tiles of a cell (land cells holding a tile). */
  neighborTiles(q, r) {
    const out = [];
    for (const [nq, nr] of neighbors(q, r)) {
      const n = this.get(nq, nr);
      if (n && n.land && n.tile) out.push(n);
    }
    return out;
  }

  waterSides(q, r) {
    let n = 0;
    for (const [nq, nr] of neighbors(q, r)) if (this.isWater(nq, nr)) n++;
    return n;
  }

  /** A land cell with at least one water side. */
  isCoastal(q, r) {
    const c = this.get(q, r);
    return !!c && c.land && this.waterSides(q, r) > 0;
  }

  /** The cell a tile at (q, r) with rotation rot is facing, or null when off the grid. */
  facing(q, r, rot) {
    const [fq, fr] = neighbor(q, r, rot);
    return { q: fq, r: fr, cell: this.get(fq, fr) || null, water: this.isWater(fq, fr) };
  }

  landCells() {
    const out = [];
    for (const c of this.cells.values()) if (c.land) out.push(c);
    return out;
  }

  emptyLand() {
    const out = [];
    for (const c of this.cells.values()) if (c.land && !c.tile) out.push(c);
    return out;
  }

  builtCells() {
    const out = [];
    for (const c of this.cells.values()) if (c.land && c.tile) out.push(c);
    return out;
  }

  clone() {
    const b = new Board(this.radius);
    for (const [k, c] of this.cells) {
      b.cells.set(k, { ...c, tile: c.tile ? { ...c.tile } : null });
    }
    b.name = this.name;
    return b;
  }
}

// --- island generator ---------------------------------------------------------

/** Smooth value noise on a lattice, seeded. */
function makeNoise(rng) {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) table[i] = rng.next();
  const perm = rng.shuffled([...Array(256).keys()]);
  const lattice = (x, y) => table[perm[(perm[x & 255] + y) & 255]];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = lattice(x0, y0);
    const b = lattice(x0 + 1, y0);
    const c = lattice(x0, y0 + 1);
    const d = lattice(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

const NAME_A = ['Wren', 'Heron', 'Pebble', 'Bramble', 'Fennel', 'Thistle', 'Kestrel', 'Linnet', 'Sorrel', 'Mallow', 'Gull', 'Puffin', 'Tansy', 'Rook', 'Samphire', 'Clover'];
const NAME_B = ['wick', 'combe', 'ford', 'holt', 'mere', 'by', 'stow', 'haven', 'ness', 'wold'];
const NAME_C = ['Isle', 'Island', 'Holm'];

export function islandName(seed) {
  const rng = new RNG(seed ^ 0x5eed);
  return `${rng.pick(NAME_A)}${rng.pick(NAME_B)} ${rng.pick(NAME_C)}`;
}

export const ISLAND_SIZE = 86;

/**
 * Grows a connected island out from the centre: the frontier cell with the highest
 * "elevation" (distance falloff + noise) is added until the island has ISLAND_SIZE cells.
 * Height (1..5) is the cell's elevation rank among land cells, so the coast is low.
 */
export function generateIsland(seed, radius = GRID_RADIUS) {
  const rng = new RNG(seed);
  const noise = makeNoise(rng);
  const ox = rng.range(0, 100);
  const oy = rng.range(0, 100);
  const stretch = rng.range(0.75, 1.3); // some islands are long, some round
  const angle = rng.range(0, Math.PI);

  const board = new Board(radius);
  const elev = new Map();
  for (const [q, r] of hexesInRadius(radius)) {
    const x = q + r / 2;
    const y = r * 0.866;
    const rx = (x * Math.cos(angle) - y * Math.sin(angle)) * stretch;
    const ry = (x * Math.sin(angle) + y * Math.cos(angle)) / stretch;
    const d = Math.hypot(rx, ry) / radius;
    const n = noise(x * 0.32 + ox, y * 0.32 + oy) * 0.65 + noise(x * 0.8 + oy, y * 0.8 + ox) * 0.35;
    const e = 1 - d * 1.15 + (n - 0.5) * 0.9;
    elev.set(key(q, r), e);
    board.cells.set(key(q, r), { q, r, land: false, height: 0, tb: rng.next(), tile: null });
  }

  // Grow from the centre.
  const landKeys = new Set([key(0, 0)]);
  const frontier = new Map();
  const addFrontier = (q, r) => {
    for (const [nq, nr] of neighbors(q, r)) {
      const k = key(nq, nr);
      if (!landKeys.has(k) && elev.has(k) && distance(nq, nr, 0, 0) <= radius - 2) frontier.set(k, [nq, nr]);
    }
  };
  addFrontier(0, 0);
  while (landKeys.size < ISLAND_SIZE && frontier.size) {
    let bestK = null;
    let bestE = -Infinity;
    for (const k of frontier.keys()) {
      const e = elev.get(k);
      if (e > bestE) {
        bestE = e;
        bestK = k;
      }
    }
    const [q, r] = frontier.get(bestK);
    frontier.delete(bestK);
    landKeys.add(bestK);
    addFrontier(q, r);
  }

  // Fill single-hex lakes so the coast reads cleanly.
  for (const c of board.cells.values()) {
    const k = key(c.q, c.r);
    if (landKeys.has(k)) continue;
    const around = neighbors(c.q, c.r).filter(([nq, nr]) => landKeys.has(key(nq, nr))).length;
    if (around >= 5) landKeys.add(k);
  }

  // Heights by elevation rank, nudged so cells by the sea are always the lowest.
  const land = [...landKeys].map((k) => board.cells.get(k));
  for (const c of land) {
    let seaSides = 0;
    for (const [nq, nr] of neighbors(c.q, c.r)) if (!landKeys.has(key(nq, nr))) seaSides++;
    c._e = elev.get(key(c.q, c.r)) - seaSides * 0.06;
  }
  land.sort((a, b) => a._e - b._e);
  land.forEach((c, i) => {
    c.land = true;
    c.height = 1 + Math.min(4, Math.floor((i / land.length) * 5));
    delete c._e;
  });

  board.name = islandName(seed);
  return board;
}

/** The land cell nearest the middle of the island (where the first cottage goes). */
export function islandHeart(board) {
  const land = board.landCells();
  let cx = 0;
  let cy = 0;
  for (const c of land) {
    cx += c.q;
    cy += c.r;
  }
  cx /= land.length;
  cy /= land.length;
  let best = null;
  let bestD = Infinity;
  for (const c of land) {
    // prefer high ground near the middle
    const d = Math.hypot(c.q - cx + (c.r - cy) / 2, (c.r - cy) * 0.866) - c.height * 0.3 + hash2(c.q, c.r) * 0.01;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
