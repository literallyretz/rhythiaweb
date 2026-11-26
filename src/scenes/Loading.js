// Port of scenes/Loading.cs: bg -> #060509 (1 s, Quad), label/bar fade in (0.5 s), splash uv_split shift 0.2 -> 1.0 (1.5 s, Quint out);
// when initialisation is done: bg -> black (0.25 s) then the menu. The progress bar tracks real resource loading.
import { compile, loadImage, makeTexture } from '../render/gl.js';

const quadInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const quintOut = (t) => 1 - Math.pow(1 - t, 5);

export class LoadingScene {
  constructor() {
    this.el = document.getElementById('loading'); this.canvas = document.getElementById('splash');
    this.label = document.getElementById('loadLabel'); this.bar = document.getElementById('loadBar'); this.fill = document.getElementById('loadFill');
    this.img = null; this.t0 = 0; this.shift = 0;   // Loading._Ready: SetShaderParameter("shift", 0)
     this.bgT = 0; this.progress = 0; this.exiting = null;
  }
  async setSplash(url) {
    this.img = await loadImage(url);
  }
  start(app) {
    this.app = app; this.mags = []; this.ceiling = 0.01; this.targetCeiling = 0.01; this._sl = performance.now();
    this.el.classList.remove('hidden'); this.t0 = performance.now(); this.draw(0);
    this.tick = () => { if (this.done) return; this.draw(performance.now()); requestAnimationFrame(this.tick); }; requestAnimationFrame(this.tick);
  }
  setProgress(done, total, text) {
    this.progress = done / total; this.fill.style.width = `${this.progress * 100}%`; if (text) this.label.textContent = text;
  }
  draw(now) {
    const t = (now - this.t0) / 1000;
    const bg = Math.min(1, t / 1); const e = quadInOut(bg);
    const c = Math.round(0x06 * e), c2 = Math.round(0x05 * e), c3 = Math.round(0x09 * e);
    let color = `rgb(${c},${c2},${c3})`;
    if (this.exiting) { const k = Math.min(1, (now - this.exiting) / 250); const f = quadInOut(k); color = `rgb(${Math.round(c * (1 - f))},${Math.round(c2 * (1 - f))},${Math.round(c3 * (1 - f))})`; }
    this.el.style.background = color;
    const fo = quadInOut(Math.min(1, t / 0.5)); this.label.style.opacity = fo; this.bar.style.opacity = fo;
    this.shift = 0.2 + 0.8 * quintOut(Math.min(1, t / 1.5));
    this.drawSplash();
    this.drawSpectrum(now);
  }
  // ui/AudioSpectrum.cs (MinFreq 0, MaxFreq 10500, BarSize 6, BarGap 4, BarMinSize 1, Align 1, Responsiveness 24, NormalizeMagnitude)
  drawSpectrum(now) {
    const cv = document.getElementById('spectrum'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.floor(cv.clientWidth * dpr), H = Math.floor(cv.clientHeight * dpr); if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); const sx = cv.clientWidth, sy = cv.clientHeight; g.clearRect(0, 0, sx, sy);
    const BAR = 6, GAP = 4, MINF = 0, MAXF = 10500, MIN = 1, ALIGN = 1, RESP = 24;
    const n = Math.round((sx - BAR) / (BAR + GAP)); if (n <= 1) return;
    const delta = Math.min(0.1, Math.max(0, (now - this._sl) / 1000)); this._sl = now;
    if (this.mags.length !== n) this.mags = new Array(n).fill(0);
    let bins = null, binHz = 0; const snd = this.app?.sound, an = snd?.analyser;
    if (an && snd.song.playing) { bins = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(bins); binHz = snd.ctx.sampleRate / an.fftSize; }
    const step = (MAXF - MINF) / n; let maxM = 0;
    for (let i = 0; i < n; i++) {
      let m = 0;
      if (bins) { const lo = MINF + i * step, hi = lo + step; const a = Math.max(0, Math.floor(lo / binHz)), b = Math.min(bins.length - 1, Math.max(a, Math.ceil(hi / binHz)));
        for (let k = a; k <= b; k++) m = Math.max(m, 10 ** (bins[k] / 20)); }
      this.mags[i] += (m - this.mags[i]) * Math.min(1, delta * RESP); if (this.mags[i] > maxM) maxM = this.mags[i];
    }
    this.targetCeiling = maxM > 0.0015 ? maxM : this.targetCeiling; this.ceiling += (this.targetCeiling - this.ceiling) * Math.min(1, delta * 6);
    const w = sx - BAR; g.strokeStyle = 'rgba(255,202,205,0.0935)'; g.lineWidth = BAR; g.lineCap = 'butt'; g.beginPath();
    for (let i = 0; i < n; i++) {
      const sc = Math.min(1, Math.max(MIN / sy, this.mags[i] / this.ceiling)), x = i / (n - 1) * w + BAR / 2, y0 = ALIGN * (1 - sc) * sy;
      g.moveTo(x, y0); g.lineTo(x, y0 + sc * sy);
    }
    g.stroke();
  }
  // loading.tscn Splash: TextureRect (anchors top .2 / bottom .8, EXPAND_IGNORE_SIZE, STRETCH_KEEP_ASPECT_CENTERED) with uv_split.gdshader
  // (split .4, angle 0). The shader's UV spans the DRAWN texture rect, so the rect is computed as TextureRect::_notification(DRAW) does.
  initSplashGL() {
    const gl = this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
    const fs = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o; uniform sampler2D tex; uniform float split, shift, angle;
const float PI = 3.14159265358979323846;
vec2 rotate(vec2 v, float rad) { float x = v.x * cos(rad) - v.y * sin(rad); float y = v.x * sin(rad) + v.y * cos(rad); return vec2(x, y); }
void main() {
  vec2 UV = vUV; vec2 uv = UV;
  float rad = angle * (PI / 180.0);
  uv = rotate(uv - vec2(0.5), rad) + vec2(0.5);
  float dir = uv.x < split ? -1.0 : 1.0;
  float offset = dir * (1.0 - shift) / 2.0;
  uv.x += offset;
  uv = rotate(uv - vec2(0.5), -rad) + vec2(0.5);
  vec4 COLOR = texture(tex, uv);
  o = vec4(COLOR.rgb * COLOR.a, COLOR.a);   // canvas_item blend (straight alpha) via the page compositor
}`;
    const vs = `#version 300 es
in vec2 aPos; in vec2 aUV; out vec2 vUV; void main() { vUV = aUV; gl_Position = vec4(aPos, 0.0, 1.0); }`;
    this.prog = compile(gl, vs, fs, 'uv_split'); this.vao = gl.createVertexArray(); this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    for (const [n, off] of [['aPos', 0], ['aUV', 8]]) { const l = gl.getAttribLocation(this.prog.program, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 16, off); }
    this.tex = makeTexture(gl, this.img, { srgb: false, mips: false });   // canvas items sample the raw sRGB values, default linear filter
  }
  drawSplash() {
    const cv = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.floor(cv.clientWidth * dpr), H = Math.floor(cv.clientHeight * dpr);
    if (!this.img || !W || !H) return;
    if (!this.gl) this.initSplashGL();
    const gl = this.gl; if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    // control rect: anchor_top .2, anchor_bottom .8, full width; TextureRect KEEP_ASPECT_CENTERED (int truncation as in texture_rect.cpp)
    const cw = W, ch = H * 0.6, cy = H * 0.2, iw = this.img.width, ih = this.img.height;
    let tw = Math.trunc(iw * ch / ih), th = Math.trunc(ch);
    if (tw > cw) { tw = Math.trunc(cw); th = Math.trunc(ih * tw / iw); }
    const ox = (cw - tw) / 2, oy = cy + (ch - th) / 2;
    const x0 = ox / W * 2 - 1, x1 = (ox + tw) / W * 2 - 1, y0 = 1 - oy / H * 2, y1 = 1 - (oy + th) / H * 2;
    gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog.program); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x1, y1, 1, 1]), gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.prog.u.tex, 0);
    gl.uniform1f(this.prog.u.split, Math.fround(0.400000019)); gl.uniform1f(this.prog.u.shift, this.shift); gl.uniform1f(this.prog.u.angle, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  async exit() {
    this.exiting = performance.now();
    await new Promise((r) => setTimeout(r, 270));
    this.done = true; this.el.classList.add('hidden');
  }
}
