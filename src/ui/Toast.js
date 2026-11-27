// Port of ui/ToastNotification.cs + prefabs/notification.tscn: bottom-right toasts, slide in 0.8 s (Quad out), stay 4 s, slide out 0.8 s (Quad in);
// older toasts move up by (new height + 8) in 0.15 s (Quad in-out); each toast's tweens run one after another (queueTween).
import { tween, quadIn, quadOut, quadInOut } from '../util/tween.js';

const MAX_WIDTH = 500;            // maxToastWidth
const COLORS = ['rgb(0,255,0)', 'rgb(255,255,0)', 'rgb(255,0,0)'];
let nextId = 0; const toasts = [];   // [{el, dx, dy, w, h, chain}]
const _m = document.createElement('canvas').getContext('2d');

// calculateMultilineWrap: a word that would pass maxWidth turns the previous trailing " " into "\n"
function wrap(text) {
  _m.font = '400 14px Ubuntu'; const words = text.split(' '), out = []; let line = 0;
  for (const w of words) {
    const ww = _m.measureText(w).width;
    if (line + ww > MAX_WIDTH) { if (out.length) out[out.length - 1] = '\n'; line = 0; }
    line += ww; out.push(w, ' ');
  }
  return out.join('');
}
const place = (t) => { t.el.style.transform = `translate(${t.dx}px, ${t.dy}px)`; };
function queue(t, dur, ease, prop, delta) {              // queueTween: starts after the toast's previous tween; target = position when it starts + delta
  t.chain = t.chain.then(() => { const from = t[prop]; return tween(dur, ease, (k) => { t[prop] = from + delta * k; place(t); }); });
  return t.chain;
}

export async function notify(message, severity = 0, multilineWrap = true, holdMs = 4000) {   // holdMs: port-only, the original always waits 4 s
  const host = document.getElementById('toasts'); if (!host) return;
  const el = document.createElement('div'); el.className = 'toast'; el.id = `NotificationToast_${nextId++}`;
  const bar = document.createElement('div'); bar.className = 'sev'; bar.style.background = COLORS[Math.min(2, Math.max(0, severity))];
  const label = document.createElement('div'); label.className = 'tlabel'; label.textContent = multilineWrap ? wrap(message) : message;
  el.append(bar, label); host.appendChild(el);
  const r = el.getBoundingClientRect(), t = { el, w: r.width, h: r.height, dx: 275, dy: 25, chain: Promise.resolve() };
  t.dy -= t.h + 8;                                         // notification.Position += Up * (Size.Y + 8) (anchored bottom-right, grows up/left)
  place(t);
  for (const o of toasts) queue(o, 0.15, quadInOut, 'dy', -(t.h + 8));
  toasts.push(t);
  queue(t, 0.8, quadOut, 'dx', -(t.w + 8));
  await new Promise((res) => setTimeout(res, holdMs));
  await queue(t, 0.8, quadIn, 'dx', t.w + 8);
  toasts.splice(toasts.indexOf(t), 1); el.remove(); if (!toasts.length) nextId = 0;
}
