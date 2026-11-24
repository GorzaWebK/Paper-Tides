// DOM side of the game: torn paper edges, the logbook, toasts, the tutorial, the
// end-of-run postcard, the share text and the favicon.

import * as art from './art.js';
import { drawIsland, HEX } from './render.js';
import { Board } from './board.js';
import { hexesInRadius, key } from './hex.js';
import { TILES, PALETTE } from './tiles.js';
import { GOAL_BY_ID } from './goals.js';
import { LIGHTHOUSE_RANGE } from './tide.js';

export const $ = (id) => document.getElementById(id);

// --- torn paper ---------------------------------------------------------------

/** Give an element ragged, torn edges with a generated clip-path. */
export function tear(el, seed = Math.random()) {
  const rnd = art.mkRand(seed);
  const pts = [];
  const n = 34;
  const deep = 5;
  for (let i = 0; i <= n; i++) pts.push(`${((i / n) * 100).toFixed(2)}% ${(rnd() * deep).toFixed(1)}px`);
  for (let i = 1; i < 12; i++) pts.push(`calc(100% - ${(rnd() * 2.5).toFixed(1)}px) ${((i / 12) * 100).toFixed(2)}%`);
  for (let i = n; i >= 0; i--) pts.push(`${((i / n) * 100).toFixed(2)}% calc(100% - ${(rnd() * deep).toFixed(1)}px)`);
  for (let i = 11; i > 0; i--) pts.push(`${(rnd() * 2.5).toFixed(1)}px ${((i / 12) * 100).toFixed(2)}%`);
  el.style.clipPath = `polygon(${pts.join(',')})`;
}

// --- tile pictures -------------------------------------------------------------

export function paintTile(canvas, type, rot, opts = {}, seed = 0.42) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const css = canvas.clientWidth || 68;
  const px = Math.round(css * dpr);
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  const S = (css / 2) * 0.86;
  ctx.setTransform(dpr, 0, 0, dpr, (css / 2) * dpr, (css / 2) * dpr);
  art.drawTile(ctx, type, rot, S, seed, opts);
}

const RING_PATH = 'M50 6C78 4 96 22 95 48 94 76 72 96 46 94 20 92 4 72 6 46 8 22 26 8 52 8 62 9 70 12 76 17';

// --- logbook ------------------------------------------------------------------

export class Logbook {
  constructor({ onSelect }) {
    this.hand = $('lb-hand');
    this.cards = [];
    this.lastKey = '';
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button');
      b.className = 'tile-card';
      b.setAttribute('role', 'radio');
      b.dataset.i = i;
      b.innerHTML = `<svg class="ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${RING_PATH}"/></svg><canvas></canvas><span class="key">${i + 1}</span><span class="name"></span>`;
      b.addEventListener('click', () => onSelect(i));
      this.hand.appendChild(b);
      this.cards.push(b);
    }
    $('lb-goals-toggle').addEventListener('click', () => {
      const g = document.querySelector('.lb-goals');
      g.classList.toggle('collapsed');
      $('lb-goals-toggle').setAttribute('aria-expanded', String(!g.classList.contains('collapsed')));
    });
  }

  update(game, settings, preview, extra = {}) {
    $('lb-island').textContent = game.name;
    $('lb-mode').textContent = extra.modeLabel || '';
    const finite = game.maxTurns !== Infinity;
    $('lb-turn').textContent = finite ? Math.min(game.turn, game.maxTurns) : game.turn;
    $('lb-turns-of').textContent = finite ? `/${game.maxTurns}` : '';
    $('lb-score').textContent = game.score;

    // the tide
    const tide = $('stat-tide');
    const tIn = game.tideIn;
    tide.classList.toggle('warning', game.warning);
    tide.classList.toggle('calm', tIn === Infinity);
    $('lb-tide').textContent = tIn === Infinity ? (game.tides ? 'out' : 'calm') : tIn;
    const level = tIn === Infinity ? 0 : 1 - (tIn - 1) / 8;
    $('tide-level').setAttribute('y', String(22 - level * 16));
    tide.title = tIn === Infinity ? (game.tides ? 'The tide will not rise again today' : 'No tide in Zen mode') : `The tide rises after ${tIn === 1 ? 'this turn' : `${tIn} turns`}`;

    // the hand (only repaint canvases when something changed)
    const k = `${game.hand.join()}|${game.selected}|${game.rot}|${settings.patterns}|${Math.round(game.dayProgress * 4)}`;
    if (k !== this.lastKey) {
      this.lastKey = k;
      game.hand.forEach((type, i) => {
        const card = this.cards[i];
        card.setAttribute('aria-checked', String(i === game.selected));
        card.setAttribute('aria-label', `${i + 1}: ${TILES[type].name}`);
        card.querySelector('.name').textContent = TILES[type].name;
        paintTile(card.querySelector('canvas'), type, i === game.selected ? game.rot : 0, { patterns: settings.patterns, evening: game.dayProgress }, 0.3 + i * 0.17);
      });
    }

    const type = game.selectedType;
    $('btn-rotate').disabled = !TILES[type].directional || game.finished;
    $('btn-undo').disabled = !game.canUndo;
    $('btn-finish').hidden = game.mode !== 'zen';

    // the note: the selected tile's rule, or the preview breakdown
    const note = $('lb-note');
    if (preview && preview.ok) {
      const total = preview.delta + (preview.goalBonus || 0);
      const parts = preview.tile.parts.map(([l, v]) => `${l} ${v > 0 ? '+' : ''}${v}`);
      if (preview.neighbours) parts.push(`neighbours ${preview.neighbours > 0 ? '+' : ''}${preview.neighbours}`);
      if (preview.goals && preview.goals.length) parts.push(`goal: ${GOAL_BY_ID[preview.goals[0]].text} +${preview.goalBonus}`);
      note.innerHTML = `<span class="gain">${total >= 0 ? '+' : ''}${total}</span> <b>${TILES[type].name}</b> here<br><span class="parts">${escapeHtml(parts.join(' · ') || 'nothing nearby yet')}</span>${
        extra.tapAgain ? '<br><span class="hint">Tap again to build</span>' : ''
      }`;
    } else if (preview && !preview.ok) {
      note.innerHTML = `<b>${TILES[type].name}</b>: <span class="bad">${escapeHtml(preview.reason)}</span><br><span class="parts">${escapeHtml(TILES[type].rule)}</span>`;
    } else {
      const facing = TILES[type].directional ? `<br><span class="hint">Its ${TILES[type].front} faces where the dashed arrow points. R turns it.</span>` : '';
      note.innerHTML = `<b>${TILES[type].name}</b>: ${escapeHtml(TILES[type].rule)}${facing}`;
    }

    // goals
    const ul = $('lb-goals');
    const gk = game.goals.map((g) => `${g.id}:${g.value}:${g.done}`).join();
    if (gk !== this.goalsKey) {
      this.goalsKey = gk;
      ul.innerHTML = game.goals
        .map((g) => {
          const def = GOAL_BY_ID[g.id];
          const prog = Math.min(g.value, def.target);
          return `<li class="${g.done ? 'done' : ''}">
            <svg class="tick" viewBox="0 0 20 20" aria-hidden="true"><path class="box" d="M3 3.5 17 3l.5 14L3 17.4z"/><path class="mark" d="M4.5 10.5 8.5 15 18 2"/></svg>
            <span class="text">${def.text}<span class="prog">${g.done ? 'done!' : `${prog} of ${def.target}${def.note ? ` · ${def.note}` : ''}`}</span></span>
            <span class="bonus">+${def.bonus}</span>
          </li>`;
        })
        .join('');
      $('lb-goals-count').textContent = `${game.goalsDone()}/${game.goals.length}`;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// --- toast --------------------------------------------------------------------

let toastTimer = 0;
export function toast(text, kind = '', ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.className = `toast ${kind}`;
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// --- tutorial -----------------------------------------------------------------

/** Build a small board for an illustration: land cells given, sea around them. */
function miniBoard(cells, radius = 3) {
  const b = new Board(radius);
  const land = new Map(cells.map((c) => [key(c[0], c[1]), c]));
  for (const [q, r] of hexesInRadius(radius)) {
    const c = land.get(key(q, r));
    b.cells.set(key(q, r), {
      q,
      r,
      land: !!c,
      height: c ? c[3] || 3 : 0,
      tb: ((q * 7 + r * 13 + 50) % 17) / 17,
      tile: c && c[2] ? { type: c[2], rot: c[4] || 0 } : null,
    });
  }
  return b;
}

function handText(ctx, text, x, y, size = 18, color = PALETTE.ink, align = 'center') {
  ctx.save();
  ctx.font = `600 ${size}px Caveat, "Segoe Print", cursive`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function curvedArrow(ctx, x, y, r, a0, a1) {
  ctx.save();
  ctx.strokeStyle = PALETTE.roof;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
  const ex = x + Math.cos(a1) * r;
  const ey = y + Math.sin(a1) * r;
  const t = a1 + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(t - 0.5) * 7, ey - Math.sin(t - 0.5) * 7);
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(t + 0.5) * 7, ey - Math.sin(t + 0.5) * 7);
  ctx.stroke();
  ctx.restore();
}

export const TUTORIAL = [
  {
    title: 'Your logbook',
    text: 'Each turn your logbook offers three tiles. Pick one by tapping it, or press 1, 2 or 3. Take as long as you like: there is no timer, ever.',
    draw(ctx, w, h, opts) {
      const types = ['meadow', 'cottage', 'harbour'];
      types.forEach((t, i) => {
        const x = w / 2 + (i - 1) * 92;
        ctx.save();
        ctx.translate(x, h / 2 - 8);
        art.drawTile(ctx, t, 5, 34, 0.2 + i * 0.3, opts);
        ctx.restore();
        handText(ctx, `${i + 1}`, x - 38, h / 2 - 50, 20, PALETTE.ink);
        handText(ctx, TILES[t].name, x, h / 2 + 45, 19);
      });
      ctx.save();
      ctx.strokeStyle = PALETTE.roof;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2 - 2, 46, 64, -0.08, 0.2, Math.PI * 2.05);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    title: 'Place it, turn it',
    text: 'Tap an empty hex to see what the tile is worth, then tap again to build (with a mouse, just click). Some tiles have a front: a door, pier, lamp or awning. Press R or ↻ to turn them.',
    draw(ctx, w, h, opts) {
      const b = miniBoard([[0, 0, 'cottage', 3, 0], [1, 0, 'meadow'], [-1, 0], [0, -1], [1, -1], [0, 1], [-1, 1, 'forest']], 2);
      const m = drawIsland(ctx, b, { x: 0, y: 0, w, h }, opts);
      const [x, y] = m.at(0, 0);
      curvedArrow(ctx, x, y, HEX * m.scale * 1.1, -2.6, -1.2);
      handText(ctx, 'door faces the meadow: +1', x + 10, y + HEX * m.scale * 1.75, 18, PALETTE.roof);
    },
  },
  {
    title: 'Good neighbours',
    text: 'Tiles score from what is next to them. Cottages love meadows and markets, windmills love fields, forests like each other, and harbours must touch the sea. The tag shows the points before you build.',
    draw(ctx, w, h, opts) {
      const b = miniBoard([[0, 0, 'cottage', 3, 0], [1, 0, 'market', 3, 3], [-1, 0, 'meadow'], [0, -1, 'meadow'], [1, -1], [0, 1], [-1, 1]], 2);
      const m = drawIsland(ctx, b, { x: 0, y: 0, w, h }, opts);
      const lab = [[1, 0, '+2'], [-1, 0, '+1'], [0, -1, '+1']];
      for (const [q, r, t] of lab) {
        const [x, y] = m.at(q, r);
        handText(ctx, t, x, y - HEX * m.scale * 0.75, 20, PALETTE.roof);
      }
      const [x, y] = m.at(0, 0);
      ctx.save();
      ctx.fillStyle = PALETTE.cream;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = 1.2;
      ctx.fillRect(x - 20, y + HEX * m.scale * 0.95, 40, 22);
      ctx.strokeRect(x - 20, y + HEX * m.scale * 0.95, 40, 22);
      ctx.restore();
      ctx.save();
      ctx.font = '600 15px Fraunces, Georgia, serif';
      ctx.fillStyle = PALETTE.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+6', x, y + HEX * m.scale * 0.95 + 11);
      ctx.restore();
    },
  },
  {
    title: 'Mind the tide',
    text: 'Every 8 turns the sea rises and floods the lowest coast, tiles and all. A turn ahead you will see the hexes it will take, rippling blue. A Lighthouse keeps the tide away from the coast within 2 hexes.',
    draw(ctx, w, h, opts, t) {
      const cells = [];
      for (const [q, r] of hexesInRadius(2)) cells.push([q, r, null, Math.max(1, 3 - Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)))]);
      cells.find((c) => c[0] === -2 && c[1] === 1)[2] = 'lighthouse';
      cells.find((c) => c[0] === 0 && c[1] === 0)[2] = 'cottage';
      cells.find((c) => c[0] === 2 && c[1] === -1)[2] = 'field';
      const b = miniBoard(cells, 3);
      const m = drawIsland(ctx, b, { x: 0, y: 0, w, h }, opts);
      for (const [q, r] of [[2, -1], [2, 0], [1, 1]]) {
        const [x, y] = m.at(q, r);
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(m.scale, m.scale);
        art.drawFloodWarning(ctx, HEX, t, q * 0.3);
        ctx.restore();
      }
      for (const c of cells) {
        const d = Math.max(Math.abs(c[0] + 2), Math.abs(c[1] - 1), Math.abs(c[0] + 2 + c[1] - 1));
        if (d > LIGHTHOUSE_RANGE || !b.isCoastal(c[0], c[1])) continue;
        const [x, y] = m.at(c[0], c[1]);
        ctx.save();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = PALETTE.ink;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(x, y, HEX * m.scale * 0.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      const [lx, ly] = m.at(-2, 1);
      handText(ctx, 'safe', lx - 10, ly + HEX * m.scale * 1.15, 18, PALETTE.ink);
      const [fx, fy] = m.at(2, 0);
      handText(ctx, 'flooding soon', fx + 6, fy + HEX * m.scale * 1.35, 18, '#3f6573');
    },
  },
  {
    title: 'Goals, and evening',
    text: 'Each run has three small goals worth bonus points. Over 40 turns the day turns to evening, then you get a postcard of your island. Try the Daily Island to play the same island as everyone else today.',
    draw(ctx, w, h, opts) {
      const b = miniBoard([[0, 0, 'lighthouse', 2, 0], [-1, 0, 'cottage', 3, 0], [-1, 1, 'meadow'], [0, 1, 'harbour', 1, 5], [-2, 1, 'forest'], [-1, -1, 'field'], [0, -1]], 3);
      const m = drawIsland(ctx, b, { x: 0, y: 0, w: w * 0.55, h }, { ...opts, evening: 0.9 });
      const [lx, ly] = m.at(0, 0);
      ctx.save();
      ctx.translate(lx, ly - 14);
      const g = ctx.createLinearGradient(0, 0, 90, 0);
      g.addColorStop(0, 'rgba(255,240,196,0.6)');
      g.addColorStop(1, 'rgba(255,240,196,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(90, -16);
      ctx.lineTo(90, 16);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(239,191,156,0.5)';
      ctx.fillRect(0, 0, w * 0.55, h);
      ctx.restore();
      const items = [['Connect 3 Harbours', true], ['Sow 6 Fields', true], ['A wood of 5 Forests', false]];
      items.forEach(([t, done], i) => {
        const y = h / 2 - 40 + i * 38;
        const x = w * 0.6;
        ctx.save();
        ctx.strokeStyle = PALETTE.ink;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y - 9, 18, 18);
        if (done) {
          ctx.strokeStyle = PALETTE.roof;
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(x + 2, y);
          ctx.lineTo(x + 7, y + 7);
          ctx.lineTo(x + 20, y - 12);
          ctx.stroke();
        }
        ctx.restore();
        handText(ctx, t, x + 26, y, 19, PALETTE.ink, 'left');
      });
    },
  },
];

export class Tutorial {
  constructor({ onDone, getOpts }) {
    this.step = 0;
    this.onDone = onDone;
    this.getOpts = getOpts;
    this.canvas = $('tut-canvas');
    this.raf = 0;
    const dots = $('tut-dots');
    dots.innerHTML = TUTORIAL.map(() => '<span></span>').join('');
  }

  open() {
    this.step = 0;
    this.show();
  }

  show() {
    const s = TUTORIAL[this.step];
    $('tut-title').textContent = s.title;
    $('tut-text').textContent = s.text;
    [...$('tut-dots').children].forEach((d, i) => d.classList.toggle('on', i === this.step));
    $('tut-next').textContent = this.step === TUTORIAL.length - 1 ? 'Start building' : 'Next';
    document.querySelector('[data-action="tut-back"]').disabled = this.step === 0;
    cancelAnimationFrame(this.raf);
    const loop = (now) => {
      this.paint(now / 1000);
      if (this.step === 3 && !this.getOpts().reduceMotion && !$('screen-tutorial').hidden) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  paint(t) {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = 320;
    const h = 190;
    if (c.width !== w * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const o = this.getOpts();
    TUTORIAL[this.step].draw(ctx, w, h, { patterns: o.patterns, evening: 0 }, o.reduceMotion ? 0 : t);
  }

  next() {
    if (this.step < TUTORIAL.length - 1) {
      this.step++;
      this.show();
    } else this.finish();
  }

  back() {
    if (this.step > 0) {
      this.step--;
      this.show();
    }
  }

  finish() {
    cancelAnimationFrame(this.raf);
    this.onDone();
  }
}

// --- postcard -----------------------------------------------------------------

function wobblyRect(ctx, x, y, w, h, rnd, j = 2) {
  ctx.beginPath();
  const pts = [];
  const steps = 18;
  for (let i = 0; i < steps; i++) pts.push([x + (w * i) / steps, y + (rnd() - 0.5) * j]);
  for (let i = 0; i < steps; i++) pts.push([x + w + (rnd() - 0.5) * j, y + (h * i) / steps]);
  for (let i = steps; i > 0; i--) pts.push([x + (w * i) / steps, y + h + (rnd() - 0.5) * j]);
  for (let i = steps; i > 0; i--) pts.push([x + (rnd() - 0.5) * j, y + (h * i) / steps]);
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function prettyDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Paint the end-of-run postcard of the finished island. */
export function drawPostcard(canvas, game, info) {
  const W = 900;
  const H = 600;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rnd = art.mkRand(0.6123);

  // the card itself, with a slightly deckled edge
  ctx.save();
  wobblyRect(ctx, 4, 4, W - 8, H - 8, rnd, 3);
  ctx.clip();
  art.drawPaper(ctx, W, H, 0.81);
  ctx.restore();
  ctx.save();
  wobblyRect(ctx, 4, 4, W - 8, H - 8, rnd, 3);
  ctx.strokeStyle = 'rgba(43,42,51,0.35)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  // the painting
  const pr = { x: 32, y: 32, w: 520, h: 536 };
  ctx.save();
  wobblyRect(ctx, pr.x, pr.y, pr.w, pr.h, rnd, 4);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, pr.y, 0, pr.y + pr.h);
  sky.addColorStop(0, 'rgba(240,200,160,0.35)');
  sky.addColorStop(1, 'rgba(127,167,181,0.25)');
  ctx.fillStyle = sky;
  ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
  const m = drawIsland(ctx, game.board, { x: pr.x + 10, y: pr.y + 10, w: pr.w - 20, h: pr.h - 20 }, { patterns: info.patterns, evening: game.dayProgress });
  // lighthouse beams in the evening light
  if (game.dayProgress > 0.6) {
    for (const c of game.board.builtCells()) {
      if (c.tile.type !== 'lighthouse') continue;
      const [x, y] = m.at(c.q, c.r);
      const a = -Math.PI / 3 * c.tile.rot;
      ctx.save();
      ctx.translate(x, y - HEX * m.scale * 0.45);
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, 160 * m.scale, 0);
      g.addColorStop(0, 'rgba(255,240,196,0.5)');
      g.addColorStop(1, 'rgba(255,240,196,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(160 * m.scale, -26 * m.scale);
      ctx.lineTo(160 * m.scale, 26 * m.scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgba(251,226,187,${0.25 + game.dayProgress * 0.25})`;
  ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
  ctx.restore();
  ctx.save();
  wobblyRect(ctx, pr.x, pr.y, pr.w, pr.h, rnd, 4);
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  // divider
  ctx.save();
  ctx.strokeStyle = 'rgba(43,42,51,0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(588, 60);
  ctx.bezierCurveTo(590, 220, 586, 380, 589, 540);
  ctx.stroke();
  ctx.restore();

  // stamp with perforated edge
  const sx = 752;
  const sy = 40;
  const sw = 104;
  const sh = 124;
  ctx.save();
  ctx.translate(sx + sw / 2, sy + sh / 2);
  ctx.rotate(0.04);
  ctx.translate(-sw / 2, -sh / 2);
  ctx.fillStyle = '#fbf5e6';
  ctx.fillRect(0, 0, sw, sh);
  ctx.fillStyle = PALETTE.paper;
  for (let x = 0; x <= sw; x += 9) {
    for (const y of [0, sh]) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let y = 0; y <= sh; y += 9) {
    for (const x of [0, sw]) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = PALETTE.roof;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(8, 8, sw - 16, sh - 16);
  ctx.save();
  ctx.translate(sw / 2, sh / 2 - 6);
  art.drawTile(ctx, info.stampTile || 'lighthouse', 0, 32, 0.77, { evening: 0.3 });
  ctx.restore();
  ctx.font = '600 11px Fraunces, Georgia, serif';
  ctx.fillStyle = PALETTE.roof;
  ctx.textAlign = 'center';
  ctx.fillText('PAPER TIDES', sw / 2, sh - 15);
  ctx.restore();

  // postmark
  ctx.save();
  ctx.translate(720, 150);
  ctx.rotate(-0.25);
  ctx.strokeStyle = 'rgba(63,101,115,0.75)';
  ctx.fillStyle = 'rgba(63,101,115,0.8)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, 42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = '600 10px Fraunces, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(info.postmark.toUpperCase(), 0, -4);
  ctx.font = '9px Fraunces, Georgia, serif';
  ctx.fillText(info.dateLabel.toUpperCase(), 0, 10);
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    const y = -18 + i * 12;
    ctx.moveTo(48, y);
    for (let x = 48; x < 140; x += 12) ctx.quadraticCurveTo(x + 3, y - 4, x + 6, y), ctx.quadraticCurveTo(x + 9, y + 4, x + 12, y);
    ctx.stroke();
  }
  ctx.restore();

  // greeting and the island's name
  ctx.save();
  ctx.fillStyle = PALETTE.ink;
  ctx.font = '600 36px Caveat, "Segoe Print", cursive';
  ctx.fillText('Greetings from', 612, 258);
  ctx.font = '700 38px Fraunces, Georgia, serif';
  const words = game.name.split(' ');
  ctx.fillText(words[0], 612, 304);
  if (words[1]) ctx.fillText(words.slice(1).join(' '), 612, 344);
  ctx.restore();

  // the "address" lines, filled in by hand
  const lines = info.lines;
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const y = 404 + i * 42;
    ctx.strokeStyle = 'rgba(43,42,51,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(612, y);
    ctx.lineTo(860, y + (rnd() - 0.5) * 2);
    ctx.stroke();
    if (lines[i]) {
      ctx.font = `600 ${i === 0 ? 34 : 26}px Caveat, "Segoe Print", cursive`;
      ctx.fillStyle = i === 0 ? PALETTE.roof : PALETTE.ink;
      ctx.fillText(lines[i], 616, y - 7);
    }
  }
  ctx.restore();
}

// --- share text ---------------------------------------------------------------

const EMOJI_WATER = '🟦';
const EMOJI_LAND = '🟫';

/** A compact emoji picture of the island for sharing. */
export function islandEmoji(board) {
  const land = board.landCells();
  if (!land.length) return '';
  // offset rows (odd-r) so the picture keeps the island's shape
  const pos = (c) => [c.q + (c.r - (c.r & 1)) / 2, c.r];
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const c of land) {
    const [col, row] = pos(c);
    minC = Math.min(minC, col);
    maxC = Math.max(maxC, col);
    minR = Math.min(minR, row);
    maxR = Math.max(maxR, row);
  }
  const grid = new Map(land.map((c) => [pos(c).join(','), c]));
  const rows = [];
  for (let r = minR; r <= maxR; r++) {
    let line = '';
    for (let col = minC; col <= maxC; col++) {
      const c = grid.get(`${col},${r}`);
      line += !c ? EMOJI_WATER : c.tile ? TILES[c.tile.type].emoji : EMOJI_LAND;
    }
    rows.push(line);
  }
  return rows.join('\n');
}

export function shareText(game, info) {
  const goals = game.goals.map((g) => (g.done ? '✅' : '⬜')).join('');
  const head = game.mode === 'daily' ? `Paper Tides · Daily Island ${info.date}` : game.mode === 'zen' ? 'Paper Tides · Zen island' : 'Paper Tides';
  const tide = game.tides ? ` · 🌊 the tide took ${game.lost.length} tile${game.lost.length === 1 ? '' : 's'}` : '';
  return `${head}\n${game.name} — ${game.score} points\nGoals ${goals}${tide}\n${islandEmoji(game.board)}\n${info.url}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// --- favicon ------------------------------------------------------------------

/** Paint a watercolour favicon in code and use it in place of the inline SVG one. */
export function makeFavicon() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = PALETTE.paper;
    ctx.beginPath();
    ctx.arc(32, 32, 31, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(32, 32);
    art.drawTile(ctx, 'cottage', 3, 27, 0.33, {});
    const link = $('favicon');
    link.type = 'image/png';
    link.href = c.toDataURL('image/png');
    const apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.href = link.href;
    document.head.appendChild(apple);
  } catch {
    /* keep the SVG favicon */
  }
}

