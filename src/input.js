// Pointer input for the map: mouse hover/click, touch tap, one-finger drag to pan,
// two-finger pinch to zoom, and the mouse wheel. Keyboard lives in main.js.

export function attachMapInput(canvas, handlers) {
  const pointers = new Map();
  let start = null; // first pointer's down position
  let moved = false;
  let pinch = null; // { dist, mx, my }
  let wasPinch = false;

  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = pos(e);
    pointers.set(e.pointerId, { x, y, type: e.pointerType });
    if (pointers.size === 1) {
      start = { x, y, type: e.pointerType };
      moved = false;
      wasPinch = false;
    } else if (pointers.size === 2) {
      pinch = pinchState();
      wasPinch = true;
      moved = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e);
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') handlers.onHover?.(x, y, 'mouse');
      return;
    }
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    if (pointers.size === 1 && start) {
      const slop = start.type === 'mouse' ? 5 : 10;
      if (!moved && Math.hypot(x - start.x, y - start.y) > slop) {
        moved = true;
        handlers.onPanStart?.();
        // include the movement so far so the map does not jump
        handlers.onPan?.(x - start.x - dx, y - start.y - dy);
      }
      if (moved) handlers.onPan?.(dx, dy);
      else if (e.pointerType === 'mouse') handlers.onHover?.(x, y, 'mouse');
    } else if (pointers.size === 2 && pinch) {
      const now = pinchState();
      if (pinch.dist > 0) handlers.onZoom?.(now.dist / pinch.dist, now.mx, now.my);
      handlers.onPan?.(now.mx - pinch.mx, now.my - pinch.my);
      pinch = now;
    }
  });

  const end = (e, cancelled) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (!cancelled && !moved && !wasPinch && start) handlers.onTap?.(p.x, p.y, start.type);
      if (moved) handlers.onGestureEnd?.();
      start = null;
      pinch = null;
    } else if (pointers.size === 1) {
      // lifting one finger of a pinch: carry on panning with the other, but never tap
      pinch = null;
      const [rest] = [...pointers.values()];
      start = { x: rest.x, y: rest.y, type: rest.type };
      moved = true;
    }
  };
  canvas.addEventListener('pointerup', (e) => end(e, false));
  canvas.addEventListener('pointercancel', (e) => end(e, true));
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) handlers.onHover?.(null, null, 'mouse');
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      const scale = e.deltaMode === 1 ? 16 : 1;
      handlers.onZoom?.(Math.exp(-e.deltaY * scale * 0.0015), x, y);
      handlers.onGestureEnd?.();
    },
    { passive: false },
  );

  // Safari's own pinch gestures would zoom the whole page.
  for (const ev of ['gesturestart', 'gesturechange']) canvas.addEventListener(ev, (e) => e.preventDefault());
}
