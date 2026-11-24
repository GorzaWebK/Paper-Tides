// One run of Paper Tides: the island, the hand of three tiles, turns, the tide,
// goals and undo. No drawing or DOM code lives here, so it can be tested in Node.

import { generateIsland, islandHeart } from './board.js';
import { RNG } from './rng.js';
import { TILES, TILE_TYPES } from './tiles.js';
import { scoreBoard, previewPlacement, placeTile, canPlace } from './scoring.js';
import { TIDE_EVERY, tideSize, floodCandidates, applyTide } from './tide.js';
import { GOAL_BY_ID, pickGoals } from './goals.js';

export const RUN_TURNS = 40;
/** The last turn after which the tide rises (turns 8, 16, 24 and 32). */
export const LAST_TIDE_TURN = 32;
/** The flood warning shows during the last this-many turns before a tide. */
export const WARNING_TURNS = 2;

export const MODES = {
  standard: { label: 'Standard run', tides: true, turns: RUN_TURNS },
  daily: { label: 'Daily Island', tides: true, turns: RUN_TURNS },
  zen: { label: 'Zen mode', tides: false, turns: Infinity },
};

const WEIGHTS = Object.fromEntries(TILE_TYPES.map((t) => [t, TILES[t].weight]));

export class Game {
  constructor({ mode = 'standard', seed = 1, date = null } = {}) {
    this.mode = mode;
    this.seed = seed >>> 0;
    this.date = date;
    const m = MODES[mode] || MODES.standard;
    this.tides = m.tides;
    this.maxTurns = m.turns;
    this.reclaim = mode === 'zen';

    this.board = generateIsland(this.seed);
    this.name = this.board.name;
    // Every island starts with one cottage on its high ground.
    const heart = islandHeart(this.board);
    placeTile(this.board, heart.q, heart.r, 'cottage', 0);
    this.heart = { q: heart.q, r: heart.r };

    this.deck = new RNG(this.seed ^ 0xdec4);
    this.hand = [];
    for (let i = 0; i < 3; i++) this.hand.push(this.drawTile());

    this.turn = 1;
    this.selected = 0;
    this.rot = 0;
    this.tideCount = 0;
    this.lost = [];
    this.pointsLost = 0;
    this.goalBonus = 0;
    this.goals = pickGoals(this.seed).map((id) => ({ id, done: false, value: 0, turn: null }));
    this.snapshot = null;
    this.undoUsedTurn = 0;
    this.bestMove = null;
    this.placements = 0;
    this.finished = false;
    this.boardScore = scoreBoard(this.board);
    this.refreshGoals();
  }

  drawTile() {
    let t = this.deck.weighted(WEIGHTS);
    // Never offer the same tile three times over.
    if (this.hand.length === 2 && this.hand[0] === t && this.hand[1] === t) t = this.deck.weighted(WEIGHTS);
    return t;
  }

  get score() {
    return this.boardScore + this.goalBonus;
  }

  get turnsLeft() {
    return this.maxTurns - this.turn + 1;
  }

  /** Progress through the run, 0 at the start and 1 on the last turn (Zen drifts slowly). */
  get dayProgress() {
    if (this.maxTurns === Infinity) return Math.min(1, (this.turn - 1) / 120);
    return Math.min(1, (this.turn - 1) / (this.maxTurns - 1));
  }

  get selectedType() {
    return this.hand[this.selected];
  }

  /** Turns until the next tide, counting this one (1 = the tide rises after this placement). */
  get tideIn() {
    if (!this.tides) return Infinity;
    const next = Math.ceil(this.turn / TIDE_EVERY) * TIDE_EVERY;
    if (next > LAST_TIDE_TURN) return Infinity;
    return next - this.turn + 1;
  }

  get nextTideSize() {
    return tideSize(this.tideCount + 1);
  }

  get warning() {
    return this.tideIn <= WARNING_TURNS;
  }

  /** The cells the coming tide will flood, while the warning is showing. */
  floodWarning() {
    if (!this.warning) return [];
    return floodCandidates(this.board, this.nextTideSize);
  }

  select(i) {
    if (i >= 0 && i < this.hand.length) this.selected = i;
  }

  rotate(dir = 1) {
    this.rot = (((this.rot - dir) % 6) + 6) % 6; // dir 1 = clockwise on screen
  }

  /** Score preview for the selected tile at (q, r), with goals it would complete and the flood it would leave. */
  preview(q, r) {
    const type = this.selectedType;
    const p = previewPlacement(this.board, q, r, type, this.rot, { reclaim: this.reclaim, before: this.boardScore });
    if (!p.ok) return p;
    const c = this.board.get(q, r);
    const saved = { land: c.land, height: c.height, tile: c.tile };
    placeTile(this.board, q, r, type, this.rot);
    p.goals = this.goals.filter((g) => !g.done && GOAL_BY_ID[g.id].value(this.board) >= GOAL_BY_ID[g.id].target).map((g) => g.id);
    p.goalBonus = p.goals.reduce((s, id) => s + GOAL_BY_ID[id].bonus, 0);
    if (this.warning && type === 'lighthouse') p.flood = floodCandidates(this.board, this.nextTideSize).map((x) => ({ q: x.q, r: x.r }));
    c.land = saved.land;
    c.height = saved.height;
    c.tile = saved.tile;
    delete c.reclaimed;
    return p;
  }

  canPlaceAt(q, r) {
    return canPlace(this.board, q, r, this.selectedType, { reclaim: this.reclaim }).ok;
  }

  refreshGoals() {
    const done = [];
    for (const g of this.goals) {
      const def = GOAL_BY_ID[g.id];
      g.value = def.value(this.board);
      if (!g.done && g.value >= def.target) {
        g.done = true;
        g.turn = this.turn;
        this.goalBonus += def.bonus;
        done.push(g.id);
      }
    }
    return done;
  }

  hasAnyMove() {
    for (const type of new Set(this.hand)) {
      for (const c of this.board.cells.values()) {
        if (canPlace(this.board, c.q, c.r, type, { reclaim: this.reclaim }).ok) return true;
      }
    }
    return false;
  }

  takeSnapshot() {
    return {
      board: this.board.clone(),
      deck: this.deck.state,
      hand: this.hand.slice(),
      turn: this.turn,
      selected: this.selected,
      rot: this.rot,
      tideCount: this.tideCount,
      lost: this.lost.slice(),
      pointsLost: this.pointsLost,
      goalBonus: this.goalBonus,
      goals: this.goals.map((g) => ({ ...g })),
      bestMove: this.bestMove,
      placements: this.placements,
      boardScore: this.boardScore,
    };
  }

  /**
   * Place the selected tile at (q, r).
   * @returns {null | {q,r,type,rot,delta,goals:string[],tide:null|{cells:Array,lost:Array,points:number},ended:boolean}}
   */
  place(q, r) {
    if (this.finished) return null;
    const type = this.selectedType;
    const check = canPlace(this.board, q, r, type, { reclaim: this.reclaim });
    if (!check.ok) return null;

    this.snapshot = this.takeSnapshot();
    const rot = this.rot;
    const before = this.score;
    placeTile(this.board, q, r, type, rot);
    this.hand[this.selected] = this.drawTile();
    this.boardScore = scoreBoard(this.board);
    const goals = this.refreshGoals();
    const delta = this.score - before;
    this.placements++;
    if (!this.bestMove || delta > this.bestMove.delta) this.bestMove = { type, delta, turn: this.turn };

    // Tide after this turn?
    let tide = null;
    if (this.tides && this.turn % TIDE_EVERY === 0 && this.turn <= LAST_TIDE_TURN) {
      const cells = floodCandidates(this.board, this.nextTideSize);
      const flooded = cells.map((c) => ({ q: c.q, r: c.r, type: c.tile ? c.tile.type : null, rot: c.tile ? c.tile.rot : 0, height: c.height }));
      const scoreBefore = this.boardScore;
      const lost = applyTide(this.board, cells);
      this.tideCount++;
      this.boardScore = scoreBoard(this.board);
      const points = scoreBefore - this.boardScore;
      this.lost.push(...lost);
      this.pointsLost += Math.max(0, points);
      this.refreshGoals();
      tide = { cells: flooded, lost, points };
    }

    this.turn++;
    // Selection stays on the same slot; the new tile starts facing east.
    this.rot = 0;
    if (this.turn > this.maxTurns || !this.hasAnyMove()) this.finished = true;
    return { q, r, type, rot, delta, goals, tide, ended: this.finished };
  }

  get canUndo() {
    return !!this.snapshot && this.undoUsedTurn !== this.snapshot.turn;
  }

  /** Take back the last placement (once per turn). */
  undo() {
    if (!this.canUndo) return false;
    const s = this.snapshot;
    this.board = s.board;
    this.deck.state = s.deck;
    this.hand = s.hand;
    this.turn = s.turn;
    this.selected = s.selected;
    this.rot = s.rot;
    this.tideCount = s.tideCount;
    this.lost = s.lost;
    this.pointsLost = s.pointsLost;
    this.goalBonus = s.goalBonus;
    this.goals = s.goals;
    this.bestMove = s.bestMove;
    this.placements = s.placements;
    this.boardScore = s.boardScore;
    this.finished = false;
    this.undoUsedTurn = s.turn;
    this.snapshot = null;
    return true;
  }

  /** Zen mode has no end, so the player finishes it themselves. */
  finish() {
    this.finished = true;
  }

  goalsDone() {
    return this.goals.filter((g) => g.done).length;
  }
}
