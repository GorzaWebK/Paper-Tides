// localStorage wrapped in try/catch: private mode or blocked storage must never break the game.

const PREFIX = 'paperTides.';
const memory = new Map(); // fallback for when storage is unavailable

export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw);
  } catch {
    /* fall through to the in-memory copy */
  }
  return memory.has(key) ? memory.get(key) : fallback;
}

export function save(key, value) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep the in-memory copy */
  }
}

export const DEFAULT_SETTINGS = {
  volume: 0.7,
  music: 0.5,
  muted: false,
  reduceMotion: false,
  patterns: false,
  names: false,
};

export function loadSettings() {
  const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { ...DEFAULT_SETTINGS, reduceMotion: prefersReduced, ...load('settings', {}) };
}

export const saveSettings = (s) => save('settings', s);

/** Best scores per mode: { standard: n, daily: n }. */
export const loadBest = () => load('best', {});
export const saveBest = (b) => save('best', b);

/** Daily results: { 'YYYY-MM-DD': { score, goals, best, seed } }. The first finished run of the day is the result. */
export const loadDaily = () => load('daily', {});
export const saveDaily = (d) => save('daily', d);

export const loadTutorialDone = () => load('tutorialDone', false);
export const saveTutorialDone = () => save('tutorialDone', true);
