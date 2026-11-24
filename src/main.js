import './style.css';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { attachMapInput } from './input.js';
import { TILES } from './tiles.js';
import { GOAL_BY_ID } from './goals.js';
import { randomSeed } from './rng.js';

const canvas = document.getElementById('map');
const renderer = new Renderer(canvas);
let game = new Game({ mode: 'standard', seed: randomSeed() });
renderer.resize();
renderer.setInset({ left: 260 });
renderer.setGame(game);

function hud() {
  const $ = (id) => document.getElementById(id);
  $('lb-stats').innerHTML = `<b>${game.name}</b><br>Turn ${Math.min(game.turn, game.maxTurns)} / ${game.maxTurns}<br>Tide in ${game.tideIn === Infinity ? '—' : game.tideIn}<br>Score ${game.score}`;
  $('lb-hand').innerHTML = game.hand.map((t, i) => `<button data-i="${i}" class="${i === game.selected ? 'sel' : ''}">${i + 1}. ${TILES[t].name}</button>`).join('');
  $('lb-goals').innerHTML = game.goals.map((g) => `<div>${g.done ? '☑' : '☐'} ${GOAL_BY_ID[g.id].text} (${Math.min(g.value, GOAL_BY_ID[g.id].target)}/${GOAL_BY_ID[g.id].target})</div>`).join('');
  const p = renderer.hover && renderer.hover.preview;
  $('lb-preview').textContent = p ? (p.ok ? `${TILES[game.selectedType].name}: ${p.delta >= 0 ? '+' : ''}${p.delta} (${p.tile.parts.map(([l, v]) => `${l} ${v}`).join(', ')})` : p.reason) : TILES[game.selectedType].rule;
  if (game.finished) $('lb-stats').innerHTML += '<br><b>Run over!</b>';
}
document.getElementById('lb-hand').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { game.select(+b.dataset.i); refreshHover(); hud(); } });
document.getElementById('btn-rotate').onclick = () => { game.rotate(1); refreshHover(); hud(); };
document.getElementById('btn-undo').onclick = () => { if (game.undo()) { renderer.boardChanged(); refreshHover(); hud(); } };

let hoverHex = null;
function refreshHover() {
  renderer.setHover(hoverHex ? { ...hoverHex, preview: game.preview(hoverHex.q, hoverHex.r) } : null);
}
function place(q, r) {
  const res = game.place(q, r);
  if (!res) return;
  renderer.dropTile(res.q, res.r, res.type, res.rot, res.delta);
  if (res.tide) renderer.floodCells(res.tide.cells, res.tide.points);
  refreshHover();
  hud();
}
attachMapInput(canvas, {
  onHover: (x, y) => { hoverHex = x === null ? null : renderer.hexAt(x, y); refreshHover(); hud(); },
  onTap: (x, y, type) => {
    const h = renderer.hexAt(x, y);
    if (!h) return;
    if (type !== 'mouse' && (!hoverHex || hoverHex.q !== h.q || hoverHex.r !== h.r)) { hoverHex = h; refreshHover(); hud(); return; }
    place(h.q, h.r);
  },
  onPan: (dx, dy) => renderer.pan(dx, dy),
  onZoom: (f, x, y) => renderer.zoomAt(f, x, y),
  onGestureEnd: () => renderer.gestureEnd(),
});
addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '3') game.select(+e.key - 1);
  else if (e.key === 'r' || e.key === 'R') game.rotate(e.shiftKey ? -1 : 1);
  else if (e.key === 'z' || e.key === 'Z') { if (game.undo()) renderer.boardChanged(); }
  else return;
  refreshHover(); hud();
});
addEventListener('resize', () => { renderer.resize(); });
hud();
const loop = (now) => { renderer.render(now); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
window.__game = () => game; window.__r = renderer;
