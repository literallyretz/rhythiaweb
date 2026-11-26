export const fround = Math.fround;
// Util.Misc.BinarySearch
export function binarySearch(values, time) {
  let left = 0, right = values.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (time < values[mid]) right = mid; else left = mid + 1;
  }
  return left - 1;
}
// Util.String.PadMagnitude -> double.ToString("N0")
export function padMagnitude(v) { return Math.round(v).toLocaleString('en-US'); }
// SoundManager.ComputeVolumeDb
// SoundManager.ComputeVolumeDb(float volume, float master, float range) -> float
export function computeVolumeDb(volume, master, range) {
  volume = fround(volume); master = fround(master); range = fround(range);
  if (volume <= 0 || master <= 0) return -Infinity;
  return fround(-80 + range * Math.pow(volume / 100, 0.1) * Math.pow(master / 100, 0.1));
}
export const dbToLinear = (db) => (db === -Infinity ? 0 : Math.pow(10, db / 20));
// C# (int) cast of a double: truncation toward zero
export const toInt = (x) => Math.trunc(x);
export function hexColor(hex) { // "ff0059" -> [r,g,b] 0..1
  const h = hex.trim().replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

// Util.Misc.ParseColor(hex, fallback): blank -> fallback; Trim, prepend '#' if missing, Color.FromHtml; an exception -> fallback. Returns [r, g, b] 0..1.
// Color.FromHtml (GodotSharp Color.cs): '#' stripped; 3/4 digits = one hex digit per channel /15, 6/8 digits = two /255; other lengths throw. A channel
// < 0 throws, but ParseCol8 = hi*16 + lo, so a bad low digit after a non-zero high digit gives hi*16 - 1 and is accepted (kept, as in the engine).
export function parseColor(hex, fallback = [1, 1, 1]) {
  if (hex == null || hex.trim() === '') return fallback;
  let h = hex.trim(); if (!h.startsWith('#')) h = '#' + h;
  h = h.slice(1);
  const c4 = (i) => { const k = '0123456789abcdef'.indexOf(h[i]?.toLowerCase()); return k; }, c8 = (i) => c4(i) * 16 + c4(i + 1);
  let ch;
  if (h.length === 3 || h.length === 4) ch = [0, 1, 2].map((i) => c4(i) / 15);
  else if (h.length === 6 || h.length === 8) ch = [0, 2, 4].map((i) => c8(i) / 255);
  else return fallback;
  if (h.length === 4 && c4(3) < 0) return fallback; if (h.length === 8 && c8(6) < 0) return fallback;   // alpha part checked too
  return ch.some((v) => v < 0) ? fallback : ch;
}

// Port of scripts/util/bindables/Bindable.cs: setting Value always raises ValueChanged(this, {Value, OldValue}), even for an equal value
export class Bindable {
  constructor(defaultValue) { this.ValueChanged = []; this.Default = defaultValue; this.value = defaultValue; }
  get Value() { return this._v; }
  set Value(v) { const old = this._v; this._v = v; for (const f of this.ValueChanged) f(this, { Value: v, OldValue: old }); }
  get value() { return this.Value; }
  set value(v) { this.Value = v; }
  Dispose() { this.ValueChanged = []; }
}
