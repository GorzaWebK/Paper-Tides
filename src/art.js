// Ink and watercolour, drawn with Canvas 2D.
//
// - Watercolour: a shape is filled several times with low alpha, each time with its
//   corners nudged a little outwards, so colour pools darker in the middle and bleeds
//   softly past the ink line. A thin same-colour stroke adds the darker "dried edge".
// - Ink: lines are split into short pieces with a little sideways jitter and drawn
//   twice, slightly offset, like a dip pen going over its own line.
// - Everything takes a seed, so a tile looks the same every time it is redrawn.

import { corner, dirAngle, edgeCorners, neighbor } from './hex.js';
import { TILES, PALETTE } from './tiles.js';

const INK = PALETTE.ink;
const TAU = Math.PI * 2;

/** Small seeded generator for art details. */
export function mkRand(seed) {
  let s = Math.floor((seed % 1) * 4294967296) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// --- primitives ----------------------------------------------------------------

function hexPoints(S, jitter, rnd) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const [x, y] = corner(i, S);
    pts.push([x + (rnd() - 0.5) * jitter, y + (rnd() - 0.5) * jitter]);
  }
  return pts;
}

function tracePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** A soft round-ish blob path. */
function blobPath(ctx, x, y, rx, ry, rnd, wobble = 0.18, n = 9) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + (rnd() - 0.5) * wobble * 2;
    pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]);
  }
  ctx.beginPath();
  const m0 = [(pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2];
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const nx = pts[(i + 1) % n];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + nx[0]) / 2, (p[1] + nx[1]) / 2);
  }
  ctx.closePath();
}

/** Layered watercolour wash over a polygon. */
function washPoly(ctx, pts, color, rnd, { layers = 3, alpha = 0.32, spread = 2.2, edge = 0.35 } = {}) {
  ctx.save();
  ctx.fillStyle = color;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  for (let l = 0; l < layers; l++) {
    const grow = 1 + ((l - layers / 2) * spread) / 40;
    const jp = pts.map(([x, y]) => [
      cx + (x - cx) * grow + (rnd() - 0.5) * spread,
      cy + (y - cy) * grow + (rnd() - 0.5) * spread,
    ]);
    ctx.globalAlpha = alpha * (0.75 + rnd() * 0.5);
    tracePoly(ctx, jp);
    ctx.fill();
  }
  if (edge > 0) {
    ctx.globalAlpha = edge;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    tracePoly(ctx, pts);
    ctx.stroke();
  }
  ctx.restore();
}

function washBlob(ctx, x, y, rx, ry, color, rnd, alpha = 0.5, layers = 2) {
  ctx.save();
  ctx.fillStyle = color;
  for (let l = 0; l < layers; l++) {
    ctx.globalAlpha = alpha * (0.7 + rnd() * 0.5);
    blobPath(ctx, x + (rnd() - 0.5) * 1.2, y + (rnd() - 0.5) * 1.2, rx * (1 + l * 0.06), ry * (1 + l * 0.06), rnd);
    ctx.fill();
  }
  ctx.restore();
}

/** A wobbly ink line through points. */
function inkLine(ctx, pts, rnd, { width = 1.1, alpha = 0.85, closed = false, jitter = 0.7, color = INK, double = true } = {}) {
  const passes = double ? 2 : 1;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const list = closed ? [...pts, pts[0]] : pts;
  for (let p = 0; p < passes; p++) {
    ctx.globalAlpha = p === 0 ? alpha : alpha * 0.35;
    ctx.lineWidth = p === 0 ? width : width * 0.7;
    const off = p === 0 ? 0 : 0.6;
    ctx.beginPath();
    for (let i = 0; i < list.length - 1; i++) {
      const [x1, y1] = list[i];
      const [x2, y2] = list[i + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const steps = Math.max(1, Math.round(len / 7));
      if (i === 0) ctx.moveTo(x1 + off, y1 + off);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const j = s === steps ? 0 : (rnd() - 0.5) * jitter * 2;
        ctx.lineTo(x1 + dx * t + nx * j + off, y1 + dy * t + ny * j + off);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function inkBlob(ctx, x, y, rx, ry, rnd, width = 1, alpha = 0.8) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  blobPath(ctx, x, y, rx, ry, rnd, 0.12, 8);
  ctx.stroke();
  ctx.restore();
}

function dot(ctx, x, y, r, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function clipHex(ctx, S) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const [x, y] = corner(i, S);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.clip();
}

// --- paper -----------------------------------------------------------------------

let grainTile = null;
function getGrain() {
  if (grainTile) return grainTile;
  const n = 192;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  let s = 12345;
  const r = () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n * n; i++) {
    const v = r();
    const dark = v < 0.5;
    img.data[i * 4] = dark ? 120 : 255;
    img.data[i * 4 + 1] = dark ? 100 : 250;
    img.data[i * 4 + 2] = dark ? 70 : 235;
    img.data[i * 4 + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 22);
  }
  g.putImageData(img, 0, 0);
  // a few paper fibres
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = r() < 0.5 ? 'rgba(140,115,80,0.10)' : 'rgba(255,255,250,0.35)';
    g.lineWidth = 0.6;
    g.beginPath();
    const x = r() * n;
    const y = r() * n;
    const a = r() * TAU;
    const l = 4 + r() * 10;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  grainTile = c;
  return c;
}

/** Warm off-white paper: base colour, soft mottling, grain, fibres and a gentle vignette. */
export function drawPaper(ctx, w, h, seed = 0.37) {
  const rnd = mkRand(seed);
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, w, h);
  // large soft mottling, like uneven sizing in the paper
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 60 + rnd() * Math.max(w, h) * 0.25;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = rnd() < 0.55;
    g.addColorStop(0, warm ? 'rgba(214,190,140,0.10)' : 'rgba(255,253,245,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.fillStyle = ctx.createPattern(getGrain(), 'repeat');
  ctx.fillRect(0, 0, w, h);
  // tiny specks
  for (let i = 0; i < (w * h) / 9000; i++) {
    dot(ctx, rnd() * w, rnd() * h, 0.4 + rnd() * 0.6, rnd() < 0.7 ? '#8b7355' : '#5c6b70', 0.12 + rnd() * 0.12);
  }
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(160,125,75,0.16)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

// --- sea and land -----------------------------------------------------------------

const ringDist = (q, r) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;

/**
 * The whole sea in a few passes. Each pass is ONE compound path made of every water
 * hex (enlarged and jittered), filled once, so the wash has no seams between hexes;
 * only its outer rim shows, ragged where it fades into the paper at the map's edge.
 */
export function drawSea(ctx, board, S) {
  const rnd = mkRand(0.777);
  const R = board.radius;
  const water = [];
  for (const c of board.cells.values()) if (!c.land) water.push(c);
  const pass = (cells, scale, jitter, color, alpha) => {
    ctx.beginPath();
    for (const c of cells) {
      const x = S * Math.sqrt(3) * (c.q + c.r / 2);
      const y = S * 1.5 * c.r;
      const pts = hexPoints(S * scale, S * jitter, rnd);
      ctx.moveTo(x + pts[0][0], y + pts[0][1]);
      for (let i = 1; i < 6; i++) ctx.lineTo(x + pts[i][0], y + pts[i][1]);
      ctx.closePath();
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill();
  };
  ctx.save();
  pass(water, 1.12, 0.45, PALETTE.sea, 0.2);
  pass(water.filter((c) => ringDist(c.q, c.r) < R), 1.1, 0.4, PALETTE.sea, 0.16);
  pass(water.filter((c) => ringDist(c.q, c.r) < R - 1), 1.05, 0.4, PALETTE.sea, 0.12);
  // deeper colour hugging the coast, with its own soft rim a little way out
  const coastal = water.filter((c) => {
    for (let k = 0; k < 6; k++) {
      const [nq, nr] = neighbor(c.q, c.r, k);
      const n = board.get(nq, nr);
      if (n && n.land) return true;
    }
    return false;
  });
  pass(coastal, 1.18, 0.35, '#5f8c9c', 0.16);
  // gentle variation in depth: soft-edged pools, no hard rims
  for (let i = 0; i < 14; i++) {
    const c = water[Math.floor(rnd() * water.length)];
    if (!c) break;
    const x = S * Math.sqrt(3) * (c.q + c.r / 2);
    const y = S * 1.5 * c.r;
    const r = S * (1.5 + rnd() * 2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() < 0.5;
    g.addColorStop(0, light ? 'rgba(244,236,216,0.22)' : 'rgba(95,140,156,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Kept for drawing a single flooded hex during the tide animation. */
export function drawSeaCell(ctx, cell, S) {
  const rnd = mkRand(cell.tb + 0.123 || 0.5);
  washPoly(ctx, hexPoints(S * 1.05, S * 0.2, rnd), PALETTE.sea, rnd, { layers: 2, alpha: 0.18, spread: 2, edge: 0 });
}

const LAND_SHADES = ['#eddcae', '#e4d9a6', '#d9d59e', '#cdd096', '#c2c98e'];

export function drawLandCell(ctx, cell, S, opts = {}) {
  const rnd = mkRand((cell.tb || 0.31) + 0.77);
  const shade = LAND_SHADES[Math.max(0, Math.min(4, (cell.height || 1) - 1))];
  washPoly(ctx, hexPoints(S * 1.01, S * 0.06, rnd), shade, rnd, { layers: 3, alpha: 0.3, spread: 1.6, edge: 0.12 });
  if (!cell.tile) {
    // a hint of what the ground is like: sand specks low down, grass ticks up high
    if (cell.height <= 1) {
      for (let i = 0; i < 6; i++) dot(ctx, (rnd() - 0.5) * S * 1.1, (rnd() - 0.5) * S * 1.1, 0.6, '#a08a5c', 0.45);
    } else if (cell.height >= 4) {
      ctx.save();
      ctx.strokeStyle = '#7f9a6a';
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 3; i++) {
        const x = (rnd() - 0.5) * S;
        const y = (rnd() - 0.5) * S;
        ctx.beginPath();
        ctx.moveTo(x - 2, y - 2);
        ctx.lineTo(x, y + 1);
        ctx.lineTo(x + 2, y - 3);
        ctx.stroke();
      }
      ctx.restore();
    }
    inkLine(ctx, hexPoints(S * 0.97, S * 0.04, rnd), rnd, { width: 0.7, alpha: 0.22, closed: true, double: false, jitter: 0.4 });
  }
}

/**
 * Board-wide ink: the coastline with two fading echo lines out to sea (like an old
 * chart), and dashed contour lines between land of different heights.
 */
export function drawCoast(ctx, board, S) {
  const rnd = mkRand(0.4242);
  for (const c of board.cells.values()) {
    if (!c.land) continue;
    const cx = S * Math.sqrt(3) * (c.q + c.r / 2);
    const cy = S * 1.5 * c.r;
    for (let d = 0; d < 6; d++) {
      const [nq, nr] = neighbor(c.q, c.r, d);
      const n = board.get(nq, nr);
      const [[x1, y1], [x2, y2]] = edgeCorners(d, S);
      const a = dirAngle(d);
      const ox = Math.cos(a);
      const oy = Math.sin(a);
      if (!n || !n.land) {
        inkLine(ctx, [[cx + x1, cy + y1], [cx + x2, cy + y2]], rnd, { width: 1.5, alpha: 0.85, jitter: 0.9 });
        for (const [off, al] of [[S * 0.2, 0.32], [S * 0.4, 0.16]]) {
          const shrink = 0.82;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          inkLine(
            ctx,
            [
              [cx + mx + (x1 - mx) * shrink + ox * off, cy + my + (y1 - my) * shrink + oy * off],
              [cx + mx + (x2 - mx) * shrink + ox * off, cy + my + (y2 - my) * shrink + oy * off],
            ],
            rnd,
            { width: 0.8, alpha: al, jitter: 0.8, color: '#3f5f6b', double: false },
          );
        }
      } else if (d < 3 && n.height !== c.height) {
        ctx.save();
        ctx.setLineDash([2.5, 2.5]);
        inkLine(ctx, [[cx + x1, cy + y1], [cx + x2, cy + y2]], rnd, { width: 0.8, alpha: 0.3, jitter: 0.5, color: '#7a6646', double: false });
        ctx.restore();
      }
    }
  }
}

// --- tiles -------------------------------------------------------------------------

const GROUND = {
  meadow: PALETTE.meadow,
  forest: '#9cb984',
  field: PALETTE.field,
  cottage: '#bdcf96',
  harbour: '#e2d2a4',
  lighthouse: '#d6cdb5',
  windmill: '#dfcf8e',
  market: '#e0cfae',
};

/**
 * Draw a tile centred on the origin.
 * opts: { patterns: bool, evening: 0..1 }
 */
export function drawTile(ctx, type, rot, S, seed = 0.5, opts = {}) {
  const rnd = mkRand(seed + 0.001);
  const evening = opts.evening || 0;
  ctx.save();
  // the paper cut-out: ground wash bleeding a little past the inked edge
  washPoly(ctx, hexPoints(S * 1.0, S * 0.08, rnd), GROUND[type], rnd, { layers: 3, alpha: 0.5, spread: 2.4, edge: 0.4 });
  ctx.save();
  clipHex(ctx, S * 0.98);
  DRAW[type](ctx, S, rot, rnd, evening);
  if (opts.patterns) drawPattern(ctx, TILES[type].pattern, S);
  ctx.restore();
  inkLine(ctx, hexPoints(S * 0.97, S * 0.05, rnd), rnd, { width: 1.15, alpha: 0.82, closed: true });
  ctx.restore();
}

function grassTuft(ctx, x, y, s, color = '#5f7f5a') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.6, y - s);
  ctx.quadraticCurveTo(x - s * 0.2, y - s * 0.2, x, y);
  ctx.moveTo(x, y - s * 1.2);
  ctx.lineTo(x, y);
  ctx.moveTo(x + s * 0.6, y - s);
  ctx.quadraticCurveTo(x + s * 0.2, y - s * 0.2, x, y);
  ctx.stroke();
  ctx.restore();
}

function tree(ctx, x, y, s, rnd, kind) {
  // shadow
  washBlob(ctx, x + s * 0.25, y + s * 0.15, s * 0.65, s * 0.3, '#3f5a3d', rnd, 0.22, 1);
  if (kind === 'pine') {
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - s * 0.4);
    ctx.stroke();
    ctx.restore();
    const tri = [
      [x, y - s * 1.55],
      [x + s * 0.55, y - s * 0.3],
      [x - s * 0.55, y - s * 0.3],
    ];
    washPoly(ctx, tri, PALETTE.forest, rnd, { layers: 2, alpha: 0.65, spread: 1.4, edge: 0.3 });
    inkLine(ctx, tri, rnd, { width: 0.9, alpha: 0.75, closed: true, jitter: 0.4 });
  } else {
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - s * 0.55);
    ctx.stroke();
    ctx.restore();
    washBlob(ctx, x, y - s * 0.95, s * 0.55, s * 0.5, PALETTE.forest, rnd, 0.6, 2);
    washBlob(ctx, x - s * 0.15, y - s * 1.05, s * 0.25, s * 0.2, '#86a77a', rnd, 0.5, 1);
    inkBlob(ctx, x, y - s * 0.95, s * 0.55, s * 0.5, rnd, 0.9, 0.7);
  }
}

/** Little lit or dark window. */
function windowPane(ctx, x, y, w, h, evening) {
  ctx.save();
  ctx.fillStyle = evening > 0.65 ? '#f2c14e' : '#6f8a93';
  ctx.globalAlpha = evening > 0.65 ? 0.95 : 0.6;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.6;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.restore();
}

/** Point at fraction t from the centre toward the front edge. */
const toward = (rot, S, t) => {
  const a = dirAngle(rot);
  return [Math.cos(a) * S * 0.866 * t, Math.sin(a) * S * 0.866 * t];
};

const DRAW = {
  meadow(ctx, S, rot, rnd) {
    washBlob(ctx, (rnd() - 0.5) * S * 0.5, (rnd() - 0.5) * S * 0.5, S * 0.45, S * 0.3, '#bcd39c', rnd, 0.45, 1);
    for (let i = 0; i < 7; i++) {
      const a = rnd() * TAU;
      const d = Math.sqrt(rnd()) * S * 0.62;
      grassTuft(ctx, Math.cos(a) * d, Math.sin(a) * d + 2, S * 0.1 + rnd() * S * 0.04);
    }
    const flowers = ['#f4ecd8', PALETTE.roof, '#e9cf5f', '#f4ecd8'];
    for (let i = 0; i < 6; i++) {
      const a = rnd() * TAU;
      const d = Math.sqrt(rnd()) * S * 0.6;
      dot(ctx, Math.cos(a) * d, Math.sin(a) * d, S * 0.035 + 0.3, flowers[i % flowers.length], 0.95);
    }
  },

  forest(ctx, S, rot, rnd) {
    const spots = [
      [-0.32, -0.12],
      [0.3, -0.18],
      [-0.02, 0.32],
      [0.04, -0.42],
      [0.42, 0.32],
      [-0.42, 0.36],
    ];
    const trees = spots
      .slice(0, 4 + Math.floor(rnd() * 2))
      .map(([x, y]) => [x * S + (rnd() - 0.5) * S * 0.1, y * S + S * 0.35 + (rnd() - 0.5) * S * 0.1]);
    trees.sort((a, b) => a[1] - b[1]);
    for (const [x, y] of trees) tree(ctx, x, y, S * (0.36 + rnd() * 0.08), rnd, rnd() < 0.5 ? 'pine' : 'round');
  },

  field(ctx, S, rot, rnd) {
    const ang = (rnd() < 0.5 ? -0.5 : 0.5) + (rnd() - 0.5) * 0.2;
    ctx.save();
    ctx.rotate(ang);
    for (let i = -6; i <= 6; i++) {
      const y = i * S * 0.17;
      if (i % 2 === 0) {
        ctx.fillStyle = '#d4b45e';
        ctx.globalAlpha = 0.35;
        ctx.fillRect(-S * 1.2, y - S * 0.06, S * 2.4, S * 0.12);
      }
      ctx.globalAlpha = 1;
      inkLine(ctx, [[-S * 1.1, y], [S * 1.1, y]], rnd, { width: 0.6, alpha: 0.32, jitter: 0.5, double: false, color: '#7a6230' });
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#8a6d2f';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 5; i++) {
      const x = (rnd() - 0.5) * S * 1.1;
      const y = (rnd() - 0.5) * S * 1.0;
      ctx.beginPath();
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x, y - 2);
      ctx.moveTo(x - 1.5, y - 1);
      ctx.lineTo(x, y - 3.5);
      ctx.lineTo(x + 1.5, y - 1);
      ctx.stroke();
    }
    ctx.restore();
  },

  cottage(ctx, S, rot, rnd, evening) {
    // garden path of stepping stones toward the door side
    for (let i = 1; i <= 3; i++) {
      const [x, y] = toward(rot, S, 0.25 + i * 0.22);
      washBlob(ctx, x, y + S * 0.12, S * 0.07, S * 0.05, '#b9ae9a', rnd, 0.8, 1);
    }
    grassTuft(ctx, -S * 0.55, S * 0.45, S * 0.1);
    grassTuft(ctx, S * 0.5, S * 0.5, S * 0.1);
    const w = S * 0.72;
    const h = S * 0.42;
    const by = S * 0.32;
    // shadow
    washBlob(ctx, S * 0.08, by + S * 0.05, w * 0.6, S * 0.12, '#4a5a3a', rnd, 0.22, 1);
    const body = [
      [-w / 2, by],
      [w / 2, by],
      [w / 2, by - h],
      [-w / 2, by - h],
    ];
    washPoly(ctx, body, '#f6ead0', rnd, { layers: 2, alpha: 0.9, spread: 1, edge: 0.2 });
    inkLine(ctx, body, rnd, { width: 1, closed: true, jitter: 0.4 });
    // chimney and smoke
    const chim = [
      [w * 0.18, by - h - S * 0.22],
      [w * 0.32, by - h - S * 0.22],
      [w * 0.32, by - h - S * 0.05],
      [w * 0.18, by - h - S * 0.05],
    ];
    washPoly(ctx, chim, '#a8584a', rnd, { layers: 1, alpha: 0.9, spread: 0.5, edge: 0 });
    inkLine(ctx, chim, rnd, { width: 0.8, closed: true, jitter: 0.3 });
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    const sx = w * 0.25;
    const sy = by - h - S * 0.27;
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx - 4, sy - 4, sx + 4, sy - 7, sx, sy - 11);
    ctx.stroke();
    ctx.restore();
    // roof
    const roof = [
      [-w / 2 - S * 0.08, by - h + 1],
      [w / 2 + S * 0.08, by - h + 1],
      [w * 0.3, by - h - S * 0.36],
      [-w * 0.3, by - h - S * 0.36],
    ];
    washPoly(ctx, roof, PALETTE.roof, rnd, { layers: 3, alpha: 0.6, spread: 1.2, edge: 0.4 });
    for (let i = 1; i < 4; i++) {
      const x = -w * 0.4 + (i * w * 0.8) / 4;
      inkLine(ctx, [[x, by - h - S * 0.02], [x * 0.75, by - h - S * 0.33]], rnd, { width: 0.6, alpha: 0.4, double: false, jitter: 0.3 });
    }
    inkLine(ctx, roof, rnd, { width: 1, closed: true, jitter: 0.4 });
    // door on the side it faces (left, middle or right of the front wall)
    const fx = Math.cos(dirAngle(rot));
    const doorX = fx > 0.3 ? w * 0.22 : fx < -0.3 ? -w * 0.22 : 0;
    const door = [
      [doorX - S * 0.07, by],
      [doorX + S * 0.07, by],
      [doorX + S * 0.07, by - S * 0.22],
      [doorX - S * 0.07, by - S * 0.22],
    ];
    washPoly(ctx, door, '#6b4a36', rnd, { layers: 1, alpha: 0.85, spread: 0.3, edge: 0 });
    inkLine(ctx, door, rnd, { width: 0.7, closed: true, jitter: 0.2, double: false });
    const wx = doorX === 0 ? w * 0.27 : -doorX;
    windowPane(ctx, wx, by - h * 0.55, S * 0.13, S * 0.11, evening);
    if (doorX === 0) windowPane(ctx, -wx, by - h * 0.55, S * 0.13, S * 0.11, evening);
  },

  harbour(ctx, S, rot, rnd, evening) {
    const a = dirAngle(rot);
    // a strip of water at the pier end, so the tile reads as a harbour even inland
    const [ex, ey] = toward(rot, S, 1.0);
    washBlob(ctx, ex, ey, S * 0.55, S * 0.45, PALETTE.sea, rnd, 0.45, 2);
    // pier: planks from the middle to the front edge
    ctx.save();
    ctx.rotate(a);
    const len = S * 0.95;
    const wid = S * 0.2;
    const pier = [
      [-S * 0.1, -wid],
      [len, -wid],
      [len, wid],
      [-S * 0.1, wid],
    ];
    washPoly(ctx, pier, PALETTE.wood, rnd, { layers: 2, alpha: 0.75, spread: 0.6, edge: 0.3 });
    for (let x = 0; x < len; x += S * 0.11) inkLine(ctx, [[x, -wid], [x, wid]], rnd, { width: 0.5, alpha: 0.5, double: false, jitter: 0.2 });
    inkLine(ctx, pier, rnd, { width: 0.9, closed: true, jitter: 0.3 });
    for (const py of [-wid - 1.5, wid + 1.5]) dot(ctx, len - 2, py, 1.6, INK, 0.8);
    ctx.restore();
    // boat beside the pier
    const side = rnd() < 0.5 ? 1 : -1;
    const bx = Math.cos(a) * S * 0.55 + Math.cos(a + (side * Math.PI) / 2) * S * 0.42;
    const by = Math.sin(a) * S * 0.55 + Math.sin(a + (side * Math.PI) / 2) * S * 0.42;
    const hull = [
      [bx - S * 0.22, by - S * 0.02],
      [bx + S * 0.22, by - S * 0.02],
      [bx + S * 0.14, by + S * 0.1],
      [bx - S * 0.14, by + S * 0.1],
    ];
    washPoly(ctx, hull, PALETTE.roof, rnd, { layers: 2, alpha: 0.75, spread: 0.6, edge: 0.3 });
    inkLine(ctx, hull, rnd, { width: 0.9, closed: true, jitter: 0.3 });
    inkLine(ctx, [[bx, by - S * 0.02], [bx, by - S * 0.36]], rnd, { width: 0.8, jitter: 0.2 });
    const sail = [
      [bx + 1, by - S * 0.34],
      [bx + S * 0.18, by - S * 0.06],
      [bx + 1, by - S * 0.06],
    ];
    washPoly(ctx, sail, PALETTE.cream, rnd, { layers: 1, alpha: 0.95, spread: 0.3, edge: 0 });
    inkLine(ctx, sail, rnd, { width: 0.7, closed: true, jitter: 0.2, double: false });
    // net shed at the back
    const [hx, hy] = toward(rot, S, -0.55);
    const shed = [
      [hx - S * 0.18, hy + S * 0.12],
      [hx + S * 0.18, hy + S * 0.12],
      [hx + S * 0.18, hy - S * 0.08],
      [hx, hy - S * 0.2],
      [hx - S * 0.18, hy - S * 0.08],
    ];
    washPoly(ctx, shed, '#8c9da2', rnd, { layers: 2, alpha: 0.7, spread: 0.6, edge: 0.3 });
    inkLine(ctx, shed, rnd, { width: 0.8, closed: true, jitter: 0.3 });
    if (evening > 0.65) dot(ctx, hx, hy, 1.6, '#f2c14e', 1);
  },

  lighthouse(ctx, S, rot, rnd, evening) {
    // rocks at the foot
    for (let i = 0; i < 4; i++) {
      const x = (rnd() - 0.5) * S * 0.9;
      const y = S * 0.35 + (rnd() - 0.5) * S * 0.25;
      washBlob(ctx, x, y, S * 0.12, S * 0.08, '#9d9688', rnd, 0.7, 1);
      inkBlob(ctx, x, y, S * 0.12, S * 0.08, rnd, 0.6, 0.5);
    }
    // light rays toward the lamp's facing
    const a = dirAngle(rot);
    const lx = 0;
    const ly = -S * 0.5;
    ctx.save();
    ctx.strokeStyle = evening > 0.6 ? '#d99a3a' : INK;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 0.8;
    for (const da of [-0.35, 0, 0.35]) {
      ctx.beginPath();
      ctx.moveTo(lx + Math.cos(a + da) * S * 0.2, ly + Math.sin(a + da) * S * 0.2);
      ctx.lineTo(lx + Math.cos(a + da) * S * 0.42, ly + Math.sin(a + da) * S * 0.42);
      ctx.stroke();
    }
    ctx.restore();
    // tower: tapered, cream and terracotta bands
    const bw = S * 0.22;
    const tw = S * 0.14;
    const yb = S * 0.38;
    const yt = -S * 0.38;
    const tower = [
      [-bw, yb],
      [bw, yb],
      [tw, yt],
      [-tw, yt],
    ];
    washPoly(ctx, tower, PALETTE.cream, rnd, { layers: 2, alpha: 0.95, spread: 0.6, edge: 0 });
    for (let i = 0; i < 3; i++) {
      const t0 = 0.12 + i * 0.3;
      const t1 = t0 + 0.14;
      const w0 = bw + (tw - bw) * t0;
      const w1 = bw + (tw - bw) * t1;
      const y0 = yb + (yt - yb) * t0;
      const y1 = yb + (yt - yb) * t1;
      washPoly(ctx, [[-w0, y0], [w0, y0], [w1, y1], [-w1, y1]], PALETTE.roof, rnd, { layers: 1, alpha: 0.75, spread: 0.3, edge: 0 });
    }
    inkLine(ctx, tower, rnd, { width: 1, closed: true, jitter: 0.3 });
    // lamp room and cap
    const lamp = [
      [-tw * 1.1, yt],
      [tw * 1.1, yt],
      [tw * 1.1, yt - S * 0.14],
      [-tw * 1.1, yt - S * 0.14],
    ];
    washPoly(ctx, lamp, evening > 0.6 ? '#f2c14e' : '#e8dca0', rnd, { layers: 1, alpha: 0.95, spread: 0.3, edge: 0 });
    inkLine(ctx, lamp, rnd, { width: 0.9, closed: true, jitter: 0.2 });
    const cap = [
      [-tw * 1.3, yt - S * 0.14],
      [tw * 1.3, yt - S * 0.14],
      [0, yt - S * 0.3],
    ];
    washPoly(ctx, cap, PALETTE.ink, rnd, { layers: 1, alpha: 0.7, spread: 0.3, edge: 0 });
    inkLine(ctx, cap, rnd, { width: 0.9, closed: true, jitter: 0.2 });
  },

  windmill(ctx, S, rot, rnd) {
    for (let i = -3; i <= 3; i++) {
      inkLine(ctx, [[-S, S * 0.25 + i * S * 0.2], [S, S * 0.05 + i * S * 0.2]], rnd, { width: 0.5, alpha: 0.22, double: false, color: '#7a6230' });
    }
    washBlob(ctx, S * 0.1, S * 0.42, S * 0.35, S * 0.1, '#4a5a3a', rnd, 0.2, 1);
    const body = [
      [-S * 0.24, S * 0.42],
      [S * 0.24, S * 0.42],
      [S * 0.14, -S * 0.2],
      [-S * 0.14, -S * 0.2],
    ];
    washPoly(ctx, body, '#e6dccb', rnd, { layers: 2, alpha: 0.95, spread: 0.6, edge: 0.2 });
    inkLine(ctx, body, rnd, { width: 1, closed: true, jitter: 0.3 });
    const cap = [
      [-S * 0.18, -S * 0.2],
      [S * 0.18, -S * 0.2],
      [0, -S * 0.36],
    ];
    washPoly(ctx, cap, PALETTE.roof, rnd, { layers: 2, alpha: 0.7, spread: 0.4, edge: 0.3 });
    inkLine(ctx, cap, rnd, { width: 0.9, closed: true, jitter: 0.2 });
    const door = [
      [-S * 0.06, S * 0.42],
      [S * 0.06, S * 0.42],
      [S * 0.06, S * 0.24],
      [-S * 0.06, S * 0.24],
    ];
    washPoly(ctx, door, '#6b4a36', rnd, { layers: 1, alpha: 0.8, spread: 0.2, edge: 0 });
    // sails
    const hx = 0;
    const hy = -S * 0.18;
    const base = 0.35 + rnd() * 0.6;
    for (let k = 0; k < 4; k++) {
      const a = base + (k * Math.PI) / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const px = -sa;
      const py = ca;
      const L = S * 0.62;
      const sail = [
        [hx + ca * S * 0.1, hy + sa * S * 0.1],
        [hx + ca * L, hy + sa * L],
        [hx + ca * L + px * S * 0.14, hy + sa * L + py * S * 0.14],
        [hx + ca * S * 0.12 + px * S * 0.14, hy + sa * S * 0.12 + py * S * 0.14],
      ];
      washPoly(ctx, sail, PALETTE.cream, rnd, { layers: 1, alpha: 0.85, spread: 0.3, edge: 0 });
      inkLine(ctx, [[hx, hy], [hx + ca * L, hy + sa * L]], rnd, { width: 1, jitter: 0.2 });
      inkLine(ctx, sail.slice(1), rnd, { width: 0.6, alpha: 0.7, jitter: 0.2, double: false });
      for (let t = 0.35; t < 1; t += 0.22) {
        inkLine(
          ctx,
          [
            [hx + ca * L * t, hy + sa * L * t],
            [hx + ca * L * t + px * S * 0.14, hy + sa * L * t + py * S * 0.14],
          ],
          rnd,
          { width: 0.5, alpha: 0.5, double: false, jitter: 0.1 },
        );
      }
    }
    dot(ctx, hx, hy, 2, INK, 0.9);
  },

  market(ctx, S, rot, rnd, evening) {
    // cobbles
    for (let i = 0; i < 10; i++) {
      const x = (rnd() - 0.5) * S * 1.3;
      const y = (rnd() - 0.5) * S * 1.2;
      inkBlob(ctx, x, y, S * 0.06, S * 0.04, rnd, 0.5, 0.25);
    }
    // baskets of produce toward the front
    const colors = [PALETTE.roof, '#e9cf5f', '#8fae6f', '#c98a3a'];
    for (let i = 0; i < 3; i++) {
      const [x0, y0] = toward(rot, S, 0.62);
      const a = dirAngle(rot) + Math.PI / 2;
      const off = (i - 1) * S * 0.22;
      const x = x0 + Math.cos(a) * off;
      const y = y0 + Math.sin(a) * off + S * 0.05;
      washBlob(ctx, x, y, S * 0.1, S * 0.07, PALETTE.wood, rnd, 0.8, 1);
      inkBlob(ctx, x, y, S * 0.1, S * 0.07, rnd, 0.7, 0.7);
      for (let k = 0; k < 3; k++) dot(ctx, x + (k - 1) * 2.4, y - 2, 1.5, colors[(i + k) % colors.length], 0.95);
    }
    // stall: table and striped awning
    const w = S * 0.75;
    const ty = S * 0.12;
    const table = [
      [-w / 2, ty],
      [w / 2, ty],
      [w / 2, ty + S * 0.14],
      [-w / 2, ty + S * 0.14],
    ];
    washPoly(ctx, table, PALETTE.wood, rnd, { layers: 2, alpha: 0.8, spread: 0.4, edge: 0.3 });
    inkLine(ctx, table, rnd, { width: 0.9, closed: true, jitter: 0.3 });
    for (const x of [-w / 2 + 2, w / 2 - 2]) inkLine(ctx, [[x, ty], [x, -S * 0.3]], rnd, { width: 0.9, jitter: 0.2 });
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 - S * 0.05 + (i * (w + S * 0.1)) / n;
      const x1 = x0 + (w + S * 0.1) / n;
      const stripe = [
        [x0 + S * 0.04, -S * 0.48],
        [x1 + S * 0.04, -S * 0.48],
        [x1, -S * 0.26],
        [x0, -S * 0.26],
      ];
      washPoly(ctx, stripe, i % 2 ? PALETTE.cream : PALETTE.roof, rnd, { layers: 1, alpha: 0.9, spread: 0.2, edge: 0 });
    }
    const awn = [
      [-w / 2 - S * 0.01, -S * 0.48],
      [w / 2 + S * 0.13, -S * 0.48],
      [w / 2 + S * 0.05, -S * 0.26],
      [-w / 2 - S * 0.05, -S * 0.26],
    ];
    inkLine(ctx, awn, rnd, { width: 1, closed: true, jitter: 0.3 });
    // scalloped edge
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 - S * 0.05 + (i * (w + S * 0.1)) / n;
      const x1 = x0 + (w + S * 0.1) / n;
      ctx.moveTo(x0, -S * 0.26);
      ctx.quadraticCurveTo((x0 + x1) / 2, -S * 0.18, x1, -S * 0.26);
    }
    ctx.stroke();
    ctx.restore();
    if (evening > 0.65) dot(ctx, w / 2 - 2, -S * 0.22, 1.8, '#f2c14e', 1);
  },
};

// --- colour-blind patterns -----------------------------------------------------------

/** A distinct ink texture per tile type, so tiles can be told apart without colour. */
export function drawPattern(ctx, pattern, S) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.32;
  ctx.lineWidth = 0.8;
  const step = S * 0.28;
  const R = S;
  ctx.beginPath();
  switch (pattern) {
    case 'dots':
      for (let y = -R; y <= R; y += step) for (let x = -R + ((y / step) % 2 ? step / 2 : 0); x <= R; x += step) ctx.rect(x - 0.9, y - 0.9, 1.8, 1.8);
      ctx.fill();
      break;
    case 'cross':
      for (let k = -2 * R; k <= 2 * R; k += step) {
        ctx.moveTo(k - R, -R);
        ctx.lineTo(k + R, R);
        ctx.moveTo(k + R, -R);
        ctx.lineTo(k - R, R);
      }
      ctx.stroke();
      break;
    case 'diagonal':
      for (let k = -2 * R; k <= 2 * R; k += step * 0.7) {
        ctx.moveTo(k - R, R);
        ctx.lineTo(k + R, -R);
      }
      ctx.stroke();
      break;
    case 'bricks':
      for (let y = -R, row = 0; y <= R; y += step * 0.7, row++) {
        ctx.moveTo(-R, y);
        ctx.lineTo(R, y);
        for (let x = -R + (row % 2) * step * 0.6; x <= R; x += step * 1.2) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + step * 0.7);
        }
      }
      ctx.stroke();
      break;
    case 'waves':
      for (let y = -R; y <= R; y += step * 0.8) {
        ctx.moveTo(-R, y);
        for (let x = -R; x <= R; x += step) ctx.quadraticCurveTo(x + step / 4, y - step * 0.3, x + step / 2, y), ctx.quadraticCurveTo(x + (3 * step) / 4, y + step * 0.3, x + step, y);
      }
      ctx.stroke();
      break;
    case 'rings':
      for (let r = step; r <= R * 1.2; r += step) {
        ctx.moveTo(r, 0);
        ctx.arc(0, 0, r, 0, TAU);
      }
      ctx.stroke();
      break;
    case 'xcross':
      ctx.lineWidth = 2.2;
      ctx.moveTo(-R * 0.7, -R * 0.7);
      ctx.lineTo(R * 0.7, R * 0.7);
      ctx.moveTo(R * 0.7, -R * 0.7);
      ctx.lineTo(-R * 0.7, R * 0.7);
      ctx.stroke();
      break;
    case 'checks':
      for (let y = -R, row = 0; y <= R; y += step, row++) for (let x = -R + (row % 2) * step; x <= R; x += step * 2) ctx.rect(x, y, step * 0.5, step * 0.5);
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
}

// --- moving things ----------------------------------------------------------------------

/** A slow ripple on the water: two short curves drifting side to side. */
export function drawRipple(ctx, rp, t, S) {
  const sway = Math.sin(t * 0.45 + rp.phase) * S * 0.08;
  const a = 0.1 + 0.16 * (0.5 + 0.5 * Math.sin(t * 0.6 + rp.phase * 1.3));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = '#3f6573';
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  const x = rp.x + sway;
  const y = rp.y;
  const l = rp.len;
  ctx.beginPath();
  ctx.moveTo(x - l / 2, y);
  ctx.quadraticCurveTo(x - l / 4, y - l * 0.18, x, y);
  ctx.quadraticCurveTo(x + l / 4, y + l * 0.18, x + l / 2, y);
  ctx.stroke();
  ctx.restore();
}

/** Land the coming tide will take: a pulsing sea-blue wash with drifting wave lines. */
export function drawFloodWarning(ctx, S, t, seed) {
  const base = ctx.globalAlpha;
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.4 + seed * 6);
  ctx.save();
  clipHex(ctx, S * 0.98);
  ctx.globalAlpha = base * (0.22 + 0.18 * pulse);
  ctx.fillStyle = PALETTE.sea;
  ctx.fillRect(-S, -S, S * 2, S * 2);
  ctx.globalAlpha = base * 0.6;
  ctx.strokeStyle = '#3f6573';
  ctx.lineWidth = 1.1;
  const drift = ((t * 4 + seed * 20) % (S * 0.5)) - S * 0.25;
  for (let k = -1; k <= 1; k++) {
    const y = k * S * 0.38 + S * 0.05;
    ctx.beginPath();
    for (let x = -S; x <= S; x += S * 0.25) {
      const xx = x + drift;
      if (x === -S) ctx.moveTo(xx, y);
      ctx.quadraticCurveTo(xx + S * 0.0625, y - S * 0.08, xx + S * 0.125, y);
      ctx.quadraticCurveTo(xx + S * 0.1875, y + S * 0.08, xx + S * 0.25, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = base * 0.7;
  ctx.strokeStyle = '#3f6573';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const [x, y] = corner(i, S * 0.92);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function drawBird(ctx, x, y, flap, s) {
  const lift = flap * s * 0.45;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s, y - lift);
  ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.35 - lift * 0.3, x, y);
  ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.35 - lift * 0.3, x + s, y - lift);
  ctx.stroke();
  ctx.restore();
}

/** A soft watercolour cloud (soft-edged puffs, a faint ink top line) and its shadow below. */
export function drawCloud(ctx, x, y, size, seed) {
  const rnd = mkRand(seed / 1000 + 0.17);
  const puffs = [];
  for (let i = 0; i < 6; i++) {
    puffs.push([(i - 2.5) * size * 0.17 + (rnd() - 0.5) * size * 0.08, (rnd() - 0.5) * size * 0.1 - (i === 2 || i === 3 ? size * 0.1 : 0), size * (0.18 + rnd() * 0.1)]);
  }
  ctx.save();
  const sh = ctx.createRadialGradient(x + size * 0.25, y + size * 0.75, 0, x + size * 0.25, y + size * 0.75, size * 0.6);
  sh.addColorStop(0, 'rgba(61,74,90,0.07)');
  sh.addColorStop(1, 'rgba(61,74,90,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x - size * 0.4, y + size * 0.15, size * 1.3, size * 1.2);
  for (const [dx, dy, r] of puffs) {
    const g = ctx.createRadialGradient(x + dx, y + dy, r * 0.2, x + dx, y + dy, r * 1.15);
    g.addColorStop(0, 'rgba(255,251,242,0.5)');
    g.addColorStop(0.7, 'rgba(240,240,236,0.25)');
    g.addColorStop(1, 'rgba(200,210,215,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r * 1.15, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r * 0.85, Math.PI * 1.15, Math.PI * 1.75);
    ctx.stroke();
  }
  ctx.restore();
}
