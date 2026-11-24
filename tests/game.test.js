import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, RUN_TURNS } from '../src/game.js';
import { generateIsland, ISLAND_SIZE } from '../src/board.js';
import { dailySeed, dateKey, RNG } from '../src/rng.js';
import { scoreBoard } from '../src/scoring.js';

const firstSpot = (g) => {
  for (const c of g.board.cells.values()) if (g.canPlaceAt(c.q, c.r)) return [c.q, c.r];
  return null;
};

const fingerprint = (board) =>
  [...board.cells.values()].map((c) => `${c.q},${c.r}:${c.land ? c.height : '~'}${c.tile ? c.tile.type[0] : ''}`).join('|');

test('daily seed comes from the date string and is the same every time', () => {
  assert.equal(dailySeed('2026-11-24'), dailySeed('2026-11-24'));
  assert.notEqual(dailySeed('2026-11-24'), dailySeed('2026-11-25'));
  assert.equal(dateKey(new Date(2026, 10, 24, 23, 59)), '2026-11-24');
  assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('the same daily seed gives the same island, goals and tile draws', () => {
  const seed = dailySeed('2026-11-24');
  const a = new Game({ mode: 'daily', seed });
  const b = new Game({ mode: 'daily', seed });
  assert.equal(fingerprint(a.board), fingerprint(b.board));
  assert.deepEqual(a.goals.map((g) => g.id), b.goals.map((g) => g.id));
  assert.equal(a.name, b.name);
  // play the same moves: same draws, same tides, same score
  for (let i = 0; i < 20; i++) {
    const [q, r] = firstSpot(a);
    a.place(q, r);
    b.place(q, r);
    assert.deepEqual(a.hand, b.hand);
  }
  assert.equal(fingerprint(a.board), fingerprint(b.board));
  assert.equal(a.score, b.score);
  // and a different day is a different island
  const c = new Game({ mode: 'daily', seed: dailySeed('2026-11-25') });
  assert.notEqual(fingerprint(a.board), fingerprint(c.board));
});

test('islands are connected, the right size, with low coasts', () => {
  for (let s = 1; s <= 25; s++) {
    const b = generateIsland(s * 7919);
    const land = b.landCells();
    assert.ok(land.length >= ISLAND_SIZE && land.length <= ISLAND_SIZE + 12, `size ${land.length}`);
    // connected
    const seen = new Set([`${land[0].q},${land[0].r}`]);
    const stack = [land[0]];
    while (stack.length) {
      const c = stack.pop();
      for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
        const n = b.get(c.q + dq, c.r + dr);
        if (n && n.land && !seen.has(`${n.q},${n.r}`)) {
          seen.add(`${n.q},${n.r}`);
          stack.push(n);
        }
      }
    }
    assert.equal(seen.size, land.length);
    const coast = land.filter((c) => b.isCoastal(c.q, c.r));
    const inland = land.filter((c) => !b.isCoastal(c.q, c.r));
    const avg = (xs) => xs.reduce((a, c) => a + c.height, 0) / xs.length;
    assert.ok(avg(coast) < avg(inland));
  }
});

test('a standard run lasts 40 turns with tides after turns 8, 16, 24 and 32', () => {
  const g = new Game({ mode: 'standard', seed: 42 });
  const tideTurns = [];
  while (!g.finished) {
    const turn = g.turn;
    const [q, r] = firstSpot(g);
    const res = g.place(q, r);
    if (res.tide) {
      tideTurns.push(turn);
      assert.equal(res.tide.cells.length, 2 + tideTurns.length);
    }
  }
  assert.deepEqual(tideTurns, [8, 16, 24, 32]);
  assert.equal(g.turn, RUN_TURNS + 1);
  assert.equal(g.placements, RUN_TURNS);
  assert.equal(g.score, scoreBoard(g.board) + g.goalBonus);
});

test('the flood warning shows during the two turns before a tide', () => {
  const g = new Game({ mode: 'standard', seed: 7 });
  const shown = [];
  while (g.turn <= 16) {
    if (g.floodWarning().length) shown.push(g.turn);
    const [q, r] = firstSpot(g);
    g.place(q, r);
  }
  assert.deepEqual(shown, [7, 8, 15, 16]);
});

test('zen mode has no tide and no turn limit', () => {
  const g = new Game({ mode: 'zen', seed: 9 });
  for (let i = 0; i < 60; i++) {
    const [q, r] = firstSpot(g);
    const res = g.place(q, r);
    assert.equal(res.tide, null);
  }
  assert.equal(g.finished, false);
  assert.equal(g.tideIn, Infinity);
});

test('undo restores the board, hand and score, once per turn', () => {
  const g = new Game({ mode: 'standard', seed: 1234 });
  assert.equal(g.canUndo, false);
  const before = { board: fingerprint(g.board), hand: g.hand.slice(), score: g.score, turn: g.turn };
  const [q, r] = firstSpot(g);
  g.place(q, r);
  assert.equal(g.canUndo, true);
  assert.equal(g.undo(), true);
  assert.equal(fingerprint(g.board), before.board);
  assert.deepEqual(g.hand, before.hand);
  assert.equal(g.score, before.score);
  assert.equal(g.turn, before.turn);
  // placing again on the same turn cannot be undone a second time
  g.place(q, r);
  assert.equal(g.canUndo, false);
  assert.equal(g.undo(), false);
  // but the next turn's placement can
  const [q2, r2] = firstSpot(g);
  g.place(q2, r2);
  assert.equal(g.canUndo, true);
});

test('undo across a tide brings the flooded land back', () => {
  const g = new Game({ mode: 'standard', seed: 99 });
  while (g.turn < 8) {
    const [q, r] = firstSpot(g);
    g.place(q, r);
  }
  const before = fingerprint(g.board);
  const [q, r] = firstSpot(g);
  const res = g.place(q, r);
  assert.ok(res.tide);
  g.undo();
  assert.equal(fingerprint(g.board), before);
  assert.equal(g.tideCount, 0);
});

test('goal bonuses are kept once earned', () => {
  const g = new Game({ mode: 'standard', seed: 5 });
  g.goals = [{ id: 'lights', done: false, value: 0, turn: null }];
  const spot = () => firstSpot(g);
  g.hand = ['lighthouse', 'lighthouse', 'lighthouse'];
  g.place(...spot());
  g.hand[g.selected] = 'lighthouse';
  const res = g.place(...spot());
  assert.deepEqual(res.goals, ['lights']);
  assert.equal(g.goalBonus, 6);
});

test('RNG state can be saved and restored', () => {
  const r = new RNG(3);
  r.next();
  const s = r.state;
  const a = [r.next(), r.next()];
  r.state = s;
  assert.deepEqual([r.next(), r.next()], a);
});
