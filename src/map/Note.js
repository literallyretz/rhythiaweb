// Port of scripts/map/objects/Note.cs + HitResult.cs
import { HIT_BOX_SIZE } from '../constants.js';
export const HitResult = { None: 0, Hit: 1, Miss: 2 };

export class Note {
  constructor(index, millisecond, x, y) {
    this.Id = 1;                 // ObjectType.Note
    this.Index = index;
    this.Millisecond = millisecond;
    this.X = x; this.Y = y;
    this.HitWindow = 55;
    this.Hittable = false;
    this.LastResult = HitResult.None;
    this.Opacity = 1;
  }
  Hit(runner, playSound = true) {
    if (this.LastResult !== HitResult.None) return;
    this.LastResult = HitResult.Hit;
    runner.emit('hitResultChanged', this.Index, this.LastResult);
    if (playSound) runner.sound.playHitSound();
  }
  Miss(runner, playSound = true) {
    if (this.LastResult !== HitResult.None) return;
    this.LastResult = HitResult.Miss;
    runner.emit('hitResultChanged', this.Index, this.LastResult);
    if (playSound) runner.sound.playMissSound();
  }
  DoProcess(runner) {
    const a = runner.Attempt;
    return this.Millisecond >= a.StartFrom && this.Millisecond - a.Progress <= 0 && this.LastResult === HitResult.None;
  }
  Process(runner) {
    const a = runner.Attempt;
    if (!this.Hittable) {
      this.Hittable = true;
      if (a.Settings.AlwaysPlayHitSound) runner.sound.playHitSound();
    }
    const late = this._isPastWindow(runner, this.HitWindow);
    const replayLateness = a.IsReplay && a.Replays.length === 1 ? a.Replays[0].Notes[this.Index] : 0;
    if (late && (!a.IsReplay || replayLateness === -1)) this.Miss(runner);
    else if ((!a.IsReplay && this.CheckHitResult(a) === HitResult.Hit) || (a.IsReplay && replayLateness !== -1 && this._isPastWindow(runner, replayLateness))) this.Hit(runner);
  }
  CheckHitResult(a) {
    const c = a.CursorPosition;
    if (c.x + HIT_BOX_SIZE >= this.X - 0.5 && c.x - HIT_BOX_SIZE <= this.X + 0.5 &&
        c.y + HIT_BOX_SIZE >= this.Y - 0.5 && c.y - HIT_BOX_SIZE <= this.Y + 0.5) return HitResult.Hit;
    return HitResult.Miss;
  }
  _isPastWindow(runner, hitWindow) {
    return this.Millisecond < runner.Attempt.Progress - hitWindow * runner.Speed;
  }
}
