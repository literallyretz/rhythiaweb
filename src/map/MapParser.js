// Port of scripts/map/MapParser.cs: SSPM v1 / v2, SSMapV1 (.txt), PHXM / PHXMFolder, RHM, and the PHXMO object block (Decode / Encode).
import { FileParser } from '../util/FileParser.js';
import { Note } from './Note.js';
import { DIFFICULTIES } from '../constants.js';

import { ZipArchive } from '../util/zip.js';
const stripEscapes = (s) => (s ?? '').replace(/[\t\r\n\f\v]/g, '');
const stripEdges = (s) => s.trim();
const sanitizeZalgo = (input, limit = 3) => input.replace(new RegExp(`(\\p{M}){${limit + 1},}`, 'gu'), '$1'); // Util.String.SanitizeZalgo

export class MapData {
  constructor(name, notes, id, artist, title, rating, mappers, difficulty, difficultyName, length, audioBuffer, coverBuffer, videoBuffer = null, artistLink = '', artistPlatform = '') {
    this.Name = name;
    this.Id = 0;                 // Map.Id is the database key (auto-increment); MapManager assigns it on insert. The `id` ctor argument is unused in Map's ctor too
    this.CacheVersion = 2; this.Favorite = false; this.PlayCount = 0; this.Collection = '';
    this.ArtistLink = artistLink; this.ArtistPlatform = artistPlatform;
    this.VideoBuffer = videoBuffer;
    this.Artist = stripEscapes(artist);
    this.Title = stripEscapes(title);
    this.PrettyTitle = this.Artist !== '' ? `${this.Artist} - ${this.Title}` : this.Title;
    this.Rating = rating;
    this.Mappers = mappers ?? ['N/A'];
    this.PrettyMappers = this.Mappers.join(', ');
    this.CachedMappers = this.Mappers.join('_');
    this.Difficulty = Math.min(Math.max(difficulty, 0), DIFFICULTIES.length - 1);
    this.DifficultyName = difficultyName != null ? stripEscapes(difficultyName) : DIFFICULTIES[this.Difficulty];
    this.AudioBuffer = audioBuffer;
    this.CoverBuffer = coverBuffer;
    this.AudioExt = (audioBuffer != null && String.fromCharCode(...audioBuffer.subarray(0, 4)) === 'OggS') ? 'ogg' : 'mp3';
    this.Notes = notes ?? [];
    this.Length = length ?? this.Notes[this.Notes.length - 1].Millisecond;
    // MapManager.Sanitize
    this.PrettyTitle = sanitizeZalgo(this.PrettyTitle);
    this.PrettyMappers = sanitizeZalgo(this.PrettyMappers);
    this.DifficultyName = sanitizeZalgo(this.DifficultyName);
  }
}

const noteSort = (a, b) => a.Millisecond - b.Millisecond; // Array.Sort(notes) uses Note.CompareTo (Millisecond); JS sort is stable

function sspmV1(file, name) {
  file.skip(2);
  const id = file.getLine();
  const mapName = file.getLine().split(' - ');
  let artist = null, song;
  if (mapName.length === 1) song = stripEdges(mapName[0]);
  else { artist = stripEdges(mapName[0]); song = stripEdges(mapName.slice(1).join(' - ')); }
  const mappers = file.getLine().split(/[&,]/);
  const mapLength = file.getUInt32();
  const noteCount = file.getUInt32();
  const difficulty = file.getUInt8();
  const hasCover = file.getUInt8() === 2;
  let coverBuffer = null;
  if (hasCover) coverBuffer = file.get(file.getUInt64());
  const hasAudio = file.getBool();
  let audioBuffer = null;
  if (hasAudio) audioBuffer = file.get(file.getUInt64());
  const notes = new Array(noteCount);
  for (let i = 0; i < noteCount; i++) {
    const ms = file.getUInt32();
    const quantum = file.getBool();
    let x, y;
    if (quantum) { x = file.getFloat(); y = file.getFloat(); } else { x = file.getUInt8(); y = file.getUInt8(); }
    notes[i] = new Note(i, ms, x - 1, -y + 1);
  }
  notes.sort(noteSort);
  notes.forEach((n, i) => (n.Index = i));
  return new MapData(name, notes, id, artist, song, 0, mappers, difficulty, null, mapLength, audioBuffer, coverBuffer);
}

function sspmV2(file, name) {
  file.skip(4); file.skip(20);
  const mapLength = file.getUInt32();
  const noteCount = file.getUInt32();
  file.skip(4);
  const difficulty = file.get(1)[0];
  file.skip(2);
  const hasAudio = file.getBool();
  const hasCover = file.getBool();
  file.skip(1);
  const customDataOffset = file.getUInt64(); file.getUInt64();
  const audioByteOffset = file.getUInt64(), audioByteLength = file.getUInt64();
  const coverByteOffset = file.getUInt64(), coverByteLength = file.getUInt64();
  file.skip(16);
  const markerByteOffset = file.getUInt64();
  file.skip(8);
  const id = file.getString(file.getUInt16());
  const mapName = file.getString(file.getUInt16()).split(' - ');
  let artist = null, song;
  if (mapName.length === 1) song = stripEdges(mapName[0]);
  else { artist = stripEdges(mapName[0]); song = stripEdges(mapName.slice(1).join(' - ')); } // C# Split(" - ", 2)
  file.skip(file.getUInt16());
  const mapperCount = file.getUInt16();
  const mappers = [];
  for (let i = 0; i < mapperCount; i++) mappers.push(file.getString(file.getUInt16()));

  let difficultyName = null;
  file.seek(customDataOffset);
  file.skip(2);
  if (file.getString(file.getUInt16()) === 'difficulty_name') {
    let length = 0;
    switch (file.get(1)[0]) { case 9: length = file.getUInt16(); break; case 11: length = file.getUInt32(); break; }
    difficultyName = file.getString(length);
  }
  let audioBuffer = null, coverBuffer = null;
  if (hasAudio) { file.seek(audioByteOffset); audioBuffer = file.get(audioByteLength); }
  if (hasCover) { file.seek(coverByteOffset); coverBuffer = file.get(coverByteLength); }
  file.seek(markerByteOffset);
  const notes = new Array(noteCount);
  for (let i = 0; i < noteCount; i++) {
    const ms = file.getUInt32();
    file.skip(1);
    const quantum = file.getBool();
    let x, y;
    if (quantum) { x = file.getFloat(); y = file.getFloat(); } else { x = file.get(1)[0]; y = file.get(1)[0]; }
    notes[i] = new Note(0, ms, x - 1, -y + 1);
  }
  notes.sort(noteSort);
  notes.forEach((n, i) => (n.Index = i));
  return new MapData(name, notes, id, artist, song, 0, mappers, difficulty, difficultyName, mapLength, audioBuffer, coverBuffer);
}

export function parseSSPM(bytes, name = 'map') {
  const file = new FileParser(bytes);
  if (file.getString(4) !== 'SS+m') throw new Error('Incorrect file signature');
  const version = file.getUInt16();
  if (version === 1) return sspmV1(file, name);
  if (version === 2) return sspmV2(file, name);
  throw new Error('Invalid SSPM version');
}

// MapParser.DecodePHXMO
export function decodePHXMO(bytes) {
  const f = new FileParser(bytes);
  f.getUInt32();
  const count = f.getUInt32();
  const notes = new Array(count);
  for (let i = 0; i < count; i++) {
    const ms = f.getUInt32();
    const quantum = f.getBool();
    let x, y;
    if (quantum) { x = f.getFloat(); y = f.getFloat(); } else { x = f.get(1)[0] - 1; y = f.get(1)[0] - 1; }
    notes[i] = new Note(i, ms, x, y);
  }
  return notes;
}

// MapParser.Encode: objects.phxmo bytes (header 12, notes, then eleven zero counts)
export function encodePHXMO(notes) {
  const out = [];
  const u32 = (v) => out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const f32 = (v) => { const b = new Uint8Array(new Float32Array([v]).buffer); out.push(b[0], b[1], b[2], b[3]); };
  u32(12); u32(notes.length);
  for (const n of notes) {
    const quantum = Math.trunc(n.X) !== n.X || Math.trunc(n.Y) !== n.Y || n.X < -1 || n.X > 1 || n.Y < -1 || n.Y > 1;
    u32(n.Millisecond); out.push(quantum ? 1 : 0);
    if (quantum) { f32(n.X); f32(n.Y); } else out.push(n.X + 1, n.Y + 1);
  }
  for (let i = 0; i < 11; i++) u32(0);
  return new Uint8Array(out);
}

// Map.EncodeMeta (hasAudio/hasCover/hasVideo mean "the file was written", as File.Exists does there)
export function encodeMeta(map) {
  return JSON.stringify({
    ID: map.Name, Artist: map.Artist, ArtistLink: map.ArtistLink, ArtistPlatform: map.ArtistPlatform, Title: map.Title, Rating: map.Rating,
    Mappers: map.Mappers, Difficulty: map.Difficulty, DifficultyName: map.DifficultyName, Length: map.Length,
    HasAudio: map.AudioBuffer != null, HasCover: map.CoverBuffer != null, HasVideo: map.VideoBuffer != null, AudioExt: map.AudioExt,
  }, null, '\t');
}

// MapParser.SSMapV1 (.txt): "id,x|y|ms,x|y|ms,..."; audio is only given when an audio path is passed (BulkImport passes none)
export function parseSSMapV1(bytes, name, audioBuffer = null) {
  const text = new TextDecoder().decode(bytes);
  const split = text.split(/\r?\n/)[0].split(',');   // file.GetLine()
  const notes = new Array(split.length - 1);
  for (let i = 1; i < split.length; i++) {
    const sub = split[i].split('|');
    notes[i - 1] = new Note(i - 1, parseInt(sub[2]) || 0, -(parseFloat(sub[0]) || 0) + 1, (parseFloat(sub[1]) || 0) - 1);
  }
  return new MapData(name, notes, null, '', name, 0, null, 0, null, null, audioBuffer);
}

// MapParser.PHXMFolder: `files` holds the folder's contents (metadata.json as text, the rest as bytes)
export function parsePHXMFolder(files, name) {
  if (files['metadata.json'] == null || files['objects.phxmo'] == null) return null;
  const md = JSON.parse(files['metadata.json']);
  const audio = md.HasAudio ? files[`audio.${md.AudioExt}`] : null, cover = md.HasCover ? files['cover.png'] : null, video = md.HasVideo ? files['video.mp4'] : null;
  if ((md.HasAudio && !audio) || (md.HasCover && !cover) || (md.HasVideo && !video)) throw new Error('Map file missing');
  const notes = decodePHXMO(files['objects.phxmo']);
  return new MapData(name, notes, md.ID, md.Artist, md.Title, 0, md.Mappers, Math.trunc(md.Difficulty), md.DifficultyName, Math.trunc(md.Length), audio, cover, video, md.ArtistLink ?? '', md.ArtistPlatform ?? '');
}

// MapParser.PHXM: a zip holding the folder above
export async function parsePHXM(bytes, name) {
  const zip = new ZipArchive(bytes), files = {};
  for (const n of ['metadata.json', 'objects.phxmo', 'cover.png', 'video.mp4']) if (zip.getEntry(n)) files[n] = await zip.read(n);
  for (const n of zip.entries.keys()) if (/^audio\.[^/]+$/.test(n)) files[n] = await zip.read(n);
  if (files['metadata.json']) files['metadata.json'] = new TextDecoder().decode(files['metadata.json']);
  return parsePHXMFolder(files, name);
}

// MapParser.RHM: a zip with a "map" json entry, an image and an audio entry
export async function parseRHM(bytes, name) {
  const zip = new ZipArchive(bytes);
  const data = JSON.parse(new TextDecoder().decode(await zip.read('map')));
  const notes = data.Notes.map((n, i) => new Note(i, Math.trunc(n.Time), n.X - 1, 1 - n.Y));
  let artist = null, title = null;
  const split = data.Title.split(' - ');
  if (split.length === 1) title = split[0]; else if (split.length > 1) { artist = split[0]; title = split.slice(1).join(' - '); }
  const audioPath = zip.getEntry('audio') ? 'audio' : data.AudioFileName;
  const audio = await zip.read(audioPath), cover = await zip.read(data.ImagePath);
  return new MapData(name, notes, null, artist ?? '', title ?? '', 0, data.Mappers, Math.trunc(data.Difficulty), data.CustomDifficultyName, notes[notes.length - 1].Millisecond, audio, cover);
}

// MapParser.Decode (for an imported file)
export const isValidExt = (ext) => ext === 'phxm' || ext === 'sspm' || ext === 'txt' || ext === 'rhm';
export async function decodeFile(fileName, bytes) {
  const dot = fileName.lastIndexOf('.'), ext = fileName.slice(dot + 1), name = dot < 0 ? fileName : fileName.slice(0, dot);
  if (!isValidExt(ext)) throw new Error(`Unsupported file format (${ext})`);
  switch (ext) {
    case 'phxm': return parsePHXM(bytes, name);
    case 'sspm': return parseSSPM(bytes, name);
    case 'txt': return parseSSMapV1(bytes, name);
    case 'rhm': return parseRHM(bytes, name);
  }
}
