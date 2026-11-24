import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landBoard, put, water } from './helpers.js';
import { scoreCell, scoreBoard, canPlace, previewPlacement } from '../src/scoring.js';

// Directions: 0 E (1,0), 1 NE (1,-1), 2 NW (0,-1), 3 W (-1,0), 4 SW (-1,1), 5 SE (0,1)

test('meadow scores 1, +1 by the sea', () => {
  const b = landBoard();
  assert.equal(scoreCell(b, put(b, 0, 0, 'meadow')).points, 1);
  assert.equal(scoreCell(b, put(b, 3, 0, 'meadow')).points, 2); // on the coast of the radius-3 island
});

test('forest scores 1 + 1 per adjacent forest', () => {
  const b = landBoard();
  put(b, 0, 0, 'forest');
  put(b, 1, 0, 'forest');
  put(b, 0, 1, 'forest');
  assert.equal(scoreCell(b, b.get(0, 0)).points, 3);
  assert.equal(scoreCell(b, b.get(1, 0)).points, 3); // (1,0) and (0,1) are neighbours too
  assert.equal(scoreBoard(b), 9);
});

test('field is a flat 2 and a windmill earns 2 per adjacent field', () => {
  const b = landBoard();
  const mill = put(b, 0, 0, 'windmill');
  assert.equal(scoreCell(b, mill).points, 0);
  put(b, 1, 0, 'field');
  put(b, -1, 0, 'field');
  put(b, 0, 1, 'field');
  put(b, 2, 0, 'field'); // not adjacent to the mill
  assert.equal(scoreCell(b, mill).points, 6);
  assert.equal(scoreCell(b, b.get(2, 0)).points, 2);
});

test('cottage likes meadows (+1) and markets (+2), door facing one of them +1', () => {
  const b = landBoard();
  const cot = put(b, 0, 0, 'cottage', 0); // door faces east (1,0)
  put(b, -1, 0, 'meadow');
  put(b, 0, -1, 'meadow');
  assert.equal(scoreCell(b, cot).points, 1 + 2);
  put(b, 1, 0, 'market');
  assert.equal(scoreCell(b, cot).points, 1 + 2 + 2 + 1);
  cot.tile.rot = 3; // door faces west, onto a meadow: still +1
  assert.equal(scoreCell(b, cot).points, 6);
  cot.tile.rot = 5; // faces SE (0,1), empty
  assert.equal(scoreCell(b, cot).points, 5);
});

test('harbour must touch water; pier facing water +2; +1 per cottage or market', () => {
  const b = landBoard();
  assert.equal(canPlace(b, 0, 0, 'harbour').ok, false);
  assert.equal(canPlace(b, 3, 0, 'harbour').ok, true);
  const h = put(b, 3, 0, 'harbour', 0); // (4,0) is water
  assert.equal(scoreCell(b, h).points, 2 + 2);
  h.tile.rot = 3; // pier faces inland
  assert.equal(scoreCell(b, h).points, 2);
  put(b, 2, 0, 'cottage');
  put(b, 2, 1, 'market');
  assert.equal(scoreCell(b, h).points, 4);
});

test('lighthouse: 1 + water sides (max 3), lamp facing water +1', () => {
  const b = landBoard();
  const l = put(b, 3, 0, 'lighthouse', 0); // corner of the hex island: (4,0), (4,-1), (3,1) are water
  assert.equal(b.waterSides(3, 0), 3);
  assert.equal(scoreCell(b, l).points, 1 + 3 + 1);
  l.tile.rot = 3;
  assert.equal(scoreCell(b, l).points, 4);
});

test('market scores 1 per different kind of neighbour; awning facing a cottage +1', () => {
  const b = landBoard();
  const m = put(b, 0, 0, 'market', 0);
  put(b, 1, 0, 'cottage');
  put(b, -1, 0, 'cottage');
  put(b, 0, 1, 'meadow');
  put(b, 0, -1, 'forest');
  assert.equal(scoreCell(b, m).points, 3 + 1);
});

test('preview gives the change in the whole island score, including neighbours', () => {
  const b = landBoard();
  put(b, 0, 0, 'cottage', 0);
  const p = previewPlacement(b, 1, 0, 'meadow', 0);
  assert.equal(p.ok, true);
  assert.equal(p.tile.points, 1);
  assert.equal(p.neighbours, 2); // cottage +1 meadow, +1 door faces meadow
  assert.equal(p.delta, 3);
  // the board itself is unchanged
  assert.equal(b.get(1, 0).tile, null);
});

test('cannot build on water or on a built tile; zen can reclaim shallow water', () => {
  const b = landBoard();
  put(b, 0, 0, 'meadow');
  assert.equal(canPlace(b, 0, 0, 'forest').ok, false);
  assert.equal(canPlace(b, 4, 0, 'forest').ok, false);
  assert.equal(canPlace(b, 4, 0, 'forest', { reclaim: true }).ok, true);
  assert.equal(canPlace(b, 5, 0, 'forest', { reclaim: true }).ok, false); // not touching land
  water(b, 1, 1);
});
