// Port of scripts/map/Replay.cs (reading) and the file-writing half of scripts/game/managers/ReplayManager.cs (NewReplay / SaveReplay).
// .phxr, little endian (Godot FileAccess): "phxr", u8 version 1, f64 speed, f64 startFrom, f64 AR, f64 AD, f64 fadeIn, u8 fadeOut,
// u8 pushback, f64 parallax, f64 FoV, f64 noteSize, f64 sensitivity, u8 status, u32+string mods ("_"-joined), u32+string map folder,
// u64 map note count, u32+string player, u64 frame count, frames (f32 progress, f32 x, f32 y), u64 first note, u64 replay note count,
// u8 per note (255 = miss, else lateness * 4), u64 skip count, f32 skips; then a SHA-256 of everything before it.
// A u32 length is the C# string's Length (UTF-16 units) and the string itself is written as UTF-8, as in the original.
import { MapManager } from './MapManager.js';
import { SettingsProfile } from '../settings.js';
import { CameraLock } from '../game/CameraLock.js';
import { CameraSpin } from '../game/CameraSpin.js';
import { NoFailModifier, AutoplayModifier, GhostModifier, ChaosModifier, EarthquakeModifier, VortexModifier, VerticalFlipModifier, HorizontalFlipModifier } from '../game/modifiers.js';
import { notify } from '../ui/Toast.js';

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder(), dec = new TextDecoder();

class Reader {
  constructor(bytes) { this.b = bytes; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.p = 0; }
  u8() { return this.v.getUint8(this.p++); }
  bool() { return this.u8() !== 0; }
  u32() { const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  u64() { const x = this.v.getBigUint64(this.p, true); this.p += 8; return Number(x); }
  f32() { const x = this.v.getFloat32(this.p, true); this.p += 4; return x; }
  f64() { const x = this.v.getFloat64(this.p, true); this.p += 8; return x; }
  str(n) { const s = dec.decode(this.b.subarray(this.p, this.p + n)); this.p += n; return s; }
}

export class Writer {
  constructor() { this.buf = new Uint8Array(1024); this.v = new DataView(this.buf.buffer); this.p = 0; this.len = 0; }
  need(n) { if (this.p + n > this.buf.length) { const nb = new Uint8Array(Math.max(this.buf.length * 2, this.p + n)); nb.set(this.buf); this.buf = nb; this.v = new DataView(nb.buffer); } }
  done(n) { this.p += n; this.len = Math.max(this.len, this.p); }
  seek(p) { this.p = p; }
  u8(x) { this.need(1); this.v.setUint8(this.p, x & 255); this.done(1); }
  u32(x) { this.need(4); this.v.setUint32(this.p, x >>> 0, true); this.done(4); }
  u64(x) { this.need(8); this.v.setBigUint64(this.p, BigInt(Math.max(0, Math.trunc(x))), true); this.done(8); }
  f32(x) { this.need(4); this.v.setFloat32(this.p, x, true); this.done(4); }
  f64(x) { this.need(8); this.v.setFloat64(this.p, x, true); this.done(8); }
  str(s) { const b = enc.encode(s); this.need(b.length); this.buf.set(b, this.p); this.done(b.length); }
  sized(s) { this.u32(s.length); this.str(s); }   // storeSizedString
  bytes() { return this.buf.slice(0, this.len); }
}

const MODS = { NoFail: NoFailModifier, Autoplay: AutoplayModifier, Ghost: GhostModifier, Chaos: ChaosModifier, Earthquake: EarthquakeModifier, Vortex: VortexModifier, VFlip: VerticalFlipModifier, HFlip: HorizontalFlipModifier };

// new Replay(path): bytes = the file, id = the file's base name
export async function parseReplay(bytes, id) {
  const r = { ID: id, Valid: true, Complete: false, LastNote: 0, LastFrame: 0 };
  const fail = (log) => { r.Valid = false; notify('Replay file corrupted', 2); console.error(log); return r; };
  if (bytes.length < 32) return fail('Replay file corrupted; invalid SHA256 hash');
  const body = bytes.subarray(0, bytes.length - 32);
  if (hex(await sha256(body)) !== hex(bytes.subarray(bytes.length - 32))) return fail('Replay file corrupted; invalid SHA256 hash');
  const f = new Reader(bytes);
  const sig = f.str(4);
  if (sig !== 'phxr') return fail(`Replay file corrupted; invalid file sig ${sig}`);
  if (f.u8() !== 1) return r;
  r.Speed = f.f64(); r.StartFrom = f.f64(); r.ApproachRate = f.f64(); r.ApproachDistance = f.f64(); r.ApproachTime = r.ApproachDistance / r.ApproachRate;
  r.FadeIn = f.f64(); r.FadeOut = f.bool(); r.Pushback = f.bool(); r.Parallax = f.f64(); r.FoV = f.f64(); r.NoteSize = f.f64(); r.Sensitivity = f.f64();
  const s = r.Settings = new SettingsProfile();   // a fresh profile: everything else stays at its default
  s.ApproachRate = r.ApproachRate; s.ApproachDistance = r.ApproachDistance; s.ApproachTime = r.ApproachTime; s.FadeIn = r.FadeIn;
  s.FadeOut = r.FadeOut ? 100 : 0; s.Pushback = r.Pushback; s.FoV = r.FoV; s.NoteSize = r.NoteSize; s.Sensitivity = r.Sensitivity;
  const status = f.u8(); r.Status = status === 0 ? 'PASSED' : status === 1 ? 'DISQUALIFIED' : 'FAILED';
  const rawMods = f.str(f.u32()).split('_');
  r.Modifiers = []; r.CameraMode = new CameraLock();
  for (const name of rawMods) {   // the original's switch has no case for Strobe, so a Strobe replay plays without it
    if (name === 'Spin') r.CameraMode = new CameraSpin();
    else if (MODS[name]) r.Modifiers.push(new MODS[name]());
  }
  r.MapID = f.str(f.u32());
  r.MapNoteCount = f.u64();
  if (r.MapID.toLowerCase().endsWith('.phxm')) { console.log(`Legacy Replay detected: ${r.MapID}`); r.MapID = r.MapID.slice(0, -5); }
  r.Map = MapManager.Maps.find((m) => m.Name === r.MapID) ?? null;   // Directory.Exists(MapFilePath)
  if (!r.Map) { r.Valid = false; notify('Replay map not found', 2); console.log(`Replay map not found: ${r.MapID}`); return r; }
  r.Player = f.str(f.u32());
  const n = f.u64(); r.Frames = new Array(n); r.CurrentPosition = { x: 0, y: 0 }; r.FrameIndex = 0; r.SkipIndex = 0;
  if (n <= 1) { r.Valid = false; return r; }
  for (let i = 0; i < n; i++) { const progress = f.f32(), x = f.f32(), y = f.f32(); r.Frames[i] = { Progress: progress, CursorPosition: { x, y } }; }
  r.Length = r.Frames[n - 1].Progress;
  r.Notes = new Float32Array(r.MapNoteCount);
  r.FirstNote = f.u64(); r.ReplayNoteCount = f.u64();
  for (let i = 0; i < r.FirstNote; i++) r.Notes[i] = -1;
  for (let i = r.FirstNote; i < r.FirstNote + r.ReplayNoteCount; i++) { const note = f.u8(); r.Notes[i] = note === 255 ? -1 : Math.trunc(note / 4); }   // note / (254 / 55): integer division by 4
  for (let i = r.FirstNote + r.ReplayNoteCount; i < r.MapNoteCount; i++) r.Notes[i] = -1;
  const sk = f.u64(); r.Skips = new Float32Array(sk);
  for (let i = 0; i < sk; i++) r.Skips[i] = f.f32();
  return r;
}

// Replay ==: GetHashCode over $"{MapID}{Valid}{Speed}{StartFrom}{Modifiers}" (Modifiers prints the list's type name, so it never differs)
export const sameReplay = (a, b) => a.MapID === b.MapID && a.Valid === b.Valid && a.Speed === b.Speed && a.StartFrom === b.StartFrom;

export const replayPath = (id) => `replays/${id}.phxr`;
export async function loadReplay(id) {
  const bytes = await MapManager.readFile(replayPath(id));
  return bytes ? parseReplay(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), id) : null;
}
export async function replayExists(id) { return (await MapManager.readFile(replayPath(id))) != null; }
export { sha256 };
