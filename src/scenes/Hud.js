// Gameplay HUD. The original draws these as quads in the 3D scene (game.tscn: Runner/HUD/*) with
// SubViewport textures and Label3Ds; here the same quads are drawn by GameRenderer in the same 3D scene
// (same camera, linear blending, depth test, alpha sorting). Hud only produces the textures. Update rules come from
// PanelLeft.cs, PanelRight.cs, HealthBar.cs, ProgressBar.cs, Progress.cs, Title.cs, Combo.cs, Skip.cs, Grid.cs.
import { padMagnitude } from '../util/misc.js';
import { ComboRing } from '../render/ComboRing.js';

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
// HUD canvases are uploaded to GL textures every time they change: keep them CPU-backed so the upload doesn't stall on a GPU readback (same pixels)
const SW = { willReadFrequently: true };
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
    const bar = () => { const c = document.createElement('canvas'); c.width = 544; c.height = 40; return c; };
    this.healthEl = bar(); this.progEl = bar();
    this.barImgs = {}; for (const n of ['health', 'health_background', 'progress', 'progress_background']) { const i = new Image(); i.src = `${ASSET}${n}.png`; this.barImgs[n] = i; }
    this.healthW = -1; this.progW = -1; this.healthDim = false;
    // PanelLeft / PanelRight: 250x625 SubViewports drawn into canvases
    this.imgs = {}; for (const n of ['panel_left_background', 'panel_right_background', 'hits', 'misses']) { const i = new Image(); i.src = `${ASSET}${n}.png`; this.imgs[n] = i; }
    const mk = () => { const c = document.createElement('canvas'); c.width = 250; c.height = 625; return { _c: c }; };
    this.leftEl = mk(); this.rightEl = mk();
    this.ring = new ComboRing();
    this.txt = { score: '0', mult: '1x', acc: '100.00%', hits: '0', miss: '0', sum: '0' };
    this.dirty = true;
    // Label3Ds
    this.titleEl = this.world('700 64px Nunito', '#fff'); this.progLbl = this.world('600 64px Nunito', 'rgba(255,255,255,0.745)');
    this.comboEl = this.world('500 64px Ubuntu', null, { w: 4, color: 'rgba(255,255,255,0.392)' });   // modulate alpha 0, outline_size 4, outline alpha .392
    this.speedEl = this.world('600 32px Nunito', '#fff'); this.skipEl = this.world('600 32px Nunito', '#fff'); this.skipEl.alpha = 0;
    this.titleEl.alpha = 1; this.progLbl.alpha = 1; this.comboEl.alpha = 1; this.speedEl.alpha = 1;
    this.missImg = new Image(); this.missImg.src = `${ASSET}miss_feedback.png`;
    this.popups = []; this.hitPopups = 0; this.missPopups = 0;
    this.ver = { health: 0, prog: 0, left: 0, right: 0 };
  }
  world(font, fill, stroke) { // Label3D: centred text, canvas at font px size; world scale applied in layout()
    const c = document.createElement('canvas'), e = { canvas: c, ver: 0, alpha: 1 };
    e.setText = (t) => {
      t = String(t); if (e._t === t) return; e._t = t;
      const { asc, desc } = lineMetrics(font), pad = 12; _m.font = font;
      const w = Math.ceil(_m.measureText(t).width) + pad * 2, h = asc + desc + pad * 2;
      c.width = w; c.height = h; e.ver++;
      drawLine(c.getContext('2d', SW), t, font, fill, w / 2, h / 2, 'center', stroke);
    };
    return e;
  }
  drawBar(c, name, w, key, dim) { // Main: TextureRect, stretch_mode tile, clipped to its size; Background: full 1088x80
    const iw = Math.trunc(w); if (iw === this[key] || !this.barImgs[name].complete) return; this[key] = iw;
    const g = c.getContext('2d', SW); g.clearRect(0, 0, 544, 40); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.globalAlpha = dim ? 0.502 : 1;
    g.drawImage(this.barImgs[name + '_background'], 0, 0, 544, 40);
    for (let x = 0; x < w; x += 1088) { const sw = Math.min(1088, w - x); if (sw > 0) g.drawImage(this.barImgs[name], 0, 0, sw, 80, x / 2, 0, sw / 2, 40); }
    g.globalAlpha = 1; this.ver[key === 'healthW' ? 'health' : 'prog']++;
  }
  drawPanels() {
    const t = this.txt, F = (w, px) => `${w} ${px}px Nunito`;
    let g = this.leftEl._c.getContext('2d', SW); g.clearRect(0, 0, 250, 625); g.drawImage(this.imgs.panel_left_background, 0, 0, 250, 625);
    g.drawImage(this.ring.canvas, 0, 0);   // MultiplierProgress Panel output, already at its place in the viewport
    drawLine(g, t.score, F(700, 50), '#fff', 125, 625 * 0.35, 'center'); drawLine(g, t.mult, F(600, 50), '#fff', 125, 625 * 0.65, 'center');
    g = this.rightEl._c.getContext('2d', SW); g.clearRect(0, 0, 250, 625); g.drawImage(this.imgs.panel_right_background, 0, 0, 250, 625);
    drawLine(g, t.acc, F(700, 50), '#fff', 125, 625 * 0.35, 'center');
    const y0 = 625 * 0.625;
    drawLine(g, t.hits, F(600, 30), `rgba(255,255,255,${this.hitOp})`, 125 - 25, y0 - 2, 'right');    // offset_bottom -4 with grow both: centre at y0 - 2
    drawLine(g, t.miss, F(600, 30), `rgba(255,255,255,${this.missOp})`, 125 + 25, y0 - 2, 'left');
    g.drawImage(this.imgs.hits, 125 - 2 - 19, y0 - 12, 19, 19); g.drawImage(this.imgs.misses, 125 + 2, y0 - 12, 19, 19);
    drawLine(g, t.sum, F(600, 50), '#fff', 125, 625 * 0.7, 'center');
    const lg = g.createLinearGradient(16, 0, 234, 0);   // alpha_gradient.gdshader: alpha = (0.5 - |u - 0.5|) * 3 / 1.5
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(16, 625 * 0.65, 218, 2);
    this.dirty = false; this.ver.left++; this.ver.right++;
  }

  init(attempt, runner) {
    this.attempt = attempt; this.runner = runner;
    this.titleEl.setText(attempt.Map.PrettyTitle);
    this.speedEl.setText(`${attempt.Speed.toFixed(2)}x`); this.speedEl.alpha = attempt.Speed === 1 ? 0 : 100 / 255;   // Speed.cs: alpha 0 at 1x, else 100/255
    this.skipEl.setText('Press Space to skip');
    this.cur = { health: 32 + 100 * 10.24, prog: 0, ringP: 0, ringC: [1, 1, 1] };
    this.tgt = { health: 32 + attempt.Health * 10.24, ringP: 0, ringC: [1, 1, 1] };
    this.hitOp = 0.627451; this.missOp = 0.627451; this.skipShown = false; this.skipT = 0; this.healthDim = false; this.healthW = this.progW = -1; this._last = null; this.lastProg = -1;
    this.popups = []; this.hitPopups = this.missPopups = 0; this._ringKey = null;
    this.onStats(attempt);
    runner.on('attemptStatsUpdated', (a) => this.onStats(a));
    runner.on('hitResultChanged', (i, r) => this.onHit(i, r));
    runner.on('skipAvailable', (a) => { this.skipEl.setText(this.runner.ObjectIndicesStart.Note >= a.Map.Notes.length ? 'Press Space to complete' : 'Press Space to skip'); if (!this.skipShown) { this.skipShown = true; this.skipT = 0; } });
  }

  // --- 3D items for GameRenderer --------------------------------------------------------------
  // Each item: texture source + version, Transform3D (basis columns incl. scale, origin), quad size in local units,
  // material alpha, cull (StandardMaterial3D back-face cull; Label3D/Sprite3D double-sided), render priority, mipmaps.
  // Label3D size = texture px * pixel_size (default 0.005; progress/combo/speed/skip/... use 0.0025).
  items() {
    const it = [];
    const quad = (src, ver, t, w, h, alpha = 1) => it.push({ src, ver, o: t.o, b: t.b, w, h, alpha, cull: true, priority: 0, mips: false });
    const lab = (e, t, px, priority = 0) => { if (e.canvas.width) it.push({ src: e.canvas, ver: e.ver, o: t.o, b: t.b, w: e.canvas.width * px, h: e.canvas.height * px, alpha: e.alpha, cull: false, priority, mips: false }); };
    quad(this.healthEl, this.ver.health, T.health, 10.88, 0.8); quad(this.progEl, this.ver.prog, T.progress, 10.88, 0.8);
    quad(this.leftEl._c, this.ver.left, T.left, 4, 10); quad(this.rightEl._c, this.ver.right, T.right, 4, 10);
    lab(this.titleEl, T.title, 0.005); lab(this.progLbl, T.progLbl, 0.0025);
    lab(this.comboEl, T.combo, 0.0025, -1);   // only its outline is visible (modulate alpha 0): outline_render_priority -1
    lab(this.speedEl, T.speed, 0.0025); lab(this.skipEl, T.skip, 0.0025);
    const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const p of this.popups) {
      if (p.hit) it.push({ src: p.canvas, ver: 1, o: [p.x, p.y, 0], b: I, w: p.canvas.width * 0.005, h: p.canvas.height * 0.005, alpha: p.alpha, cull: false, priority: 0, mips: false });
      else if (this.missImg.complete) it.push({ src: this.missImg, ver: 1, o: [p.x, p.y, 0], b: [[0.025, 0, 0], [0, 0.025, 0], [0, 0, 0.025]], w: 512 * 0.01, h: 512 * 0.01, alpha: p.alpha, cull: false, priority: 0, mips: true });
    }
    return it;
  }
  layout() {}
  setCamera() {}   // the renderer's camera moves; the HUD stays fixed in world space as in the original

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
  popup(x, text, hit) { // Grid.cs spawnHitIcon/spawnMissIcon at (note.X, -1.4, 0); tween: transparency 0->1 (linear) || position +Up/4 (Quint, Out), 0.25 s
    const p = { x, y: -1.4, t: 0, hit, alpha: 0 };
    if (hit) { // prefabs/hit_popup.tscn: Label3D Roboto-Medium, font_size 32 (default), pixel_size 0.005, modulate alpha 0.47058824
      p.a0 = 0.47058824; const f = '500 32px Roboto', c = document.createElement('canvas'), { asc, desc } = lineMetrics(f); _m.font = f;
      c.width = Math.ceil(_m.measureText(text).width) + 24; c.height = asc + desc + 24; drawLine(c.getContext('2d', SW), text, f, '#fff', c.width / 2, c.height / 2, 'center');
      p.canvas = c; this.hitPopups++;
    } else { p.a0 = 1; this.missPopups++; } // prefabs/miss_icon.tscn: Sprite3D scale 0.025, pixel_size 0.01
    p.alpha = p.a0; this.popups.push(p);
  }
  stepPopups(dt) { // Tween steps on process frames; QueueFree in the final callback
    for (const p of this.popups) {
      p.t = Math.min(0.25, p.t + dt); const k = p.t / 0.25;
      p.alpha = p.a0 * (1 - k);                                  // transparency k
      p.y = -1.4 + 0.25 * (1 - Math.pow(1 - k, 5));             // Tween TRANS_QUINT EASE_OUT
    }
    this.popups = this.popups.filter((p) => { if (p.t < 0.25) return true; p.hit ? this.hitPopups-- : this.missPopups--; return false; });
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
    this.stepPopups(dt);
    if (!a.CanSkip) { this.skipShown = false; this.skipEl.alpha = 0; }
    else if (this.skipShown) {
      this.skipT += dt; const t = this.skipT, ease = (x) => (1 - Math.cos(Math.PI * x)) / 2, mix = (p, q, x) => p + (q - p) * ease(x);
      let v; if (t < 0.75) v = mix(0, 0.25, t / 0.75); else if (t < 1.5) v = mix(0.25, 0.75, (t - 0.75) / 0.75);
      else { const u = (t - 1.5) % 1.5; v = u < 0.75 ? mix(0.75, 0.25, u / 0.75) : mix(0.25, 0.75, (u - 0.75) / 0.75); }
      this.skipEl.alpha = v;
    }
  }
  drawRing() { // PanelLeft._PhysicsProcess sets progress/colour; sides = clamp(ComboMultiplierIncrement, 3, 32)
    const n = Math.min(Math.max(this.attempt.ComboMultiplierIncrement, 3), 32);
    const key = `${n}|${this.cur.ringP}|${this.cur.ringC}`; if (key === this._ringKey) return false; this._ringKey = key;
    this.ring.draw(this.cur.ringP, this.cur.ringC, n);
    return true;
  }
  destroy() { this.popups = []; }
}
