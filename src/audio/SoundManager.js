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
    this.menuGain = this.ctx.createGain(); this.menuGain.connect(this.master);
    this.song = new SongPlayer(this.ctx, this.songGain);
    this.menuMusic = new SongPlayer(this.ctx, this.menuGain);             // MenuMusic = new() { Name = "Menu" }
    // SoundManager statics: Map, Scope, JukeboxQueue, JukeboxIndex, menuMusicPausedByUser (+ the JukeboxPlayed / JukeboxEmpty events)
    this.Map = null; this.Scope = 'Silent'; this.JukeboxQueue = []; this.JukeboxIndex = 0; this.menuMusicPausedByUser = false;
    this.JukeboxPlayed = []; this.JukeboxEmpty = []; this.maps = []; this.sceneName = () => ''; this.panel = null;
    this.song.onFinished = () => this._songFinished();
    this.hitBuffer = this.missBuffer = this.failBuffer = null;
    this.hitVoices = []; this.missVoices = [];
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
    this.menuGain.gain.value = dbToLinear(computeVolumeDb(s.VolumeMenuMusic, m, 70));
  }
  // AudioStreamPlayer.Play() with MaxPolyphony = 16: each Play adds a voice; past the limit the OLDEST voice is stopped
  // (AudioStreamPlayerInternal.ensure_playback_limit: while (size > max) stop_playback_stream(playbacks[0]))
  _oneShot(buffer, gain, voices) {
    if (!buffer) return;
    const src = this.ctx.createBufferSource(); src.buffer = buffer; src.connect(gain);
    const end = () => { const i = voices.indexOf(src); if (i >= 0) voices.splice(i, 1); src.onended = null; src.disconnect(); };
    src.onended = end; voices.push(src); src.start();
    while (voices.length > 16) { const old = voices[0]; try { old.stop(); } catch {} voices.shift(); old.onended = null; old.disconnect(); }
  }
  playHitSound() { if (this.settings.EnableHitSound) this._oneShot(this.hitBuffer, this.hitGain, this.hitVoices); }
  playMissSound() { if (this.settings.EnableMissSound) this._oneShot(this.missBuffer, this.missGain, this.missVoices); }
  // AudioServer.GetTimeSinceLastMix(): Godot's song position is the mixer position at its last 512-frame mix step, and this is the time since that step.
  // Chrome's ctx.currentTime is the same kind of value (position at the last render, advancing in coarse jumps), so the time since it last
  // advanced is rebuilt from the output timestamp (a continuous audio clock) and clamped to one mix chunk (AudioServer buffer_size = 512).
  timeSinceLastMix() {
    const c = this.ctx, ts = c.getOutputTimestamp();
    if (!ts.performanceTime) return 0;
    const head = ts.contextTime + (performance.now() - ts.performanceTime) / 1000 + (c.outputLatency || c.baseLatency || 0);
    return Math.min(Math.max(head - c.currentTime, 0), 512 / c.sampleRate);
  }
  playFailSound() { if (this.failBuffer) { const s = this.ctx.createBufferSource(); s.buffer = this.failBuffer; s.connect(this.failGain); s.start(); } }

  // ---- Jukebox / menu music (scripts/SoundManager.cs) ----
  _isScopedPlayback() { return !this.settings.AutoplayJukebox; }
  _songFinished() {                                   // Song.Finished
    if (this._isScopedPlayback()) { this.stopScopedSession(); return; }
    switch (this.sceneName()) {
      case 'SceneMenu': if (this.settings.AutoplayJukebox) { this.JukeboxIndex++; this.playJukeboxIndex(this.JukeboxIndex); } break;
      case 'SceneResults': this.playJukeboxIndex(this.JukeboxIndex); break;
      default: break;
    }
  }
  updateJukeboxQueue() { this.JukeboxQueue = this.maps.map((m) => m.Id); }
  _mapById(id) { return this.maps.find((m) => m.Id === id) ?? null; }
  start() {                                           // static start(): MapsInitialized / MapManager.Initialized
    this.updateJukeboxQueue();
    if (this.settings.AutoplayJukebox) this.playJukeboxIndex(Math.floor(Math.random() * this.JukeboxQueue.length));
    else this.stopScopedSession();
  }
  playJukebox(map) {
    if (map == null) return;
    if (this._isScopedPlayback()) { this.startMapSelectionPlayback(map); return; }
    this.menuMusic.stop(); this.menuMusicPausedByUser = false;
    this.Map = map;
    if (!map.decodedAudio) { this.JukeboxIndex++; this.playJukeboxIndex(this.JukeboxIndex); return; }   // map.AudioBuffer == null
    this.JukeboxIndex = this.maps.findIndex((x) => x.Id === map.Id);
    this.song.setStream(map.decodedAudio); this.song.play();
    for (const f of this.JukeboxPlayed) f(map);
  }
  playJukeboxIndex(index = -1) {
    if (this.JukeboxQueue.length === 0) return;
    index = index === -1 ? this.JukeboxIndex : index;
    if (index >= this.JukeboxQueue.length) index = 0; else if (index < 0) index = this.JukeboxQueue.length - 1;
    this.playJukebox(this._mapById(this.JukeboxQueue[index]));
  }
  startMapSelectionPlayback(map) {
    if (map == null) return;
    this.song.stop(); this.song.setPaused(false);
    this.song.pitchScale = this.lobbySpeed ?? 1;
    this.menuMusic.stop(); this.menuMusicPausedByUser = false;
    this.Map = map; this.Scope = 'Preview';
    const i = this.maps.findIndex((x) => x.Id === map.Id); if (i >= 0) this.JukeboxIndex = i;
    this.song.setStream(map.decodedAudio); this.song.play(0);
    for (const f of this.JukeboxPlayed) f(map);
  }
  beginGameplayScope(map) {
    if (!this._isScopedPlayback()) return;
    this.Map = map; this.Scope = 'GameplayResults'; this.menuMusic.stop();
  }
  stopScopedSession() {
    this.song.stop(); this.song.setPaused(false);
    this.Map = null; this.Scope = 'Silent';
    for (const f of this.JukeboxEmpty) f();
    this.refreshMenuMusicPlayback();
  }
  isJukeboxPaused() { return this.song.paused || this.menuMusicPausedByUser; }
  toggleJukeboxPause() {
    const song = this.song;
    if (song.playing || song.paused) {
      song.setPaused(!song.paused);
      this.panel?.updateMap(this.Map);
      return song.paused;
    }
    if (!this.menuMusic.buffer) return false;
    if (!this._shouldPlayMenuMusic() && !this.menuMusicPausedByUser) return false;
    this.menuMusicPausedByUser = !this.menuMusicPausedByUser;
    if (this.menuMusicPausedByUser) this.menuMusic.setPaused(true);
    else if (this.menuMusic.paused) this.menuMusic.setPaused(false);
    else if (!this.menuMusic.playing) this.menuMusic.play();
    return this.menuMusicPausedByUser;
  }
  _shouldPlayMenuMusic() {
    if (!this.settings.EnableMenuMusic) return false;
    if (!this.menuMusic.buffer) return false;
    if (this.sceneName() !== 'SceneMenu') return false;       // SceneManager.Scene is not MainMenu
    if (this.song.playing) return false;
    return true;
  }
  refreshMenuMusicPlayback() {
    const mm = this.menuMusic;
    this.panel?.updateMap(this.Map);
    if (this.menuMusicPausedByUser) {
      if (mm.playing && !mm.paused) mm.setPaused(true);
      this.panel?.showMenuTheme();
      return;
    }
    if (this._shouldPlayMenuMusic()) {
      if (mm.paused) mm.setPaused(false); else if (!mm.playing) mm.play();
      this.panel?.showMenuTheme();
    } else if (mm.playing || mm.paused) {
      mm.stop(); mm.setPaused(false);
      if (this.Map == null) this.panel?.clearMap();
    }
  }
  process() { this.refreshMenuMusicPlayback(); }              // SoundManager._Process
}
