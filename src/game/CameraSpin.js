// Port of scripts/game/camera/CameraSpin.cs. camera.rotation is Godot's Camera3D.Rotation (euler, YXZ order), float32 like Vector3.
import { BOUNDS } from '../constants.js';
const f = Math.fround;
const clamp = (v) => Math.min(Math.max(v, -BOUNDS), BOUNDS);
const DEG90 = f(Math.PI / 2);

// Basis.FromEuler(rotation, YXZ).Z (z rotation stays 0 here): (sin y cos x, -sin x, cos y cos x)
export const basisZ = ([x, y]) => [f(Math.sin(y) * Math.cos(x)), f(-Math.sin(x)), f(Math.cos(y) * Math.cos(x))];

export class CameraSpin {
  get Name() { return 'Spin'; }
  get Rankable() { return true; }
  Process(attempt, camera, cursor, mouseDelta, sensitivity) {
    const s = attempt.Settings, PI = f(Math.PI);
    let [rx, ry, rz] = camera.rotation ?? [0, 0, 0];
    if (!attempt.IsReplay) {   // camera.Rotation += (-mouseDelta.Y / 120 * sensitivity / PI, -mouseDelta.X / 120 * sensitivity / PI, 0)
      rx = f(rx + f(f(f(-mouseDelta.y / 120) * sensitivity) / PI));
      ry = f(ry + f(f(f(-mouseDelta.x / 120) * sensitivity) / PI));
    } else {                   // camera.Rotation += (mouseDelta.Y / PI, -mouseDelta.X / PI, 0)
      rx = f(rx + f(mouseDelta.y / PI));
      ry = f(ry + f(-mouseDelta.x / PI));
    }
    rx = Math.min(Math.max(rx, -DEG90), DEG90);
    camera.rotation = [rx, ry, rz];
    const z = basisZ(camera.rotation), parallax = f(s.CameraParallax);
    // position = (0, 0, 3.5) + cursorLock * parallax + Basis.Z / 4 (the pivot mimics ROBLOX's orbital camera)
    const px = f(f(attempt.CursorPosition.x * parallax) + f(z[0] / 4)), py = f(f(attempt.CursorPosition.y * parallax) + f(z[1] / 4)), pz = f(3.5 + f(z[2] / 4));
    camera.position = [px, py, pz];
    // project the cursor along the camera's ray onto z = 0
    const k = Math.abs(f(pz / z[2]));
    attempt.RawCursorPosition = { x: f(px - f(z[0] * k)), y: f(py - f(z[1] * k)) };
    attempt.CursorPosition = { x: clamp(attempt.RawCursorPosition.x), y: clamp(attempt.RawCursorPosition.y) };
    if (Number.isFinite(attempt.CursorPosition.x) && Number.isFinite(attempt.CursorPosition.y)) cursor.position = [attempt.CursorPosition.x, attempt.CursorPosition.y, 0];
  }
}
