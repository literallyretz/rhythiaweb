// Port of scenes/Game.cs + PlayerInputController.cs + PauseMenu.cs (flow only; logic lives in game/Runner.js).
import { Attempt } from '../game/Attempt.js';
import { Runner } from '../game/Runner.js';
import { updateCursor } from '../game/CameraLock.js';
import { Hud } from './Hud.js';
import { SettingsManager } from '../SettingsManager.js';
import { tweenOpacity } from '../util/tween.js';
import { parseSSPM } from '../map/MapParser.js';

export const STEP_MS = 1000 / 120; // project.godot physics_ticks_per_second=120 (HUD-only _PhysicsProcess)

const FIREFOX = /Firefox\//.test(navigator.userAgent);
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
    this.app.sound.beginGameplayScope(attempt.Map);         // Runner.Play -> SoundManager.BeginGameplayScope
    this.app.renderer.cursor.rotation = 0;                  // CursorManager.Init: cursorMesh.Transform = Identity
    this.active = true; this.paused = false; this.acc = 0; this.last = performance.now();
    this.showPause(false, true);   // Game.cs: Menu.HideMenu(true)
    this.app.menuCursor?.UpdateVisible(false, false);   // Game.cs: MenuCursor.Instance.UpdateVisible(false, false)
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
    const r = this.runner, a = this.attempt, pf = this.app.perf;
    const p0 = pf ? performance.now() : 0;
    // Runner._Process: runs once per rendered frame with the real frame time (delta = (now - lastFrame) / 1e6 s)
    if (r.Playing) r.process(dt / 1000);
    if (!this.active) return;                                  // process() may have ended the attempt
    const p1 = pf ? performance.now() : 0;
    // _PhysicsProcess (120 Hz) only drives the HUD lerps: HealthBar, PanelLeft ring, PanelRight opacity
    this.acc += dt;
    for (let n = 0; this.acc >= STEP_MS && n < 240; n++) { if (r.Playing) this.hud.physics(STEP_MS / 1000); this.acc -= STEP_MS; }
    if (this.acc > 1000) this.acc = 0;
    const progress = a.Progress;
    const ren = this.app.renderer;
    // CursorManager._Process: while Playing, cursorMesh.RotationDegrees += Vector3.Back * (float)CursorRotation * (float)delta (float32)
    if (r.Playing) ren.cursor.rotation = Math.fround(ren.cursor.rotation + Math.fround(Math.fround(this.app.settings.CursorRotation) * Math.fround(dt / 1000)));
    ren.updateSpace(dt / 1000, a.LastHitColour, this.app.settings.SpaceHitEffects);
    this.hud.frame(progress);
    const p2 = pf ? performance.now() : 0;
    pf?.begin();
    ren.render(a, r, progress, this.app.settings, this.app.noteColors, this.hud.items());
    pf?.end(p1 - p0, p2 - p1, performance.now() - p2, ren.lastNoteCount);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  onMouseMove(e) { // PlayerInputController -> Game.OnMouseMove (one call per motion event, UseAccumulatedInput = false)
    if (!this.active || !this.runner.Playing) return;       // if (!Runner.Playing ...) return
    const evs = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      // Godot (Windows, captured): relative = raw lLastX/lLastY counts, no DPI scaling. Chromium's movementX is the platform value, unscaled
      // (blink mouse_event.cc has a TODO for scaling it); with unadjustedMovement that is the raw count. Firefox reports CSS px, so x devicePixelRatio there.
      const k = FIREFOX ? (window.devicePixelRatio || 1) : 1;
      const rel = { x: Math.fround(ev.movementX * k), y: Math.fround(ev.movementY * k) };
      updateCursor(this.attempt, this.app.renderer.cam, this.app.renderer.cursor, rel);
      const len = Math.fround(Math.sqrt(Math.fround(Math.fround(rel.x * rel.x) + Math.fround(rel.y * rel.y))));   // Vector2.Length()
      this.attempt.DistanceMM += len / this.app.settings.Sensitivity / 57.5;
    }
  }

  onKey(e) {
    if (!this.active || e.repeat) return;
    if (e.code === 'Escape' && !SettingsManager.Shown) { if (performance.now() - (this.lockLostAt ?? 0) > 150) this.togglePause(); e.preventDefault(); }
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
    this.app.menuCursor?.UpdateVisible(show && this.app.settings.UseCursorInMenus);   // PauseMenu.ShowMenu
    if (show) { if (document.pointerLockElement) document.exitPointerLock(); } else { this.last = performance.now(); this.lockPointer(); }
  }
  showPause(v, instant = false) { // PauseMenu.ShowMenu: Visible = true on show; modulate tween 0.25 s (Quad); callback: Visible = Shown (read when the tween ends)
    const el = document.getElementById('pause'); this.pauseShown = v;
    if (v) el.classList.remove('hidden');
    tweenOpacity(el, v ? 1 : 0, instant ? 0 : 0.25).then(() => el.classList.toggle('hidden', !this.pauseShown));
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
