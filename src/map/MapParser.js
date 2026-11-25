// Port of scripts/map/MapParser.cs: SSPM v1 / v2 and the PHXMO object block.
// (txt SSMapV1 / rhm / phxm zip folders are not needed for the minimal build.)
import { FileParser } from '../util/FileParser.js';
import { Note } from './Note.js';
import { DIFFICULTIES } from '../constants.js';

const stripEscapes = (s) => (s ?? '').replace(/[\t\r\n\f\v]/g, '');
const stripEdges = (s) => s.trim();
const sanitizeZalgo = (input, limit = 3) => input.replace(new RegExp(`(\\p{M}){${limit + 1},}`, 'gu'), '$1'); // Util.String.SanitizeZalgo

export class MapData {
  constructor(name, notes, id, artist, title, rating, mappers, difficulty, difficultyName, length, audioBuffer, coverBuffer) {
    this.Name = name;
    this.Id = id;
    this.Artist = stripEscapes(artist);
    this.Title = stripEscapes(title);
    this.PrettyTitle = this.Artist !== '' ? `${this.Artist} - ${this.Title}` : this.Title;
    this.Rating = rating;
    this.Mappers = mappers ?? ['N/A'];
    this.PrettyMappers = this.Mappers.join(', ');
    this.Difficulty = Math.min(Math.max(difficulty, 0), DIFFICULTIES.length - 1);
    this.DifficultyName = difficultyName != null ? stripEscapes(difficultyName) : DIFFICULTIES[this.Difficulty];
    this.AudioBuffer = audioBuffer;
    this.CoverBuffer = coverBuffer;
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

// MapParser.DecodePHXMO (kept so .phxm maps can be added later without touching gameplay code)
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
