// Port of scenes/Game.cs + PlayerInputController.cs + PauseMenu.cs (flow only; logic lives in game/Runner.js).
import { Attempt } from '../game/Attempt.js';
import { Runner } from '../game/Runner.js';
import { TrailRenderer } from '../game/TrailRenderer.js';
import { CURSOR_SIZE } from '../constants.js';
import { updateCursor } from '../game/CameraLock.js';
import { BOUNDS } from '../constants.js';
import { Hud } from './Hud.js';
import { SettingsManager } from '../SettingsManager.js';
import { tweenOpacity } from '../util/tween.js';
import { notify } from '../ui/Toast.js';
import { Lobby } from '../Lobby.js';
import { Stats } from '../Stats.js';
import { MapManager } from '../map/MapManager.js';
import { ReplayManager, Mode } from '../game/ReplayManager.js';

export const STEP_MS = 1000 / 120; // project.godot physics_ticks_per_second=120 (HUD-only _PhysicsProcess)

const FIREFOX = /Firefox\//.test(navigator.userAgent);
export class GameScene {
  constructor(app) {
    this.app = app; this.active = false; this.paused = false; this.trail = new TrailRenderer();
    this.hud = new Hud(document.getElementById('hudRoot'), document.getElementById('hudPersp'), app.canvas);
    // pointerrawupdate (secure contexts, Chromium) is dispatched per OS motion event instead of once per frame, like Godot's input events
    document.addEventListener('onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove', (e) => this.onMouseMove(e));
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
    this.replayManager = new ReplayManager(this);
    this.cursorManager = this.makeCursorManager();
  }

  // CursorManager: cursorMesh plus one duplicate per extra replay; its settings are the replay's profile while watching one
  makeCursorManager() {
    const game = this;
    return {
      settings: null, alphas: [], fades: [],
      init(attempt) {
        const ren = game.app.renderer;
        this.settings = attempt.IsReplay ? attempt.Replays[0].Settings : attempt.Settings;
        ren.cursors = [ren.cursor];
        if (attempt.IsReplay) for (let i = 1; i < attempt.Replays.length; i++) ren.cursors.push({ position: [0, 0, 0], rotation: 0 });
        this.alphas = ren.cursors.map(() => Math.min(Math.max(attempt.Settings.CursorOpacity, 0), 1)); this.fades = ren.cursors.map(() => null);
        ren.cursorAlphas = attempt.IsReplay ? this.alphas : null;   // Grid.Init sets the live opacity; replays overwrite it every frame
      },
      ShowCursor(i = 0, instant = true) {
        if (instant) this.alphas[i] = this.settings.CursorOpacity;                                   // Transparency = 1 - CursorOpacity
        else this.fades[i] = { from: this.alphas[i], t0: performance.now() };                        // CreateTween().TweenProperty(transparency, 1, 0.5)
      },
      HideCursor(i = 0, instant = true) { this.ShowCursor(i, instant); },
      process() { this.fades.forEach((f, i) => { if (!f) return; const t = Math.min(1, (performance.now() - f.t0) / 500); this.alphas[i] = f.from * (1 - t); if (t >= 1) this.fades[i] = null; }); },
      UpdateCursor(pos, i = 0) { const ren = game.app.renderer; updateCursor(game.runner.Attempt, ren.cam, ren.cursors[i], pos, this.settings, game.replayManager); },
    };
  }

  // Replays: the mouse is visible (no pointer lock) while the viewer shows, hidden otherwise
  setReplayMouse(visible) { if (document.pointerLockElement) document.exitPointerLock(); document.body.classList.toggle('noNative', !visible); this.replayMouseVisible = visible; }

  // spec: Game.Play(map, speed, startFrom, cameraMode, mods, players, replays); from the Lobby unless given
  async start(spec = null) {
    const app = this.app;
    spec ??= { speed: Lobby.Speed, startFrom: Lobby.StartFrom, mods: Lobby.Modifiers, cameraMode: Lobby.CameraMode, replays: null };
    this.spec = spec;
    // Game.Play / Game.Restart / Results.Replay: MapParser.Decode(...) on every attempt, so Note.LastResult/Hittable never carry over
    const map = await MapManager.decodeStored(app.map); map.decodedAudio = app.map.decodedAudio;   // (decoded audio is immutable, reused)
    this.stepCount = 0;
    const settings = app.settings;
    app.sound.song.stop(); app.sound.song.setStream(map.decodedAudio); app.sound.updateVolume();
    const attempt = new Attempt(map, spec.speed, spec.startFrom, settings, app.noteColors, map.decodedAudio ? map.decodedAudio.duration : 0, spec.mods, spec.cameraMode, spec.replays);
    // Attempt ctor: Length = max(1000 * song length, Map.Length + 1000)
    this.attempt = attempt;
    const runner = this.runner = new Runner(app.sound);
    runner.noteColors = app.noteColors;
    runner.onStop = (a) => this.finish(a);
    runner.updateAutoplayCursor = (pos) => {   // CursorManager.UpdateAutoplayCursor
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
      const r = this.app.renderer, s = this.app.settings;
      pos = { x: Math.min(Math.max(pos.x, -BOUNDS), BOUNDS), y: Math.min(Math.max(pos.y, -BOUNDS), BOUNDS) };
      if (attempt.CameraMode.Name === 'Spin') {   // aim the camera at the target and feed the difference through CameraSpin as mouse movement
        const fr = Math.fround, par = fr(s.CameraParallax), PI = fr(Math.PI), TAU = 2 * Math.PI;
        const o = [fr(attempt.CursorPosition.x * par), fr(attempt.CursorPosition.y * par), 3.5];
        const d = [pos.x - o[0], pos.y - o[1], 0 - o[2]], l = Math.hypot(...d);   // Basis.LookingAt(target - origin, Up).GetEuler() (YXZ)
        const ex = Math.asin(d[1] / l), ey = Math.atan2(-d[0], -d[2]);
        const pitch = fr(ex - r.cam.rotation[0]);
        const diff = (ey - r.cam.rotation[1]) % TAU, yaw = fr((2 * diff) % TAU - diff);   // Mathf.AngleDifference(from, to)
        attempt.CameraMode.Process(attempt, r.cam, r.cursor, { x: fr(-yaw * fr(120 * PI)), y: fr(-pitch * fr(120 * PI)) }, 1);
        return;
      }
      attempt.RawCursorPosition = { x: pos.x, y: pos.y }; attempt.CursorPosition = { x: pos.x, y: pos.y };
      r.cam.position = [Math.fround(pos.x * Math.fround(s.CameraParallax)), Math.fround(pos.y * Math.fround(s.CameraParallax)), 3.76];
      r.cam.rotation = [0, 0, 0]; r.cursor.position = [pos.x, pos.y, 0];
    };
    runner.on('attemptStatsUpdated', (a) => { a.HighestCombo = Math.max(a.HighestCombo ?? 0, a.Combo); });
    attempt.HighestCombo = 0;
    this.hud.init(attempt, runner);
    app.renderer.cam.position = [0, 0, 3.75]; app.renderer.cam.rotation = [0, 0, 0]; app.renderer.cursor.position = [0, 0, 0];
    app.renderer.noteHitColor = [1, 1, 1];
    // CursorManager._EnterTree; Runner.Play: Camera.Fov = settings.FoV (the replay's profile while watching one)
    this.cursorManager.init(attempt); runner.replayManager = this.replayManager;
    app.renderer.fov = attempt.IsReplay ? attempt.Replays[0].Settings.FoV : null;
    this.fadeoutToggleValue = -1;
    // Game._Ready: replay viewer, orthogonal camera, replay mode
    const rm = this.replayManager;
    rm.InitReplayLength(attempt); rm.ShowReplayViewer(attempt, attempt.IsReplay); rm.ShowOrthonogalCamera(attempt, attempt.IsReplay);
    rm.pauseImg.src = 'assets/textures/ui/pause.png';
    if (attempt.IsReplay) rm.CurrentMode = Mode.PLAYBACK;
    else if (attempt.Settings.RecordReplays && !attempt.Modifiers.some((m) => m.Name === 'Autoplay')) { rm.NewReplay(attempt); rm.CurrentMode = Mode.RECORD; }
    else rm.CurrentMode = Mode.NONE;
    runner.Play(attempt, settings);
    if (!attempt.IsReplay) {   // Game.cs after Runner.Play(); the attempt plays a decoded copy, so the count goes on MapManager's entry
      Stats.Instance.Attempts++;
      const stored = MapManager.GetMapById(attempt.Map.Id) ?? attempt.Map; stored.PlayCount++; attempt.Map.PlayCount = stored.PlayCount; MapManager.Update(stored);
    }
    this.app.sound.beginGameplayScope(attempt.Map);         // Runner.Play -> SoundManager.BeginGameplayScope
    this.app.renderer.cursor.rotation = 0;                  // CursorManager.Init: cursorMesh.Transform = Identity
    this.app.renderer.visAssist = settings.VisibilityAssist;   // Grid.Init: VisibilityAssist.Visible = setting (once per attempt)
    this.trail.reset(); this.app.renderer.trail = this.trail;   // fresh TrailRenderer per Game scene
    this.active = true; this.paused = false; this.acc = 0; this.last = performance.now();
    this.showPause(false, true);   // Game.cs: Menu.HideMenu(true)
    if (settings.AbsoluteInput && !attempt.IsReplay && !this.isFullscreen()) this.enterFullscreen().then((ok) => { if (!ok && this.active && !this.paused) { this.togglePause(true); notify('Absolute Input needs fullscreen. Press F11.'); } });
    this.app.menuCursor?.UpdateVisible(false, false);   // Game.cs: MenuCursor.Instance.UpdateVisible(false, false)
    document.getElementById('gameCanvas').style.visibility = 'visible';
    if (!attempt.IsReplay) this.lockPointer();   // Input.MouseMode = AbsoluteInput || IsReplay ? Visible : Captured
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
    // ReplayManager._Process (before Runner in game.tscn), then Runner._Process: once per rendered frame with the real frame time
    this.replayManager.Process(r); this.cursorManager.process();
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
    if (r.Playing) ren.cursor.rotation = Math.fround(ren.cursor.rotation + Math.fround(Math.fround(this.cursorManager.settings.CursorRotation) * Math.fround(dt / 1000)));   // CursorManager settings
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
    if (!this.active || !this.runner.Playing || this.attempt.IsReplay || this.attempt.Modifiers.some((m) => m.Name === 'Autoplay')) return;       // if (!Runner.Playing || IsReplay || Autoplay) return
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
    else if (e.code === 'Space') { if (this.attempt.IsReplay) this.replayManager.TogglePause(); else this.runner.Skip(); e.preventDefault(); }   // OnPauseOrSkipPressed
    else if (e.code === 'F2') { if (this.attempt.IsReplay) this.replayManager.ShowReplayViewer(this.attempt); e.preventDefault(); }   // OnToggleReplayViewerVisibility
    else if (e.code === 'F3') { if (this.attempt.IsReplay) this.replayManager.ShowOrthonogalCamera(this.attempt); e.preventDefault(); }   // OnToggleShowOrthonogalCamera
    else if (e.code === 'KeyF') {   // OnToggleFade
      const s = this.attempt.Settings; let val;
      if (s.FadeOut > 0) { this.fadeoutToggleValue = s.FadeOut; val = 0; } else val = this.fadeoutToggleValue === -1 ? 100 : this.fadeoutToggleValue;
      s.FadeOut = val;
    } else if (e.code === 'KeyP') this.attempt.Settings.Pushback = !this.attempt.Settings.Pushback;   // OnTogglePushback
  }

  onLockChange() {
    if (this.active && !this.attempt.IsReplay && document.pointerLockElement !== this.app.canvas && this.runner.Playing && !this.paused) { this.lockLostAt = performance.now(); this.togglePause(true); }
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
    if (show) { if (document.pointerLockElement) document.exitPointerLock(); document.body.classList.remove('noNative'); }
    else { this.last = performance.now(); if (a.IsReplay && this.replayManager.ViewerVisible) this.setReplayMouse(true); else this.lockPointer(true); }   // PauseMenu: IsReplay && ViewerVisible ? Visible : ...
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
    const a = this.attempt;
    this.start({ speed: a.Speed, startFrom: a.StartFrom, mods: a.Modifiers, cameraMode: a.CameraMode, replays: a.Replays });   // new Attempt from the old one's values
  }

  finish(attempt) {
    this.active = false; this.paused = false;
    if (document.pointerLockElement) document.exitPointerLock();
    document.getElementById('gameCanvas').style.visibility = 'hidden';
    this.showPause(false);
    this.app.showResults(attempt);
  }
}
