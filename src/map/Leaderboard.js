// Port of scripts/map/Leaderboard.cs. Same file format (little-endian, as Godot's FileAccess and BitConverter write it):
// u32 count; per score: u32 length, then u32+UTF-8 attempt id, u32+UTF-8 player, u8 qualifies, u64 score, f64 accuracy, f64 unix time,
// f64 progress, f64 map length, f64 speed, u32+UTF-8 JSON modifiers; then a SHA-256 of everything before it.
// The file lives at pbs/<map name> in the port's virtual user folder (IndexedDB), like user://pbs/<map name>.
import { MapManager } from './MapManager.js';

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const path = (mapID) => `pbs/${mapID}`;
let pending = Promise.resolve();   // a Save still writing (the C# writes synchronously before the results screen)

class Reader {   // FileParser
  constructor(buf) { this.b = buf; this.v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); this.p = 0; }
  need(n) { if (this.p + n > this.b.length) throw new Error('Leaderboard: read past end'); }
  get(n) { this.need(n); const out = this.b.subarray(this.p, this.p + n); this.p += n; return out; }
  u32() { this.need(4); const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  u64() { this.need(8); const x = this.v.getBigUint64(this.p, true); this.p += 8; return x; }
  f64() { this.need(8); const x = this.v.getFloat64(this.p, true); this.p += 8; return x; }
  bool() { this.need(1); return this.b[this.p++] !== 0; }
  str(n) { return new TextDecoder().decode(this.get(n)); }
}

function readScore(buf) {   // Score(byte[] buffer)
  const r = new Reader(buf);
  const AttemptID = r.str(r.u32()), Player = r.str(r.u32());
  const Qualifies = r.bool(), Value = Number(r.u64()), Accuracy = r.f64(), Time = r.f64(), Progress = r.f64(), MapLength = r.f64(), Speed = r.f64();
  const Modifiers = {}; const json = JSON.parse(r.str(r.u32()));
  for (const [k, v] of Object.entries(json)) Modifiers[k] = !!v;
  return { AttemptID, Player, Qualifies, Value, Accuracy, Time, Progress, MapLength, Speed, Modifiers };
}

export class Leaderboard {
  constructor(mapID = null) { this.MapID = mapID; this.Valid = false; this.ScoreCount = 0; this.Scores = []; }   // new Leaderboard(): all defaults

  // Leaderboard(mapID, path): reads the file (missing file: the C# throws, its callers check File.Exists first)
  static async Load(mapID, waitForSaves = true) {
    if (waitForSaves) await pending;
    const lb = new Leaderboard(mapID);
    const buffer = await MapManager.readFile(path(mapID));
    if (!buffer) return null;
    const bytes = new Uint8Array(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength);
    let content;
    try {
      const r = new Reader(bytes);
      content = r.get(bytes.length - 32); r.p = 0;
      const count = lb.ScoreCount = r.u32();
      for (let i = 0; i < count; i++) lb.Add(readScore(r.get(r.u32())));
      lb.Valid = true;
      const stored = r.get(32), hash = await sha256(content);
      if (stored.some((b, i) => b !== hash[i])) { console.log('Leaderboard file corrupted; invalid leaderboard hash'); await lb.Reset(); }
    } catch (e) { console.error(e); await lb.Reset(); }
    return lb;
  }

  static async Exists(mapID) { await pending; return !!(await MapManager.readFile(path(mapID))); }

  // Runner.Stop: a missing file is created as an empty leaderboard ([0,0,0,0] + its hash) first
  static async CreateEmpty(mapID) {
    const head = new Uint8Array(4), file = new Uint8Array(36); file.set(head); file.set(await sha256(head), 4);
    await MapManager.writeFile(path(mapID), file);
  }

  Add(score) {   // sorted by score, descending (List.Sort is unstable; ties keep no defined order), at most 8
    this.Scores.push(score);
    this.Scores.sort((a, b) => b.Value - a.Value);
    if (this.Scores.length > 8) this.Scores.length = 8;
    this.ScoreCount = this.Scores.length;
  }

  Save() {
    const enc = new TextEncoder(), parts = [], u32 = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, x, true); return b; };
    parts.push(u32(this.ScoreCount));
    for (const s of this.Scores) {
      const id = enc.encode(s.AttemptID ?? ''), player = enc.encode(s.Player ?? ''), mods = enc.encode(JSON.stringify(s.Modifiers ?? {}));
      const body = new Uint8Array(4 + id.length + 4 + player.length + 1 + 8 * 6 + 4 + mods.length), v = new DataView(body.buffer); let o = 0;
      v.setUint32(o, id.length, true); o += 4; body.set(id, o); o += id.length;
      v.setUint32(o, player.length, true); o += 4; body.set(player, o); o += player.length;
      body[o++] = s.Qualifies ? 1 : 0;
      v.setBigUint64(o, BigInt(Math.max(0, Math.trunc(s.Value))), true); o += 8;
      for (const d of [s.Accuracy, s.Time, s.Progress, s.MapLength, s.Speed]) { v.setFloat64(o, d, true); o += 8; }
      v.setUint32(o, mods.length, true); o += 4; body.set(mods, o);
      parts.push(u32(body.length), body);
    }
    const total = parts.reduce((n, p) => n + p.length, 0), content = new Uint8Array(total); let o = 0;
    for (const p of parts) { content.set(p, o); o += p.length; }
    const save = (async () => { const file = new Uint8Array(total + 32); file.set(content); file.set(await sha256(content), total); await MapManager.writeFile(path(this.MapID), file); })();
    pending = pending.then(() => save).catch((e) => console.error(e));
    return save;
  }

  async Reset() { this.Valid = false; this.ScoreCount = 0; this.Scores = []; await this.Save(); }
}

// Runner.Stop: records the attempt as "You" when it started from the beginning and wasn't autoplayed
export function recordScore(attempt, speed) {
  const id = attempt.Map.Name;
  const job = (async () => {
    if (!(await MapManager.readFile(path(id)))) await Leaderboard.CreateEmpty(id);
    const lb = await Leaderboard.Load(id, false);   // (not waiting on `pending`: this job is part of it)
    const mods = {}; for (const m of attempt.Modifiers) mods[m.Name] = true;
    lb.Add({ AttemptID: attempt.ID, Player: 'You', Qualifies: attempt.Qualifies, Value: attempt.Score, Accuracy: attempt.Accuracy,
      Time: Date.now() / 1000, Progress: attempt.Progress, MapLength: attempt.Map.Length, Speed: speed, Modifiers: mods });
    await lb.Save();
  })();
  pending = pending.then(() => job).catch((e) => console.error(e));
  return job;
}
