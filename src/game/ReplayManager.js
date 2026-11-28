// Port of scripts/game/managers/ReplayManager.cs and the ReplayViewer node of scenes/game.tscn
// (Pause button, Time label, Seek slider, Tip label, Background panel; the OrthogonalPanel is drawn by GameRenderer).
import { Writer, sha256, replayPath } from '../map/Replay.js';
import { MapManager } from '../map/MapManager.js';
import { HitResult } from '../map/Note.js';
// Util.String.FormatTime
const formatTime = (sec) => { const m = Math.floor(Math.abs(sec) / 60), s = Math.floor(Math.abs(sec) % 60); return `${sec < 0 ? '-' : ''}${m}:${String(s).padStart(2, '0')}`; };

export const Mode = { NONE: 0, RECORD: 1, PLAYBACK: 2 };

export class ReplayManager {
  constructor(game) {
    this.game = game; this.CurrentMode = Mode.NONE; this.ViewerVisible = false; this.CanShow = false;
    this.ReplayLength = 0; this.ReplayPath = null; this.CursorPosition = { x: 0, y: 0 }; this.file = null;
    const v = this.viewer = document.createElement('div'); v.id = 'replayViewer';
    v.innerHTML = '<div class="rvBg"></div><div class="rvTip">Press F2 to hide replay UI, F3 to hide orthogonal camera, F to toggle note fade out, P to toggle note pushback</div>'
      + '<div class="rvTime">0:00 / 0:00</div><button class="rvPause" tabindex="-1"><img src="assets/textures/ui/pause.png" alt=""></button>'
      + '<div class="slider rvSeek" tabindex="-1"><div class="rail"></div><div class="fill"></div><div class="grab"></div></div>';
    document.getElementById('hud').appendChild(v);
    const q = (s) => v.querySelector(s);
    this.bg = q('.rvBg'); this.tip = q('.rvTip'); this.time = q('.rvTime'); this.pause = q('.rvPause'); this.pauseImg = this.pause.firstChild; this.seek = q('.rvSeek');
    this.fill = q('.rvSeek .fill'); this.grab = q('.rvSeek .grab');
    this.seekValue = 0; this.seekerHovered = false;
    this.pause.onclick = () => this.TogglePause();
    // HSlider (max 1, step 0): ValueChanged updates the time; DragEnded seeks and releases focus; focus = seekerHovered
    const fromX = (x) => { const r = this.seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - r.left) / r.width)); };
    this.seek.onpointerdown = (e) => { this.seek.setPointerCapture(e.pointerId); this.seek.classList.add('drag'); this.seekerHovered = true; this.setSeekValue(fromX(e.clientX)); e.preventDefault(); e.stopPropagation(); };
    this.seek.onpointermove = (e) => { if (this.seek.hasPointerCapture(e.pointerId)) this.setSeekValue(fromX(e.clientX)); };
    this.seek.onpointerup = (e) => {
      if (!this.seek.hasPointerCapture(e.pointerId)) return;
      this.seek.releasePointerCapture(e.pointerId); this.seek.classList.remove('drag');
      this.Seek(this.seekValue); this.seekerHovered = false;
    };
    this.show(false);
  }

  setSeekValue(value) {
    if (value === this.seekValue && this._drawn) return; this.seekValue = value; this._drawn = true;
    const w = this.seek.clientWidth, x = value * w; this.grab.style.left = `${x - 16}px`; this.fill.style.width = `${x}px`;
    this.time.textContent = `${formatTime(value * this.ReplayLength / 1000)} / ${formatTime(this.ReplayLength / 1000)}`;
  }

  // ---- recording ----
  NewReplay(attempt) {
    const settings = attempt.Settings;
    this.file = null;
    if (!settings.RecordReplays) return;   // || Rhythia.TempMode
    this.ReplayPath = replayPath(attempt.ID);
    const f = this.file = new Writer();
    f.str('phxr'); f.u8(1);
    f.f64(attempt.Speed); f.f64(attempt.StartFrom); f.f64(settings.ApproachRate); f.f64(settings.ApproachDistance); f.f64(settings.FadeIn);
    f.u8(settings.FadeOut > 0 ? 1 : 0); f.u8(settings.Pushback ? 1 : 0);
    f.f64(settings.CameraParallax); f.f64(settings.FoV); f.f64(settings.NoteSize); f.f64(settings.Sensitivity);
    this.statusOffset = f.p; f.u8(0);
    const mods = attempt.Modifiers.map((m) => m.Name);
    if (attempt.CameraMode.Name === 'Spin') mods.push('Spin');   // temp until replays are redone
    f.sized(mods.join('_')); f.sized(attempt.Map.Name); f.u64(attempt.Map.Notes.length); f.sized('You');
    this.frameCountOffset = f.p; f.u64(0);   // reserve frame count
  }

  SaveReplay(attempt) {
    const f = this.file; if (!f) return null;
    this.file = null;
    f.seek(this.statusOffset); f.u8(attempt.Alive ? (attempt.Qualifies ? 0 : 1) : 2);
    f.seek(this.frameCountOffset); f.u64(attempt.ReplayFrames.length);
    for (const fr of attempt.ReplayFrames) { f.f32(fr[0]); f.f32(fr[1]); f.f32(fr[2]); }
    f.seek(f.len); f.u64(attempt.FirstNote); f.u64(attempt.Sum);
    const low = Math.max(0, attempt.FirstNote), high = Math.max(low, attempt.FirstNote + attempt.Sum);
    const hits = attempt.HitsInfo.subarray(low, high);
    for (let i = 0; i < hits.length; i++) f.u8(hits[i] === -1 ? 255 : Math.trunc(Math.min(254, Math.fround(hits[i] * 4))));   // (byte)Math.Min(254, lateness * (254 / 55))
    f.u64(attempt.ReplaySkips.length);
    for (const s of attempt.ReplaySkips) f.f32(s);
    const body = f.bytes(), path = this.ReplayPath;
    attempt.ReplayPath = path;
    attempt.replaySaved = (async () => { const out = new Uint8Array(body.length + 32); out.set(body); out.set(await sha256(body), body.length); await MapManager.writeFile(path, out); })();
    return attempt.replaySaved;
  }

  // ---- playback ----
  InitReplayLength(attempt) { if (attempt?.IsReplay) this.ReplayLength = attempt.MaxReplayLength; }

  Process(runner) {   // _Process
    const a = runner.Attempt;
    if (!a.IsReplay || !runner.Playing) return;
    if (!this.seekerHovered) {
      this.setSeekValue(a.Progress / a.MaxReplayLength);
      if (a.Progress > this.ReplayLength && runner.Playing) this.TogglePause();
    }
    this.updateCursors();
  }

  show(visible) { for (const e of [this.pause, this.time, this.seek, this.tip, this.bg]) e.style.visibility = visible ? 'visible' : 'hidden'; }
  ShowReplayViewer(attempt, show = null) {
    this.ViewerVisible = show ?? !this.ViewerVisible;
    const visible = this.ViewerVisible && attempt.IsReplay;
    this.show(visible);
    if (attempt.IsReplay) this.game.setReplayMouse(visible);   // Input.MouseMode = visible ? Visible : Hidden
  }
  ShowOrthonogalCamera(attempt, show = null) {
    this.CanShow = show ?? !this.CanShow;
    this.game.app.renderer.showOrtho = this.CanShow && attempt.IsReplay;
  }

  TogglePause() {
    const r = this.game.runner;
    r.Pause();
    this.pauseImg.src = r.Playing ? 'assets/textures/ui/pause.png' : 'assets/textures/ui/play.png';
  }

  Seek(seekedTime) {
    const runner = this.game.runner, att = runner.Attempt;
    seekedTime *= this.ReplayLength;
    att.Hits = 0; att.Misses = 0; att.Sum = 0; att.Accuracy = 100; att.Score = 0; att.Combo = 0; att.ComboMultiplier = 1; att.ComboMultiplierProgress = 0;
    att.Health = 100; att.HealthStep = 15; att.Alive = true; att.Qualifies = true;
    for (let i = 0; i < att.Map.Notes.length; i++) {
      const note = att.Map.Notes[i];
      note.Hittable = false; note.LastResult = HitResult.None;
      if (note.Millisecond > Math.max(att.Progress, seekedTime)) break;
      else if (note.Millisecond < seekedTime && note.Index >= att.FirstNote) {
        if (att.Replays[0].Notes[i] === -1) note.Miss(runner, false); else note.Hit(runner, false);
      }
    }
    if (att.Progress > this.ReplayLength && seekedTime <= this.ReplayLength && !runner.Playing) this.TogglePause();
    runner.Seek(seekedTime);
    runner.emit('attemptStatsUpdated', att);
    const r0 = att.Replays[0];
    for (let i = 0; i < r0.Frames.length; i++) if (att.Progress < r0.Frames[i].Progress) { r0.FrameIndex = Math.max(0, i - 1); break; }
    this.updateCursors();
  }

  updateCursors() {
    const a = this.game.runner.Attempt, cm = this.game.cursorManager;
    for (let i = 0; i < a.Replays.length; i++) {
      const replay = a.Replays[i], F = replay.Frames;
      if (replay.FrameIndex === F.length - 1) continue;
      // advance frame forward deterministically making sure frames only advance when allowed
      while (replay.FrameIndex < F.length - 1 && a.Progress >= F[replay.FrameIndex + 1].Progress) {
        replay.FrameIndex++;
        if (replay.FrameIndex === F.length - 1) cm.HideCursor(i, false);
      }
      const next = Math.min(replay.FrameIndex + 1, F.length - 1);
      const cur = F[replay.FrameIndex], nxt = F[next];
      const inv = cur.Progress === nxt.Progress ? 0 : (a.Progress - cur.Progress) / (nxt.Progress - cur.Progress);   // Mathf.InverseLerp
      const t = Math.fround(Math.min(Math.max(inv, 0), 1));
      this.CursorPosition = { x: Math.fround(cur.CursorPosition.x + (nxt.CursorPosition.x - cur.CursorPosition.x) * t), y: Math.fround(cur.CursorPosition.y + (nxt.CursorPosition.y - cur.CursorPosition.y) * t) };
      cm.UpdateCursor(this.CursorPosition, i);
      cm.ShowCursor(i);
    }
  }
}
