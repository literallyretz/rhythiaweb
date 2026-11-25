// Port of scenes/Game.cs + PlayerInputController.cs + PauseMenu.cs (flow only; logic lives in game/Runner.js).
import { Attempt } from '../game/Attempt.js';
import { Runner } from '../game/Runner.js';
import { updateCursor } from '../game/CameraLock.js';
import { Hud } from './Hud.js';
import { parseSSPM } from '../map/MapParser.js';

export const STEP_MS = 1000 / 120; // project.godot physics_ticks_per_second=120 (HUD-only _PhysicsProcess)

export class GameScene {
  constructor(app) {
    this.app = app; this.active = false; this.paused = false;
    this.hud = new Hud(document.getElementById('hudRoot'), document.getElementById('hudPersp'), app.canvas);
    document.addEventListener('pointermove', (e) => this.onMouseMove(e));
    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.active && this.runner.Playing) this.togglePause(true); });
    window.addEventListener('blur', () => { if (this.active && this.runner?.Playing) this.togglePause(true); });
    window.addEventListener('resize', () => { if (this.active) this.hud.layout(); });
    document.getElementById('pResume').onclick = () => this.togglePause(false);
    document.getElementById('pRestart').onclick = () => this.restart();
    document.getElementById('pHide').onclick = () => this.togglePause(false);
    document.getElementById('pQuit').onclick = () => { this.showPause(false); this.runner.GiveUp(); };
  }

  async start() {
    const app = this.app;
    // Game.Play / Game.Restart / Results.Replay: MapParser.Decode(...) on every attempt, so Note.LastResult/Hittable never carry over
    const map = parseSSPM(app.mapBytes, app.mapName); map.decodedAudio = app.map.decodedAudio;   // (decoded audio is immutable, reused)
    this.stepCount = 0;
    const settings = app.settings;
    app.sound.song.stop(); app.sound.song.setStream(map.decodedAudio); app.sound.updateVolume();
    const attempt = new Attempt(map, app.speed, 0, settings, app.noteColors, map.decodedAudio ? map.decodedAudio.duration : 0);
    // Attempt ctor: Length = max(1000 * song length, Map.Length + 1000)
    this.attempt = attempt;
    const runner = this.runner = new Runner(app.sound);
    runner.noteColors = app.noteColors;
    runner.onStop = (a) => this.finish(a);
    runner.on('attemptStatsUpdated', (a) => { a.HighestCombo = Math.max(a.HighestCombo ?? 0, a.Combo); });
    attempt.HighestCombo = 0;
    this.hud.init(attempt, runner);
    app.renderer.cam.position = [0, 0, 3.75]; app.renderer.cursor.position = [0, 0, 0];
    app.renderer.noteHitColor = [1, 1, 1];
    runner.Play(attempt, settings);
    this.active = true; this.paused = false; this.acc = 0; this.last = performance.now();
    this.showPause(false);
    document.getElementById('gameCanvas').style.visibility = 'visible';
    this.lockPointer();
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  lockPointer() {
    const c = this.app.canvas;
    try { const p = c.requestPointerLock?.({ unadjustedMovement: true }); if (p?.catch) p.catch(() => c.requestPointerLock?.().catch?.(() => {})); } catch { /* no pointer lock available */ }
  }

  frame(now) {
    this.raf = null;
    if (!this.active) return;
    const dt = now - this.last; this.last = now;
    const r = this.runner, a = this.attempt;
    // Runner._Process: runs once per rendered frame with the real frame time (delta = (now - lastFrame) / 1e6 s)
    if (r.Playing) r.process(dt / 1000);
    if (!this.active) return;                                  // process() may have ended the attempt
    // _PhysicsProcess (120 Hz) only drives the HUD lerps: HealthBar, PanelLeft ring, PanelRight opacity
    this.acc += dt;
    for (let n = 0; this.acc >= STEP_MS && n < 240; n++) { if (r.Playing) this.hud.physics(STEP_MS / 1000); this.acc -= STEP_MS; }
    if (this.acc > 1000) this.acc = 0;
    const progress = a.Progress;
    const ren = this.app.renderer;
    ren.updateSpace(dt / 1000, a.LastHitColour, this.app.settings.SpaceHitEffects);
    ren.render(a, r, progress, this.app.settings, this.app.noteColors);
    this.hud.setCamera(ren.cam.position[0], ren.cam.position[1]);
    this.hud.frame(progress);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  onMouseMove(e) { // PlayerInputController -> Game.OnMouseMove (one call per motion event, UseAccumulatedInput = false)
    if (!this.active || !this.runner.Playing) return;       // if (!Runner.Playing ...) return
    const evs = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
    const k = window.devicePixelRatio || 1;                  // Godot reports relative motion in physical pixels
    for (const ev of evs) {
      const rel = { x: ev.movementX * k, y: ev.movementY * k };
      updateCursor(this.attempt, this.app.renderer.cam, this.app.renderer.cursor, rel);
      this.attempt.DistanceMM += Math.hypot(rel.x, rel.y) / this.app.settings.Sensitivity / 57.5;
    }
  }

  onKey(e) {
    if (!this.active || e.repeat) return;
    if (e.code === 'Escape') { if (performance.now() - (this.lockLostAt ?? 0) > 150) this.togglePause(); e.preventDefault(); }
    else if (e.code === 'Backquote') { this.restart(); e.preventDefault(); }
    else if (e.code === 'Space') { this.runner.Skip(); e.preventDefault(); }   // OnPauseOrSkipPressed -> Runner.Skip
  }

  onLockChange() {
    if (this.active && document.pointerLockElement !== this.app.canvas && this.runner.Playing && !this.paused) { this.lockLostAt = performance.now(); this.togglePause(true); }
  }

  // PlayerInputController.OnTogglePaused handler in Game.cs + PauseMenu.ShowMenu
  togglePause(force) {
    const r = this.runner, a = this.attempt; if (a.Stopped) return;
    const show = force ?? !this.paused;
    if (show === this.paused) return;
    if (r.ObjectIndicesStart.Note > 0 && a.Progress < a.Map.Notes[a.Map.Notes.length - 1].Millisecond) a.Qualifies = false;
    this.paused = show; r.Playing = !show;
    this.app.sound.song.pitchScale = a.Speed; this.app.sound.song.setPaused(!r.Playing);
    this.showPause(show);
    if (show) { if (document.pointerLockElement) document.exitPointerLock(); } else { this.last = performance.now(); this.lockPointer(); }
  }
  showPause(v) { // PauseMenu.ShowMenu: modulate tween 0.25 s, Visible = Shown afterwards
    const el = document.getElementById('pause'); clearTimeout(this._pt);
    if (v) { el.classList.remove('hidden'); void el.offsetWidth; el.classList.add('show'); }
    else { el.classList.remove('show'); this._pt = setTimeout(() => el.classList.add('hidden'), 250); }
  }

  // Game.Restart
  restart() {
    this.showPause(false);
    this.runner.Fail(); this.runner.Stop(false);
    this.start();
  }

  finish(attempt) {
    this.active = false; this.paused = false;
    if (document.pointerLockElement) document.exitPointerLock();
    document.getElementById('gameCanvas').style.visibility = 'hidden';
    this.showPause(false);
    this.app.showResults(attempt);
  }
}
