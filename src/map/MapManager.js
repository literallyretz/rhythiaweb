// Port of scripts/map/MapManager.cs + MapCache.cs + the import half of MapParser.cs (BulkImport / Encode / Decode of a stored map).
// Deviation (unavoidable): there is no writable maps folder or SQLite in a browser. The maps folder (user://maps/<Name>/...) is a small
// virtual file store in IndexedDB ("files", keyed by path) and the Map table is the "maps" store (keyed by the auto-increment Id).
import { MapData, decodeFile, decodePHXMO, encodePHXMO, encodeMeta, parsePHXMFolder } from './MapParser.js';
import { Bindable } from '../util/misc.js';
import { writeZip } from '../util/zip.js';

const DB = 'rhythiaweb-maps';
let dbp = null;
const open = () => dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('maps', { keyPath: 'Id', autoIncrement: true }); r.result.createObjectStore('files'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const run = async (stores, mode, fn) => {
  const db = await open(), tx = db.transaction(stores, mode);
  const out = await fn(...[].concat(stores).map((s) => tx.objectStore(s)));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  return out;
};
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const sha256hex = async (parts) => {   // MapCache.GetMd5Checksum: only used to tell identical maps apart, so the hash function is internal
  const total = parts.reduce((n, p) => n + p.length, 0), all = new Uint8Array(total); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', all))].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Map table columns (everything on Map that is not [Ignore]d)
const COLUMNS = ['Id', 'Name', 'CacheVersion', 'MetadataObjectHash', 'Collection', 'Favorite', 'Artist', 'ArtistLink', 'ArtistPlatform', 'Title', 'PrettyTitle', 'Rating', 'CachedMappers', 'PrettyMappers', 'DifficultyName', 'Difficulty', 'Length', 'AudioExt', 'PlayCount'];
const mapDir = (name) => `maps/${name}/`;

export const MapManager = {
  Maps: [],
  Selected: new Bindable(null),
  MapsFolder: 'maps',
  _l: { deleted: [], updated: [], initialized: [], importStarted: [], imported: [], importFinished: [] },
  on(ev, fn) { this._l[ev].push(fn); },
  _emit(ev, ...a) { for (const f of this._l[ev]) f(...a); },

  // virtual folder
  async readFile(path) { return run('files', 'readonly', (f) => req(f.get(path))); },
  async writeFile(path, data) { return run('files', 'readwrite', (f) => req(f.put(data, path))); },
  async deleteDir(prefix) { return run('files', 'readwrite', (f) => req(f.delete(IDBKeyRange.bound(prefix, prefix + '￿')))); },
  async dirExists(name) { return run('files', 'readonly', async (f) => (await req(f.getAllKeys(IDBKeyRange.bound(mapDir(name), mapDir(name) + '￿'), 1))).length > 0); },

  // MapManager._Ready -> MapCache.Initialize / Load(true) -> MapsInitialized
  async initialize() { await this.load(); this._emit('initialized', this.Maps); },

  // MapCache.Load + OrderAndSetMaps: favorites first, then by PrettyTitle (OrderBy: culture-aware, stable)
  async load() {
    const rows = await run('maps', 'readonly', (m) => req(m.getAll()));
    const maps = [];
    for (const row of rows) {
      try { maps.push(await this._fromRow(row)); } catch (e) { console.error('Failed to load map', row.Name, e); }
    }
    const byTitle = (a, b) => a.PrettyTitle.localeCompare(b.PrettyTitle);
    const sorted = maps.filter((x) => x.Favorite).sort(byTitle);
    sorted.push(...maps.filter((x) => !x.Favorite).sort(byTitle));
    for (const m of sorted) this.Sanitize(m);
    this.Maps = sorted;
  },

  // A row plus the stored folder (Map.TryParseNotes / cover.png); audio stays unread until the map is played
  async _fromRow(row) {
    const dir = mapDir(row.Name);
    const [objects, cover] = await Promise.all([this.readFile(dir + 'objects.phxmo'), this.readFile(dir + 'cover.png')]);
    const map = new MapData(row.Name, [], null, '', '', 0, null, 0, null, 0, null, null);
    Object.assign(map, row);
    map.Mappers = [];   // Mappers is [Ignore]d: a cached Map has none, PrettyMappers / CachedMappers carry them
    map.Notes = objects ? decodePHXMO(objects) : [];
    map.CoverBuffer = cover ?? null;
    return map;
  },
  async _row(map) { const r = {}; for (const c of COLUMNS) r[c] = map[c]; if (!r.Id) delete r.Id; return r; },

  // Map.AudioBuffer is read from audio.<ext> on demand (Decode(map.FolderPath))
  async readAudio(map) { return map.AudioBuffer ?? await this.readFile(`${mapDir(map.Name)}audio.${map.AudioExt}`) ?? null; },

  // Game.Play / Restart / Replay: MapParser.Decode(map.FolderPath, ...): a fresh copy of the stored map every attempt
  async decodeStored(map) {
    const dir = mapDir(map.Name), md = await this.readFile(dir + 'metadata.json'), files = { 'metadata.json': md, 'objects.phxmo': await this.readFile(dir + 'objects.phxmo') };
    const meta = JSON.parse(md);
    if (meta.HasAudio) files[`audio.${meta.AudioExt}`] = await this.readFile(`${dir}audio.${meta.AudioExt}`);
    if (meta.HasCover) files['cover.png'] = await this.readFile(dir + 'cover.png');
    if (meta.HasVideo) files['video.mp4'] = await this.readFile(dir + 'video.mp4');
    const fresh = parsePHXMFolder(files, map.Name);
    Object.assign(fresh, { Id: map.Id, Favorite: map.Favorite, PlayCount: map.PlayCount });
    return fresh;
  },

  // MapParser.Encode + MapCache.InsertMap
  async encode(map) {
    const dir = mapDir(map.Name);
    const objects = encodePHXMO(map.Notes);
    await this.deleteDir(dir);
    await this.writeFile(dir + 'objects.phxmo', objects);
    if (map.AudioBuffer != null) await this.writeFile(`${dir}audio.${map.AudioExt}`, map.AudioBuffer);
    if (map.CoverBuffer != null) await this.writeFile(dir + 'cover.png', map.CoverBuffer);
    if (map.VideoBuffer != null) await this.writeFile(dir + 'video.mp4', map.VideoBuffer);
    const meta = encodeMeta(map);
    await this.writeFile(dir + 'metadata.json', meta);
    map.MetadataObjectHash = await sha256hex([new TextEncoder().encode(meta), objects]);
    return this.insertMap(map);
  },
  // Same Name replaces the stored row (the original also keeps one folder per Name) and keeps its Id
  async insertMap(map) {
    return run('maps', 'readwrite', async (m) => {
      const existing = (await req(m.getAll())).find((r) => r.Name === map.Name);
      if (existing) map.Id = existing.Id;
      map.Id = await req(m.put(await this._row(map)));
      return map.Id;
    });
  },
  async updateMap(map) { return run('maps', 'readwrite', async (m) => req(m.put(await this._row(map)))); },

  Select(map) { this.Selected.value = this.GetMapById(map.Id); },
  GetMapById(id) { return this.Maps.find((x) => x.Id === id) ?? null; },
  async Update(map) { await this.updateMap(map); this._emit('updated', map); },

  // MapManager.Delete
  async Delete(map) {
    await this.deleteDir(mapDir(map.Name));
    await run('maps', 'readwrite', (m) => req(m.delete(map.Id)));
    this.Maps = this.Maps.filter((x) => x.Id !== map.Id);
    this._emit('deleted', map);
  },

  // MapManager.Sanitize (the title / mappers / difficulty name are zalgo-stripped when a Map is built; this re-checks cached rows)
  Sanitize(map) {
    const z = (s) => s.replace(/(\p{M}){4,}/gu, '$1');
    const t = z(map.PrettyTitle), mp = z(map.PrettyMappers), d = z(map.DifficultyName);
    if (t !== map.PrettyTitle || mp !== map.PrettyMappers || d !== map.DifficultyName) { map.PrettyTitle = t; map.PrettyMappers = mp; map.DifficultyName = d; this.Update(map); }
  },

  // MapParser.ExportEncode: the stored map re-decoded (the list entries carry no buffers) and written as a .phxm (uncompressed zip)
  async exportEncode(map) {
    const d = await this.decodeStored(map), enc = new TextEncoder();
    const entries = [['metadata.json', enc.encode(encodeMeta(d))], ['objects.phxmo', encodePHXMO(d.Notes)]];
    if (d.AudioBuffer != null) entries.push([`audio.${d.AudioExt}`, d.AudioBuffer]);
    if (d.CoverBuffer != null) entries.push(['cover.png', d.CoverBuffer]);
    if (d.VideoBuffer != null) entries.push(['video.mp4', d.VideoBuffer]);
    return { name: `${d.Name}.phxm`, blob: writeZip(entries) };
  },

  // MapParser.BulkImport(paths): files is a FileList / array of File
  async bulkImport(files, notifyFn = null) {
    files = [...files];
    if (files.length === 0) return [];
    if (notifyFn) notifyFn(`Importing ${files.length} map(s)`);
    this._emit('importStarted');
    const maps = []; let good = 0, corrupted = 0;
    for (const file of files) {
      try {
        const map = await decodeFile(file.name, new Uint8Array(await file.arrayBuffer()));
        if (map) { await this.encode(map); maps.push(map); }
        good++; this._emit('imported', map);
      } catch (e) { corrupted++; console.error(`Import failed: ${file.name}`, e); this.onImportError?.(file.name, e); }
    }
    console.log(`BULK IMPORT: TOTAL: ${good + corrupted}; CORRUPT: ${corrupted}`);
    this._emit('importFinished', maps);
    if (notifyFn) notifyFn(`Finished importing ${files.length} map(s)`);
    return maps;
  },
};
