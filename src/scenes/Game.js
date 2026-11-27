// Port of scenes/Game.cs + PlayerInputController.cs + PauseMenu.cs (flow only; logic lives in game/Runner.js).
import { Attempt } from '../game/Attempt.js';
import { Runner } from '../game/Runner.js';
import { TrailRenderer } from '../game/TrailRenderer.js';
import { CURSOR_SIZE } from '../constants.js';
import { updateCursor } from '../game/CameraLock.js';
import { Hud } from './Hud.js';
import { SettingsManager } from '../SettingsManager.js';
import { tweenOpacity } from '../util/tween.js';
import { notify } from '../ui/Toast.js';
import { Lobby } from '../Lobby.js';
import { MapManager } from '../map/MapManager.js';

export const STEP_MS = 1000 / 120; // project.godot physics_ticks_per_second=120 (HUD-only _PhysicsProcess)

const FIREFOX = /Firefox\//.test(navigator.userAgent);
export class GameScene {
  constructor(app) {
    this.app = app; this.active = false; this.paused = false; this.trail = new TrailRenderer();
    this.hud = new Hud(document.getElementById('hudRoot'), document.getElementById('hudPersp'), app.canvas);
    document.addEventListener('pointermove', (e) => this.onMouseMove(e));
    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    // Web-only (not in the original): a browser cannot confine the pointer, so Absolute Input is only playable in fullscreen (F11 or the Fullscreen API)
    const leftFullscreen = () => { if (this.active && this.app.settings.AbsoluteInput && !this.isFullscreen() && this.runner?.Playing && !this.paused) { this.togglePause(true); notify('Absolute Input needs fullscreen. Press F11.'); } };
    document.addEventListener('fullscreenchange', leftFullscreen); window.addEventListener('resize', leftFullscreen);
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
    const map = await MapManager.decodeStored(app.map); map.decodedAudio = app.map.decodedAudio;   // (decoded audio is immutable, reused)
    this.stepCount = 0;
    const settings = app.settings;
    app.sound.song.stop(); app.sound.song.setStream(map.decodedAudio); app.sound.updateVolume();
    const attempt = new Attempt(map, Lobby.Speed, Lobby.StartFrom, settings, app.noteColors, map.decodedAudio ? map.decodedAudio.duration : 0, Lobby.Modifiers);
    // Attempt ctor: Length = max(1000 * song length, Map.Length + 1000)
    this.attempt = attempt;
    const runner = this.runner = new Runner(app.sound);
    runner.noteColors = app.noteColors;
    runner.onStop = (a) => this.finish(a);
    runner.updateAutoplayCursor = (pos) => {   // CursorManager.UpdateAutoplayCursor (the CameraSpin branch arrives with camera modes)
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
      const r = this.app.renderer, s = this.app.settings;
      attempt.RawCursorPosition = { x: pos.x, y: pos.y }; attempt.CursorPosition = { x: pos.x, y: pos.y };
      r.cam.position = [Math.fround(pos.x * Math.fround(s.CameraParallax)), Math.fround(pos.y * Math.fround(s.CameraParallax)), 3.76];
      r.cam.rotation = [0, 0, 0]; r.cursor.position = [pos.x, pos.y, 0];
    };
    runner.on('attemptStatsUpdated', (a) => { a.HighestCombo = Math.max(a.HighestCombo ?? 0, a.Combo); });
    attempt.HighestCombo = 0;
    this.hud.init(attempt, runner);
    app.renderer.cam.position = [0, 0, 3.75]; app.renderer.cursor.position = [0, 0, 0];
    app.renderer.noteHitColor = [1, 1, 1];
    runner.Play(attempt, settings);
    this.app.sound.beginGameplayScope(attempt.Map);         // Runner.Play -> SoundManager.BeginGameplayScope
    this.app.renderer.cursor.rotation = 0;                  // CursorManager.Init: cursorMesh.Transform = Identity
    this.app.renderer.visAssist = settings.VisibilityAssist;   // Grid.Init: VisibilityAssist.Visible = setting (once per attempt)
    this.trail.reset(); this.app.renderer.trail = this.trail;   // fresh TrailRenderer per Game scene
    this.active = true; this.paused = false; this.acc = 0; this.last = performance.now();
    this.showPause(false, true);   // Game.cs: Menu.HideMenu(true)
    if (settings.AbsoluteInput && !this.isFullscreen()) this.enterFullscreen().then((ok) => { if (!ok && this.active && !this.paused) { this.togglePause(true); notify('Absolute Input needs fullscreen. Press F11.'); } });
    this.app.menuCursor?.UpdateVisible(false, false);   // Game.cs: MenuCursor.Instance.UpdateVisible(false, false)
    document.getElementById('gameCanvas').style.visibility = 'visible';
    this.lockPointer();
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  lockPointer(resumed = false) {
    const c = this.app.canvas;
    // Game.cs: MouseMode = AbsoluteInput ? Visible : Captured; PauseMenu (resume): AbsoluteInput ? ConfinedHidden : Captured. A browser cannot confine the pointer, so
    // ConfinedHidden is a hidden native cursor and Visible a shown one; absolute input never takes the pointer lock.
    if (this.app.settings.AbsoluteInput) { document.body.classList.toggle('noNative', resumed); return; }
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
    // CursorManager/TrailRenderer._Process (child of CursorManager, so after its cursor rotation): Rotation.Z = cursor rotation in radians, size = Grid.Init CURSOR_SIZE * CursorScale
    this.trail.process(dt / 1000, a, r, this.app.settings, Math.fround(ren.cursor.rotation * Math.PI / 180), Math.fround(CURSOR_SIZE * this.app.settings.CursorScale));
    ren.updateSpace(dt / 1000, a.LastHitColour, this.app.settings.SpaceHitEffects);
    this.hud.frame(progress);
    const p2 = pf ? performance.now() : 0;
    pf?.begin();
    ren.render(a, r, progress, this.app.settings, this.app.noteColors, this.hud.items());
    pf?.end(p1 - p0, p2 - p1, performance.now() - p2, ren.lastNoteCount);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  onMouseMove(e) { // PlayerInputController -> Game.OnMouseMove (one call per motion event, UseAccumulatedInput = false)
    if (!this.active || !this.runner.Playing || this.attempt.Modifiers.some((m) => m.Name === 'Autoplay')) return;       // if (!Runner.Playing || IsReplay || Autoplay) return
    const evs = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      // Godot (Windows, captured): relative = raw lLastX/lLastY counts, no DPI scaling. Chromium's movementX is the platform value, unscaled
      // (blink mouse_event.cc has a TODO for scaling it); with unadjustedMovement that is the raw count. Firefox reports CSS px, so x devicePixelRatio there.
      const k = FIREFOX ? (window.devicePixelRatio || 1) : 1;
      const rel = { x: Math.fround(ev.movementX * k), y: Math.fround(ev.movementY * k) };
      if (this.attempt.Settings.AbsoluteInput) {
        // Game.cs OnMouseMove: (absolute - Window.Size / 2) * 0.582f, Window.Size in pixels (Vector2i / int = integer division); the window is not locked, so the position is real
        const dpr = window.devicePixelRatio || 1, cx = Math.trunc(Math.round(innerWidth * dpr) / 2), cy = Math.trunc(Math.round(innerHeight * dpr) / 2);
        const abs = { x: Math.fround(Math.fround(ev.clientX * dpr - cx) * Math.fround(0.582)), y: Math.fround(Math.fround(ev.clientY * dpr - cy) * Math.fround(0.582)) };
        updateCursor(this.attempt, this.app.renderer.cam, this.app.renderer.cursor, abs);
      } else updateCursor(this.attempt, this.app.renderer.cam, this.app.renderer.cursor, rel);
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
  isFullscreen() {   // F11 (display-mode) or the Fullscreen API
    return !!document.fullscreenElement || matchMedia('(display-mode: fullscreen)').matches || (innerWidth >= screen.width - 1 && innerHeight >= screen.height - 1);
  }
  // asks for fullscreen from a click (Play / Resume); resolves true when the page is fullscreen
  async enterFullscreen() {
    if (!this.isFullscreen()) { try { await document.documentElement.requestFullscreen?.(); } catch { /* needs a user gesture */ } }
    return this.isFullscreen();
  }

  togglePause(force) {
    const r = this.runner, a = this.attempt; if (a.Stopped) return;
    const show = force ?? !this.paused;
    if (show === this.paused) return;
    if (!show && this.app.settings.AbsoluteInput && !this.isFullscreen()) {   // resume is blocked until fullscreen
      this.enterFullscreen().then((ok) => { if (ok) this.togglePause(false); else notify('Absolute Input needs fullscreen. Press F11.'); });
      return;
    }
    if (r.ObjectIndicesStart.Note > 0 && a.Progress < a.Map.Notes[a.Map.Notes.length - 1].Millisecond) a.Qualifies = false;
    this.paused = show; r.Playing = !show;
    this.app.sound.song.pitchScale = a.Speed; this.app.sound.song.setPaused(!r.Playing);
    this.showPause(show);
    this.app.menuCursor?.UpdateVisible(show && this.app.settings.UseCursorInMenus);   // PauseMenu.ShowMenu
    if (show) { if (document.pointerLockElement) document.exitPointerLock(); document.body.classList.remove('noNative'); } else { this.last = performance.now(); this.lockPointer(true); }
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
