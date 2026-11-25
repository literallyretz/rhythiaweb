// Web Audio counterpart of SoundManager.cs (Song / HitSound / MissSound / FailSound players + volume maths).
import { computeVolumeDb, dbToLinear } from '../util/misc.js';

// Minimal AudioStreamPlayer stand-in with the members Runner.cs touches.
class SongPlayer {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out;
    this.buffer = null; this.source = null;
    this.playing = false; this.paused = false;
    this._rate = 1; this._basePos = 0; this._baseCtx = 0; this._pausedPos = 0;
  }
  setStream(buffer) { this.stop(); this.buffer = buffer; }
  getLength() { return this.buffer ? this.buffer.duration : 0; }
  get pitchScale() { return this._rate; }
  set pitchScale(v) {
    if (v === this._rate) return;
    if (this.playing && !this.paused) { const p = this._position(); this._basePos = p; this._baseCtx = this.ctx.currentTime; }
    this._rate = v;
    if (this.source) this.source.playbackRate.value = v;
  }
  _position() { return this._basePos + (this.ctx.currentTime - this._baseCtx) * this._rate; }
  getPlaybackPosition() { if (!this.playing) return 0; return this.paused ? this._pausedPos : Math.min(this._position(), this.getLength()); }
  play(from = 0) {
    if (!this.buffer) return;
    this._killSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer; src.playbackRate.value = this._rate; src.connect(this.out);
    src.onended = () => { if (this.source === src) { this.source = null; this.playing = false; this.onFinished?.(); } };   // AudioStreamPlayer.Finished
    this.source = src;
    this._basePos = Math.max(0, from); this._baseCtx = this.ctx.currentTime;
    this.playing = true; this.paused = false;
    if (this._basePos < this.buffer.duration) src.start(0, this._basePos); else { this.playing = false; this.source = null; }
  }
  seek(sec) {
    if (!this.buffer) return;
    if (this.paused) { this._pausedPos = sec; return; }
    if (this.playing) this.play(sec);
  }
  stop() { this._killSource(); this.playing = false; this.paused = false; }
  setPaused(p) { // AudioStreamPlayer.StreamPaused
    if (p === this.paused) return;
    if (p) { if (!this.playing) return; this._pausedPos = this._position(); this._killSource(false); this.paused = true; }
    else if (this.paused) { this.paused = false; this.playing = false; this.play(this._pausedPos); }
  }
  _killSource(clearPlaying = true) {
    if (this.source) { const s = this.source; this.source = null; s.onended = null; try { s.stop(); } catch {} s.disconnect(); }
    if (clearPlaying) this.playing = false;
  }
}

export class SoundManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0; this.master.connect(this.analyser);   // AudioEffectSpectrumAnalyzer on the master bus (FFT 1024)
    this.songGain = this.ctx.createGain(); this.songGain.connect(this.master);
    this.hitGain = this.ctx.createGain(); this.hitGain.connect(this.master);
    this.missGain = this.ctx.createGain(); this.missGain.connect(this.master);
    this.failGain = this.ctx.createGain(); this.failGain.connect(this.master);
    this.song = new SongPlayer(this.ctx, this.songGain);
    this.hitBuffer = this.missBuffer = this.failBuffer = null;
    this.hitVoices = 0; this.missVoices = 0;
    this.updateVolume();
  }
  async decode(arrayBuffer) { return this.ctx.decodeAudioData(arrayBuffer.slice(0)); }
  resume() { return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve(); }
  // SoundManager.UpdateVolume (ranges 70 / 80 as in the C#)
  updateVolume() {
    const s = this.settings, m = s.VolumeMaster;
    this.songGain.gain.value = dbToLinear(computeVolumeDb(s.VolumeMusic, m, 70));
    this.hitGain.gain.value = dbToLinear(computeVolumeDb(s.VolumeHitSound, m, 80));
    this.missGain.gain.value = dbToLinear(computeVolumeDb(s.VolumeMissSound, m, 80));
    this.failGain.gain.value = dbToLinear(computeVolumeDb(s.VolumeSFX, m, 80));
  }
  _oneShot(buffer, gain, kind) {
    if (!buffer) return;
    const max = 16; // MaxPolyphony = 16
    if (this[kind] >= max) return;
    const src = this.ctx.createBufferSource(); src.buffer = buffer; src.connect(gain);
    this[kind]++; src.onended = () => { this[kind]--; src.disconnect(); };
    src.start();
    this.lastHitSoundCount = (this.lastHitSoundCount ?? 0) + (kind === 'hitVoices' ? 1 : 0);
  }
  playHitSound() { if (this.settings.EnableHitSound) this._oneShot(this.hitBuffer, this.hitGain, 'hitVoices'); }
  playMissSound() { if (this.settings.EnableMissSound) this._oneShot(this.missBuffer, this.missGain, 'missVoices'); }
  playFailSound() { if (this.failBuffer) { const s = this.ctx.createBufferSource(); s.buffer = this.failBuffer; s.connect(this.failGain); s.start(); } }
}
