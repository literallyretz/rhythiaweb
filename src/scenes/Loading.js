// Port of scenes/Loading.cs: bg -> #060509 (1 s, Quad), label/bar fade in (0.5 s), splash uv_split shift 0.2 -> 1.0 (1.5 s, Quint out);
// when initialisation is done: bg -> black (0.25 s) then the menu. The progress bar tracks real resource loading.
const quadInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const quintOut = (t) => 1 - Math.pow(1 - t, 5);

export class LoadingScene {
  constructor() {
    this.el = document.getElementById('loading'); this.canvas = document.getElementById('splash');
    this.label = document.getElementById('loadLabel'); this.bar = document.getElementById('loadBar'); this.fill = document.getElementById('loadFill');
    this.img = null; this.t0 = 0; this.shift = 0.2; this.bgT = 0; this.progress = 0; this.exiting = null;
  }
  async setSplash(url) {
    const blob = await (await fetch(url)).blob(); this.img = await createImageBitmap(blob);
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
  drawSplash() {
    const cv = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.floor(cv.clientWidth * dpr), H = Math.floor(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.clearRect(0, 0, W, H); if (!this.img) return;
    // TextureRect anchors top 0.2 .. bottom 0.8, full width, stretch_mode 5 (keep aspect centred)
    const rx = 0, ry = H * 0.2, rw = W, rh = H * 0.6;
    const sc = Math.min(rw / this.img.width, rh / this.img.height), iw = this.img.width * sc, ih = this.img.height * sc;
    if (!this.rect || this.rect.width !== rw || this.rect.height !== Math.ceil(rh)) { this.rect = document.createElement('canvas'); this.rect.width = rw; this.rect.height = Math.ceil(rh); }
    const rg = this.rect.getContext('2d'); rg.clearRect(0, 0, rw, rh); rg.drawImage(this.img, (rw - iw) / 2, (rh - ih) / 2, iw, ih);
    // uv_split.gdshader: split 0.4; uv.x += dir * (1 - shift) / 2 with dir=-1 left of the split, +1 right of it
    const split = 0.4, off = (1 - this.shift) / 2 * rw;
    const part = (x0, x1, shiftPx) => { // dest [x0,x1) samples source [x0+shiftPx, x1+shiftPx) (clamped, transparent outside)
      const sx0 = Math.max(0, x0 + shiftPx), sx1 = Math.min(rw, x1 + shiftPx); if (sx1 <= sx0) return;
      g.drawImage(this.rect, sx0, 0, sx1 - sx0, this.rect.height, sx0 - shiftPx + rx, ry, sx1 - sx0, this.rect.height);
    };
    part(0, split * rw, -off); part(split * rw, rw, off);
  }
  async exit() {
    this.exiting = performance.now();
    await new Promise((r) => setTimeout(r, 270));
    this.done = true; this.el.classList.add('hidden');
  }
}
