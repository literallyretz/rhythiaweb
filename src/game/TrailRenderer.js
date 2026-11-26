// Port of scripts/game/renderers/TrailRenderer.cs (+ CursorTrailData.cs). The CursorTrail MultiMesh of game.tscn is kept as `mm`: like
// Multimesh.InstanceCount / SetInstanceTransform / SetInstanceColor it is only rewritten while the trail is processing, so it freezes
// as-is when the setting is off or the runner is paused. GameRenderer draws `mm` (quad 1x1 scaled by size, rotated about +Z, colour (1,1,1,alpha)).
const f = Math.fround;
const TRAIL_SPAWN_RATE = 240, TRAIL_MIN_DETAIL = 0, TRAIL_MAX_DETAIL = 100;
const nowUsec = () => Math.floor(performance.now() * 1000);   // Time.GetTicksUsec()

export class TrailRenderer {
  constructor() { this.reset(); }
  reset() { this.data = []; this.acc = 0; this.mm = { size: 0, inst: [] }; }   // new Game scene / _ExitTree: activeTrailsData.Clear(), InstanceCount = 0

  // _Process(delta): delta in seconds; cursorRot = cursor.Rotation.Z (radians); size = cursor mesh size.X
  process(delta, attempt, runner, settings, cursorRot, size) {
    if (!settings.CursorTrail || !runner.Playing) return;
    const now = nowUsec();
    this.spawn(delta, now, attempt, settings, cursorRot);
    this.cull(now, settings);
    this.render(now, attempt, settings, size);
  }

  spawn(delta, now, attempt, settings, cursorRot) {            // processTrailSpawning
    const trailDetail = f(Math.min(Math.max(settings.TrailDetail, TRAIL_MIN_DETAIL), TRAIL_MAX_DETAIL));
    const wantedEmission = f(trailDetail / TRAIL_MAX_DETAIL);
    const rate = f(wantedEmission * TRAIL_SPAWN_RATE);
    if (rate <= 0) return;
    const interval = 1.0 / rate;
    this.acc += delta;
    const steps = Math.trunc(this.acc / interval);
    if (steps <= 0) return;
    this.data.push({ time: now, x: f(attempt.CursorPosition.x), y: f(attempt.CursorPosition.y), rot: cursorRot });   // one entry per frame, however many steps
    this.acc -= interval * steps;
  }

  cull(now, settings) {                                        // cullExpiredTrails
    const maxLife = Math.trunc(settings.TrailTime * 1_000_000);
    for (let i = this.data.length - 1; i >= 0; i--) if (now - this.data[i].time >= maxLife) this.data.splice(i, 1);
  }

  render(now, attempt, settings, size) {                       // updateTrailRendering
    const inst = [], cp = attempt.CursorPosition;
    for (const t of this.data) {
      if (f(Math.hypot(f(t.x - cp.x), f(t.y - cp.y))) === 0) { inst.push({ x: t.x, y: t.y, rot: t.rot, a: 0 }); continue; }   // cursor hasn't moved: alpha 0
      const elapsed = f(f(now - t.time) / 1_000_000);
      const step = f(Math.min(Math.max(elapsed / settings.TrailTime, 0), 1));
      inst.push({ x: t.x, y: t.y, rot: t.rot, a: f(1 + f((0 - 1) * step)) });   // Mathf.Lerp(1, 0, step)
    }
    this.mm = { size, inst };
  }
}
