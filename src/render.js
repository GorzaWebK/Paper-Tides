// Canvas 2D renderer.
//
// The island (sea wash, land, tiles, coastline, labels) is drawn once into an offscreen
// "map layer" and only redrawn when the board changes or the zoom changes a lot. Each
// frame then just copies that layer, and adds the few things that move: ripples, the
// flood warning, the tile under the cursor, tiles dropping in, birds, clouds and the
// evening light. With reduced motion on, frames are only drawn when something changes.

import { hexToPixel, pixelToHex, dirAngle, distance, neighbor } from './hex.js';
import { hash2 } from './rng.js';
import { TILES, PALETTE } from './tiles.js';
import { LIGHTHOUSE_RANGE, protectedKeys } from './tide.js';
import * as art from './art.js';

export const HEX = 32; // hex radius in world units

const MAX_LAYER_PIXELS = 6e6;
const MAX_LAYER_SIDE = 4096;
const AMBIENT_FRAME_MS = 33; // ~30 fps is plenty for slow water and clouds

const easeOutBack = (t) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;

function mixColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp(pa >> 16, pb >> 16, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `rgb(${r},${g},${bl})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.inset = { left: 0, right: 0, top: 0, bottom: 0 };
    this.settings = { reduceMotion: false, patterns: false, names: false };
    this.game = null;
    this.hover = null; // { q, r, preview }
    this.layer = document.createElement('canvas');
    this.layerCtx = this.layer.getContext('2d');
    this.layerScale = 0;
    this.layerDirty = true;
    this.layerTimer = 0;
    this.dirty = true;
    this.hidden = new Set(); // cells left out of the layer while they animate in
    this.drops = [];
    this.floods = [];
    this.popups = [];
    this.lastFrame = 0;
    this.paper = document.createElement('canvas');
    this.ripples = [];
    this.warning = [];
    this.protect = new Set();
    this.birds = [];
    this.clouds = [];
    this.paused = false;
    this.seedAmbient();
  }

  seedAmbient() {
    this.birds = Array.from({ length: 3 }, (_, i) => ({
      x: Math.random(),
      y: 0.15 + Math.random() * 0.5,
      speed: 0.006 + Math.random() * 0.004,
      phase: Math.random() * 6,
      size: 5 + Math.random() * 3,
      dy: 0.02 + i * 0.01,
    }));
    this.clouds = Array.from({ length: 3 }, (_, i) => ({
      x: Math.random(),
      y: 0.1 + i * 0.3 + Math.random() * 0.1,
      speed: 0.0025 + Math.random() * 0.002,
      size: 70 + Math.random() * 60,
      seed: Math.floor(Math.random() * 1000),
    }));
  }

  // --- sizes and camera ------------------------------------------------------

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.paper.width = Math.round(w * dpr);
    this.paper.height = Math.round(h * dpr);
    const pctx = this.paper.getContext('2d');
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    art.drawPaper(pctx, w, h);
    this.requestLayer(true);
  }

  setInset(inset) {
    this.inset = { ...this.inset, ...inset };
    this.dirty = true;
  }

  /** Centre of the part of the screen not covered by the logbook. */
  viewCentre() {
    const { left, right, top, bottom } = this.inset;
    return [left + (this.w - left - right) / 2, top + (this.h - top - bottom) / 2];
  }

  worldToScreen(x, y) {
    const [cx, cy] = this.viewCentre();
    return [cx + (x - this.cam.x) * this.cam.zoom, cy + (y - this.cam.y) * this.cam.zoom];
  }

  screenToWorld(sx, sy) {
    const [cx, cy] = this.viewCentre();
    return [(sx - cx) / this.cam.zoom + this.cam.x, (sy - cy) / this.cam.zoom + this.cam.y];
  }

  hexAt(sx, sy) {
    const [x, y] = this.screenToWorld(sx, sy);
    const [q, r] = pixelToHex(x, y, HEX);
    return this.game && this.game.board.get(q, r) ? { q, r } : null;
  }

  /** Bounds of the whole grid in world units, with room for the sea to fade out. */
  worldBounds() {
    const R = this.game ? this.game.board.radius : 8;
    const mx = HEX * Math.sqrt(3) * (R + 0.5) + HEX * 2;
    const my = HEX * 1.5 * R + HEX * 3;
    return { x: -mx, y: -my, w: mx * 2, h: my * 2 };
  }

  /** Frame the island in the free part of the screen. */
  fit() {
    if (!this.game) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of this.game.board.cells.values()) {
      if (!c.land) continue;
      const [x, y] = hexToPixel(c.q, c.r, HEX);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const { left, right, top, bottom } = this.inset;
    const vw = Math.max(100, this.w - left - right);
    const vh = Math.max(100, this.h - top - bottom);
    const iw = maxX - minX + HEX * 3;
    const ih = maxY - minY + HEX * 3;
    this.cam.zoom = Math.max(0.35, Math.min(2.2, Math.min(vw / iw, vh / ih)));
    this.cam.x = (minX + maxX) / 2;
    this.cam.y = (minY + maxY) / 2;
    this.requestLayer(true);
  }

  clampCam() {
    const b = this.worldBounds();
    const pad = HEX * 2;
    this.cam.x = Math.max(b.x + pad, Math.min(b.x + b.w - pad, this.cam.x));
    this.cam.y = Math.max(b.y + pad, Math.min(b.y + b.h - pad, this.cam.y));
  }

  pan(dx, dy) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.clampCam();
    this.dirty = true;
  }

  zoomAt(f, sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const z = Math.max(0.35, Math.min(3, this.cam.zoom * f));
    this.cam.zoom = z;
    const [cx, cy] = this.viewCentre();
    this.cam.x = wx - (sx - cx) / z;
    this.cam.y = wy - (sy - cy) / z;
    this.clampCam();
    this.dirty = true;
  }

  zoomBy(f) {
    const [cx, cy] = this.viewCentre();
    this.zoomAt(f, cx, cy);
    this.gestureEnd();
  }

  /** After panning or zooming stops, redraw the layer if its resolution no longer suits the zoom. */
  gestureEnd() {
    const want = this.targetLayerScale();
    if (Math.abs(want - this.layerScale) / Math.max(0.01, this.layerScale) > 0.12) this.requestLayer(false);
  }

  targetLayerScale() {
    const b = this.worldBounds();
    let s = this.cam.zoom * this.dpr;
    s = Math.min(s, Math.sqrt(MAX_LAYER_PIXELS / (b.w * b.h)), MAX_LAYER_SIDE / b.w, MAX_LAYER_SIDE / b.h);
    return s;
  }

  /** Ask for the map layer to be redrawn: now, or shortly (zoom changes are batched). */
  requestLayer(now) {
    this.dirty = true;
    clearTimeout(this.layerTimer);
    if (now) this.layerDirty = true;
    else
      this.layerTimer = setTimeout(() => {
        this.layerDirty = true;
        this.dirty = true;
      }, 140);
  }

  // --- game state hooks ---------------------------------------------------------

  setGame(game) {
    this.game = game;
    this.hover = null;
    this.drops = [];
    this.floods = [];
    this.popups = [];
    this.hidden.clear();
    this.boardChanged();
    this.fit();
  }

  setSettings(s) {
    this.settings = { ...this.settings, ...s };
    this.requestLayer(true);
  }

  /** Call after anything on the board changes. */
  boardChanged() {
    const g = this.game;
    if (!g) return;
    this.ripples = [];
    for (const c of g.board.cells.values()) {
      if (c.land) continue;
      const n = 1 + Math.floor(hash2(c.q, c.r, 7) * 2);
      for (let i = 0; i < n; i++) {
        const [x, y] = hexToPixel(c.q, c.r, HEX);
        this.ripples.push({
          x: x + (hash2(c.q, c.r, 11 + i) - 0.5) * HEX * 1.1,
          y: y + (hash2(c.q, c.r, 21 + i) - 0.5) * HEX * 1.1,
          phase: hash2(c.q, c.r, 31 + i) * Math.PI * 2,
          len: HEX * (0.3 + hash2(c.q, c.r, 41 + i) * 0.3),
        });
      }
    }
    this.warning = g.floodWarning().map((c) => ({ q: c.q, r: c.r }));
    this.protect = protectedKeys(g.board);
    this.requestLayer(true);
  }

  setHover(h) {
    this.hover = h;
    this.dirty = true;
  }

  /** A tile was placed: drop it in like a paper cut-out. */
  dropTile(q, r, type, rot, delta) {
    const now = performance.now();
    const [x, y] = hexToPixel(q, r, HEX);
    if (!this.settings.reduceMotion) {
      const k = `${q},${r}`;
      this.hidden.add(k);
      this.drops.push({ q, r, type, rot, start: now, dur: 520, key: k });
    }
    if (delta) this.popups.push({ x, y: y - HEX * 0.6, text: `${delta > 0 ? '+' : ''}${delta}`, start: now, dur: 1500 });
    this.boardChanged();
  }

  /** The tide took these cells: fade what was on them into the sea. */
  floodCells(cells, points) {
    const now = performance.now();
    if (!this.settings.reduceMotion) this.floods.push({ cells, start: now, dur: 1800 });
    if (points > 0 && cells.length) {
      let sx = 0;
      let sy = 0;
      for (const c of cells) {
        const [x, y] = hexToPixel(c.q, c.r, HEX);
        sx += x;
        sy += y;
      }
      this.popups.push({ x: sx / cells.length, y: sy / cells.length, text: `−${points} washed away`, start: now + 400, dur: 2200, small: true });
    }
    this.boardChanged();
  }

  popup(text, q, r) {
    const [x, y] = hexToPixel(q, r, HEX);
    this.popups.push({ x, y: y - HEX, text, start: performance.now(), dur: 2000, small: true });
    this.dirty = true;
  }

  isAnimating() {
    return this.drops.length > 0 || this.floods.length > 0 || this.popups.length > 0;
  }

  // --- drawing --------------------------------------------------------------

  rebuildLayer() {
    const g = this.game;
    const b = this.worldBounds();
    const s = this.targetLayerScale();
    this.layerScale = s;
    const W = Math.max(1, Math.ceil(b.w * s));
    const H = Math.max(1, Math.ceil(b.h * s));
    if (this.layer.width !== W || this.layer.height !== H) {
      this.layer.width = W;
      this.layer.height = H;
    }
    const ctx = this.layerCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(s, 0, 0, s, -b.x * s, -b.y * s);
    if (!g) return;
    const board = g.board;
    const evening = g.dayProgress;
    const opts = { patterns: this.settings.patterns, evening };

    // sea first, so land washes sit on top of it
    for (const c of board.cells.values()) {
      if (c.land) continue;
      const [x, y] = hexToPixel(c.q, c.r, HEX);
      ctx.save();
      ctx.translate(x, y);
      art.drawSeaCell(ctx, c, HEX, board);
      ctx.restore();
    }
    if (art.drawSeaEdge) art.drawSeaEdge(ctx, board, HEX);
    for (const c of board.cells.values()) {
      if (!c.land) continue;
      const [x, y] = hexToPixel(c.q, c.r, HEX);
      ctx.save();
      ctx.translate(x, y);
      art.drawLandCell(ctx, c, HEX, opts);
      ctx.restore();
    }
    if (art.drawCoast) art.drawCoast(ctx, board, HEX);
    for (const c of board.cells.values()) {
      if (!c.land || !c.tile || this.hidden.has(`${c.q},${c.r}`)) continue;
      const [x, y] = hexToPixel(c.q, c.r, HEX);
      ctx.save();
      ctx.translate(x, y);
      art.drawTile(ctx, c.tile.type, c.tile.rot, HEX, hash2(c.q, c.r, 3), opts);
      ctx.restore();
    }
    if (this.settings.names) {
      for (const c of board.cells.values()) {
        if (!c.land || !c.tile || this.hidden.has(`${c.q},${c.r}`)) continue;
        const [x, y] = hexToPixel(c.q, c.r, HEX);
        drawName(ctx, TILES[c.tile.type].name, x, y + HEX * 0.62, HEX);
      }
    }
  }

  /** Should a frame be drawn now? */
  wantsFrame(now) {
    if (this.paused) return false;
    if (this.dirty || this.layerDirty || this.isAnimating()) return true;
    if (this.settings.reduceMotion) return false;
    return now - this.lastFrame >= AMBIENT_FRAME_MS;
  }

  render(now) {
    if (!this.wantsFrame(now)) return;
    const t = now / 1000;
    this.lastFrame = now;
    this.dirty = false;
    if (this.layerDirty) {
      this.layerDirty = false;
      this.rebuildLayer();
    }
    const ctx = this.ctx;
    const dpr = this.dpr;
    const g = this.game;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.paper, 0, 0);
    if (!g) return;
    const still = this.settings.reduceMotion;
    const tt = still ? 0 : t;

    // world transform
    const [vcx, vcy] = this.viewCentre();
    const z = this.cam.zoom;
    const tx = vcx - this.cam.x * z;
    const ty = vcy - this.cam.y * z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * tx, dpr * ty);
    const b = this.worldBounds();
    ctx.drawImage(this.layer, b.x, b.y, b.w, b.h);

    // view rectangle in world space, to skip what is off screen
    const [wx0, wy0] = this.screenToWorld(0, 0);
    const [wx1, wy1] = this.screenToWorld(this.w, this.h);
    const onScreen = (x, y, m = HEX * 2) => x > wx0 - m && x < wx1 + m && y > wy0 - m && y < wy1 + m;

    // ripples on the water
    if (art.drawRipple) {
      for (const rp of this.ripples) if (onScreen(rp.x, rp.y)) art.drawRipple(ctx, rp, tt, HEX);
    }

    // the coming tide
    const hp = this.hover && this.hover.preview;
    const warn = hp && hp.flood ? hp.flood : this.warning;
    for (const c of warn) {
      const [x, y] = hexToPixel(c.q, c.r, HEX);
      ctx.save();
      ctx.translate(x, y);
      art.drawFloodWarning ? art.drawFloodWarning(ctx, HEX, tt, hash2(c.q, c.r)) : fallbackWarning(ctx, HEX, tt);
      ctx.restore();
    }

    // tiles the tide is taking
    for (let i = this.floods.length - 1; i >= 0; i--) {
      const f = this.floods[i];
      const k = clamp01((now - f.start) / f.dur);
      if (k >= 1) {
        this.floods.splice(i, 1);
        continue;
      }
      for (const c of f.cells) {
        const [x, y] = hexToPixel(c.q, c.r, HEX);
        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = 1 - k;
        art.drawLandCell(ctx, { q: c.q, r: c.r, height: c.height || 1, land: true }, HEX, { evening: g.dayProgress });
        if (c.type) art.drawTile(ctx, c.type, c.rot, HEX, hash2(c.q, c.r, 3), { patterns: this.settings.patterns, evening: g.dayProgress });
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8;
        art.drawFloodWarning ? art.drawFloodWarning(ctx, HEX, tt * 3, 0.5) : fallbackWarning(ctx, HEX, tt);
        ctx.restore();
      }
    }

    // lighthouse protection rings while a lighthouse is in hand
    if (g.selectedType === 'lighthouse' && !g.finished) {
      ctx.save();
      for (const k of this.protect) {
        const [q, r] = k.split(',').map(Number);
        if (!g.board.isCoastal(q, r)) continue;
        const [x, y] = hexToPixel(q, r, HEX);
        drawDottedHex(ctx, x, y, HEX * 0.82, 0.35);
      }
      ctx.restore();
    }

    // the tile under the cursor
    if (this.hover && !g.finished) this.drawHover(ctx, now, tt);

    // tiles landing
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      const k = clamp01((now - d.start) / d.dur);
      const [x, y] = hexToPixel(d.q, d.r, HEX);
      if (k >= 1) {
        this.drops.splice(i, 1);
        this.hidden.delete(d.key);
        this.layerDirty = true;
        this.dirty = true;
      }
      const s = 1.18 - 0.18 * easeOutBack(k);
      const lift = (1 - easeOutBack(k)) * HEX * 0.35;
      ctx.save();
      ctx.translate(x, y);
      // soft shadow on the paper, shrinking as the cut-out lands
      ctx.fillStyle = 'rgba(43,42,51,0.18)';
      ctx.beginPath();
      ctx.ellipse(HEX * 0.08 + lift * 0.3, HEX * 0.12 + lift * 0.4, HEX * 0.9 * s, HEX * 0.8 * s, 0, 0, Math.PI * 2);
      ctx.globalAlpha = clamp01(1 - k * 1.2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.translate(0, -lift);
      ctx.scale(s, s);
      art.drawTile(ctx, d.type, d.rot, HEX, hash2(d.q, d.r, 3), { patterns: this.settings.patterns, evening: g.dayProgress });
      ctx.restore();
    }

    // evening: lighthouse beams
    const p = g.dayProgress;
    if (p > 0.68) {
      const a = clamp01((p - 0.68) / 0.25);
      let i = 0;
      for (const c of g.board.builtCells()) {
        if (c.tile.type !== 'lighthouse') continue;
        const [x, y] = hexToPixel(c.q, c.r, HEX);
        const ang = dirAngle(c.tile.rot) + (still ? 0 : Math.sin(t * 0.35 + i * 1.7) * 0.7);
        drawBeam(ctx, x, y - HEX * 0.45, ang, HEX * 5, a);
        i++;
      }
    }

    // score pop-ups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pp = this.popups[i];
      const k = (now - pp.start) / pp.dur;
      if (k >= 1) {
        this.popups.splice(i, 1);
        continue;
      }
      if (k < 0) continue;
      ctx.save();
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - clamp01((k - 0.6) / 0.4);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = `${pp.small ? 15 : 22}px Caveat, "Segoe Print", cursive`;
      ctx.textAlign = 'center';
      ctx.fillText(pp.text, pp.x, pp.y - (still ? 0 : k * HEX * 0.8));
      ctx.restore();
    }

    // screen space: clouds, birds, evening tint
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!still) {
      const dt = 1 / 30;
      for (const c of this.clouds) {
        c.x += c.speed * dt;
        if (c.x > 1.25) c.x = -0.25;
        if (art.drawCloud) art.drawCloud(ctx, c.x * this.w, c.y * this.h, c.size, c.seed);
      }
      for (const bd of this.birds) {
        bd.x += bd.speed * dt;
        if (bd.x > 1.1) {
          bd.x = -0.1;
          bd.y = 0.1 + Math.random() * 0.6;
        }
        const by = bd.y * this.h + Math.sin(t * 0.5 + bd.phase) * 12;
        if (art.drawBird) art.drawBird(ctx, bd.x * this.w, by, Math.sin(t * 5 + bd.phase), bd.size);
      }
    }
    drawEvening(ctx, this.w, this.h, p);
  }

  drawHover(ctx, now, tt) {
    const g = this.game;
    const { q, r, preview } = this.hover;
    const [x, y] = hexToPixel(q, r, HEX);
    const type = g.selectedType;
    ctx.save();
    ctx.translate(x, y);
    if (preview && preview.ok) {
      ctx.globalAlpha = 0.82;
      art.drawTile(ctx, type, g.rot, HEX, hash2(q, r, 3), { patterns: this.settings.patterns, evening: g.dayProgress });
      ctx.globalAlpha = 1;
      // which neighbour the front faces
      if (TILES[type].directional) {
        const a = dirAngle(g.rot);
        ctx.strokeStyle = PALETTE.roof;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * HEX * 0.7, Math.sin(a) * HEX * 0.7);
        ctx.lineTo(Math.cos(a) * HEX * 1.25, Math.sin(a) * HEX * 1.25);
        ctx.stroke();
        ctx.setLineDash([]);
        const hx = Math.cos(a) * HEX * 1.25;
        const hy = Math.sin(a) * HEX * 1.25;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - Math.cos(a - 0.5) * 6, hy - Math.sin(a - 0.5) * 6);
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - Math.cos(a + 0.5) * 6, hy - Math.sin(a + 0.5) * 6);
        ctx.stroke();
      }
      drawDottedHex(ctx, 0, 0, HEX * 0.98, 0.9);
      // score tag
      const total = preview.delta + (preview.goalBonus || 0);
      drawTag(ctx, `${total >= 0 ? '+' : ''}${total}`, 0, -HEX * 1.15, preview.goalBonus > 0);
    } else {
      ctx.strokeStyle = PALETTE.roof;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-HEX * 0.28, -HEX * 0.28);
      ctx.lineTo(HEX * 0.28, HEX * 0.28);
      ctx.moveTo(HEX * 0.28, -HEX * 0.28);
      ctx.lineTo(-HEX * 0.28, HEX * 0.28);
      ctx.stroke();
    }
    ctx.restore();
    // lighthouse range
    if (type === 'lighthouse' && preview && preview.ok) {
      for (const c of g.board.cells.values()) {
        if (!c.land || distance(c.q, c.r, q, r) > LIGHTHOUSE_RANGE || !g.board.isCoastal(c.q, c.r)) continue;
        const [cx, cy] = hexToPixel(c.q, c.r, HEX);
        drawDottedHex(ctx, cx, cy, HEX * 0.7, 0.6);
      }
    }
  }
}

// --- small drawing helpers ----------------------------------------------------

function drawDottedHex(ctx, x, y, S, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const px = x + S * Math.cos(a);
    const py = y + S * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawTag(ctx, text, x, y, special) {
  ctx.save();
  ctx.font = '600 15px Fraunces, Lora, Georgia, serif';
  const w = Math.max(30, ctx.measureText(text).width + 14);
  ctx.translate(x, y);
  ctx.rotate(-0.04);
  ctx.fillStyle = special ? '#fbe7b0' : PALETTE.cream;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -11);
  ctx.lineTo(w / 2, -12);
  ctx.lineTo(w / 2 + 1, 10);
  ctx.lineTo(-w / 2 - 1, 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PALETTE.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0.5);
  ctx.restore();
}

function drawName(ctx, text, x, y, S) {
  ctx.save();
  ctx.font = `${Math.round(S * 0.34)}px Fraunces, Lora, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(244,236,216,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function fallbackWarning(ctx, S, t) {
  ctx.fillStyle = PALETTE.sea;
  ctx.globalAlpha *= 0.3 + 0.15 * Math.sin(t * 1.5);
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawBeam(ctx, x, y, ang, len, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const grad = ctx.createLinearGradient(0, 0, len, 0);
  grad.addColorStop(0, `rgba(255,240,196,${0.42 * alpha})`);
  grad.addColorStop(1, 'rgba(255,240,196,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len, -len * 0.16);
  ctx.quadraticCurveTo(len * 1.04, 0, len, len * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Afternoon warms the paper; evening adds a dusky edge. */
function drawEvening(ctx, w, h, p) {
  if (p <= 0.15) return;
  const k = clamp01((p - 0.15) / 0.85);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = k < 0.6 ? mixColor('#ffffff', '#fbe2bb', k / 0.6) : mixColor('#fbe2bb', '#efbf9c', (k - 0.6) / 0.4);
  ctx.fillRect(0, 0, w, h);
  if (k > 0.5) {
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(255,255,255,0)');
    v.addColorStop(1, `rgba(138,127,166,${0.35 * (k - 0.5) * 2})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** Draw the finished island into a rectangle (for the postcard and the tutorial). */
export function drawIsland(ctx, board, rect, opts = {}) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of board.cells.values()) {
    if (!c.land) continue;
    const [x, y] = hexToPixel(c.q, c.r, HEX);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (minX === Infinity) {
    minX = minY = -HEX;
    maxX = maxY = HEX;
  }
  const iw = maxX - minX + HEX * 4;
  const ih = maxY - minY + HEX * 4;
  const s = Math.min(rect.w / iw, rect.h / ih);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.scale(s, s);
  ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
  for (const c of board.cells.values()) {
    if (c.land) continue;
    const [x, y] = hexToPixel(c.q, c.r, HEX);
    ctx.save();
    ctx.translate(x, y);
    art.drawSeaCell(ctx, c, HEX, board);
    ctx.restore();
  }
  if (art.drawSeaEdge) art.drawSeaEdge(ctx, board, HEX);
  for (const c of board.cells.values()) {
    if (!c.land) continue;
    const [x, y] = hexToPixel(c.q, c.r, HEX);
    ctx.save();
    ctx.translate(x, y);
    art.drawLandCell(ctx, c, HEX, opts);
    ctx.restore();
  }
  if (art.drawCoast) art.drawCoast(ctx, board, HEX);
  for (const c of board.cells.values()) {
    if (!c.land || !c.tile) continue;
    const [x, y] = hexToPixel(c.q, c.r, HEX);
    ctx.save();
    ctx.translate(x, y);
    art.drawTile(ctx, c.tile.type, c.tile.rot, HEX, hash2(c.q, c.r, 3), opts);
    ctx.restore();
  }
  ctx.restore();
}

export { neighbor };
