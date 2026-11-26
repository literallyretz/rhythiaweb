// Port of scripts/ui/menu/play/MapInfo.cs + MapInfoContainer.cs + FlatPreview.cs (info panel, speed, start-from, Start, favorite/delete/export, preview).
// Camera Mode, Modifiers and the Leaderboard are not ported yet; their space in the panel is left empty.
import { MapManager } from '../map/MapManager.js';
import { Lobby } from '../Lobby.js';
import { DIFFICULTY_COLORS } from '../constants.js';
import { notify } from './Toast.js';
import { binarySearch } from '../util/misc.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const formatTime = (seconds) => { const m = Math.floor(Math.abs(seconds) / 60), s = Math.floor(Math.abs(seconds) % 60); return `${seconds < 0 ? '-' : ''}${m}:${String(s).padStart(2, '0')}`; };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// HSlider with the settings menu's look; returns { set(v) (no signal), onChange, onDragEnd }
function hslider(host, min, max, step) {
  host.classList.add('slider');
  host.innerHTML = '<div class="rail"></div><div class="fill"></div><div class="grab"></div>';
  const fill = host.querySelector('.fill'), grab = host.querySelector('.grab');
  const api = { value: min, onChange: null, onDragEnd: null, set(v) { api.value = v; draw(); } };
  const draw = () => { const f = (api.value - min) / (max - min); fill.style.width = `${f * 100}%`; grab.style.left = `calc(${f * 100}% - 16px)`; };
  let changed = false;
  const at = (e) => { const r = host.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1);
    let v = min + f * (max - min); if (step) v = Math.round(v / step) * step; v = clamp(v, min, max);
    if (v !== api.value) { api.value = v; draw(); changed = true; api.onChange?.(v); } };
  host.addEventListener('pointerdown', (e) => { host.setPointerCapture(e.pointerId); host.classList.add('drag'); changed = false; at(e); });
  host.addEventListener('pointermove', (e) => { if (host.classList.contains('drag')) at(e); });
  host.addEventListener('pointerup', () => { host.classList.remove('drag'); api.onDragEnd?.(changed); });
  draw();
  return api;
}

export class MapInfo {
  constructor(app, list) {
    this.app = app; this.list = list; this.Map = null; this.container = null;
    const root = this.root = $('mapInfo');
    root.innerHTML = `<div class="mi-hold"><div class="mi-con" style="opacity:0">
      <div class="mi-info"><div class="mi-cbg"><img class="mi-cov" alt=""></div>
        <div class="mi-sub"><div class="mi-main"></div><div class="mi-extra"></div>
          <div class="mi-btns"><button class="mi-b" id="miExport" title="Export"><img src="assets/skin/ui/buttons/export.png" alt=""></button><button class="mi-b" id="miFav"><img alt=""></button><button class="mi-b" id="miDel" title="Delete"><img src="assets/skin/ui/buttons/delete.png" alt=""></button></div></div></div>
      <div class="mi-act">
        <div class="mi-prev"><div class="mi-lab">Preview</div><div class="mi-fp"></div></div>
        <div class="mi-speed"><div class="mi-lab">Speed</div><div class="mi-pre"></div><div class="mi-row"><div id="miSpeedSl"></div><input id="miSpeedEd" class="mi-ed" spellcheck="false"></div></div>
        <div class="mi-play"><div class="mi-lab">Play</div><div class="mi-row"><div id="miSfSl"></div><input id="miSfEd" class="mi-ed" placeholder="0:00" spellcheck="false"></div><button id="miStart" class="mi-start"><img src="assets/skin/ui/buttons/play.png" alt=""><span>START</span></button></div>
      </div></div></div>`;
    this.hold = root.querySelector('.mi-hold'); this.con = root.querySelector('.mi-con');
    const q = (s) => root.querySelector(s);
    this.cbg = q('.mi-cbg'); this.cov = q('.mi-cov'); this.main = q('.mi-main'); this.extra = q('.mi-extra');
    this.favBtn = $('miFav'); this.fp = q('.mi-fp'); this.start = $('miStart');
    const size = () => { const w = root.clientWidth, h = root.clientHeight, S = Math.max(Math.min(w, h), Math.min(850, h)); this.hold.style.cssText = `width:${S}px;height:${S}px;left:${(w - S) / 2}px;top:${(h - S) / 2}px`; this.hold.style.setProperty('--S', `${S}px`); };
    new ResizeObserver(size).observe(root); size();
    // FlatPreview: 3x3 tiles
    this.tiles = []; this.alpha = new Float32Array(9);
    for (let i = 0; i < 9; i++) { const t = document.createElement('i'); this.fp.appendChild(t); this.tiles.push(t); }
    this.pvMap = null;

    $('miExport').onclick = async () => {
      const m = this.Map; if (!m) return;
      notify(`Exporting ${m.Name}.phxm`, 1);
      const { name, blob } = await MapManager.exportEncode(m), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
      notify('Done! Download started', 0);
    };
    this.favBtn.onclick = () => { const m = this.Map; m.Favorite = !m.Favorite; MapManager.Update(m); this._fav(); };
    $('miDel').onclick = () => MapManager.Delete(this.Map);

    // Speed
    const speedSl = this.speedSl = hslider($('miSpeedSl'), 50, 150, 5), speedEd = this.speedEd = $('miSpeedEd');
    const pre = q('.mi-pre'); this.presets = [];
    [['speed_minus_minus', 80], ['speed_minus', 90], ['speed_middle', 100], ['speed_plus', 110], ['speed_plus_plus', 120]].forEach(([ic, sp]) => {
      const b = document.createElement('button'); b.className = 'mi-pb'; b.title = String(sp); b.innerHTML = `<img src="assets/skin/ui/buttons/${ic}.png" alt="">`;
      b.onclick = () => Lobby.SetSpeed(sp / 100); b._sp = sp; pre.appendChild(b); this.presets.push(b);
    });
    const displaySpeed = (speed) => {
      speed *= 100; const r = Math.round(speed * 10) / 10; if (Math.abs(r - speed) <= 1e-6 /* Mathf.Epsilon (float build) */) speed = r;
      speedSl.set(speed); speedEd.value = String(speed);
      for (const b of this.presets) b.classList.toggle('on', b._sp / 100 === speed / 100);
    };
    displaySpeed(Lobby.Speed); Lobby.on('SpeedChanged', displaySpeed);
    const applySpeed = () => {
      let v = parseFloat(speedEd.value); if (!(v === v)) v = 100;
      v = clamp(v, 25, 1000) / 100; Lobby.SetSpeed(v);
      const sm = app.sound; if (sm.Map?.Name === this.Map?.Name && sm.song.playing) sm.song.pitchScale = Lobby.Speed;
    };
    speedEd.onblur = applySpeed; speedEd.onkeydown = (e) => { if (e.key === 'Enter') applySpeed(); };
    speedSl.onChange = (v) => { speedEd.value = String(v); applySpeed(); };

    // StartFrom
    const sfSl = this.sfSl = hslider($('miSfSl'), 0, 1, 0), sfEd = this.sfEd = $('miSfEd');
    Lobby.on('StartFromChanged', (sf) => {
      const length = this.Map ? this.Map.Length : 1;
      sfSl.set(sf / length); sfEd.value = formatTime(sf / 1000);
      this.start.lastChild.textContent = `START${sf > 0 ? ` (${sfEd.value})` : ''}`;
    });
    const applyStartFrom = (input = null, seek = true) => {
      const Map = this.Map; if (!Map) return;
      input ??= sfEd.value === '' ? sfEd.placeholder : sfEd.value;
      let value = 0; const split = String(input).split(':').reverse();   // string[].Reverse() reverses in place (C# 14)
      if (split.length > 1 && split[1].trim() !== '' && !isNaN(split[1])) value += 60 * parseFloat(split[1]);
      let iv = Number(split[0]);
      if (split[0].trim() !== '' && !isNaN(iv)) { if (iv < 1) iv *= Map.Length / 1000; value += iv; }
      value = clamp(value * 1000, 0, Map.Length);
      Lobby.SetStartFrom(value);
      const sm = app.sound;
      if (sm.Map?.Name !== Map.Name) sm.startMapSelectionPlayback(Map);
      if (seek && sm.song.playing) { this._pvSeek(Lobby.StartFrom); sm.song.seek(Lobby.StartFrom / 1000); }
    };
    sfEd.onblur = () => applyStartFrom(); sfEd.onkeydown = (e) => { if (e.key === 'Enter') applyStartFrom(); };
    sfSl.onChange = (v) => applyStartFrom((Math.round(v * this.Map.Length) / 1000).toFixed(2), false);
    sfSl.onDragEnd = (changed) => { if (changed) applyStartFrom(); };
    this.start.onclick = () => app.playMap(this.Map);
    app.mapInfo = this;
  }
  _fav() { const m = this.Map; this.favBtn.title = m.Favorite ? 'Unfavorite' : 'Favorite'; this.favBtn.firstChild.src = `assets/skin/ui/buttons/${m.Favorite ? 'unfavorite' : 'favorite'}.png`; }
  // MapInfo.Select / MapInfoContainer.Setup
  Select(map) {
    if (!map || (this.Map && this.Map.Name === map.Name)) return;
    if (this.Map) this._ghost();   // old container: Transition(false)
    this.Map = map; const c = this.con;
    const col = DIFFICULTY_COLORS[map.Difficulty] ?? '#ffffff';
    this.cbg.style.setProperty('--dc', col);
    this.cov.src = this.list.coverURL(map) ?? '';
    const mappers = (map.PrettyMappers ?? map.Mappers.join(', '));
    this.main.innerHTML = `<b>${esc(map.PrettyTitle ?? map.Title)}</b><br><span class="dn" style="color:${col}">${esc(map.DifficultyName)}</span> <span class="by">by ${esc(mappers)}</span>`;
    this.extra.innerHTML = `<span>${formatTime(map.Length / 1000)}<br>${map.Notes.length} notes</span><br><span class="nm">${esc(map.Name)}</span>`;
    this._fav();
    Lobby.SetStartFrom(0); this._pvSetup(map);
    // Transition(true): opacity / position / scale tween
    c.style.transition = 'none'; c.style.opacity = 0; c.style.transform = 'translateY(24px) scale(.9)'; void c.offsetWidth;
    c.style.transition = 'opacity .4s cubic-bezier(.215,.61,.355,1),transform .4s cubic-bezier(.215,.61,.355,1)'; c.style.opacity = 1; c.style.transform = 'none';
  }
  _ghost() {   // MapInfoContainer.Transition(false): 0.3 s cubic out, 24 px down, scale .9
    const g = this.con.cloneNode(true); g.className += ' mi-ghost'; g.removeAttribute('id'); this.hold.appendChild(g);
    g.style.transition = 'opacity .3s cubic-bezier(.215,.61,.355,1),transform .3s cubic-bezier(.215,.61,.355,1)';
    requestAnimationFrame(() => { g.style.opacity = 0; g.style.transform = 'translateY(24px) scale(.9)'; });
    setTimeout(() => g.remove(), 350);
  }
  Clear() { if (!this.Map) return; this.Map = null; this._ghost(); this.con.style.opacity = 0; }
  // FlatPreview (UseSoundManagerStreamPlayer = true)
  _pvSetup(map) {
    if (this.pvMap && this.pvMap.Name === map.Name) return;
    this.pvMap = map; this.lastPassedNote = -1; this.pvTime = 0; this.noteTimestamps = map.Notes.map((n) => n.Millisecond);
  }
  _pvSeek(ms) { if (!this.pvMap) return; this.pvTime = ms; this.lastPassedNote = binarySearch(this.noteTimestamps, ms); }
  Process(delta) {
    const map = this.pvMap; if (!map) return;
    const k = Math.min(1, delta * 6);
    for (let i = 0; i < 9; i++) { this.alpha[i] *= 1 - k; this.tiles[i].style.opacity = this.alpha[i] * 5; }
    const sm = this.app.sound; if (!sm.Map || sm.Map.Name !== map.Name) return;
    const old = this.pvTime; this.pvTime = sm.song.getPlaybackPosition() * 1000;
    if (this.pvTime < old) this.lastPassedNote = binarySearch(this.noteTimestamps, this.pvTime);
    const n = map.Notes;
    for (let i = clamp(this.lastPassedNote + 1, 0, Math.max(0, n.length - 1)); i < n.length; i++) {
      const nt = n[i];
      if (this.pvTime >= nt.Millisecond) {
        const x = clamp(Math.floor(nt.X + 1.5), 0, 2), y = clamp(Math.floor(-nt.Y + 1.5), 0, 2);
        this.alpha[x + 3 * y] = 0.2; this.lastPassedNote = i;
      } else break;
    }
  }
}
