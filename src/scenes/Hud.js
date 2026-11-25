// Gameplay HUD. The original draws these as quads in the 3D scene (game.tscn: Runner/HUD/*) with
// SubViewport textures; here the same quads are placed with CSS 3D transforms using the identical
// transforms and camera FoV, so the layout/perspective matches. Update rules come from
// PanelLeft.cs, PanelRight.cs, HealthBar.cs, ProgressBar.cs, Progress.cs, Title.cs, Combo.cs, Skip.cs, Grid.cs.
import { padMagnitude } from '../util/misc.js';

const ASSET = 'assets/skin/game/';
// Godot Transform3D basis vectors (x axis, y axis, z axis) and origin, copied from scenes/game.tscn
const T = {
  health:   { size: [10.88, 0.8], o: [0, -6.3, -10], b: [[1, 0, 0], [0, 0.965926, 0.258819], [0, -0.258819, 0.965926]] },
  progress: { size: [10.88, 0.8], o: [0, 6.3, -10], b: [[1, 0, 0], [0, 0.965926, -0.258819], [0, 0.258819, 0.965926]] },
  left:     { size: [4, 10], o: [-7.5, 0, -9], b: [[0.984808, 0, 0.173648], [0, 1, 0], [-0.173648, 0, 0.984808]] },
  right:    { size: [4, 10], o: [7.5, 0, -9], b: [[0.984808, 0, -0.173648], [0, 1, 0], [0.173648, 0, 0.984808]] },
  title:    { o: [0, 8.25, -10], b: [[2, 0, 0], [0, 1.93185, 0.517638 * -1], [0, 0.517638, 1.93185]] },
  progLbl:  { o: [0, 7, -10], b: [[3.5, 0, 0], [0, 3.38074, -0.905867], [0, 0.905867, 3.38074]] },
  combo:    { o: [0, 3.5, -10], b: [[7, 0, 0], [0, 6.89365, -1.21554], [0, 1.21554, 6.89365]] },
  speed:    { o: [0, -7.5, -10], b: [[7, 0, 0], [0, 6.76148, 1.81173], [0, -1.81173, 6.76148]] },
  skip:     { o: [0, -5, -10], b: [[7, 0, 0], [0, 6.76148, 1.81173], [0, -1.81173, 6.76148]] },
};
// Text is rasterised into canvases (like Godot's SubViewport textures / Label3D glyph atlases) at the original pixel size,
// then the canvas is mapped onto the 3D quad. Control Label height = font ascent + descent; glyph baseline = top + ascent.
const _m = document.createElement('canvas').getContext('2d');
const lineMetrics = (font) => { _m.font = font; const m = _m.measureText('Hg'); return { asc: Math.round(m.fontBoundingBoxAscent), desc: Math.round(m.fontBoundingBoxDescent) }; };
const drawLine = (g, text, font, fill, x, cy, align, stroke) => { // (x, cy): anchor x per alignment, vertical centre of the line box
  const { asc, desc } = lineMetrics(font); g.font = font; g.textBaseline = 'alphabetic'; g.textAlign = align;
  const by = cy - (asc + desc) / 2 + asc;
  if (stroke) { g.lineWidth = stroke.w * 2; g.lineJoin = 'round'; g.strokeStyle = stroke.color; g.strokeText(text, x, by); } // FT_Glyph_Stroke: centred stroke, radius = outline_size
  if (fill) { g.fillStyle = fill; g.fillText(text, x, by); }
};
const lerp = (a, b, t) => a + (b - a) * t;
const formatTime = (sec) => { const neg = sec < 0; const m = Math.floor(Math.abs(sec) / 60), s = Math.floor(Math.abs(sec) % 60); return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}`; };

export class Hud {
  constructor(root, persp, canvas) {
    this.root = root; this.persp = persp; this.canvas = canvas;
    this.build();
  }
  el(cls, parent = this.root, tag = 'div') { const e = document.createElement(tag); e.className = cls; parent.appendChild(e); return e; }

  build() {
    this.root.innerHTML = '';
    // Health / ProgressBar: SubViewport 544x40 with size_2d_override 1088x80 -> drawn at half resolution, then stretched onto the quad
    const bar = () => { const c = document.createElement('canvas'); c.width = 544; c.height = 40; c.className = 'h3'; c.style.cssText = 'width:1088px;height:80px'; this.root.appendChild(c); return c; };
    this.healthEl = bar(); this.progEl = bar();
    this.barImgs = {}; for (const n of ['health', 'health_background', 'progress', 'progress_background']) { const i = new Image(); i.src = `${ASSET}${n}.png`; this.barImgs[n] = i; }
    this.healthW = -1; this.progW = -1; this.healthDim = false;
    // PanelLeft / PanelRight: 250x625 SubViewports drawn into canvases
    this.imgs = {}; for (const n of ['panel_left_background', 'panel_right_background', 'hits', 'misses']) { const i = new Image(); i.src = `${ASSET}${n}.png`; this.imgs[n] = i; }
    const mk = () => { const c = this.el('h3'); c.style.cssText = 'width:250px;height:625px'; c.innerHTML = '<canvas width="250" height="625" style="position:absolute;left:0;top:0"></canvas>'; c._c = c.firstChild; return c; };
    this.leftEl = mk(); this.rightEl = mk();
    this.ring = document.createElement('canvas'); this.ring.width = this.ring.height = 256;
    this.txt = { score: '0', mult: '1x', acc: '100.00%', hits: '0', miss: '0', sum: '0' };
    this.dirty = true;
    // Label3Ds
    this.titleEl = this.world('700 64px Nunito', '#fff'); this.progLbl = this.world('600 64px Nunito', 'rgba(255,255,255,0.745)');
    this.comboEl = this.world('500 64px Ubuntu', null, { w: 4, color: 'rgba(255,255,255,0.392)' });   // modulate alpha 0, outline_size 4, outline alpha .392
    this.speedEl = this.world('600 32px Nunito', '#fff'); this.skipEl = this.world('600 32px Nunito', '#fff'); this.skipEl.style.opacity = 0;
    this.popupLayer = this.el('h3'); this.popupLayer.style.cssText = 'width:0;height:0;transform-style:preserve-3d';
    this.hitPopups = 0; this.missPopups = 0;
  }
  world(font, fill, stroke) { // Label3D: centred text, canvas at font px size; world scale applied in layout()
    const e = this.el('h3'), c = document.createElement('canvas'); c.style.position = 'absolute'; e.appendChild(c);
    e.setText = (t) => {
      t = String(t); if (e._t === t) return; e._t = t;
      const { asc, desc } = lineMetrics(font), pad = 12; _m.font = font;
      const w = Math.ceil(_m.measureText(t).width) + pad * 2, h = asc + desc + pad * 2;
      c.width = w; c.height = h; c.style.width = `${w}px`; c.style.height = `${h}px`; c.style.left = `${-w / 2}px`; c.style.top = `${-h / 2}px`;
      drawLine(c.getContext('2d'), t, font, fill, w / 2, h / 2, 'center', stroke);
    };
    return e;
  }
  drawBar(c, name, w, key, dim) { // Main: TextureRect, stretch_mode tile, clipped to its size; Background: full 1088x80
    const iw = Math.trunc(w); if (iw === this[key] || !this.barImgs[name].complete) return; this[key] = iw;
    const g = c.getContext('2d'); g.clearRect(0, 0, 544, 40); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.globalAlpha = dim ? 0.502 : 1;
    g.drawImage(this.barImgs[name + '_background'], 0, 0, 544, 40);
    for (let x = 0; x < w; x += 1088) { const sw = Math.min(1088, w - x); if (sw > 0) g.drawImage(this.barImgs[name], 0, 0, sw, 80, x / 2, 0, sw / 2, 40); }
    g.globalAlpha = 1;
  }
  drawPanels() {
    const t = this.txt, F = (w, px) => `${w} ${px}px Nunito`;
    let g = this.leftEl._c.getContext('2d'); g.clearRect(0, 0, 250, 625); g.drawImage(this.imgs.panel_left_background, 0, 0, 250, 625);
    g.drawImage(this.ring, 125 - 128, 625 * 0.65 - 128);
    drawLine(g, t.score, F(700, 50), '#fff', 125, 625 * 0.35, 'center'); drawLine(g, t.mult, F(600, 50), '#fff', 125, 625 * 0.65, 'center');
    g = this.rightEl._c.getContext('2d'); g.clearRect(0, 0, 250, 625); g.drawImage(this.imgs.panel_right_background, 0, 0, 250, 625);
    drawLine(g, t.acc, F(700, 50), '#fff', 125, 625 * 0.35, 'center');
    const y0 = 625 * 0.625;
    drawLine(g, t.hits, F(600, 30), `rgba(255,255,255,${this.hitOp})`, 125 - 25, y0 - 2, 'right');    // offset_bottom -4 with grow both: centre at y0 - 2
    drawLine(g, t.miss, F(600, 30), `rgba(255,255,255,${this.missOp})`, 125 + 25, y0 - 2, 'left');
    g.drawImage(this.imgs.hits, 125 - 2 - 19, y0 - 12, 19, 19); g.drawImage(this.imgs.misses, 125 + 2, y0 - 12, 19, 19);
    drawLine(g, t.sum, F(600, 50), '#fff', 125, 625 * 0.7, 'center');
    const lg = g.createLinearGradient(16, 0, 234, 0);   // alpha_gradient.gdshader: alpha = (0.5 - |u - 0.5|) * 3 / 1.5
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(16, 625 * 0.65, 218, 2);
    this.dirty = false;
  }

  init(attempt, runner) {
    this.attempt = attempt; this.runner = runner;
    this.titleEl.setText(attempt.Map.PrettyTitle);
    this.speedEl.setText(`${attempt.Speed.toFixed(2)}x`); this.speedEl.style.opacity = attempt.Speed === 1 ? 0 : 100 / 255;   // Speed.cs: alpha 0 at 1x, else 100/255
    this.skipEl.setText('Press Space to skip');
    this.cur = { health: 32 + 100 * 10.24, prog: 0, ringP: 0, ringC: [1, 1, 1] };
    this.tgt = { health: 32 + attempt.Health * 10.24, ringP: 0, ringC: [1, 1, 1] };
    this.hitOp = 0.627451; this.missOp = 0.627451; this.skipShown = false; this.skipT = 0; this.healthDim = false; this.healthW = this.progW = -1; this._last = null; this.lastProg = -1;
    this.popupLayer.innerHTML = ''; this.hitPopups = this.missPopups = 0;
    this.onStats(attempt);
    runner.on('attemptStatsUpdated', (a) => this.onStats(a));
    runner.on('hitResultChanged', (i, r) => this.onHit(i, r));
    runner.on('skipAvailable', (a) => { this.skipEl.setText(this.runner.ObjectIndicesStart.Note >= a.Map.Notes.length ? 'Press Space to complete' : 'Press Space to skip'); if (!this.skipShown) { this.skipShown = true; this.skipT = 0; } });
    this.layout();
  }

  // --- placement ---------------------------------------------------------------------------
  matrix(b) { // Godot basis (world, y up) -> CSS matrix3d (y down). columns: i'=X, j'=-Y, k'=Z
    const f = (v) => [v[0], -v[1], v[2]];
    const X = f(b[0]), Y = f(b[1]), Z = f(b[2]);
    return `matrix3d(${X[0]},${X[1]},${X[2]},0, ${-Y[0]},${-Y[1]},${-Y[2]},0, ${Z[0]},${Z[1]},${Z[2]},0, 0,0,0,1)`;
  }
  place(el, t, w, h, k, scaleBox) {
    // el is centred on the container origin; translate to world pos, orient, scale from px box to world units
    el.style.marginLeft = `${-w / 2}px`; el.style.marginTop = `${-h / 2}px`;
    const s = scaleBox ? (k * t.size[0]) / w : k; // quads: box -> world size; labels: 1 CSS px = 1 world unit of font px * pixel size
    el.style.transform = `translate3d(${t.o[0] * k}px,${-t.o[1] * k}px,${t.o[2] * k}px) ${this.matrix(t.b)} scale(${s})`;
  }
  layout() {
    const H = this.canvas.clientHeight || window.innerHeight, fov = this.attempt.Settings.FoV;
    const D = (H / 2) / Math.tan(fov * Math.PI / 360);   // CSS perspective distance (px) matching the WebGL projection
    const k = D / 3.75;                                  // px per world unit at the grid plane (camera z = 3.75)
    this.k = k; this.persp.style.setProperty('--D', `${D}px`);
    this.place(this.healthEl, T.health, 1088, 80, k, true);
    this.place(this.progEl, T.progress, 1088, 80, k, true);
    this.place(this.leftEl, T.left, 250, 625, k, true);
    this.place(this.rightEl, T.right, 250, 625, k, true);
    // Label3D: world size = font_px * pixel_size * node scale. default pixel_size 0.005, progress/combo/speed/skip use 0.0025
    const lab = (el, t, px) => { el.style.cssText += ';width:0;height:0'; el.style.transform = `translate3d(${t.o[0] * k}px,${-t.o[1] * k}px,${t.o[2] * k}px) ${this.matrix(t.b)} scale(${px * k})`; };
    lab(this.titleEl, T.title, 0.005); lab(this.progLbl, T.progLbl, 0.0025); lab(this.comboEl, T.combo, 0.0025);
    lab(this.speedEl, T.speed, 0.0025); lab(this.skipEl, T.skip, 0.0025);
    this.popupLayer.style.transform = `scale(${k / 100})`; // popup children use 100 px per world unit
  }
  setCamera(cx, cy) { // camera parallax: the world shifts opposite to the camera
    this.root.style.transform = `translate3d(${-cx * this.k}px,${cy * this.k}px,0)`;
  }

  // --- updates -----------------------------------------------------------------------------
  onStats(a) {
    this.txt.score = padMagnitude(a.Score); this.dirty = true;                    // PanelLeft: PadMagnitude(Score)
    this.txt.mult = `${a.ComboMultiplier}x`;
    this.tgt.ringP = a.ComboMultiplierProgress / a.ComboMultiplierIncrement;
    this.tgt.ringC = a.ComboMultiplier === 8 ? [1, 140 / 255, 0] : [1, 1, 1];
    this.txt.acc = `${a.Hits + a.Misses === 0 ? '100.00' : a.Accuracy.toFixed(2)}%`;   // PanelRight
    this.txt.hits = String(a.Hits); this.txt.miss = String(a.Misses); this.txt.sum = padMagnitude(a.Sum);
    this.comboEl.setText(a.Combo);                              // Combo.cs
    this.tgt.health = 32 + a.Health * 10.24;                            // HealthBar.cs
    if (!a.IsReplay && a.Health <= 0 && !this.healthDim) { this.healthDim = true; this.healthW = -1; }   // HealthBar.cs: Main + Background modulate 0xffffff80
  }
  onHit(noteIndex, result) {
    const a = this.attempt, n = a.Map.Notes[noteIndex], s = a.Settings;
    if (result === 1) { this.hitOp = 1; this.dirty = true; if (s.HitPopups && this.hitPopups < 64) this.popup(n.X, String(this.runner.lastHitScore), true); }
    else if (result === 2) { this.missOp = 1; this.dirty = true; if (s.MissPopups && this.missPopups < 64) this.popup(n.X, null, false); }
  }
  popup(x, text, hit) { // Grid.cs spawnHitIcon/spawnMissIcon at (note.X, -1.4, 0); transparency 0->1 (linear) + rise 0.25 units (quint out), 0.25 s
    const e = document.createElement('div'); e.className = 'popup';
    let a0 = 1;
    if (hit) { // prefabs/hit_popup.tscn: Label3D Roboto-Medium, font_size 32, pixel_size 0.005, modulate alpha 0.47
      a0 = 0.47058824; const f = '500 32px Roboto', c = document.createElement('canvas'), { asc, desc } = lineMetrics(f); _m.font = f;
      const w = Math.ceil(_m.measureText(text).width) + 24, h = asc + desc + 24; c.width = w; c.height = h; drawLine(c.getContext('2d'), text, f, '#fff', w / 2, h / 2, 'center');
      c.style.cssText = `display:block;width:${w}px;height:${h}px;transform:scale(.5);transform-origin:0 0`; e.style.width = `${w / 2}px`; e.style.height = `${h / 2}px`; e.appendChild(c);
      e.dataset.w = w / 2; e.dataset.h = h / 2; this.hitPopups++;
    } else { // prefabs/miss_icon.tscn: Sprite3D scale 0.025, pixel_size 0.01, 512 px texture -> 0.128 units
      const i = document.createElement('img'); i.src = `${ASSET}miss_feedback.png`; i.style.cssText = 'display:block;width:12.8px;height:12.8px'; e.appendChild(i);
      e.dataset.w = 12.8; e.dataset.h = 12.8; this.missPopups++;
    }
    const tx = `translate3d(${x * 100 - e.dataset.w / 2}px,${140 - e.dataset.h / 2}px,0)`, tx2 = `translate3d(${x * 100 - e.dataset.w / 2}px,${115 - e.dataset.h / 2}px,0)`;
    e.style.transform = tx; this.popupLayer.appendChild(e);
    e.animate([{ opacity: a0 }, { opacity: 0 }], { duration: 250, easing: 'linear', fill: 'forwards' });
    e.animate([{ transform: tx }, { transform: tx2 }], { duration: 250, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).onfinish = () => { e.remove(); hit ? this.hitPopups-- : this.missPopups--; };
  }
  // _PhysicsProcess equivalents (120 Hz): HealthBar lerp, PanelLeft ring lerp, PanelRight opacity decay
  physics(dt) {
    const a = this.attempt, c = this.cur, t = this.tgt;
    c.health = lerp(c.health, t.health, Math.min(1, dt * Math.min(Math.max(a.Settings.HPLerpValue, 10), 100)));
    c.ringP = lerp(c.ringP, t.ringP, Math.min(1, dt * 16));
    for (let i = 0; i < 3; i++) c.ringC[i] = lerp(c.ringC[i], t.ringC[i], dt * 2);
    const mv = (v, to, d) => (v > to ? Math.max(to, v - d) : v);
    if (this.hitOp > 0.62) { this.hitOp = mv(this.hitOp, 0.62, dt * 1.5); this.dirty = true; }
    if (this.missOp > 0.62) { this.missOp = mv(this.missOp, 0.62, dt * 1.5); this.dirty = true; }
  }
  // HudManager._Process: runs every frame
  frame(progress) {
    const a = this.attempt;
    this.drawBar(this.healthEl, 'health', this.cur.health, 'healthW', this.healthDim);
    this.drawBar(this.progEl, 'progress', Math.max(0, 32 + (a.Progress / a.Length) * 1024), 'progW', false);   // ProgressBar.cs
    this.progLbl.setText(`${formatTime(Math.max(0, a.Progress) / 1000)} / ${formatTime(a.Length / 1000)}`);      // Progress.cs
    if (this.drawRing()) this.dirty = true;
    if (this.dirty && this.imgs.hits.complete) this.drawPanels();
    // Skip.cs: looping sine tween (in-out) alpha 0 -> .25 -> .75, then .75 <-> .25 every 0.75 s; killed with alpha 0 once CanSkip is false
    const now = performance.now(), dt = this._last == null ? 0 : (now - this._last) / 1000; this._last = now;
    if (!a.CanSkip) { this.skipShown = false; this.skipEl.style.opacity = 0; }
    else if (this.skipShown) {
      this.skipT += dt; const t = this.skipT, ease = (x) => (1 - Math.cos(Math.PI * x)) / 2, mix = (p, q, x) => p + (q - p) * ease(x);
      let v; if (t < 0.75) v = mix(0, 0.25, t / 0.75); else if (t < 1.5) v = mix(0.25, 0.75, (t - 0.75) / 0.75);
      else { const u = (t - 1.5) % 1.5; v = u < 0.75 ? mix(0.75, 0.25, u / 0.75) : mix(0.25, 0.75, (u - 0.75) / 0.75); }
      this.skipEl.style.opacity = v;
    }
  }
  drawRing() { // combo_progress.gdshader: n-gon outline, filled clockwise from the top up to `progress`
    const g = this.ring.getContext('2d'), n = Math.min(Math.max(this.attempt.ComboMultiplierIncrement, 3), 32);
    const key = `${n}|${this.cur.ringP.toFixed(3)}|${this.cur.ringC.map((v) => v.toFixed(2))}`; if (key === this._ringKey) return false; this._ringKey = key;
    g.clearRect(0, 0, 256, 256);
    const pts = []; for (let i = 0; i < n; i++) { const ang = (i / n) * Math.PI * 2; pts.push([128 + Math.sin(ang) * 64, 128 - Math.cos(ang) * 64]); }
    const path = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
    g.lineWidth = 6; g.lineJoin = 'miter'; // shader: thickness 3 px each side of the edge
    g.strokeStyle = 'rgb(40,40,40)'; path(); g.stroke();
    g.save(); g.beginPath(); g.moveTo(128, 128); g.arc(128, 128, 200, -Math.PI / 2, -Math.PI / 2 + this.cur.ringP * Math.PI * 2); g.closePath(); g.clip();
    g.strokeStyle = `rgb(${this.cur.ringC.map((v) => Math.round(v * 255)).join(',')})`; path(); g.stroke(); g.restore();
    return true;
  }
  destroy() { this.root.innerHTML = ''; }
}
