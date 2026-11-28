// Port of scripts/game/Runner.cs (gameplay loop, object processing, scoring, health, fail/stop).
// Godot signals -> a tiny emitter.
import { HitResult } from '../map/Note.js';
import { BREAK_TIME } from '../constants.js';
import { binarySearch, fround, toInt } from '../util/misc.js';
import { AutoplayHandler } from './AutoplayHandler.js';
import { recordScore } from '../map/Leaderboard.js';
import { Stats } from '../Stats.js';

export class Runner {
  constructor(sound) {
    this.sound = sound;
    this.Attempt = null;
    this.ObjectIndicesStart = {};
    this.ObjectIndicesEnd = {};
    this.Map = null;
    this.Speed = 1;
    this.Paused = false;
    this.Playing = false;
    this.StopQueued = false;
    this.settings = null;
    this.firstFrame = true;
    this.noteTimestamps = [];
    this.lastHitScore = 0;
    this._handlers = {};
    this.onStop = null; // SceneManager.Load("results") hook
    this.autoplayEnabled = false; this.autoplayHandler = null; this.hitResultProgressOverride = null;
    this.updateAutoplayCursor = null;   // CursorManager.UpdateAutoplayCursor (set by the Game scene)
  }
  on(name, fn) { (this._handlers[name] ??= []).push(fn); }
  off(name, fn) { this._handlers[name] = (this._handlers[name] ?? []).filter((f) => f !== fn); }
  emit(name, ...args) { for (const fn of this._handlers[name] ?? []) fn(...args); }

  // _Process(delta): delta in seconds. In the browser build this is driven by a fixed 120 Hz stepper.
  process(delta) {
    if (!this.Playing) return;
    if (this.firstFrame) { this.firstFrame = false; return; }
    const a = this.Attempt, s = this.settings;
    a.Progress += delta * 1000 * this.Speed;

    // De-sync corrector
    if (a.Progress > 0 && a.Progress < a.Length && !a.Stopped) {
      const song = this.sound.song;
      const audioDelay = a.Progress - s.LocalOffset - 1000 * (song.getPlaybackPosition() + this.sound.timeSinceLastMix());
      if (Math.abs(audioDelay / this.Speed) > Math.max(40, delta)) {
        song.pitchScale = Math.min(Math.max(this.Speed + audioDelay / 1000, Math.max(0.01, this.Speed - 0.5)), this.Speed + 0.5);
      } else if (Math.abs(song.pitchScale - this.Speed) > 1e-5) {
        song.pitchScale = this.Speed;
      }
    }

    if (this.autoplayEnabled) {
      this.updateAutoplayCursor?.(this.autoplayHandler.GetCursorPosition(a.Progress));
      this.processAutoplayHits();
    }

    // Save replay frame: every 1/60 s while recording (the original's "cursor moved" check compares array references, so it is always true)
    const now = performance.now() * 1000;
    if (!this.autoplayEnabled && !a.Stopped && s.RecordReplays && !a.Map.Ephemeral && now - a.LastReplayFrame >= 1000000 / 60) {
      a.LastReplayFrame = now;
      a.ReplayFrames.push([Math.fround(a.Progress), a.CursorPosition.x, a.CursorPosition.y]);
    }

    // Song state check
    if (a.Map.AudioBuffer != null) {
      const song = this.sound.song;
      const offsetProgress = a.Progress - s.LocalOffset;
      const songEnd = song.getLength() * 1000;
      if (!song.playing && offsetProgress >= 0 && offsetProgress < songEnd) song.play(offsetProgress / 1000);
      else if (song.playing && offsetProgress >= songEnd) song.stop();
    }

    // Skip check
    const passedNotes = this.ObjectIndicesStart.Note;
    const nextNoteMillisecond = passedNotes >= a.Map.Notes.length ? Number.MAX_SAFE_INTEGER : a.Map.Notes[passedNotes].Millisecond;
    if (nextNoteMillisecond - a.Progress >= BREAK_TIME * this.Speed) {
      const lastNoteMillisecond = passedNotes > 0 ? a.Map.Notes[passedNotes - 1].Millisecond : 0;
      const skipWindow = nextNoteMillisecond - BREAK_TIME - lastNoteMillisecond;
      if (skipWindow >= 1000 * this.Speed) {
        if (!a.CanSkip) { a.CanSkip = true; this.emit('skipAvailable', a); }
      }
    } else {
      a.CanSkip = false;
    }

    this.ProcessObjects();

    if (this.StopQueued || (a.Progress >= a.Length && !a.IsReplay)) {
      this.StopQueued = false;
      this.Stop();
    }
  }

  ProcessObjects() {
    const a = this.Attempt, s = this.settings;
    for (const type of Object.keys(a.Objects)) {
      const objects = a.Objects[type];
      const startIndex = this.ObjectIndicesStart[type];
      this.ObjectIndicesEnd[type] = objects.length;
      for (let i = startIndex; i < objects.length; i++) {
        const obj = objects[i];
        if (obj.DoProcess(this)) {
          obj.Process(this);
        } else {
          if (obj.Millisecond > a.Progress + s.ApproachTime * 1000 * this.Speed) {
            this.ObjectIndicesEnd[type] = Math.max(obj.Index, this.ObjectIndicesStart[type]);
            break;
          }
          if (obj.Index === this.ObjectIndicesStart[type] && obj.Millisecond < Math.max(a.Progress, a.StartFrom)) {
            this.ObjectIndicesStart[type]++;
          }
        }
      }
    }
  }

  Play(attempt, settings) {
    if (!attempt) return;
    this.Attempt = attempt;
    this.settings = attempt.IsReplay ? attempt.Replays[0].Settings : settings;   // the attempt itself keeps the live profile (renderers use it)
    this.Map = attempt.Map;
    this.Speed = attempt.Speed;
    this.ObjectIndicesStart = {}; this.ObjectIndicesEnd = {};
    for (const key of Object.keys(attempt.Objects)) {
      this.ObjectIndicesStart[key] = attempt.FirstNote;
      this.ObjectIndicesEnd[key] = attempt.Objects[key].length;
    }
    this.noteTimestamps = attempt.Objects.Note.map((n) => n.Millisecond);
    attempt.TimeStarted = performance.now();   // HudManager.Init(); Attempt.TimeStarted = Time.GetTicksUsec()
    if (!this._connected) { this._connected = true; this.on('hitResultChanged', (i, r) => this.onHitResultChanged(i, r)); }
    this.emit('attemptStatsUpdated', attempt);
    for (const mod of attempt.Modifiers) {   // map and render modifiers apply from the start (HudManager.DisplayModifier -> 'displayModifier')
      mod.Active = false;
      if (mod.map || mod.render) {
        mod.Activate(attempt); this.emit('displayModifier', mod);
        if (mod.map) mod.ModifyMap(attempt.Map, attempt);
      }
    }
    this.autoplayEnabled = attempt.Modifiers.some((m) => m.Name === 'Autoplay') && !attempt.IsReplay;
    if (this.autoplayEnabled) {
      for (const mod of attempt.Modifiers.filter((m) => m.Name === 'Autoplay')) { mod.Activate(attempt); this.emit('displayModifier', mod); }
      this.autoplayHandler = new AutoplayHandler(attempt);
    } else this.autoplayHandler = null;
    if (attempt.Map.AudioBuffer != null) this.sound.song.pitchScale = this.Speed;
    if (attempt.IsReplay) for (const r of attempt.Replays) r.FrameIndex = 0;
    this.Playing = true;
    this.firstFrame = true;
  }

  Pause(pause = null) {
    this.Playing = pause ?? !this.Playing;
    this.sound.song.pitchScale = this.Speed;
    this.sound.song.setPaused(!this.Playing);
    if (this.Playing) this.syncSongPosition();
  }

  Skip() {
    const a = this.Attempt;
    if (a.CanSkip) {
      a.ReplaySkips.push(a.Progress);
      const passedNotes = this.ObjectIndicesStart.Note;
      if (passedNotes >= a.Map.Notes.length) this.Stop();
      else this.Seek(a.Map.Notes[passedNotes].Millisecond - this.settings.ApproachTime * 1500 * this.Speed);
    }
  }

  processAutoplayHits() {
    const a = this.Attempt;
    if (!this.autoplayEnabled || a.IsReplay || !a.Objects.Note) return;
    const objects = a.Objects.Note;
    for (let i = this.ObjectIndicesStart.Note; i < objects.length; i++) {
      const n = objects[i];
      if (n.Millisecond > a.Progress) break;
      if (n.Millisecond < a.StartFrom || n.LastResult !== HitResult.None) continue;
      n.Hittable = true;
      try { this.hitResultProgressOverride = n.Millisecond; n.Hit(this); } finally { this.hitResultProgressOverride = null; }
    }
  }

  Seek(ms) {
    const a = this.Attempt;
    a.Progress = ms;
    this.autoplayHandler?.Reset(a.Progress);
    for (const key of Object.keys(a.Objects)) {
      this.ObjectIndicesStart[key] = binarySearch(this.noteTimestamps, ms) + 1;
      this.ObjectIndicesEnd[key] = a.Objects[key].length;
    }
    this.ProcessObjects();
    this.syncSongPosition();
  }

  Fail() {
    const a = this.Attempt;
    if (a.Alive) this.sound.playFailSound();
    if (!a.IsReplay) {
      a.Alive = false;
      a.Qualifies = false;
      if (a.DeathTime === -1) a.DeathTime = Math.max(0, a.Progress);
    }
  }

  GiveUp() { this.Fail(); this.Stop(); }

  QueueStop() {
    if (!this.Playing) return;
    this.Playing = false;
    this.StopQueued = true;
  }

  Stop(results = true) {
    const a = this.Attempt;
    if (a.Stopped) return;
    this.ProcessObjects(); // give objects a last chance
    this.Playing = false;
    this.StopQueued = false;
    a.Stopped = true;
    if (!this.autoplayEnabled && !a.IsReplay && this.replayManager?.CurrentMode === 1) this.replayManager.SaveReplay(a);   // Mode.RECORD
    if (!a.IsReplay) {   // && !Rhythia.TempMode (no temp mode in the browser)
      const st = Stats.Instance;
      st.GamePlaytime += Math.floor((performance.now() - a.TimeStarted) / 1000);
      st.TotalDistance += Math.trunc(a.DistanceMM);
      if (a.StartFrom === 0 && !this.autoplayEnabled) {   // personal bests: every attempt from the start that wasn't autoplayed, failed or not
        recordScore(a, this.Speed);
        if (a.Qualifies) {
          st.Passes++; st.TotalScore += a.Score;
          if (a.Accuracy === 100) st.FullCombos++;
          if (a.Score > st.HighestScore) st.HighestScore = a.Score;
          st.AverageAccuracy = (st.AverageAccuracy + a.Accuracy) / st.Passes;   // as in the original (not a true running mean)
        }
      }
      st.ForceUpdate();
    }
    if (results && this.onStop) this.onStop(a);
  }

  onHitResultChanged(noteIndex, hitResult) {
    const a = this.Attempt;
    const judgmentProgress = this.hitResultProgressOverride ?? a.Progress;
    // float lateness = (float)(((int)judgmentProgress - Notes[i].Millisecond) / Speed);
    const lateness = a.IsReplay ? a.HitsInfo[noteIndex] : fround((toInt(judgmentProgress) - a.Map.Notes[noteIndex].Millisecond) / this.Speed);
    // float factor = 1 - Math.Max(0, lateness - 25) / 150f;
    const factor = fround(1 - fround(Math.max(0, fround(lateness - 25)) / fround(150)));
    const hitScore = Math.floor(100 * a.ComboMultiplier * a.ModsMultiplier * factor * ((this.Speed - 1) / 2.5 + 1)) >>> 0;
    this.lastHitScore = hitScore;

    switch (hitResult) {
      case HitResult.Hit:
        a.Hits++; a.Sum++;
        a.Accuracy = Math.floor(fround(fround(a.Hits / a.Sum) * 10000)) / 100;   // Math.Floor(float*10000)/100 -> double division
        a.Combo++; a.ComboMultiplierProgress++;
        a.LastHitColour = this.noteColors[noteIndex % this.noteColors.length];
        a.Score += hitScore;
        if (!a.IsReplay) {
          Stats.Instance.NotesHit++;
          if (a.Combo > Stats.Instance.HighestCombo) Stats.Instance.HighestCombo = a.Combo;
          a.HitsInfo[noteIndex] = lateness;
        }
        if (a.ComboMultiplierProgress === a.ComboMultiplierIncrement) {
          if (a.ComboMultiplier < 8) {
            a.ComboMultiplierProgress = a.ComboMultiplier === 7 ? a.ComboMultiplierIncrement : 0;
            a.ComboMultiplier++;
          }
        }
        break;
      case HitResult.Miss:
        a.Misses++; a.Sum++;
        a.Accuracy = fround(Math.floor(fround(fround(a.Hits / a.Sum) * 10000)) / 100); // Mathf.Floor(...) / 100 stays float
        a.Combo = 0; a.ComboMultiplierProgress = 0;
        a.ComboMultiplier = Math.max(1, a.ComboMultiplier - 1);
        if (!a.IsReplay) { Stats.Instance.NotesMissed++; a.HitsInfo[noteIndex] = -1; }
        break;
      default: break;
    }

    if (hitResult !== HitResult.None) {
      const hit = hitResult === HitResult.Hit;
      this.updateHealth(hit);
      if (!a.IsReplay && a.Health <= 0 && a.Alive) this.Fail();
      if (this.checkFail(hit, a.Health)) this.QueueStop();
    }
    this.emit('attemptStatsUpdated', a);
  }

  updateHealth(hit) {
    const a = this.Attempt;
    if (a.HasHealthModifier) {
      for (const mod of a.Modifiers.filter((m) => m.health)) {
        a.Health = mod.ApplyHealthResult(hit, a.Health);
        if (!mod.Active) { mod.Activate(a); this.emit('displayModifier', mod); }
      }
      return;
    }
    if (hit) {
      a.HealthStep = Math.max(a.HealthStep / 1.45, 15);
      a.Health = Math.min(100, a.Health + a.HealthStep / 1.75);
    } else {
      a.Health = Math.max(0, a.Health - a.HealthStep);
      a.HealthStep = Math.min(a.HealthStep * 1.2, 100);
    }
  }

  checkFail(hit, health) {
    const a = this.Attempt, defaultFail = health <= 0; let fail = null;
    for (const mod of a.Modifiers) {
      if (!mod.fail) continue;
      fail = mod.CheckFailCondition(hit, health);
      if (fail !== defaultFail && !mod.Active) { mod.Activate(a); this.emit('displayModifier', mod); }
      if (fail === true) break;
    }
    return fail ?? defaultFail;
  }

  syncSongPosition() {
    const a = this.Attempt;
    if (a.Map.AudioBuffer != null) {
      const song = this.sound.song;
      if (!song.playing && this.Playing) song.play();
      song.seek((a.Progress - a.Settings.LocalOffset) / 1000);
    }
  }
}
