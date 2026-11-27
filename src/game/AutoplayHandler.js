// Port of scripts/game/AutoplayHandler.cs. Vector2 maths is float32 like Godot's (Math.fround after each operation).
// The C# caches the processed path in user://cache/autoplay/<sha256>.bin; that cache only saves recomputing it and isn't ported:
// the path is computed for every attempt.
import { BOUNDS, HIT_BOX_SIZE } from '../constants.js';

const f = Math.fround;
const MAX_SHIFT_MULTIPLIER = f(0.25);
const hitboxSize = () => f(0.5 + HIT_BOX_SIZE);   // (float)(0.5 + Constants.HIT_BOX_SIZE)
const clampB = (v) => Math.min(Math.max(v, -BOUNDS), BOUNDS);
const note = (x, y, ms) => ({ X: f(x), Y: f(y), Millisecond: ms });   // AutoNote
const samePos = (a, b) => a.X === b.X && a.Y === b.Y;                 // Vector2 ==
const sigmoid = (v) => f(1 / f(1 + f(Math.exp(-v))));

function normalized(x, y) {   // Vector2.Normalized: zero stays zero
  const l = f(Math.sqrt(f(f(x * x) + f(y * y))));
  return l === 0 ? [0, 0] : [f(x / l), f(y / l)];
}

function checkHit(n, cx, cy, size) {
  const dx = Math.abs(f(n.X - cx)), dy = Math.abs(f(n.Y - cy));
  return Math.max(dx, dy) < size;
}

function lowerBound(notes, time) {
  let low = 0, high = notes.length;
  while (low < high) { const mid = low + ((high - low) >> 1); if (notes[mid].Millisecond < time) low = mid + 1; else high = mid; }
  return low;
}

function catmullRomRaw(p0, p1, p2, p3, u, t0, t1, t2, t3) {
  const alpha = f(0.4), tension = -1;
  const t01 = f(Math.pow(Math.max(Math.abs(f(t0 - t1)), 1), alpha));
  const t12 = f(Math.pow(Math.max(Math.abs(f(t1 - t2)), 1), alpha));
  const t23 = f(Math.pow(Math.max(Math.abs(f(t2 - t3)), 1), alpha));
  let m1 = f(f(1 - tension) * f(f(p2 - p1) + f(t12 * f(f(f(p1 - p0) / t01) - f(f(p2 - p0) / f(t01 + t12))))));
  let m2 = f(f(1 - tension) * f(f(p2 - p1) + f(t12 * f(f(f(p3 - p2) / t23) - f(f(p3 - p1) / f(t12 + t23))))));
  if (!Number.isFinite(m1)) m1 = 0;
  if (!Number.isFinite(m2)) m2 = 0;
  const u2 = f(u * u), d = f(p1 - p2);
  return f(f(f(f(f(f(2 * d) + m1) + m2) * u2) * u) + f(f(f(f(f(-3 * d) - m1) - m1) - m2) * u2) + f(m1 * u) + p1);
}

function splinePosition(n0, n1, n2, n3, time) {
  const seg = n2.Millisecond - n1.Millisecond;
  if (seg <= 0) return [n1.X, n1.Y];
  if (samePos(n1, n2)) return [n1.X, n1.Y];
  const u = f(Math.min(Math.max((time - n1.Millisecond) / seg, 0), 1));
  return [catmullRomRaw(n0.X, n1.X, n2.X, n3.X, u, n0.Millisecond, n1.Millisecond, n2.Millisecond, n3.Millisecond),
    catmullRomRaw(n0.Y, n1.Y, n2.Y, n3.Y, u, n0.Millisecond, n1.Millisecond, n2.Millisecond, n3.Millisecond)];
}

function clampShift(x, y, limit) {
  if (x === 0 || y === 0) return [Math.min(Math.max(x, -limit), limit), Math.min(Math.max(y, -limit), limit)];
  let k = f(Math.min(Math.max(x, -limit), limit) / x); x = f(x * k); y = f(y * k);
  k = f(Math.min(Math.max(y, -limit), limit) / y); x = f(x * k); y = f(y * k);
  return [x, y];
}

function cursorFromNotes(data, elapsed) {   // getCursorPositionFromNotes
  if (!data.length) return [0, 0];
  let i = 0;
  while (i + 1 < data.length && !(data[i + 1].Millisecond > elapsed)) i++;
  const p = splinePosition(data[Math.max(i - 1, 0)], data[i], data[Math.min(i + 1, data.length - 1)], data[Math.min(i + 2, data.length - 1)], elapsed);
  return [clampB(p[0]), clampB(p[1])];
}

function mergeSimultaneousNotes(notes) {
  for (let i = 1; i < notes.length; i++) if (notes[i].Millisecond < notes[i - 1].Millisecond) { notes.sort((a, b) => a.Millisecond - b.Millisecond); break; }
  const merged = []; let i = 0;
  while (i < notes.length) {
    const first = notes[i++]; let x = first.X, y = first.Y, count = 1;
    while (i < notes.length && notes[i].Millisecond === first.Millisecond) { x = f(x + notes[i].X); y = f(y + notes[i].Y); i++; count++; }
    merged.push(note(f(x / count), f(y / count), first.Millisecond));
  }
  return merged;
}

export class AutoplayHandler {
  constructor(attempt) {
    this.processed = []; this.lastLoadedNote = 0;
    let notes = attempt.Map.Notes.map((n) => note(n.X, n.Y, n.Millisecond));
    if (!notes.length) return;
    notes = mergeSimultaneousNotes(notes);
    const pre = this.initialPreprocess(notes);
    const secondary = this.compressStacks(pre);
    this.shiftPreprocess(notes, pre, secondary);
  }

  Reset(progress) {
    const p = this.processed, index = lowerBound(p, progress);
    this.lastLoadedNote = index < p.length && p[index].Millisecond === progress ? index : Math.max(0, index - 1);
  }

  GetCursorPosition(progress) {
    const p = this.processed;
    if (!p.length) return { x: 0, y: 0 };
    if (progress < p[this.lastLoadedNote].Millisecond) this.Reset(progress);
    while (this.lastLoadedNote + 1 < p.length && !(p[this.lastLoadedNote + 1].Millisecond > progress)) this.lastLoadedNote++;
    const i = this.lastLoadedNote;
    const pos = splinePosition(p[Math.max(i - 1, 0)], p[i], p[Math.min(i + 1, p.length - 1)], p[Math.min(i + 2, p.length - 1)], progress);
    return { x: clampB(pos[0]), y: clampB(pos[1]) };
  }

  initialPreprocess(notes) {
    const out = []; let i = 0;
    while (i < notes.length) {
      const n = notes[i]; i++;
      const collected = [n];
      while (i < notes.length) {
        const next = notes[i];
        if (Math.abs(next.Millisecond - n.Millisecond) <= 5 && checkHit(n, next.X, next.Y, f(hitboxSize() * f(0.9)))) { collected.push(next); i++; } else break;
      }
      let ax = 0, ay = 0;
      for (const c of collected) { ax = f(ax + c.X); ay = f(ay + c.Y); }
      ax = f(ax / collected.length); ay = f(ay / collected.length);
      if (out.length > 0) {
        const prev = out[out.length - 1];
        const elapsed = f(Math.abs(prev.Millisecond - n.Millisecond) / 1000);
        if (elapsed > 0) {
          const dist = f(Math.sqrt(f(f((ax - prev.X) ** 2) + f((ay - prev.Y) ** 2))));
          const speed = f(dist / f(elapsed * 100));
          const k = f(f(0.8) + f(f(f(sigmoid(f(speed * 5)) - f(0.5)) * 2) * f(0.2)));
          ax = f(ax * k); ay = f(ay * k);
        }
        if (i > 2 && out.length >= 2) {
          const pp = out[out.length - 2];
          const d1 = normalized(f(prev.X - pp.X), f(prev.Y - pp.Y)), d2 = normalized(f(ax - prev.X), f(ay - prev.Y));
          const dot = f(f(d1[0] * d2[0]) + f(d1[1] * d2[1]));
          const k = f(1 + f(Math.max(f(-dot - f(0.5)), 0) * f(1 / f(f(elapsed * 20) + 1))));
          ax = f(ax * k); ay = f(ay * k);
        }
      }
      let nn = note(ax, ay, n.Millisecond);
      const previous = notes[Math.max(i - 2, 0)];
      if (collected.length === 1 && n.X === previous.X && n.Y === previous.Y && out.length > 0) nn = note(out[out.length - 1].X, out[out.length - 1].Y, nn.Millisecond);
      out.push(nn);
    }
    return out;
  }

  compressStacks(notes) {
    const out = [];
    for (let i = 0; i < notes.length; i++) {
      if (i > 0 && i + 1 < notes.length && samePos(notes[i - 1], notes[i]) && samePos(notes[i + 1], notes[i])) continue;
      out.push(notes[i]);
    }
    return out;
  }

  shiftPreprocess(original, pre, sec) {
    const maxRange = f(hitboxSize() * MAX_SHIFT_MULTIPLIER), size = f(hitboxSize() * f(0.9)), out = this.processed;
    for (let i = 0; i + 1 < sec.length; i++) {
      const n0 = sec[Math.max(i - 2, 0)], n1 = sec[Math.max(i - 1, 0)], n2 = sec[i], n3 = sec[i + 1], n4 = sec[Math.min(i + 2, sec.length - 1)];
      if (samePos(n1, n2) || samePos(n2, n3)) { out.push(n2); continue; }
      const pos = splinePosition(n0, n1, n3, n4, n2.Millisecond);
      const [sx, sy] = clampShift(f(pos[0] - n2.X), f(pos[1] - n2.Y), maxRange);
      const shifted = note(f(n2.X + sx), f(n2.Y + sy), n2.Millisecond);
      const validation = [...out.slice(-3), shifted, ...sec.slice(i + 1, i + 4)];
      let valid = true;
      const low = validation[Math.min(2, validation.length - 1)].Millisecond, high = validation[Math.max(0, validation.length - 3)].Millisecond;
      for (let k = lowerBound(original, low); k < original.length; k++) {
        const o = original[k]; if (o.Millisecond > high) break;
        const a = cursorFromNotes(validation, o.Millisecond + 1), b = cursorFromNotes(validation, o.Millisecond + 5);
        if (!(checkHit(o, a[0], a[1], size) || checkHit(o, b[0], b[1], size))) { valid = false; break; }
      }
      out.push(valid ? shifted : n2);
    }
    out.push(pre[pre.length - 1]);
  }
}
