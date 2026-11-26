// Port of scripts/game/camera/CameraLock.cs + the relevant parts of CursorManager.UpdateCursor
import { BOUNDS } from '../constants.js';
const f = Math.fround;                                   // Godot Vector2 is single precision
const clamp = (v) => Math.min(Math.max(v, -BOUNDS), BOUNDS);

export class CameraLock {
  get Name() { return 'Lock'; }
  get Rankable() { return true; }
  // camera/cursor are plain {position:[x,y,z]} targets owned by the renderer
  Process(attempt, camera, cursor, mouseDelta, sensitivity) {
    const s = attempt.Settings;
    // new Vector2(1, -1) * (mouseDelta * sensitivity / 120f)
    const dx = f(f(mouseDelta.x * sensitivity) / 120), dy = -f(f(mouseDelta.y * sensitivity) / 120);
    if (s.CursorDrift) {
      attempt.CursorPosition = { x: clamp(f(attempt.CursorPosition.x + dx)), y: clamp(f(attempt.CursorPosition.y + dy)) };
    } else {
      attempt.RawCursorPosition = { x: f(attempt.RawCursorPosition.x + dx), y: f(attempt.RawCursorPosition.y + dy) };
      attempt.CursorPosition = { x: clamp(attempt.RawCursorPosition.x), y: clamp(attempt.RawCursorPosition.y) };
    }
    const parallax = s.CameraParallax;
    camera.position = [f(attempt.CursorPosition.x * f(parallax)), f(attempt.CursorPosition.y * f(parallax)), 3.75];
    camera.rotation = [0, 0, 0];
    cursor.position = [attempt.CursorPosition.x, attempt.CursorPosition.y, 0];
  }
}

// CursorManager.UpdateCursor (replays not in scope)
export function updateCursor(attempt, camera, cursor, inputDelta) {
  const s = attempt.Settings;
  let sensitivity = f(s.Sensitivity);                     // (float)(double)settings.Sensitivity
  if (s.AbsoluteInput && !attempt.IsReplay) sensitivity = f(s.AbsoluteSensitivity);
  sensitivity = f(sensitivity * f(f(s.FoV) / 70));        // sensitivity *= (float)(double)settings.FoV / 70f
  if (s.AbsoluteInput || attempt.IsReplay) {              // repositionAbsolute: the cursor is recomputed from the absolute position every time
    camera.rotation = [0, 0, 0]; attempt.RawCursorPosition = { x: 0, y: 0 }; attempt.CursorPosition = { x: 0, y: 0 };
  }
  attempt.CameraMode.Process(attempt, camera, cursor, inputDelta, sensitivity);
}
