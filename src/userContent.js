// Web stand-in for the user folder (Constants.USER_FOLDER/colorsets, /meshes). The bundled files are what FileInitializer.deepCopy copies from res://user
// (listed in assets/user.json by tools/gen-user-manifest.py); files the player imports are kept in IndexedDB and listed beside them.
const DB = 'rhythia-user', STORE = 'files';
const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { try { const db = await open(); return await new Promise((res, rej) => { const t = db.transaction(STORE, mode), q = fn(t.objectStore(STORE)); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); }); } catch { return undefined; } };
const EXT = { colorsets: '.txt', meshes: '.obj' };

export const userContent = {
  bundled: { colorsets: [], meshes: [] }, imported: { colorsets: [], meshes: [] },
  async load() {
    try { const m = await (await fetch('assets/user.json')).json(); this.bundled = { colorsets: m.colorsets ?? [], meshes: m.meshes ?? [] }; } catch { /* no manifest */ }
    const keys = (await tx('readonly', (s) => s.getAllKeys())) ?? [];
    for (const k of ['colorsets', 'meshes']) this.imported[k] = keys.filter((x) => x.startsWith(k + '/')).map((x) => x.slice(k.length + 1));
  },
  names(kind) { return [...new Set([...this.bundled[kind], ...this.imported[kind]])]; },
  // read one file's text: imported first (the user folder wins over the bundled copy), else the bundled asset; null when missing
  async read(kind, name) {
    const mine = await tx('readonly', (s) => s.get(`${kind}/${name}`));
    if (typeof mine === 'string') return mine;
    try { const r = await fetch(`assets/${kind}/${encodeURIComponent(name)}${EXT[kind]}`); return r.ok ? await r.text() : null; } catch { return null; }
  },
  // file picker -> user folder; returns how many were added
  async importFiles(kind, files) {
    let n = 0;
    for (const f of files) {
      if (!f.name.toLowerCase().endsWith(EXT[kind])) continue;
      const name = f.name.slice(0, -EXT[kind].length);
      const text = await f.text();
      if (await tx('readwrite', (s) => s.put(text, `${kind}/${name}`)) !== undefined) n++;
    }
    await this.load(); return n;
  },
};
