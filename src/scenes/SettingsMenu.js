// Port of ui/SettingsMenu.cs on the scene tree in scenes/main.tscn (Settings > Hide / Holder > Dim, Categories, Sidebar, Header, Outline).
// Layout numbers are the .tscn anchors/offsets; colours and boxes are scripts/themes/theme.tres. Only settings whose DEFS entry has ui: true
// (the ones that drive something in this port) are listed.
import { SettingsManager } from '../SettingsManager.js';
import { tween, quadOut } from '../util/tween.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; parent?.appendChild(e); return e; };

export class SettingsMenu {
  constructor(app) {
    this.app = app; this.Shown = false; this.selected = null; this.panels = {};
    const root = this.root = el('div', 'hidden', document.getElementById('app')); root.id = 'settings';
    this.hideBtn = el('button', null, root); this.hideBtn.id = 'sHide';
    const holder = this.holder = el('div', null, root); holder.id = 'sHolder';
    el('div', null, holder).id = 'sDim';
    el('div', null, holder).id = 'sSep1';
    this.sidebar = el('div', null, holder); this.sidebar.id = 'sSidebar';
    this.cats = el('div', null, holder); this.cats.id = 'sCats';
    this.header = el('div', null, holder); this.header.id = 'sHeader';
    el('div', null, holder).id = 'sOutline';

    // Header: title, profiles OptionButton, create-profile button + name edit
    el('span', null, this.header).id = 'sTitle'; this.header.firstChild.textContent = 'SETTINGS';
    this.profiles = new Dropdown(this.header, 'sProfiles', (name) => {
      if (name === SettingsManager.GetCurrentProfile()) return;
      SettingsManager.Save(); SettingsManager.SetCurrentProfile(name); SettingsManager.Load();
    });
    const create = el('button', null, this.header); create.id = 'sCreate'; create.title = 'Create Profile';
    const icon = el('img', null, create); icon.src = 'assets/textures/ui/add.png'; icon.alt = '';
    const edit = el('input', null, this.header); edit.id = 'sProfileEdit'; edit.placeholder = 'profile name'; edit.title = 'Create Profile'; edit.hidden = true; edit.spellcheck = false;
    create.onclick = () => { edit.hidden = !edit.hidden; if (!edit.hidden) edit.focus(); };
    edit.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      edit.hidden = true; const profile = edit.value; edit.value = '';
      SettingsManager.Save(); SettingsManager.SetCurrentProfile(profile); SettingsManager.Reload();   // TextSubmitted
      this.updateProfileSelection();
    };
    SettingsManager.onLoaded(() => this.updateProfileSelection());

    // Categories + rows (one scroll container and one sidebar entry per section)
    for (const [section, items] of SettingsManager.Settings.ToOrderedSectionList()) {
      if (!items.length) continue;
      const cat = el('div', 'scat', this.cats); cat.dataset.name = section; cat.hidden = true;
      // ScrollBar wheel: change = page / PAGE_DIVISOR (8) * factor per notch (scroll_bar.cpp); a 100 px wheel delta is one notch
      cat.addEventListener('wheel', (e) => { if (e.ctrlKey || e.altKey || e.shiftKey) return; const f = e.deltaMode === 0 ? Math.abs(e.deltaY) / 100 : 1; cat.scrollTop += Math.sign(e.deltaY) * (cat.clientHeight / 8) * f; e.preventDefault(); e.stopPropagation(); }, { passive: false });
      const entry = el('div', 'sbcat', this.sidebar); entry.dataset.name = section;
      const btn = el('button', null, entry); btn.textContent = section.toUpperCase();
      btn.onclick = () => this.selectCategory(cat);
      if (!this.selected) this.selectCategory(cat);
      for (const setting of items) { const row = this.buildRow(setting); cat.appendChild(row); this.panels[setting.Id] = row; }
    }
    this.updateProfileSelection();
    this.hideBtn.onclick = () => this.hideMenu();
    this.hideBtn.style.pointerEvents = 'none';
    window.addEventListener('keydown', (e) => this.onKey(e), true);   // _Input
    this.showMenu(false, true);
  }

  // SettingsMenu._Input: Ctrl+O toggles, Escape closes (and is handled so the pause/quit logic does not also fire)
  onKey(e) {
    if (e.code === 'KeyO' && e.ctrlKey) { this.showMenu(!this.Shown); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.code === 'Escape' && this.Shown) { this.showMenu(false); e.preventDefault(); e.stopImmediatePropagation(); }
  }

  showMenu(show = true, instant = false) {
    this.Shown = show; SettingsManager.Shown = show;
    this.hideBtn.style.pointerEvents = show ? 'auto' : 'none';        // hideButton.MouseFilter = Stop / Ignore
    const r = this.root, h = this.holder;
    if (show) { r.classList.remove('hidden'); this.off = 25; }          // Visible = true; holder.OffsetTop/Bottom = 25
    if (this.off === undefined) this.off = 25;
    if (this.op === undefined) this.op = 0;
    const op0 = this.op, off0 = this.off, op1 = show ? 1 : 0, off1 = show ? 0 : 25, dur = instant ? 0 : 0.25;
    // CreateTween().SetTrans(Quad).SetEase(Out).SetParallel(): modulate alpha, offset_top, offset_bottom; then Visible = Shown
    tween(dur, quadOut, (k) => { this.op = op0 + (op1 - op0) * k; this.off = off0 + (off1 - off0) * k; r.style.opacity = this.op; h.style.transform = `translateY(${this.off}px)`; })
      .then(() => { if (!this.Shown) r.classList.add('hidden'); });
  }
  hideMenu() { this.showMenu(false); }

  selectCategory(cat) {
    if (this.selected) { this.entry(this.selected).classList.remove('sel'); this.selected.hidden = true; }
    this.selected = cat; cat.hidden = false; this.entry(cat).classList.add('sel');   // Color (1,1,1,8/255)
  }
  entry(cat) { return this.sidebar.querySelector(`.sbcat[data-name="${cat.dataset.name}"]`); }

  updateProfileSelection() {
    const cur = SettingsManager.GetCurrentProfile(), names = ['default', ...SettingsManager.GetProfiles().filter((n) => n !== 'default')];
    if (!names.includes(cur)) names.push(cur);
    this.profiles.set(names, cur);
  }

  buildRow(setting) {
    const row = el('div', 'srow'); row.dataset.id = setting.Id;
    const title = el('div', 'stitle', row); title.textContent = setting.Title; title.title = setting.Description;
    if (setting.Type === 'bool') this.setupToggle(setting, row);
    else if (setting.Slider) this.setupSlider(setting, row);
    else if (setting.List) this.setupList(setting, row);
    if (setting.Type === 'Variant' && setting.Buttons.length) {
      const box = el('div', 'sbtns', row);
      for (const b of setting.Buttons) {
        const btn = el('button', 'sbtn', box); btn.textContent = b.Title; btn.title = b.Description; let last = 0;
        btn.onclick = () => { const now = performance.now(); if (now - last < 250) return; last = now; b.OnPressed?.(); };   // setupButton: 250 ms debounce
      }
    }
    return row;
  }

  // setupList: OptionButton filled with List.Values; ItemSelected -> SetVariant when changed; Updated -> select the current value's index (no match = nothing selected)
  setupList(setting, row) {
    const dd = new Dropdown(row, '', (n) => { if (setting.GetVariant() !== n) setting.SetVariant(n); }, true);
    dd.box.removeAttribute('id'); dd.box.classList.add('lst');
    const refresh = () => dd.set(setting.List.Values, setting.List.Values.includes(setting.GetVariant()) ? setting.GetVariant() : '');
    setting.Updated.add(refresh); refresh();
  }

  setupToggle(setting, row) {
    const t = el('div', 'toggle', row); t.innerHTML = '<svg viewBox="0 0 32 16" width="28" height="14"><g class="off" fill-opacity=".5"><rect width="30" height="14" x="1" y="1" fill="#1a1a1a" rx="7"/><circle cx="8" cy="8" r="5" fill="#fff"/></g><g class="on"><rect width="30" height="14" x="1" y="1" fill="#fff" fill-opacity=".75" rx="7"/><circle cx="24" cy="8" r="5" fill="#1a1a1a"/></g></svg>';   // theme icons toggle_off / toggle_on (scene/theme/icons)
    const update = (v) => t.classList.toggle('on', !!v);
    t.onclick = () => { const v = !setting.GetVariant(); if (setting.GetVariant() !== v) setting.SetVariant(v); };
    setting.Updated.add(update); update(setting.GetVariant());
  }

  setupSlider(setting, row) {
    const S = setting.Slider, box = el('div', 'slider', row);
    el('div', 'rail', box); const fill = el('div', 'fill', box), grab = el('div', 'grab', box);
    const le = el('input', 'sle', row); le.maxLength = 5; le.spellcheck = false; le.autocomplete = 'off';
    const placeholder = Number(setting.DefaultValue); le.placeholder = placeholder.toFixed(4);
    box.tabIndex = 0;
    const ratioOf = (v) => Math.min(1, Math.max(0, (v - S.min) / (S.max - S.min)));
    const draw = (v) => {
      const x = ratioOf(v) * box.clientWidth; grab.style.left = `${x - 16}px`; fill.style.width = `${x}px`;
    };
    const apply = () => {                                              // applyLineEdit
      let v = parseFloat(le.value); if (!Number.isFinite(v)) v = parseFloat(le.placeholder);
      if (setting.GetVariant() !== v) setting.SetVariant(v);
    };
    le.onblur = apply; le.onkeydown = (e) => { if (e.key === 'Enter') { apply(); le.blur(); } e.stopPropagation(); };
    const fromX = (clientX) => {                                       // Slider: ratio from mouse x, Range.set_value step snapping (allow_greater/lesser)
      const r = box.getBoundingClientRect(), ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      let v = S.min + ratio * (S.max - S.min); v = Math.round((v - S.min) / S.step) * S.step + S.min;
      return Math.min(S.max, Math.max(S.min, v));
    };
    const set = (v) => { if (setting.GetVariant() !== v) setting.SetVariant(v); };
    box.onpointerdown = (e) => { box.setPointerCapture(e.pointerId); box.classList.add('drag'); set(fromX(e.clientX)); box.focus(); e.preventDefault(); };
    box.onpointermove = (e) => { if (box.hasPointerCapture(e.pointerId)) set(fromX(e.clientX)); };
    box.onpointerup = (e) => { box.releasePointerCapture(e.pointerId); box.classList.remove('drag'); };
    box.onkeydown = (e) => {                                           // Slider ui_left/ui_right: one step
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const d = e.key === 'ArrowLeft' ? -S.step : S.step; set(Math.min(S.max, Math.max(S.min, Number(setting.GetVariant()) + d))); e.preventDefault(); }
    };
    const update = (value) => {                                        // updateSlider: round to 3 decimals, text, SetValueNoSignal
      value = Math.round(value * 1000) / 1000; le.value = String(value); if (document.activeElement === le) le.blur(); draw(value);
    };
    setting.Updated.add(update); update(setting.GetVariant());
    new ResizeObserver(() => draw(setting.GetVariant())).observe(box);
  }
}

// OptionButton + PopupMenu (theme.tres PopupMenu styles)
class Dropdown {
  constructor(parent, id, onSelect, fixed = false) {   // fixed: the popup is placed under the button in window coordinates (a PopupMenu is its own window, not clipped by the scroll area)
    this.onSelect = onSelect; this.box = el('div', 'opt', parent); this.box.id = id;
    this.btn = el('button', 'optbtn', this.box); this.menu = el('div', fixed ? 'popup fix' : 'popup', fixed ? document.body : this.box); this.menu.hidden = true;   // fixed: lives on body, the settings holder is transformed and would become its containing block
    this.btn.onclick = () => {
      this.menu.hidden = !this.menu.hidden;
      if (fixed && !this.menu.hidden) {
        const r = this.btn.getBoundingClientRect(); this.menu.style.left = `${r.left}px`; this.menu.style.minWidth = `${r.width}px`;
        this.menu.style.top = `${Math.max(0, Math.min(r.bottom, innerHeight - this.menu.offsetHeight))}px`;   // popup positions are clamped to the screen
      }
    };
    document.addEventListener('pointerdown', (e) => { if (!this.box.contains(e.target) && !this.menu.contains(e.target)) this.menu.hidden = true; });
  }
  set(items, current) {
    this.btn.textContent = current; this.menu.textContent = '';
    for (const n of items) { const it = el('div', 'pitem', this.menu); it.textContent = n; it.onclick = () => { this.menu.hidden = true; this.btn.textContent = n; this.onSelect(n); }; }
  }
}
