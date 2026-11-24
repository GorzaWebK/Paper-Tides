// Seeded random numbers. The same seed always gives the same island and the same
// tile draws, which is what makes the Daily Island identical for everyone.

/** A whole-number hash of a string (FNV-1a), for turning date strings into seeds. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small, fast seeded generator (mulberry32) whose state can be saved and restored (for undo). */
export class RNG {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  pick(list) {
    return list[this.int(list.length)];
  }

  /** Pick a key from { key: weight } using the weights. */
  weighted(weights) {
    const keys = Object.keys(weights);
    let total = 0;
    for (const k of keys) total += weights[k];
    let x = this.next() * total;
    for (const k of keys) {
      x -= weights[k];
      if (x < 0) return k;
    }
    return keys[keys.length - 1];
  }

  /** Shuffle a copy of a list. */
  shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

/** A stable pseudo-random float in [0,1) for a pair of integers (used for per-hex art details). */
export function hash2(x, y, salt = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The player's calendar date as YYYY-MM-DD (local time). */
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The Daily Island seed is just a hash of the date string, so everyone gets the same one. */
export function dailySeed(key) {
  return hashString(`paper-tides/daily/${key}`);
}

/** A random seed for a standard run. */
export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}
