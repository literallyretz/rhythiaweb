// Port of scripts/ui/menu/JukeboxPanel.cs + scripts/ui/AudioSpectrum.cs (node JukeboxPanel in scenes/main_menu.tscn).
const el = (tag, id, parent) => { const e = document.createElement(tag); if (id) e.id = id; parent.appendChild(e); return e; };

export class JukeboxPanel {
  constructor(app, parent) {
    this.app = app; this.Map = null;
    const root = this.root = el('div', 'jukebox', parent);
    el('div', 'jBg', root);
    this.spectrum = el('canvas', 'jSpectrum', root);
    const title = this.titleBox = el('div', 'jTitle', root);                    // Label (self_modulate alpha 0.745) + Panel behind + GoTo button
    el('div', 'jTitleBg', title); this.title = el('span', 'jTitleText', title); this.title.dataset.t = '';
    this.selectButton = el('button', 'jGoTo', title); this.selectButton.disabled = true;
    const mk = (id) => { const b = el('button', id, root); b.className = 'jBtn'; el('div', null, b); return b; };
    this.pauseButton = mk('jPause'); this.skipButton = mk('jSkip'); this.rewindButton = mk('jRewind');
    this.pauseButton.onclick = () => this.pause(); this.skipButton.onclick = () => this.skip(); this.rewindButton.onclick = () => this.rewind();
    this.selectButton.onclick = () => this.select();
    for (const b of [this.pauseButton, this.skipButton, this.rewindButton]) {
      b.onmouseenter = () => { b.style.opacity = 1; }; b.onmouseleave = () => { b.style.opacity = ''; };   // SelfModulate 255 / 190 (0.745)
    }
    this.selectButton.onmouseenter = () => { title.classList.add('hot'); }; this.selectButton.onmouseleave = () => { title.classList.remove('hot'); };
    // AudioSpectrum exports as set in main_menu.tscn: MinFreq 0, MaxFreq 6000, BarMinSize 1, Align 1; defaults BarSize 4, BarGap 4, Responsiveness 24, NormalizeMagnitude
    this.mags = []; this.ceiling = 0.01; this.targetCeiling = 0.01; this._last = performance.now();
    addEventListener('keydown', (e) => {                              // _Input: Mediaplay / Medianext / Mediaprevious
      if (e.code === 'MediaPlayPause') this.pause(); else if (e.code === 'MediaTrackNext') this.skip(); else if (e.code === 'MediaTrackPrevious') this.rewind();
    });
    const snd = app.sound; snd.panel = this;
    snd.JukeboxPlayed.push((m) => this.updateMap(m)); snd.JukeboxEmpty.push(() => this.clearMap());   // SoundManager.JukeboxPlayed / JukeboxEmpty
    this.updateSkin();
    if (snd.Map != null) this.updateMap(snd.Map);
  }
  setTitle(t) { if (this._t === t) return; this._t = t; this.title.textContent = t; this.title.dataset.t = t; }   // (DOM only touched on change)
  clearMap() { this.setTitle(''); this.Map = null; this.selectButton.disabled = true; }
  showMenuTheme() { this.setTitle('Menu Theme'); this.Map = null; this.selectButton.disabled = true; }
  updateMap(map) {
    this.Map = map;
    if (this.Map != null) { this.setTitle(map.PrettyTitle); this.selectButton.disabled = false; }
  }
  updateSkin() {
    const snd = this.app.sound, paused = snd.isJukeboxPaused();
    if (this._skin !== paused) {
      this._skin = paused;
      this.pauseButton.firstChild.style.backgroundImage = `url(assets/skin/ui/jukebox_${paused ? 'play' : 'pause'}.png)`;
      this.skipButton.firstChild.style.backgroundImage = 'url(assets/skin/ui/jukebox_skip.png)';
      this.rewindButton.firstChild.style.backgroundImage = 'url(assets/skin/ui/jukebox_skip.png)';
    }
  }
  pause() { this.app.sound.toggleJukeboxPause(); this.updateSkin(); }
  skip() { const s = this.app.sound; if (!this.app.settings.AutoplayJukebox) return; s.JukeboxIndex++; s.playJukeboxIndex(s.JukeboxIndex); }
  rewind() {
    const s = this.app.sound; if (!this.app.settings.AutoplayJukebox) return;
    if (s.song.getPlaybackPosition() < 2) { s.JukeboxIndex--; s.playJukeboxIndex(s.JukeboxIndex); } else s.song.seek(0);
  }
  select() { /* MapList.Select(Map, false): the only map is always the selected one, so nothing changes */ }

  // _Process (JukeboxPanel) + AudioSpectrum._Process/_Draw
  process(now) {
    if (this.root.offsetParent === null) return;           // menu hidden (gameplay): nothing visible to update
    const snd = this.app.sound, song = snd.song;
    const progress = song.buffer ? song.getPlaybackPosition() / song.getLength() : 0;
    this.updateSkin();
    this.drawSpectrum(now, progress);
  }
  drawSpectrum(now, progress) {
    const cv = this.spectrum, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sx = cv.clientWidth, sy = cv.clientHeight; if (!sx) return;
    const W = Math.floor(sx * dpr), H = Math.floor(sy * dpr); if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, sx, sy);
    const BAR = 4, GAP = 4, MINF = 0, MAXF = 6000, MIN = 1, ALIGN = 1, RESP = 24;
    const n = Math.round((sx - BAR) / (BAR + GAP)); if (n <= 1) return;
    const delta = Math.min(0.1, Math.max(0, (now - this._last) / 1000)); this._last = now;
    if (this.mags.length !== n) this.mags = new Array(n).fill(0);
    const snd = this.app.sound, an = snd.analyser; let bins = null, binHz = 0;
    if (an && (snd.song.playing && !snd.song.paused || snd.menuMusic.playing && !snd.menuMusic.paused)) { bins = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(bins); binHz = snd.ctx.sampleRate / an.fftSize; }
    const step = (MAXF - MINF) / n; let maxM = 0;
    for (let i = 0; i < n; i++) {
      let m = 0;
      if (bins) { const lo = MINF + Math.max(0, i * step), hi = lo + step; const a = Math.max(0, Math.floor(lo / binHz)), b = Math.min(bins.length - 1, Math.max(a, Math.ceil(hi / binHz)));
        for (let k = a; k <= b; k++) m = Math.max(m, 10 ** (bins[k] / 20)); }
      this.mags[i] += (m - this.mags[i]) * Math.min(1, delta * RESP); if (this.mags[i] > maxM) maxM = this.mags[i];
    }
    this.targetCeiling = maxM > 0.0015 ? maxM : this.targetCeiling; this.ceiling += (this.targetCeiling - this.ceiling) * Math.min(1, delta * 6);
    const w = sx - BAR; g.strokeStyle = '#fff'; g.lineWidth = BAR; g.lineCap = 'butt'; g.beginPath();
    for (let i = 0; i < n; i++) {
      const sc = Math.min(1, Math.max(MIN / sy, this.mags[i] / this.ceiling)), x = i / (n - 1) * w + BAR / 2, y0 = ALIGN * (1 - sc) * sy;
      g.moveTo(x, y0); g.lineTo(x, y0 + sc * sy);
    }
    g.stroke();
    // jukebox_progress.gdshader: COLOR *= progress > x ? color_fill : color_background (x = fraction across the spectrum rect)
    g.globalCompositeOperation = 'source-in';
    const pr = Math.min(1, Math.max(0, progress)), gr = g.createLinearGradient(0, 0, sx, 0);   // one source-in fill, hard stop at progress
    gr.addColorStop(0, 'rgb(201,0,69)'); gr.addColorStop(pr, 'rgb(201,0,69)'); gr.addColorStop(pr, 'rgba(255,202,205,0.74509805)'); gr.addColorStop(1, 'rgba(255,202,205,0.74509805)');
    g.fillStyle = gr; g.fillRect(0, 0, sx, sy);
  }
}
