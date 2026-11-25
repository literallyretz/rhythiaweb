// Port of scripts/game/Attempt.cs (replay / modifier / camera-spin fields intentionally omitted)
import { CameraLock } from './CameraLock.js';
import { hexColor } from '../util/misc.js';

export class Attempt {
  constructor(map, speed, startFrom, settings, noteColors, songLengthSec = 0) {
    this.ID = `${map.Name}_${new Date().toISOString().replace(/:/g, '_')}`;
    this.Settings = settings;
    this.Map = map;
    this.Speed = speed;
    this.StartFrom = startFrom;
    this.CameraMode = new CameraLock();
    this.Modifiers = [];
    this.Stopped = false; this.Paused = false; this.Alive = true; this.CanSkip = false; this.Qualifies = true;
    this.DeathTime = -1;
    this.IsReplay = false;
    this.UseFadeOut = true;

    this.Length = Math.max(1000 * songLengthSec, map.Length + 1000);
    this.Progress = speed * -1000 - settings.ApproachTime * 1000 + startFrom;

    this.Accuracy = 100; this.Health = 100; this.HealthStep = 15; this.HasHealthModifier = false;
    this.Hits = 0; this.Misses = 0; this.Sum = 0; this.Score = 0; this.Combo = 0;
    this.ComboMultiplier = 1; this.ComboMultiplierProgress = 0;
    this.ComboMultiplierIncrement = Math.max(2, Math.floor(map.Notes.length / 200));
    this.ModsMultiplier = 1;
    this.HitsInfo = new Float32Array(map.Notes.length);
    this.ReplaySkips = [];
    this.DistanceMM = 0;

    this.CursorPosition = { x: 0, y: 0 };
    this.RawCursorPosition = { x: 0, y: 0 };

    this.Objects = { Note: [...map.Notes] };
    this.FirstNote = 0;
    if (this.StartFrom > 0) {
      this.Qualifies = false;
      for (const note of map.Notes) { this.FirstNote = note.Index; if (note.Millisecond >= this.StartFrom) break; }
    }
    // int index = (int)(FirstNote - 1) % NoteColors.Length; index<0 ? ^abs(index) (i.e. from the end)
    const colors = noteColors;
    const index = (this.FirstNote - 1) % colors.length;
    this.LastHitColour = colors[index >= 0 ? index : colors.length - Math.abs(index)];
  }
}
