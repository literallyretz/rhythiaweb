// Port of scripts/ui/menu/play/MapInfo.cs, MapInfoContainer.cs, FlatPreview.cs, SpeedPresetButton.cs, LinkPopupButton.cs and prefabs/map_info_container.tscn.
// Camera Mode, Modifiers and the Leaderboard (with its Dim and LeaderboardHide) are not ported yet; their parts of the panel stay empty.
import { MapManager } from '../map/MapManager.js';
import { Lobby } from '../Lobby.js';
import { DIFFICULTY_COLORS } from '../constants.js';
import { notify } from './Toast.js';
import { radial } from './MapList.js';
import { OptionPopup } from './OptionPopup.js';
import { binarySearch } from '../util/misc.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const formatTime = (seconds) => { const m = Math.floor(Math.abs(seconds) / 60), s = Math.floor(Math.abs(seconds) % 60); return `${seconds < 0 ? '-' : ''}${m}:${String(s).padStart(2, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const outCubic = (t) => 1 - (1 - t) ** 3, outQuart = (t) => 1 - (1 - t) ** 4, outQuint = (t) => 1 - (1 - t) ** 5;

// Godot tweens, processed from _Process. Several tweens may drive the same property; the newest one is applied last, as in Godot.
const tweens = [];
function tweenProp(obj, key, to, dur, ease) {
  const t = { obj, key, to, dur, ease, from: null, time: 0, done: false }; tweens.push(t); return t;
}
function processTweens(delta) {
  for (const t of tweens) {
    if (t.from === null) t.from = t.obj[t.key];   // the start value is read when the tween first steps
    t.time += delta; const k = t.dur > 0 ? Math.min(1, t.time / t.dur) : 1;
    t.obj[t.key] = t.from + (t.to - t.from) * t.ease(k);
    if (k >= 1) t.done = true;
  }
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].done) { const t = tweens.splice(i, 1)[0]; t.then?.(); }
}
const whenAll = (list, cb) => { let n = list.length; for (const t of list) t.then = () => { if (--n === 0) cb(); }; };

// HSlider (theme.tres: slider / grabber_area / grabber / tick, center_grabber). Value semantics of Range: step snapping, rounded, allow_greater/lesser.
function hslider(host, { min, max, step, rounded = false, allowGreater = false, ticks = 0 }) {
  host.classList.add('slider'); host.tabIndex = 0;
  host.innerHTML = `<div class="rail"></div><div class="fill"></div>${'<i class="tk"></i>'.repeat(ticks)}<div class="grab"></div>`;
  const fill = host.querySelector('.fill'), grab = host.querySelector('.grab');
  host.querySelectorAll('.tk').forEach((t, i) => { t.style.left = `calc(${(i / (ticks - 1)) * 100}% - 16px)`; });   // i * areasize / (ticks - 1), centred under the grabber
  const api = { value: min, onChange: null, onDragEnd: null };
  const ratio = () => clamp((api.value - min) / (max - min), 0, 1);
  const draw = () => { const f = ratio() * 100; fill.style.width = `${f}%`; grab.style.left = `calc(${f}% - 16px)`; };
  const setValue = (v, signal) => {   // Range.set_value
    if (step > 0) v = Math.round((v - min) / step) * step + min;
    if (rounded) v = Math.round(v);
    if (!allowGreater) v = clamp(v, min, max);
    if (v === api.value) return;
    api.value = v; draw(); if (signal) api.onChange?.(v);
  };
  api.set = (v) => setValue(v, false);   // SetValueNoSignal
  const ratioAt = (x) => { const r = host.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1); };
  let grabbing = false, before = 0;
  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    host.setPointerCapture(e.pointerId); host.focus(); grabbing = true; before = ratio();
    setValue(min + ratioAt(e.clientX) * (max - min), false);   // the jump to the click is made with signals blocked
  });
  host.addEventListener('pointermove', (e) => { if (grabbing) setValue(min + ratioAt(e.clientX) * (max - min), true); });
  host.addEventListener('pointerup', (e) => { if (!grabbing || e.button !== 0) return; grabbing = false; api.onDragEnd?.(Math.abs(before - ratio()) > 1e-9); });
  host.addEventListener('wheel', (e) => { if (!e.deltaY) return; host.focus(); setValue(api.value + (e.deltaY < 0 ? step : -step), true); });   // not accepted: the event still reaches the scroll container
  host.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setValue(api.value + (e.key === 'ArrowLeft' ? -step : step), true); e.preventDefault(); } });
  new ResizeObserver(draw).observe(host); draw();
  return api;
}

class MapInfoContainer {
  constructor(app) {
    this.app = app; this.Map = null; this.Name = 'MapInfoContainer';
    this.alpha = 0; this.posX = 0; this.posY = 0; this.scale = 1; this.infoOff = 0; this.actOff = 0;   // Modulate = (1,1,1,0) in _Ready
    const el = this.el = document.createElement('div'); el.className = 'mi-con'; el._c = this;
    el.innerHTML = `
      <div class="mi-info"><div class="mi-bg"></div><div class="mi-sc"><div class="mi-ib">
        <div class="mi-cbg"><img class="mi-cov" alt=""><button class="mi-al"><i></i><span></span></button></div>
        <div class="mi-sub"><div class="mi-main"></div><div class="mi-extra"></div>
          <div class="mi-btns"><button class="gb mi-b mi-exp" title="Exports map into a .phxm file to share easily"><img src="assets/skin/ui/buttons/export.png" alt=""></button><button class="gb mi-b mi-fav"><img alt=""></button><button class="gb mi-b mi-del" title="Delete"><img src="assets/skin/ui/buttons/delete.png" alt=""></button></div></div>
      </div></div><div class="mi-ol"></div></div>
      <div class="mi-act"><div class="mi-bg"></div><div class="mi-sc"><div class="mi-hs">
        <div class="mi-prev"><div class="mi-lab">Preview</div><div class="mi-pa"><div class="mi-fp"></div></div></div>
        <div class="mi-speed"><div class="mi-lab">Speed</div><div class="mi-psc"><div class="mi-pre"></div></div><div class="mi-sl mi-ssl"></div><input class="mi-ed mi-sed" spellcheck="false" autocomplete="off" placeholder="100"></div>
        <div class="mi-play"><div class="mi-lab">Play</div><div class="mi-sl mi-fsl"></div><input class="mi-ed mi-fed" placeholder="0:00" spellcheck="false" autocomplete="off"><button class="mi-start"><span>START</span><img src="assets/skin/ui/buttons/play.png" alt=""></button></div>
        <div class="mi-sep" style="left:50%;top:16px;bottom:calc(50% + 16px)"></div><div class="mi-sep" style="left:75%;top:16px;bottom:calc(50% + 16px)"></div>
        <div class="mi-sep" style="left:50%;top:calc(50% + 16px);bottom:16px"></div><div class="mi-sep" style="left:16px;right:16px;top:50%;width:auto;height:1px"></div>
      </div></div><div class="mi-ol"></div></div>`;
    const q = (s) => el.querySelector(s);
    this.info = q('.mi-info'); this.actions = q('.mi-act'); this.ols = [...el.querySelectorAll('.mi-ol')];
    this.coverBackground = q('.mi-cbg'); this.cover = q('.mi-cov'); this.mainLabel = q('.mi-main'); this.extraLabel = q('.mi-extra');
    this.favoriteButton = q('.mi-fav'); this.startButton = q('.mi-start'); this.artistLink = q('.mi-al');

    // ArtistLink (LinkPopupButton)
    this.linkPopup = new OptionPopup('Open Link', '');
    this.linkPopup.AddOption('Open', () => window.open(this.link, '_blank', 'noopener'), '');
    this.linkPopup.AddOption('Cancel', () => {});
    this.artistLink.onclick = () => this.linkPopup.Show();

    // FlatPreview: 3x3 ColorRects
    this.fp = q('.mi-fp'); this.tiles = []; this.tileAlpha = new Float32Array(9); this.pvMap = null; this.pvTime = 0;
    for (let i = 0; i < 9; i++) { const t = document.createElement('i'); this.fp.appendChild(t); this.tiles.push(t); }

    q('.mi-exp').onclick = () => {
      const m = this.Map;
      notify(`Exporting to ${m.Name}.phxm`, 1);
      MapManager.exportEncode(m).then(({ name, blob }) => {
        notify('Done! Opening export...', 0);
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
      });
    };
    this.favoriteButton.onclick = () => { const m = this.Map; m.Favorite = !m.Favorite; MapManager.Update(m); this._fav(); };
    q('.mi-del').onclick = () => MapManager.Delete(this.Map);

    // Speed setup
    const speedSlider = hslider(q('.mi-ssl'), { min: 50, max: 150, step: 5, rounded: true, allowGreater: true, ticks: 11 }), speedEdit = q('.mi-sed');
    const pre = q('.mi-pre'); this.presets = [];
    [['speed_minus_minus', 80], ['speed_minus', 90], ['speed_middle', 100], ['speed_plus', 110], ['speed_plus_plus', 120]].forEach(([ic, sp]) => {
      const b = document.createElement('button'); b.className = 'gb mi-pb'; b.title = String(sp); b.innerHTML = `<img src="assets/skin/ui/buttons/${ic}.png" alt="">`;
      b.onclick = () => Lobby.SetSpeed(sp / 100); b._sp = sp; pre.appendChild(b); this.presets.push(b);
    });
    const displaySpeed = (speed) => {
      for (const b of this.presets) b.classList.toggle('on', b._sp / 100 === speed);   // SpeedPresetButton.updateState
      speed *= 100; const r = Math.round(speed * 10) / 10;
      if (Math.abs(r - speed) <= 1e-6) speed = r;   // Mathf.Epsilon
      speedSlider.set(speed); speedEdit.value = String(speed);
    };
    displaySpeed(Lobby.Speed); Lobby.on('SpeedChanged', displaySpeed);
    const applySpeed = () => {
      let v = Number(speedEdit.value); if (speedEdit.value.trim() === '' || !Number.isFinite(v)) v = 100;
      Lobby.SetSpeed(clamp(v, 25, 1000) / 100);
      const sm = app.sound; if (sm.Map?.Name === this.Map?.Name && sm.song.playing) sm.song.pitchScale = Lobby.Speed;
    };
    speedEdit.addEventListener('blur', applySpeed); speedEdit.addEventListener('keydown', (e) => { if (e.key === 'Enter') applySpeed(); });
    speedSlider.onChange = (v) => { speedEdit.value = String(v); applySpeed(); };

    // StartFrom setup
    const sfSlider = hslider(q('.mi-fsl'), { min: 0, max: 1, step: 0, ticks: 11 }), sfEdit = q('.mi-fed');
    Lobby.on('StartFromChanged', (startFrom) => {
      const length = this.Map != null ? this.Map.Length : 1;
      sfSlider.set(startFrom / length); sfEdit.value = formatTime(startFrom / 1000);
      this.startButton.firstChild.textContent = `START${startFrom > 0 ? ` (${sfEdit.value})` : ''}`;
    });
    const applyStartFrom = (input = null, seek = true) => {
      const Map = this.Map;
      input ??= sfEdit.value === '' ? sfEdit.placeholder : sfEdit.value;
      let value = 0; const split = String(input).split(':').reverse();   // string[].Reverse() reverses in place
      const isFloat = (s) => s.trim() !== '' && Number.isFinite(Number(s));
      if (split.length > 1 && isFloat(split[1])) value += 60 * Number(split[1]);
      if (isFloat(split[0])) { let iv = Number(split[0]); if (iv < 1) iv *= Math.floor(Map.Length / 1000); value += iv; }   // Map.Length / 1000 is integer division
      value = clamp(value * 1000, 0, Map.Length);
      Lobby.SetStartFrom(value);
      const sm = app.sound;
      if (sm.Map?.Name !== Map.Name) sm.startMapSelectionPlayback(Map);
      if (seek && sm.song.playing) { this._pvSeek(Lobby.StartFrom); sm.song.seek(Lobby.StartFrom / 1000); }
    };
    sfEdit.addEventListener('blur', () => applyStartFrom()); sfEdit.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyStartFrom(); });
    sfSlider.onChange = (v) => applyStartFrom((Math.round(v * this.Map.Length) / 1000).toFixed(2), false);
    sfSlider.onDragEnd = (changed) => { if (changed) applyStartFrom(); };
    for (const e of [speedEdit, sfEdit]) e.addEventListener('keydown', (ev) => ev.stopPropagation());

    this.startButton.onclick = () => app.playMap(this.Map);
  }
  _fav() { const m = this.Map; this.favoriteButton.title = m.Favorite ? 'Unfavorite' : 'Favorite'; this.favoriteButton.firstChild.src = `assets/skin/ui/buttons/${m.Favorite ? 'unfavorite' : 'favorite'}.png`; }

  Setup(map, list) {
    if (map == null || this.Name === map.Name) return;
    this.Map = map; this.Name = map.Name;
    // Transition
    this.posX = 0; this.posY = 0; this.scale = 1;
    this.infoOff -= 64; this.actOff -= 80;
    tweenProp(this, 'infoOff', 0, 0.5, outQuint); tweenProp(this, 'actOff', 0, 0.6, outQuart);
    this.posX -= 64;   // OffsetRight = 0; Position += Vector2.Left * 64
    // Info
    const col = DIFFICULTY_COLORS[clamp(map.Difficulty, 0, DIFFICULTY_COLORS.length - 1)];
    this.mainLabel.innerHTML = `<p class="t">${esc(map.PrettyTitle)}</p><p><span style="color:${col}">${esc(map.DifficultyName)}</span> <span class="by">by ${esc(map.PrettyMappers)}</span></p>`;
    this.extraLabel.innerHTML = `<span class="a">${formatTime(map.Length / 1000)}\n${map.Notes.length} notes</span>\n<span class="b">${esc(map.Name)}</span>`;
    this.coverBackground.style.setProperty('--dc', col);
    this.cover.src = list.coverURL(map) ?? '';
    this._fav();
    this.artistLink.style.display = map.ArtistLink !== '' ? '' : 'none';
    this.artistLink.lastChild.textContent = `Available on ${map.ArtistPlatform}`;
    this.link = map.ArtistLink;   // UpdateLink
    this.linkPopup.Options.Open.title = map.ArtistLink;
    this.linkPopup.UpdateInfo(`<p style="text-align:center"><span style="color:#dddddd">This will open the following link:</span><br><span style="color:#aaaaff"><i><u>${esc(map.ArtistLink)}</u></i></span><br><br><span style="color:#dddddd">Are you sure?</span></p>`);
    // Actions
    Lobby.SetStartFrom(0);
    this._pvSetup(map);
  }
  Transition(show) {   // Cubic out, parallel: modulate, position, scale (pivot = centre)
    const time = show ? 0.4 : 0.3;
    const list = [tweenProp(this, 'alpha', show ? 1 : 0, time, outCubic), tweenProp(this, 'posX', 0, time, outCubic),
      tweenProp(this, 'posY', show ? 0 : 24, time, outCubic), tweenProp(this, 'scale', show ? 1 : 0.9, time, outCubic)];
    return { TweenCallback: (cb) => whenAll(list, cb) };
  }
  // FlatPreview (UseSoundManagerStreamPlayer = true)
  _pvSetup(map) {
    if (this.pvMap && this.pvMap.Name === map.Name) return;
    this.pvMap = map; this.lastPassedNote = -1; this.noteTimestamps = map.Notes.map((n) => n.Millisecond);
  }
  _pvSeek(ms) { if (!this.pvMap) return; this.pvTime = ms; this.lastPassedNote = binarySearch(this.noteTimestamps, ms); }
  Process(delta, mouse) {
    const e = this.el;
    e.style.opacity = this.alpha; e.style.transform = `translate(${this.posX}px,${this.posY}px) scale(${this.scale})`;
    this.info.style.transform = `translateX(${this.infoOff}px)`; this.actions.style.transform = `translateX(${this.actOff}px)`;
    for (const o of this.ols) {   // outline.gdshader: cursor_position = viewport mouse position
      const r = o.getBoundingClientRect();
      o.style.background = `${radial(mouse[0] - r.left, mouse[1] - r.top, '38,38,38', (t) => t.toFixed(3))},#0d0d0d`;
    }
    const map = this.pvMap; if (!map) return;
    const k = Math.min(1, delta * 6);
    for (let i = 0; i < 9; i++) { this.tileAlpha[i] += (0 - this.tileAlpha[i]) * k; this.tiles[i].style.opacity = this.tileAlpha[i]; }
    const sm = this.app.sound; if (!sm.Map || sm.Map.Name !== map.Name) return;
    const old = this.pvTime; this.pvTime = sm.song.getPlaybackPosition() * 1000;
    if (this.pvTime < old) this.lastPassedNote = binarySearch(this.noteTimestamps, this.pvTime);
    const n = map.Notes;
    for (let i = clamp(this.lastPassedNote + 1, 0, Math.max(0, n.length - 1)); i < n.length; i++) {
      const nt = n[i];
      if (this.pvTime < nt.Millisecond) break;
      this.tileAlpha[clamp(Math.floor(nt.X + 1.5), 0, 2) + 3 * clamp(Math.floor(-nt.Y + 1.5), 0, 2)] = 0.2;   // Color(1, 1, 1, 0.2)
      this.lastPassedNote = i;
    }
  }
}

export class MapInfo {
  constructor(app, list) {
    this.app = app; this.list = list; this.Map = null; this.InfoContainer = null; this.cache = []; this.pendingSelection = null;
    const root = this.root = document.getElementById('mapInfo');
    root.innerHTML = '<div class="mi-hold"></div>'; this.holder = root.firstChild;
    const draw = () => {   // AspectRatioContainer (ratio 1, centred) + _Draw: Holder.CustomMinimumSize = min(850, height)
      const w = root.clientWidth, h = root.clientHeight, S = Math.max(Math.min(w, h), Math.min(850, h));
      Object.assign(this.holder.style, { width: `${S}px`, height: `${S}px`, left: `${(w - S) / 2}px`, top: `${(h - S) / 2}px` });
      this.holder.style.setProperty('--S', `${S}px`);
    };
    new ResizeObserver(draw).observe(root); draw();
    this.mouse = [0, 0]; window.addEventListener('mousemove', (e) => { this.mouse = [e.clientX, e.clientY]; });
    MapManager.Selected.ValueChanged.push(() => this.Select(MapManager.Selected.Value));
    MapManager.on('deleted', (map) => setTimeout(() => {   // CallDeferred
      if (this.Map == null || this.Map.Name === map.Name) { this.Map = null; this.InfoContainer?.Transition(false); }
    }));
  }
  ApplyPendingSelection() { if (this.pendingSelection != null) { const map = this.pendingSelection; this.pendingSelection = null; this.Map = null; this.Select(map); } }
  Select(map) {
    if (map == null) return;
    if (!this.app.menuRunning) { this.pendingSelection = map; return; }   // not inside the tree
    if (this.Map != null && map.Name === this.Map.Name) return;
    this.Map = map; this.pendingSelection = null;
    const old = this.InfoContainer;
    old?.Transition(false).TweenCallback(() => { old.el.remove(); this.cache.push(old); });
    this.InfoContainer = this.cache.length > 0 ? this.cache.pop() : new MapInfoContainer(this.app);
    this.holder.appendChild(this.InfoContainer.el);
    this.InfoContainer.Setup(map, this.list);
    this.InfoContainer.Transition(true);
  }
  Process(delta) {
    processTweens(delta);
    for (const el of this.holder.children) el._c?.Process(delta, this.mouse);
  }
}
