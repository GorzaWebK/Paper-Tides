// Pointy-top hexagons in axial coordinates (q, r).
// Direction d (0..5) points E, NE, NW, W, SW, SE. On screen (y down) the angle of
// direction d is -60° × d, so turning a tile clockwise means d - 1.

export const SQRT3 = Math.sqrt(3);

export const DIRS = [
  [1, 0], // 0 E
  [1, -1], // 1 NE
  [0, -1], // 2 NW
  [-1, 0], // 3 W
  [-1, 1], // 4 SW
  [0, 1], // 5 SE
];

export const key = (q, r) => `${q},${r}`;

export function parseKey(k) {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}

export function neighbor(q, r, d) {
  const [dq, dr] = DIRS[((d % 6) + 6) % 6];
  return [q + dq, r + dr];
}

export function neighbors(q, r) {
  return DIRS.map(([dq, dr]) => [q + dq, r + dr]);
}

export function distance(q1, r1, q2, r2) {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Angle (radians, screen space) of direction d. */
export function dirAngle(d) {
  return (-Math.PI / 3) * d;
}

export function hexToPixel(q, r, size) {
  return [size * SQRT3 * (q + r / 2), size * 1.5 * r];
}

export function pixelToHex(x, y, size) {
  const q = ((SQRT3 / 3) * x - y / 3) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

export function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq + 0, rr + 0]; // + 0 turns -0 into 0
}

/** Corner i (0..5) of a pointy-top hex, centred at the origin. Corner i sits between directions i and i+1... */
export function corner(i, size) {
  const a = (Math.PI / 180) * (60 * i - 30);
  return [size * Math.cos(a), size * Math.sin(a)];
}

/** All hexes within `radius` of the origin. */
export function hexesInRadius(radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push([q, r]);
    }
  }
  return out;
}

/**
 * The two corners that bound the edge facing direction d (for pointy-top hexes).
 * Direction d's edge lies at angle -60°·d, between corners at -60°·d ± 30°.
 */
export function edgeCorners(d, size) {
  const mid = -60 * d;
  const a1 = ((mid - 30) * Math.PI) / 180;
  const a2 = ((mid + 30) * Math.PI) / 180;
  return [
    [size * Math.cos(a1), size * Math.sin(a1)],
    [size * Math.cos(a2), size * Math.sin(a2)],
  ];
}
