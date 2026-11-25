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
export function computeVolumeDb(volume, master, range) {
  if (volume <= 0 || master <= 0) return -Infinity;
  return -80 + range * Math.pow(volume / 100, 0.1) * Math.pow(master / 100, 0.1);
}
export const dbToLinear = (db) => (db === -Infinity ? 0 : Math.pow(10, db / 20));
// C# (int) cast of a double: truncation toward zero
export const toInt = (x) => Math.trunc(x);
export function hexColor(hex) { // "ff0059" -> [r,g,b] 0..1
  const h = hex.trim().replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
