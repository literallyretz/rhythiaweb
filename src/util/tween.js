// Godot Tween stand-in for opacity (Control.modulate / CanvasItem.self_modulate alpha) tweens.
// Tween.TransitionType.Quad with the Tween default EaseType (EASE_IN_OUT): Godot's ease-in-out quad.
export const quadInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Like CreateTween().TweenProperty(el, "modulate:a", to, dur).SetTrans(Quad): the start value is read when the tween first steps,
// tweens are not killed by newer ones (every tween keeps writing; the newest is stepped last and wins); resolves when it finishes.
const live = new Set(); let raf = 0;
function step(now) {
  raf = 0;
  for (const tw of [...live]) {
    if (tw.t0 === null) { tw.t0 = now; tw.from = parseFloat(getComputedStyle(tw.el).opacity); }
    const k = tw.dur > 0 ? Math.min(1, (now - tw.t0) / 1000 / tw.dur) : 1;
    tw.el.style.opacity = tw.from + (tw.to - tw.from) * tw.ease(k);
    if (k >= 1) { live.delete(tw); tw.done(); }
  }
  if (live.size) raf = requestAnimationFrame(step);
}
export function tweenOpacity(el, to, dur, ease = quadInOut) {
  return new Promise((done) => { live.add({ el, to, dur, ease, t0: null, from: 0, done }); if (!raf) raf = requestAnimationFrame(step); });
}

// Tween.TransitionType.Quad with the three EaseTypes (TRANS_QUAD formulas in tween_equations.h)
export const quadIn = (t) => t * t;
export const quadOut = (t) => 1 - (1 - t) * (1 - t);
// Generic property tween: fn(easedValue 0..1) every frame, resolves when finished. Starts stepping on the next frame like a Godot Tween.
export function tween(dur, ease, fn) {
  return new Promise((done) => {
    let t0 = null;
    const frame = (now) => {
      if (t0 === null) t0 = now;
      const k = dur > 0 ? Math.min(1, (now - t0) / 1000 / dur) : 1;
      fn(ease(k));
      if (k >= 1) done(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
