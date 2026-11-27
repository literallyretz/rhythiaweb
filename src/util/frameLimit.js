// Lock FPS / FPS (Engine.MaxFps): every requestAnimationFrame loop in the app (game, menu, HUD, panels) goes through one queue, so a cap
// holds the whole frame back like Godot's MaxFps does. A browser can't run faster than the display refresh, so only caps below it apply.
const native = window.requestAnimationFrame.bind(window);
const queue = new Map(); let nextId = 0, pending = false, last = 0;
export const frameLimit = { fps: 0 };   // 0 = uncapped (Engine.MaxFps = 0)
function tick(now) {
  pending = false;
  const iv = frameLimit.fps > 0 ? 1000 / frameLimit.fps : 0;
  if (iv && now - last < iv - 1) { pending = true; native(tick); return; }   // not due yet: wait for the next refresh
  last = iv && now - last < 2 * iv ? last + iv : now;                        // keep the cadence steady instead of drifting
  const cbs = [...queue.values()]; queue.clear();
  for (const cb of cbs) { try { cb(now); } catch (e) { reportError(e); } }
}
window.requestAnimationFrame = (cb) => { const id = ++nextId; queue.set(id, cb); if (!pending) { pending = true; native(tick); } return id; };
window.cancelAnimationFrame = (id) => { queue.delete(id); };
