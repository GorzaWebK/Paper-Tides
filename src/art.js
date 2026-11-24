// Tile art (first pass: flat colours so the game can be played and tested).
import { corner, dirAngle } from './hex.js';
import { TILES, PALETTE } from './tiles.js';

function hexPath(ctx, S) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const [x, y] = corner(i, S);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function drawPaper(ctx, w, h) {
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, w, h);
}

export function drawSeaCell(ctx, cell, S) {
  hexPath(ctx, S * 1.02);
  ctx.fillStyle = PALETTE.sea;
  ctx.globalAlpha = 0.45;
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawLandCell(ctx, cell, S) {
  hexPath(ctx, S);
  ctx.fillStyle = ['#efe3c2', '#e9dcb5', '#e2d9ae', '#dad6a6', '#d1cf9c'][cell.height - 1] || PALETTE.sand;
  ctx.fill();
  ctx.strokeStyle = PALETTE.ink;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function drawTile(ctx, type, rot, S) {
  hexPath(ctx, S * 0.96);
  ctx.fillStyle = TILES[type].color;
  ctx.fill();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = PALETTE.ink;
  ctx.font = `${S * 0.42}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(TILES[type].name.slice(0, 2), 0, 0);
  if (TILES[type].directional) {
    const a = dirAngle(rot);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * S * 0.45, Math.sin(a) * S * 0.45);
    ctx.lineTo(Math.cos(a) * S * 0.8, Math.sin(a) * S * 0.8);
    ctx.stroke();
  }
}
