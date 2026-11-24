// Paper Tides: start-up, screens, input and the flow of a run.

import './style.css';
import { Game, MODES } from './game.js';
import { Renderer } from './render.js';
import { attachMapInput } from './input.js';
import { Sound } from './audio.js';
import { TILES } from './tiles.js';
import { GOAL_BY_ID } from './goals.js';
import { dailySeed, dateKey, randomSeed } from './rng.js';
import { neighbor } from './hex.js';
import * as store from './storage.js';
import { $, tear, Logbook, toast, Tutorial, drawPostcard, shareText, copyText, prettyDate, makeFavicon } from './ui.js';

const canvas = $('map');
const renderer = new Renderer(canvas);
const sound = new Sound();
let settings = store.loadSettings();

let game = null; // the run being played (or the island behind the menu)
let state = 'menu'; // menu | playing | paused | settings | tutorial | ended
let settingsReturn = 'menu';
let pendingMode = null; // a run waiting for the first-time tutorial to finish
let hoverHex = null; // { q, r }
let touchPreview = false; // a tap previewed a hex; a second tap builds
let busyUntil = 0; // input is ignored while the tide animates
let endTimer = 0;
let lastResult = null;

const today = dateKey();

// --- screens ------------------------------------------------------------------

const SCREENS = ['menu', 'pause', 'settings', 'tutorial', 'end'];

function showScreen(name) {
  for (const s of SCREENS) {
    const el = $(`screen-${s}`);
    const on = s === name;
    if (on && el.hidden) {
      el.classList.remove('fade-in');
      void el.offsetWidth;
      el.classList.add('fade-in');
    }
    el.hidden = !on;
  }
  const playing = name === null;
  $('hud').hidden = !(playing || name === 'pause' || (name === 'settings' && settingsReturn === 'pause'));
  document.body.classList.toggle('playing', playing || name === 'pause');
  renderer.paused = name === 'pause' || name === 'settings' || name === 'tutorial';
  renderer.interactive = playing;
  if (!renderer.paused) renderer.dirty = true;
  updateInsets();
}

function updateInsets() {
  if ($('hud').hidden) {
    renderer.setInset({ left: 0, right: 0, top: 0, bottom: 0 });
    return;
  }
  const lb = document.querySelector('.lb-wrap').getBoundingClientRect();
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (lb.height > h * 0.6 && lb.left < w / 3) renderer.setInset({ left: lb.right + 4, right: 56, top: 0, bottom: 0 });
  else renderer.setInset({ left: 0, right: 0, top: 54, bottom: Math.max(0, h - lb.top + 4) });
}

// --- settings -----------------------------------------------------------------

function applySettings() {
  sound.setVolume(settings.volume);
  sound.setMusicVolume(settings.music);
  sound.setMuted(settings.muted);
  renderer.setSettings({ reduceMotion: settings.reduceMotion, patterns: settings.patterns, names: settings.names });
  document.body.classList.toggle('reduce-motion', settings.reduceMotion);
  $('btn-mute').classList.toggle('muted', settings.muted);
  $('btn-mute').setAttribute('aria-pressed', String(settings.muted));
  const form = $('settings-form');
  for (const el of form.elements) {
    if (!(el.name in settings)) continue;
    if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else el.value = settings[el.name];
  }
  if (game) refreshHud();
}

$('settings-form').addEventListener('input', (e) => {
  const el = e.target;
  if (!(el.name in settings)) return;
  settings[el.name] = el.type === 'checkbox' ? el.checked : Number(el.value);
  store.saveSettings(settings);
  applySettings();
  if (el.name === 'volume') sound.tick();
});

function toggleMute() {
  settings.muted = !settings.muted;
  store.saveSettings(settings);
  applySettings();
  toast(settings.muted ? 'Sound off' : 'Sound on', '', 1200);
}

// --- the logbook ----------------------------------------------------------------

const logbook = new Logbook({
  onSelect(i) {
    if (!game || state !== 'playing') return;
    selectTile(i);
  },
});

function modeLabel(g) {
  if (g.mode === 'daily') return `Daily Island · ${prettyDate(g.date)}`;
  return MODES[g.mode].label;
}

function refreshHud() {
  if (!game) return;
  const preview = renderer.hover ? renderer.hover.preview : null;
  logbook.update(game, settings, preview, { modeLabel: modeLabel(game), tapAgain: touchPreview && preview && preview.ok });
}

function refreshHover() {
  if (!game || state !== 'playing' || !hoverHex || game.finished) {
    renderer.setHover(null);
  } else {
    renderer.setHover({ ...hoverHex, preview: game.preview(hoverHex.q, hoverHex.r) });
  }
  refreshHud();
}

function selectTile(i) {
  if (i === game.selected) return;
  game.select(i);
  sound.tick();
  refreshHover();
}

function rotate(dir) {
  if (!game || state !== 'playing' || !TILES[game.selectedType].directional) return;
  game.rotate(dir);
  sound.swish();
  refreshHover();
}

function undo() {
  if (!game || state !== 'playing' || performance.now() < busyUntil) return;
  if (!game.undo()) {
    toast(game.snapshot ? 'Only one undo per turn' : 'Nothing to undo', '', 1600);
    return;
  }
  clearTimeout(endTimer);
  sound.undo();
  renderer.drops = [];
  renderer.floods = [];
  renderer.hidden.clear();
  renderer.boardChanged();
  refreshHover();
}

// --- placing tiles --------------------------------------------------------------

function place(q, r) {
  if (!game || state !== 'playing' || game.finished || performance.now() < busyUntil) return;
  if (!game.canPlaceAt(q, r)) {
    sound.nope();
    const p = game.preview(q, r);
    if (p.reason && p.reason !== 'Off the map') toast(p.reason, '', 1500);
    return;
  }
  const res = game.place(q, r);
  if (!res) return;
  touchPreview = false;
  sound.thup();
  renderer.dropTile(res.q, res.r, res.type, res.rot, res.delta);

  res.goals.forEach((id, i) => {
    setTimeout(() => {
      sound.chime();
      toast(`Goal: ${GOAL_BY_ID[id].text}  +${GOAL_BY_ID[id].bonus}`, 'goal', 2800);
      renderer.popup(`+${GOAL_BY_ID[id].bonus} goal!`, res.q, res.r);
    }, 350 + i * 900);
  });

  if (res.tide) {
    const delay = 600;
    busyUntil = performance.now() + delay + 1200;
    renderer.floodCells(res.tide.cells, res.tide.points, delay);
    setTimeout(() => {
      sound.bell();
      const lost = res.tide.lost.length;
      toast(lost ? `The tide rose and took ${lost} tile${lost === 1 ? '' : 's'}` : 'The tide rose, but your village stayed dry', 'tide', 3200);
    }, delay);
  } else if (!res.ended && game.tideIn === 1) {
    setTimeout(() => toast(`The tide rises after this turn: ${game.nextTideSize} hexes will flood`, 'tide', 3200), res.goals.length ? 1400 : 300);
  } else if (!res.ended && game.tideIn === 2) {
    setTimeout(() => toast('The tide is turning. Watch the rippling coast.', 'tide', 2800), res.goals.length ? 1400 : 300);
  }

  if (!res.ended && game.turnsLeft === 5) setTimeout(() => toast('Five turns left before evening', '', 2200), 500);

  if (res.ended) {
    const wait = res.tide ? 2600 : res.goals.length ? 2000 : 1300;
    endTimer = setTimeout(endRun, wait);
  }
  refreshHover();
}

// --- runs -----------------------------------------------------------------------

function startRun(mode, seed) {
  sound.unlock();
  if (!store.loadTutorialDone()) {
    pendingMode = { mode, seed };
    openTutorial();
    return;
  }
  clearTimeout(endTimer);
  const s = seed ?? (mode === 'daily' ? dailySeed(today) : randomSeed());
  game = new Game({ mode, seed: s, date: mode === 'daily' ? today : null });
  hoverHex = null;
  touchPreview = false;
  state = 'playing';
  showScreen(null);
  renderer.setGame(game);
  sound.startMusic();
  refreshHover();
  toast(mode === 'daily' ? `Daily Island: ${game.name}` : mode === 'zen' ? `Zen mode on ${game.name}. No tide, no limit.` : `Welcome to ${game.name}`, '', 2600);
}

function endRun() {
  if (!game) return;
  state = 'ended';
  game.finished = true;
  sound.fanfare();
  const score = game.score;
  const best = store.loadBest();
  const prevBest = best[game.mode] || 0;
  const newBest = score > prevBest;
  if (newBest) best[game.mode] = score;
  store.saveBest(best);

  let dailyText = '';
  const daily = store.loadDaily();
  if (game.mode === 'daily') {
    const rec = daily[game.date];
    if (!rec) {
      daily[game.date] = { score, best: score, goals: game.goalsDone(), seed: game.seed };
      dailyText = `${score} (today's result)`;
    } else {
      rec.best = Math.max(rec.best || rec.score, score);
      dailyText = `${rec.score} · this sail ${score}`;
    }
    store.saveDaily(daily);
  } else {
    dailyText = daily[today] ? `today ${daily[today].score}` : 'not sailed yet';
  }

  $('end-title').textContent = game.mode === 'zen' ? 'A quiet day of building' : 'The day is done';
  $('end-score').textContent = score;
  $('end-best').textContent = Math.max(prevBest, score);
  $('end-daily').textContent = dailyText;
  const done = game.goalsDone();
  const notes = [];
  if (newBest && prevBest > 0) notes.push('A new best!');
  if (game.bestMove) notes.push(`Best move: a ${TILES[game.bestMove.type].name} for +${game.bestMove.delta}.`);
  if (game.tides) notes.push(game.lost.length ? `The tide took ${game.lost.length} tile${game.lost.length === 1 ? '' : 's'}.` : 'Not one tile lost to the tide.');
  $('end-note').textContent = notes.join(' ');

  // which tile goes on the stamp: the one there is most of
  const counts = {};
  for (const c of game.board.builtCells()) counts[c.tile.type] = (counts[c.tile.type] || 0) + 1;
  const stampTile = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'cottage';
  const date = game.date || today;
  lastResult = { date };
  drawPostcard($('postcard'), game, {
    patterns: settings.patterns,
    stampTile,
    postmark: game.mode === 'daily' ? 'Daily Island' : game.mode === 'zen' ? 'Zen mode' : 'Paper Tides',
    dateLabel: prettyDate(date),
    lines: [`${score} points`, `${done} of ${game.goals.length} goals ticked off`, game.tides ? `${game.lost.length} lost to the tide` : 'no tide today', game.bestMove ? `best: ${TILES[game.bestMove.type].name} +${game.bestMove.delta}` : ''],
  });
  hoverHex = null;
  renderer.setHover(null);
  showScreen('end');
  renderer.fit();
}

async function copyResult() {
  if (!game) return;
  const text = shareText(game, { date: lastResult ? lastResult.date : today, url: location.origin + location.pathname });
  const ok = await copyText(text);
  toast(ok ? 'Result copied. Paste it anywhere!' : 'Could not copy, sorry', '', 2200);
}

function backToMenu() {
  clearTimeout(endTimer);
  state = 'menu';
  hoverHex = null;
  showMenuIsland();
  showScreen('menu');
  updateMenuRecords();
}

/** Today's Daily Island, drawn behind the menu. */
function showMenuIsland() {
  game = new Game({ mode: 'daily', seed: dailySeed(today), date: today });
  renderer.setGame(game);
  renderer.setHover(null);
}

function updateMenuRecords() {
  const best = store.loadBest();
  $('rec-best').textContent = best.standard || '–';
  const d = store.loadDaily()[today];
  $('rec-daily').textContent = d ? `${d.score} points` : 'not yet sailed';
  $('daily-date').textContent = prettyDate(today);
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  showScreen('pause');
}

function resume() {
  state = 'playing';
  showScreen(null);
  refreshHover();
}

function openSettings(from) {
  settingsReturn = from;
  state = 'settings';
  showScreen('settings');
}

function closeSettings() {
  if (settingsReturn === 'pause') {
    state = 'paused';
    showScreen('pause');
  } else {
    state = 'menu';
    showScreen('menu');
  }
}

// --- tutorial ------------------------------------------------------------------

let tutorialReturn = 'menu';
const tutorial = new Tutorial({
  getOpts: () => settings,
  onDone() {
    store.saveTutorialDone();
    if (pendingMode) {
      const p = pendingMode;
      pendingMode = null;
      startRun(p.mode, p.seed);
    } else if (tutorialReturn === 'settings') {
      openSettings(settingsReturn);
    } else {
      state = 'menu';
      showScreen('menu');
    }
  },
});

function openTutorial(from = 'menu') {
  tutorialReturn = from;
  state = 'tutorial';
  showScreen('tutorial');
  tutorial.open();
}

// --- buttons ---------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  sound.unlock();
  const a = b.dataset.action;
  switch (a) {
    case 'standard':
    case 'daily':
    case 'zen':
      startRun(a);
      break;
    case 'tutorial':
      openTutorial(state === 'settings' ? 'settings' : 'menu');
      break;
    case 'settings':
      openSettings(state === 'paused' ? 'pause' : 'menu');
      break;
    case 'back':
      closeSettings();
      break;
    case 'resume':
      resume();
      break;
    case 'restart':
      startRun(game.mode, game.seed);
      break;
    case 'menu':
      backToMenu();
      break;
    case 'again':
      startRun(game && game.mode === 'zen' ? 'zen' : 'standard');
      break;
    case 'copy':
      copyResult();
      break;
    case 'tut-next':
      tutorial.next();
      break;
    case 'tut-back':
      tutorial.back();
      break;
    case 'tut-skip':
      tutorial.finish();
      break;
    default:
      break;
  }
});

$('btn-rotate').addEventListener('click', () => rotate(1));
$('btn-undo').addEventListener('click', undo);
$('btn-pause').addEventListener('click', pause);
$('btn-mute').addEventListener('click', () => {
  sound.unlock();
  toggleMute();
});
$('btn-zoom-in').addEventListener('click', () => renderer.zoomBy(1.25));
$('btn-zoom-out').addEventListener('click', () => renderer.zoomBy(0.8));
$('btn-recentre').addEventListener('click', () => renderer.fit());
$('btn-finish').addEventListener('click', () => {
  if (state !== 'playing' || game.mode !== 'zen') return;
  if (game.placements === 0 || window.confirm('Finish this island and get your postcard?')) endRun();
});

// --- map input ---------------------------------------------------------------------

attachMapInput(canvas, {
  onHover(x, y) {
    if (state !== 'playing') return;
    const h = x === null ? null : renderer.hexAt(x, y);
    if ((h && hoverHex && h.q === hoverHex.q && h.r === hoverHex.r) || (!h && !hoverHex)) return;
    hoverHex = h;
    touchPreview = false;
    refreshHover();
  },
  onTap(x, y, type) {
    sound.unlock();
    if (state !== 'playing') return;
    const h = renderer.hexAt(x, y);
    if (!h) return;
    if (type !== 'mouse') {
      // touch: the first tap shows the preview, a second tap on the same hex builds
      if (!hoverHex || hoverHex.q !== h.q || hoverHex.r !== h.r || !touchPreview) {
        hoverHex = h;
        touchPreview = true;
        refreshHover();
        if (!game.canPlaceAt(h.q, h.r)) sound.nope();
        else sound.tick();
        return;
      }
    }
    hoverHex = h;
    place(h.q, h.r);
  },
  onPan: (dx, dy) => renderer.pan(dx, dy),
  onZoom: (f, x, y) => renderer.zoomAt(f, x, y),
  onGestureEnd: () => renderer.gestureEnd(),
});

// --- keyboard ----------------------------------------------------------------------

/** Arrow keys move a cursor across the hexes; Enter or Space builds there. */
function moveCursor(key) {
  if (!hoverHex) {
    const h = renderer.hexAt(...renderer.viewCentre());
    hoverHex = h || { ...game.heart };
  } else {
    const dir = { ArrowRight: 0, ArrowLeft: 3, ArrowUp: hoverHex.r % 2 ? 2 : 1, ArrowDown: hoverHex.r % 2 ? 4 : 5 }[key];
    const [q, r] = neighbor(hoverHex.q, hoverHex.r, dir);
    if (game.board.get(q, r)) hoverHex = { q, r };
  }
  touchPreview = false;
  refreshHover();
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea, select')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === 'm' || k === 'M') {
    sound.unlock();
    toggleMute();
    return;
  }
  if (state === 'tutorial') {
    if (k === 'ArrowRight' || k === 'Enter') tutorial.next();
    else if (k === 'ArrowLeft') tutorial.back();
    else if (k === 'Escape') tutorial.finish();
    else return;
    e.preventDefault();
    return;
  }
  if (k === 'Escape') {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
    else if (state === 'settings') closeSettings();
    return;
  }
  if (state !== 'playing') return;
  if (k === '1' || k === '2' || k === '3') selectTile(Number(k) - 1);
  else if (k === 'r' || k === 'R') rotate(e.shiftKey ? -1 : 1);
  else if (k === 'z' || k === 'Z') undo();
  else if (k === '+' || k === '=') renderer.zoomBy(1.2);
  else if (k === '-' || k === '_') renderer.zoomBy(1 / 1.2);
  else if (k.startsWith('Arrow')) moveCursor(k);
  else if ((k === 'Enter' || k === ' ') && hoverHex) place(hoverHex.q, hoverHex.r);
  else return;
  e.preventDefault();
});

// --- window -------------------------------------------------------------------------

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderer.resize();
    updateInsets();
    renderer.fit();
  }, 120);
});

document.addEventListener('visibilitychange', () => {
  sound.setHidden(document.hidden);
  if (document.hidden && state === 'playing') pause();
});

// --- start ---------------------------------------------------------------------------

function boot() {
  if (new URLSearchParams(location.search).get('ads') === 'debug') document.body.classList.add('debug-ads');
  document.querySelectorAll('.torn').forEach((el, i) => tear(el, 0.13 + i * 0.21));
  // on small portrait screens the goals start folded away (tap "Goals" to open them)
  if (matchMedia('(orientation: portrait) and (max-width: 820px)').matches) {
    document.querySelector('.lb-goals').classList.add('collapsed');
    $('lb-goals-toggle').setAttribute('aria-expanded', 'false');
  }
  makeFavicon();
  renderer.resize();
  applySettings();
  showMenuIsland();
  updateMenuRecords();
  showScreen('menu');
  // redraw canvas text once the web fonts arrive
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      renderer.requestLayer(true);
      logbook.lastKey = '';
      refreshHud();
    });
  }
  const loop = (now) => {
    renderer.render(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();

// handy for testing in the console
window.paperTides = { get game() { return game; }, renderer, startRun, endRun };
