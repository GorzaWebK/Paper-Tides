import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landBoard, put } from './helpers.js';
import { floodCandidates, applyTide, protectedKeys, tideSize } from '../src/tide.js';

test('tide sizes grow 3, 4, 5, 6', () => {
  assert.deepEqual([1, 2, 3, 4].map(tideSize), [3, 4, 5, 6]);
});

test('the tide floods the lowest coastal cells first and never inland ones', () => {
  const b = landBoard();
  b.get(3, 0).height = 1;
  b.get(-3, 0).height = 2;
  b.get(0, 0).height = 1; // low but inland: safe
  const f = floodCandidates(b, 2);
  assert.deepEqual(f.map((c) => [c.q, c.r]), [[3, 0], [-3, 0]]);
});

test('lighthouses protect coast within 2 hexes', () => {
  const b = landBoard();
  b.get(3, 0).height = 1;
  b.get(3, -1).height = 1;
  put(b, 2, 0, 'lighthouse');
  const safe = protectedKeys(b);
  assert.ok(safe.has('3,0'));
  assert.ok(safe.has('3,-1'));
  assert.ok(!safe.has('-3,0'));
  const f = floodCandidates(b, 3);
  assert.ok(f.every((c) => !safe.has(`${c.q},${c.r}`)));
});

test('flooded cells become water and report lost tiles', () => {
  const b = landBoard();
  put(b, 3, 0, 'harbour');
  const lost = applyTide(b, [b.get(3, 0), b.get(-3, 0)]);
  assert.deepEqual(lost, [{ q: 3, r: 0, type: 'harbour' }]);
  assert.equal(b.isWater(3, 0), true);
  assert.equal(b.isCoastal(2, 0), true);
});
