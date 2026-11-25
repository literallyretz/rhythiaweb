// Port of scripts/game/camera/CameraLock.cs + the relevant parts of CursorManager.UpdateCursor
import { BOUNDS } from '../constants.js';
const clamp = (v) => Math.min(Math.max(v, -BOUNDS), BOUNDS);

export class CameraLock {
  get Name() { return 'Lock'; }
  get Rankable() { return true; }
  // camera/cursor are plain {position:[x,y,z]} targets owned by the renderer
  Process(attempt, camera, cursor, mouseDelta, sensitivity) {
    const s = attempt.Settings;
    const dx = mouseDelta.x * sensitivity / 120, dy = -(mouseDelta.y * sensitivity / 120);
    if (s.CursorDrift) {
      attempt.CursorPosition = { x: clamp(attempt.CursorPosition.x + dx), y: clamp(attempt.CursorPosition.y + dy) };
    } else {
      attempt.RawCursorPosition = { x: attempt.RawCursorPosition.x + dx, y: attempt.RawCursorPosition.y + dy };
      attempt.CursorPosition = { x: clamp(attempt.RawCursorPosition.x), y: clamp(attempt.RawCursorPosition.y) };
    }
    const parallax = s.CameraParallax;
    camera.position = [attempt.CursorPosition.x * parallax, attempt.CursorPosition.y * parallax, 3.75];
    camera.rotation = [0, 0, 0];
    cursor.position = [attempt.CursorPosition.x, attempt.CursorPosition.y, 0];
  }
}

// CursorManager.UpdateCursor (relative input path; absolute input / replays not in scope)
export function updateCursor(attempt, camera, cursor, inputDelta) {
  const s = attempt.Settings;
  let sensitivity = s.Sensitivity;
  sensitivity *= s.FoV / 70;
  attempt.CameraMode.Process(attempt, camera, cursor, inputDelta, sensitivity);
}
