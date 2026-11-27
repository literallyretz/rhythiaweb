// Port of scripts/game/modifiers/*.cs and Rhythia.RegisterModifiers. The C# interfaces become flags:
// map = IMapModifier, render = IObjectRenderModifier<Note>, fail = IFailModifier, health = IHealthModifier.
// Render modifiers get the note's render state: { X, Y, Index, Transform: { x, y, z, rot }, Opacity } (rot = rotation about +Z, Vector3.Back).
import FastNoiseLite from '../vendor/FastNoiseLite.js';

const col = (hex) => [(hex >>> 24 & 255) / 255, (hex >>> 16 & 255) / 255, (hex >>> 8 & 255) / 255, (hex & 255) / 255];   // new Color(0xRRGGBBAA)
const upRotated = (rad) => [-Math.sin(rad), Math.cos(rad)];   // Vector3.Up.Rotated(Vector3.Back, rad), z stays 0
const f32 = Math.fround;

export class Modifier {   // Modifier.cs
  constructor() { this.Active = false; }
  get Rankable() { return false; }
  get ScoreMultiplier() { return 1; }
  get IncompatibleMods() { return []; }
  Activate(attempt) { this.Active = true; }
}

export class NoFailModifier extends Modifier {
  get Name() { return 'NoFail'; } get Color() { return col(0x20e12cff); }
  get fail() { return true; } get IsFail() { return false; }
  CheckFailCondition(_hit, _health) { return false; }
}

export class AutoplayModifier extends Modifier {
  get Name() { return 'Autoplay'; } get Color() { return col(0xffd166ff); }
  Activate(attempt) { super.Activate(attempt); attempt.Qualifies = false; }
}

export class GhostModifier extends Modifier {
  get Name() { return 'Ghost'; } get Color() { return col(0xffffffff); }
  get Rankable() { return true; } get ScoreMultiplier() { return 1.03; } get render() { return true; }
  Activate(attempt) { super.Activate(attempt); attempt.UseFadeOut = false; }
  ModifyRenderObject(note, attempt) {
    const ad = f32(attempt.Settings.ApproachDistance);
    note.Opacity -= Math.min(1, (ad + note.Transform.z) / (ad / 2));
  }
}

export class StrobeModifier extends Modifier {
  get Name() { return 'Strobe'; } get Color() { return col(0xffe854ff); }
  get Rankable() { return true; } get ScoreMultiplier() { return 1.035; } get render() { return true; }
  ModifyRenderObject(note, attempt) {
    const at = attempt.Settings.ApproachTime;
    if (attempt.Progress / 1000 / attempt.Speed % at >= at / 2) note.Opacity = 0;   // C# % on doubles = fmod, like JS %
  }
}

export class ChaosModifier extends Modifier {
  constructor() {
    super();
    // new FastNoiseLite(): Godot's defaults (modules/noise/fastnoise_lite.h): SIMPLEX_SMOOTH, seed 0, frequency 0.01, FBM 5 octaves, lacunarity 2, gain 0.5
    const n = this.noise = new FastNoiseLite(0);
    n.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S); n.SetFrequency(0.01);
    n.SetFractalType(FastNoiseLite.FractalType.FBm); n.SetFractalOctaves(5); n.SetFractalLacunarity(2); n.SetFractalGain(0.5); n.SetFractalWeightedStrength(0);
  }
  get Name() { return 'Chaos'; } get Color() { return col(0xff6198ff); }
  get Rankable() { return true; } get ScoreMultiplier() { return 1.015; } get render() { return true; }
  ModifyRenderObject(note, attempt) {
    const depth = Math.max(0, -note.Transform.z);
    if (depth > 0) {
      const n = f32(this.noise.GetNoise(note.X * 2, note.Y * 2, note.Index + f32(attempt.Progress / attempt.Speed / 400)));
      const [dx, dy] = upRotated(n * Math.PI * 4);
      const offset = Math.pow(depth / f32(attempt.Settings.ApproachDistance), 2);
      note.Transform.x += dx * offset; note.Transform.y += dy * offset;
    }
  }
}

export class VortexModifier extends Modifier {
  get Name() { return 'Vortex'; } get Color() { return col(0x9661ffff); }
  get Rankable() { return true; } get ScoreMultiplier() { return 1.02; } get render() { return true; }
  ModifyRenderObject(note, attempt) {
    let depth = Math.max(0, -note.Transform.z);
    if (depth > 0) {
      depth /= f32(attempt.Settings.ApproachDistance);
      let rotation = Math.pow(depth * 15, 1.5) / 60;
      const sine = Math.sin(attempt.Progress / attempt.Speed / 1000 * attempt.Settings.ApproachTime);
      rotation *= Math.sign(sine) * Math.pow(Math.abs(sine), 0.75);
      const T = note.Transform, c = Math.cos(rotation), s = Math.sin(rotation);   // Transform.Rotated(Back, r): basis and origin rotate about +Z
      const x = T.x * c - T.y * s, y = T.x * s + T.y * c; T.x = x; T.y = y; T.rot += rotation;
      const pull = Math.pow(depth * 0.85, 3) * Math.hypot(T.x, T.y);
      T.x -= T.x * pull; T.y -= T.y * pull;
    }
  }
}

export class EarthquakeModifier extends Modifier {
  get Name() { return 'Earthquake'; } get Color() { return col(0xff4400ff); }
  get Rankable() { return true; } get ScoreMultiplier() { return 1.01; } get render() { return true; }
  ModifyRenderObject(note, attempt) {
    const depth = Math.max(0, -note.Transform.z);
    if (depth > 0) {
      const rad = (Math.floor(Math.random() * 360) - 180) * (Math.PI / 180);   // random.Next(-180, 180): -180..179
      const [dx, dy] = upRotated(rad);
      const offset = Math.pow(depth / f32(attempt.Settings.ApproachDistance), 1.5) / 2;
      note.Transform.x += dx * offset; note.Transform.y += dy * offset;
    }
  }
}

export class HorizontalFlipModifier extends Modifier {
  get Name() { return 'HFlip'; } get Color() { return col(0xffffffff); }
  get Rankable() { return true; } get map() { return true; }
  ModifyMap(map, attempt) { for (const n of map.Notes) n.X = -n.X; }
}

export class VerticalFlipModifier extends Modifier {
  get Name() { return 'VFlip'; } get Color() { return col(0xffffffff); }
  get Rankable() { return true; } get map() { return true; }
  ModifyMap(map, attempt) { for (const n of map.Notes) n.Y = -n.Y; }
}

// Rhythia.RegisterModifiers
export const Modifiers = [new NoFailModifier(), new AutoplayModifier(), new GhostModifier(), new StrobeModifier(), new ChaosModifier(),
  new VortexModifier(), new EarthquakeModifier(), new HorizontalFlipModifier(), new VerticalFlipModifier()];
