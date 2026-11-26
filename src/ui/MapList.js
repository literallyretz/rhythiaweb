// Port of scripts/ui/menu/play/MapList.cs + MapButton.cs + MapButtonWide.cs (List layout), prefabs/map_button_wide.tscn, outline.gdshader and the
// Menus/Play/MapList node tree of scenes/main_menu.tscn. The Grid layout (MapButtonSquare) is not ported yet.
import { MapManager } from '../map/MapManager.js';
import { Lobby } from '../Lobby.js';
import { lx, lrect } from './UIScale.js';
import { Bindable } from '../util/misc.js';
import { DIFFICULTY_COLORS } from '../constants.js';

const $ = (id) => document.getElementById(id);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const formatTime = (seconds) => { const m = Math.floor(Math.abs(seconds) / 60), s = Math.floor(Math.abs(seconds) % 60); return `${seconds < 0 ? '-' : ''}${m}:${String(s).padStart(2, '0')}`; };   // Util.String.FormatTime
const LIGHT = '201,0,69', CURSOR_LIGHT = '38,38,38', OUTLINE = '#0d0d0d', GLOW = 350;
// outline.gdshader: outline colour, mixed towards cursor_light_color (linear falloff), then towards light_color by `fill` (horizontal) and by the selection light (squared falloff)
export const radial = (x, y, rgb, f) => `radial-gradient(circle at ${x}px ${y}px,${[0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1].map((t) => `rgba(${rgb},${f(1 - t)}) ${(t * GLOW).toFixed(1)}px`).join(',')},rgba(${rgb},0) ${GLOW}px)`;

class MapButton {   // MapButton + MapButtonWide
  constructor(list) {
    this.list = list;
    this.Map = null; this.ListIndex = 0; this.MinimumSize = list.buttonMinSize; this.HoveredSizeOffset = list.buttonHoverSize; this.SelectedSizeOffset = list.buttonSelectSize;
    this.SizeOffset = 0; this.Hovered = false; this.Selected = false; this.OutlineFill = 0; this.targetOutlineFill = 0; this.LightPosition = [-10000, 0];
    this.stickoutOffset = 0; this.holderLeft = 0.1; this.height = this.MinimumSize;   // CustomMinimumSize.y
    const el = this.el = document.createElement('div'); el.className = 'mb';
    el.innerHTML = '<div class="hold"><div class="out"></div><div class="cov"></div><div class="fav"><i></i></div><div class="ttl"><span></span></div><div class="sepr"></div><div class="ext"></div><button class="hit" tabindex="-1"></button></div>';
    this.hold = el.firstChild; this.out = this.hold.querySelector('.out'); this.cov = this.hold.querySelector('.cov'); this.fav = this.hold.querySelector('.fav');
    this.title = this.hold.querySelector('.ttl span'); this.extra = this.hold.querySelector('.ext');
    const hit = this.hold.querySelector('.hit');
    hit.onmouseenter = () => this.Hover(true); hit.onmouseleave = () => this.Hover(false);
    hit.onclick = () => this.onPressed?.();
    hit.oncontextmenu = (e) => e.preventDefault();
  }
  Hover(hover) {
    if (this.Hovered === hover) return;
    this.Hovered = hover; this.SizeOffset = this._computeSizeOffset();
    this.onHover?.(hover);
    this.el.classList.toggle('hov', hover);   // Holder self_modulate tween 0.15 s (css transition)
  }
  Select(select = true) {
    if (this.Selected === select) return;
    this.Selected = select; this.SizeOffset = this._computeSizeOffset();
    this.el.classList.toggle('sel', select);  // Cover modulate alpha 128 -> 255 over 0.1 s
  }
  Deselect() { this.Select(false); }
  UpdateInfo(map, selected = false) {
    this.Map = map;
    this.title.textContent = map.PrettyTitle;
    this.fav.style.display = map.Favorite ? 'block' : 'none';
    this.fav.firstChild.style.background = DIFFICULTY_COLORS[clamp(map.Difficulty, 0, DIFFICULTY_COLORS.length - 1)];
    const url = this.list.coverURL(map); this.cov.style.backgroundImage = url ? `url(${url})` : 'none';
    // MapButtonWide.UpdateInfo: [outline_size=2][outline_color=000000][color=808080]{time} — [color={diff}]{difficulty name} [color=808080]by [color=b0b0b0]{mappers}
    const e = document.createElement('span'); this.extra.replaceChildren(e);
    const span = (txt, color) => { const s = document.createElement('b'); s.textContent = txt; s.style.color = color; e.append(s); };
    span(`${formatTime(map.Length / 1000)} — `, '#808080'); span(`${map.DifficultyName} `, DIFFICULTY_COLORS[map.Difficulty]); span('by ', '#808080'); span(map.PrettyMappers, '#b0b0b0');
    this.stickoutOffset = selected ? 0.05 : 0;
    if (selected) { this.Select(); this.UpdateOutline(1, 0); }
  }
  UpdateOutline(targetFill, fill = -1) { this.targetOutlineFill = targetFill; if (fill !== -1) this.OutlineFill = fill; }
  _computeSizeOffset() { return (this.Hovered ? this.HoveredSizeOffset : 0) + (this.Selected ? this.SelectedSizeOffset : 0); }

  process(delta, now, container) {
    const list = this.list;
    this.OutlineFill = lerp(this.OutlineFill, this.targetOutlineFill, Math.min(1, 10 * delta));
    this.fav.style.transform = `rotate(${this.ListIndex * -10 + now / 20}deg)`;
    this.fav.style.opacity = (225 + 30 * Math.sin(Math.PI * now / 2000 + this.ListIndex)) / 255;
    // MapButtonWide._Process
    this.stickoutOffset = lerp(this.stickoutOffset, this.Selected ? 0.05 : 0, Math.min(1, 16 * delta));
    const half = list.height / 2;
    let centerOffset = Math.abs(container.centerY - half) / (half + this.MinimumSize / 2);
    centerOffset = Math.cos(Math.PI * centerOffset / 2);
    this.holderLeft = 0.1 - centerOffset / 20 - this.stickoutOffset;
    this.height = lerp(this.height, this.MinimumSize + this.SizeOffset, Math.min(1, 16 * delta));
    // Outline shader
    const left = this.holderLeft * list.width, f = this.OutlineFill, [lx, ly] = this.LightPosition, rect = container.rect;
    const cx = list.mouse.x - (rect.left + left), cy = list.mouse.y - rect.top;
    // fill_glow = clamp(1 - UV.x + 2 * (fill - 0.5)): fully lit until x = 2*fill - 1, fading out by x = 2*fill
    this.out.style.background = [radial(lx - (rect.left + left), ly - rect.top, LIGHT, (t) => (t * t).toFixed(3)),
      `linear-gradient(to right,rgba(${LIGHT},1) ${((2 * f - 1) * 100).toFixed(2)}%,rgba(${LIGHT},0) ${(2 * f * 100).toFixed(2)}%)`,
      radial(cx, cy, CURSOR_LIGHT, (t) => t.toFixed(3)), OUTLINE].join(',');
  }
}

export class MapList {
  constructor(app) {
    this.app = app; MapList.Instance = this;
    this.Layout = 'List'; this.Spacing = 10;
    this.WideButtonMinimumSize = 90; this.WideButtonHoveredSize = 10; this.WideButtonSelectedSize = 20;
    this.ScrollStep = 1500; this.ScrollFriction = 20; this.ScrollElasticity = 0.02;
    this.ScrollLength = 0; this.ScrollMomentum = 0; this.TargetScroll = 0; this.Scroll = 0;
    this.DragScroll = false; this.MouseScroll = false; this.DisplaySelectionCursor = false;
    this.SearchQuery = ''; this.AuthorQuery = '';
    this.Ascending = new Bindable(true); this.Sorting = new Bindable('Alphabetical');
    this.Maps = [];                                   // queried and ordered maps to display
    this.root = $('mapList'); this.mask = $('mlMask'); this.cursor = $('mlCursor'); this.barMain = $('mlBarMain');
    this.containers = new Map(); this.containerCache = []; this.mapButtons = new Map(); this.mapButtonCache = [];
    this.hoveredButton = null; this.selectedMapID = null;
    this.buttonMinSize = this.WideButtonMinimumSize; this.buttonHoverSize = this.WideButtonHoveredSize; this.buttonSelectSize = this.WideButtonSelectedSize;
    this.buttonsPerContainer = 1; this.lastMouseY = 0; this.dragDistance = 0;
    this.mouse = { x: -10000, y: -10000, screenY: 0 }; this.cursorPos = [-40, 0]; this.cursorRot = 0; this.cursorAlpha = 0;
    this.last = performance.now();
    this.width = 0; this.height = 0;

    this.Sorting.ValueChanged.push(() => this.Sort()); this.Ascending.ValueChanged.push(() => this.Sort());
    this.root.addEventListener('mouseleave', () => this._toggleSelectionCursor(false));
    window.addEventListener('mousemove', (e) => { this.mouse.x = lx(e.clientX); this.mouse.y = lx(e.clientY); this.mouse.screenY = e.screenY; }, true);
    // unhandled input: presses that no control consumed (buttons, inputs and the sort panel consume them)
    const handled = (t) => !!t.closest?.('button,input,a,#sortPanel,#settings');
    window.addEventListener('pointerdown', (e) => {
      if (!this.visible() || handled(e.target) || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.button === 0) { this.DragScroll = true; this.dragDistance = 0; } else if (e.button === 2) { this.MouseScroll = true; this.dragDistance = 0; }
    }, true);
    window.addEventListener('pointerup', (e) => { if (e.button === 0) this.DragScroll = false; else if (e.button === 2) this.MouseScroll = false; }, true);
    window.addEventListener('blur', () => { this.DragScroll = false; this.MouseScroll = false; });
    window.addEventListener('contextmenu', (e) => { if (this.visible() && !e.target.closest?.('input')) e.preventDefault(); });
    window.addEventListener('wheel', (e) => {
      if (!this.visible() || e.ctrlKey || e.altKey || e.shiftKey || e.target.closest?.('#settings')) return;
      this.ScrollMomentum += e.deltaY > 0 ? this.ScrollStep : -this.ScrollStep;
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!app.menuRunning) return;
      if (e.code === 'F2') { this._shuffle(); e.preventDefault(); }
      else if (e.code === 'Space' && Lobby.Map != null && this.visible() && !(document.activeElement instanceof HTMLInputElement) && !app.settingsMenu?.Shown) {
        e.preventDefault(); this.play();
      }
    });
    new ResizeObserver(() => this._clear()).observe(this.root);   // Resized += clear

    MapManager.on('initialized', () => this.UpdateMaps());
    MapManager.on('updated', () => this.UpdateMaps());
    MapManager.on('deleted', (map) => {
      if (this.selectedMapID === map.Name) {
        this.selectedMapID = null;
        if (MapManager.Maps.length > 0) setTimeout(() => this.Select(MapManager.Maps[0], false));   // CallDeferred
      }
      setTimeout(() => { this._clear(); this.UpdateMaps(); });
    });
    MapManager.on('importFinished', async (maps) => {   // MapParser.MapsImportFinished
      if (maps.length > 0) { await MapManager.load(); this.UpdateMaps(); this.Select(maps[0]); }
    });
    this.UpdateMaps();
    requestAnimationFrame((t) => this._frame(t));
  }

  visible() { const p = $('play'); return p.style.display !== 'none' && this.app.menuRunning; }   // IsVisibleInTree
  coverURL(map) { if (!map.CoverBuffer) return null; return map._coverURL ??= URL.createObjectURL(new Blob([map.CoverBuffer], { type: 'image/png' })); }
  play() { this.app.playMap(Lobby.Map); }   // Game.Play(Lobby.Map, ...)

  _frame(now) {
    const delta = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (this.visible() || this.mapButtons.size) { try { this._process(delta, now); } catch (e) { console.error(e); } }
    requestAnimationFrame((t) => this._frame(t));
  }

  _process(delta, now) {
    const r = lrect(this.root); this.width = this.root.clientWidth; this.height = this.root.clientHeight;
    const Size = { X: this.width, Y: this.height };
    this.buttonsPerContainer = 1;   // List layout

    let scrollElasticOffset = 0;
    if ((this.TargetScroll <= 0 && this.ScrollMomentum < 0) || (this.TargetScroll >= this.ScrollLength && this.ScrollMomentum > 0)) scrollElasticOffset = this.ScrollMomentum * this.ScrollElasticity;
    this.ScrollLength = Math.max(0, Math.trunc(this.Maps.length / this.buttonsPerContainer) * (this.buttonMinSize + this.Spacing) - this.Spacing - Size.Y) + this.buttonHoverSize + this.buttonSelectSize;
    this.ScrollMomentum = lerp(this.ScrollMomentum, 0, Math.min(1, this.ScrollFriction * delta));

    const mouseY = this.mouse.screenY;
    if (this.DragScroll && this.visible()) {
      const dragDelta = (this.lastMouseY - mouseY) * 30;
      this.ScrollMomentum += dragDelta; this.dragDistance += Math.abs(dragDelta);
    }
    this.lastMouseY = mouseY;

    const barH = this.barMain.clientHeight;
    if (this.MouseScroll) {
      const a = r.top + barH / 2, b = r.top + Size.Y - barH / 2;
      const t = (this.mouse.y - a) / (b - a);   // Mathf.InverseLerp(Position.Y + ..., Position.Y + Size.Y - ..., mouse Y)
      this.TargetScroll = lerp(this.TargetScroll, this.ScrollLength * clamp(t, 0, 1), Math.min(1, 24 * delta));
    } else {
      this.TargetScroll = clamp(this.TargetScroll + this.ScrollMomentum * delta, 0, this.ScrollLength) + scrollElasticOffset;
    }
    this.Scroll = lerp(this.Scroll, this.TargetScroll, Math.min(1, 12 * delta));

    const aTop = Math.max(0, (this.TargetScroll - scrollElasticOffset) / (this.ScrollLength + Size.Y));
    const aBottom = Math.min(1, aTop + Size.Y / (this.ScrollLength + Size.Y));
    this.barMain.style.top = `${aTop * 100}%`; this.barMain.style.bottom = `${(1 - aBottom) * 100}%`;

    let lastContainer = null; const drawn = [], sizeOffsets = []; let firstIndex = -1, upOffset = 0, downOffset = 0;
    for (let i = 0; i < this.Maps.length; i++) {
      const containerIndex = Math.trunc(i / this.buttonsPerContainer), map = this.Maps[i];
      const top = containerIndex * (this.buttonMinSize + this.Spacing) - this.Scroll, bottom = top + this.buttonMinSize;
      const display = top < Size.Y && bottom > 0;
      let button = this.mapButtons.get(map.Name) ?? null;
      if (!display) {   // cache / ignore outside the list
        if (button != null) {
          const parent = button.container;
          for (const sib of parent.children) {
            sib.container = null;
            if (sib === this.hoveredButton) this.hoveredButton = null;
            this.mapButtons.delete(sib.Map.Name); this.mapButtonCache.push(sib);
            sib.el.remove(); sib.Deselect(); sib.UpdateOutline(0, 0);
          }
          parent.children = []; parent.el.remove();
          this.containers.delete(containerIndex); this.containerCache.push(parent);
        }
        continue;
      }
      let container = this.containers.get(containerIndex);
      if (!container) {
        container = this.containerCache.pop() ?? { el: Object.assign(document.createElement('div'), { className: 'mrow' }), children: [], h: 0 };
        this.containers.set(containerIndex, container); this.mask.append(container.el);
      }
      if (button == null) {
        button = this.mapButtonCache.pop() ?? this._setupButton(new MapButton(this));
        button.ListIndex = i; button.container = container; this.mapButtons.set(map.Name, button);
        container.children.push(button); container.el.append(button.el); container.h = container.h || button.MinimumSize;
        button.UpdateInfo(map, map.Name === this.selectedMapID);
      }
      if (container !== lastContainer) {
        drawn.push(container);
        if (firstIndex === -1) firstIndex = containerIndex;
        const sizeOffset = container.h > 0 ? container.h - this.buttonMinSize : 0;
        downOffset += sizeOffset; sizeOffsets.push(sizeOffset); lastContainer = container;
      }
    }

    // selection cursor: Position.Lerp(target, min(1, 8 * delta)), Rotation = -Position.Y / 60
    let target = [-80, this.cursorPos[1]];
    if (this.hoveredButton && this.hoveredButton.container) {
      const hb = this.hoveredButton;
      target = [this.DisplaySelectionCursor ? hb.holderLeft * Size.X - 60 : -80, clamp(hb.container.top + hb.container.h / 2 - 20, 0, Size.Y)];   // Container.Position.Y + Size.Y / 2 - cursor.Size.Y / 2
    }
    const k = Math.min(1, 8 * delta); this.cursorPos = [lerp(this.cursorPos[0], target[0], k), lerp(this.cursorPos[1], target[1], k)];
    this.cursorRot = -this.cursorPos[1] / 60;
    this.cursor.style.transform = `translate(${this.cursorPos[0]}px,${this.cursorPos[1]}px) rotate(${this.cursorRot}rad)`;
    // GlobalPosition of the rotated cursor = position + pivot + R * (-pivot)
    const c = Math.cos(this.cursorRot), s = Math.sin(this.cursorRot);
    const cgp = [r.left + this.cursorPos[0] + 20 + (c * -20 - s * -20), r.top + this.cursorPos[1] + 20 + (s * -20 + c * -20)];

    for (let i = 0; i < drawn.length; i++) {
      const index = i + firstIndex, container = drawn[i];
      const sizeOffset = sizeOffsets[i], indexOffset = index * (this.buttonMinSize + this.Spacing);
      let top = indexOffset - this.Scroll + (this.buttonMinSize + this.buttonHoverSize + this.buttonSelectSize) / 2;
      downOffset -= sizeOffset; top += (upOffset - downOffset) / 2; upOffset += sizeOffset;
      const first = index === 0 || index === Math.ceil(this.Maps.length / this.buttonsPerContainer) - 1;
      container.el.style.zIndex = first ? 1 : 0;
      // the container is centred on `top` (grow both); its height is the button's current CustomMinimumSize.y
      const h = container.children[0]?.height ?? container.h;
      container.h = h; container.centerY = top; container.top = top - h / 2;
      container.el.style.top = `${top - h / 2}px`; container.el.style.height = `${h}px`;
      container.rect = { left: r.left, top: r.top + top - h / 2 };
      for (const b of container.children) {
        b.LightPosition = this.DisplaySelectionCursor ? cgp : [-10000, Size.Y / 2];
        b.process(delta, now, container);
        b.hold.style.left = `${b.holderLeft * Size.X}px`;
      }
    }
  }

  Select(map, playIfPreSelected = true) {
    const changed = this.selectedMapID == null || this.selectedMapID !== map.Name;
    if (changed) {
      MapManager.Select(map);
      this.app.menuBg?.setCover(new Blob([map.CoverBuffer ?? new Uint8Array()], { type: 'image/png' })).catch(() => {});   // SceneManager.Space.UpdateMap(map)
      this.app.ensureAudio(map).then(() => { if (Lobby.Map === map || Lobby.Map?.Name === map.Name) this.app.sound.startMapSelectionPlayback(map); });
      const old = this.mapButtons.get(this.selectedMapID);
      if (this.selectedMapID != null && old) { old.Deselect(); old.UpdateOutline(0); }
    }
    if (!changed && playIfPreSelected) this.play();
    this.selectedMapID = map.Name;
    this.Focus(map);
    return changed;
  }

  Focus(map) {
    const idx = this.Maps.findIndex((m) => m.Name === map.Name);
    this.TargetScroll = Math.trunc(idx / this.buttonsPerContainer) * (this.buttonMinSize + this.Spacing) + this.buttonMinSize / 2 - this.height / 2;
    this.app.mainMenu?.Transition(this.app.mainMenu.PlayMenu);   // SceneManager.Scene is MainMenu
  }

  Sort() {
    const byTitle = (a, b) => a.PrettyTitle.localeCompare(b.PrettyTitle);
    let ordered;
    switch (this.Sorting.Value) {
      case 'Difficulty': ordered = [...this.Maps].sort((a, b) => a.Difficulty - b.Difficulty); break;
      case 'Mappers': {
        const first = (m) => { const arr = m.Mappers?.length === 0 ? m.PrettyMappers.split(', ') : m.Mappers; return [...arr].sort((a, b) => a.localeCompare(b))[0]; };
        ordered = [...this.Maps].sort((a, b) => first(a).localeCompare(first(b))); break;
      }
      default: ordered = [...this.Maps].sort(byTitle);
    }
    if (!this.Ascending.Value) ordered.reverse();
    this.Maps = [...ordered.filter((m) => m.Favorite), ...ordered.filter((m) => !m.Favorite)];
    this._clear();
  }

  Search(query = '', author = '') {
    this.SearchQuery = query ?? this.SearchQuery; this.AuthorQuery = author ?? this.AuthorQuery;
    this.UpdateMaps();
  }

  UpdateMaps() {
    const has = (s, q) => s.toLocaleLowerCase().includes(q.toLocaleLowerCase());
    const queried = MapManager.Maps.filter((x) => has(x.PrettyTitle, this.SearchQuery) && has(x.PrettyMappers, this.AuthorQuery));
    this.Maps = [...queried.filter((m) => m.Favorite), ...queried.filter((m) => !m.Favorite)];
    this.Sort(); this._clear();
  }

  _setupButton(button) {
    button.onHover = (hovered) => {
      if (hovered) { this.hoveredButton = button; this._toggleSelectionCursor(true); }   // Layout == List
      if (button.Map.Name !== this.selectedMapID) button.UpdateOutline(hovered ? 0.5 : 0);
    };
    button.onPressed = () => {
      if (this.dragDistance < 500 && this.Select(button.Map)) { button.Select(); button.UpdateOutline(1.0); }
    };
    return button;
  }

  _toggleSelectionCursor(display) {
    if (this.DisplaySelectionCursor === display) return;
    this.DisplaySelectionCursor = display;
    if (display && this.hoveredButton?.container) this.cursorPos = [this.cursorPos[0], this.hoveredButton.container.top ?? this.cursorPos[1]];
    this.cursor.style.transition = 'opacity .1s'; this.cursor.style.opacity = display ? 1 : 0;   // modulate alpha tween 0.1 s
  }

  _clear() {
    this.hoveredButton = null;
    for (const b of this.mapButtons.values()) b.el.remove();
    for (const b of this.mapButtonCache) b.el.remove();
    for (const c of this.containers.values()) c.el.remove();
    for (const c of this.containerCache) c.el.remove();
    this.mapButtons.clear(); this.mapButtonCache = []; this.containers.clear(); this.containerCache = [];
  }

  _shuffle() {   // Maps.Shuffle()
    const a = [...this.Maps];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    this.Maps = a; this._clear();
  }
}
