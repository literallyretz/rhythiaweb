// Port of scripts/scenes/MainMenu.cs (menu transitions) + the Menus/Play SubTopBar buttons (ImportButton, RandomPickButton, SortMenuButton, SearchPanel).
import { tweenOpacity, quadIn, quadInOut } from '../util/tween.js';
import { MapManager } from '../map/MapManager.js';
import { MapInfo } from './MapInfo.js';
import { MapList } from './MapList.js';
import { Lobby } from '../Lobby.js';
import { notify } from './Toast.js';

const $ = (id) => document.getElementById(id);

export class MainMenu {
  constructor(app) {
    this.app = app;
    this.HomeMenu = $('home'); this.PlayMenu = $('play');
    this.tabs = new Map([[this.HomeMenu, $('tabHome')], [this.PlayMenu, $('tabPlay')]]);
    this.CurrentMenu = this.HomeMenu; this.LastMenu = this.HomeMenu;
    this.MapList = new MapList(app);
    this.MapInfo = new MapInfo(app, this.MapList);
    $('tabHome').onclick = () => this.Transition(this.HomeMenu);
    $('tabPlay').onclick = () => this.Transition(this.PlayMenu);
    $('btnPlay').onclick = () => this.Transition(this.PlayMenu);          // Home/Buttons/Play -> Menus/Play
    window.addEventListener('mouseup', (e) => {                          // MouseButton.Xbutton1 / Xbutton2
      if (!app.menuRunning) return;
      if (e.button === 3) this.Transition(this.HomeMenu); else if (e.button === 4) this.Transition(this.LastMenu);
    });
    window.addEventListener('keydown', (e) => {                          // _UnhandledInput: Escape -> Home
      if (!app.menuRunning || e.code !== 'Escape' || e.defaultPrevented || app.settingsMenu?.Shown) return;
      this.Transition(this.HomeMenu);
    });
    this._subTopBar();
  }

  // MainMenu._Ready: a freshly loaded menu scene starts on Home with a fresh MapList
  Transition(menu, instant = false) {
    if (this.CurrentMenu === menu) return;
    this.LastMenu = this.CurrentMenu; this.CurrentMenu = menu;
    this.tabs.get(this.LastMenu).disabled = false; this.tabs.get(this.CurrentMenu).disabled = true;
    const time = instant ? 0 : 0.15, last = this.LastMenu, cur = this.CurrentMenu;
    tweenOpacity(last, 0, time, quadIn).then(() => { if (this.LastMenu === last && this.CurrentMenu !== last) last.style.display = 'none'; });
    cur.style.display = '';
    tweenOpacity(cur, 1, time, quadInOut);
    this.app.sound.refreshMenuMusicPlayback();
  }

  _subTopBar() {
    const app = this.app, list = this.MapList;
    $('stSettings').onclick = () => app.settingsMenu.showMenu();                       // SettingsMenuButton
    $('stFolder').onclick = () => notify('There is no user folder in the browser. Imported maps are stored in this browser.');   // OS.ShellShowInFileManager
    $('stImport').onclick = () => {                                                    // ImportButton -> ImportDialog (filters *.sspm *.phxm *.txt *.rhm)
      const inp = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.sspm,.phxm,.txt,.rhm' });
      inp.onchange = () => MapManager.bulkImport(inp.files);
      inp.click();
    };
    MapManager.onImportError = (name, e) => {                                          // the parsers' ToastNotification.Notify calls
      const ext = name.slice(name.lastIndexOf('.') + 1), base = name.slice(0, name.lastIndexOf('.'));
      notify(ext === 'sspm' ? 'SSPM file corrupted' : ext === 'rhm' ? 'RHM file corrupted' : ext === 'txt' ? 'SSMapV1 file corrupted' : ext === 'phxm' ? `${base} is not the proper format!` : 'Unsupported file format', 2);
    };
    const pick = () => {                                                               // RandomPickButton.Pick
      if (list.Maps.length === 0) return;
      list.Select(list.Maps[Math.floor(Math.random() * list.Maps.length)], false);
    };
    $('stRandom').onclick = pick;
    window.addEventListener('keydown', (e) => { if (app.menuRunning && e.ctrlKey && e.code === 'F4') { pick(); e.preventDefault(); } });
    // SortMenuButton
    const sortBtn = $('stSort'), panel = $('sortPanel');
    sortBtn.addEventListener('click', () => { panel.hidden = !panel.hidden; sortBtn.classList.toggle('on', !panel.hidden); });
    window.addEventListener('mousedown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !sortBtn.contains(e.target)) { panel.hidden = true; sortBtn.classList.remove('on'); } }, true);
    let prev = panel.querySelector('[data-sort=Alphabetical]');
    for (const b of panel.querySelectorAll('[data-sort]')) b.onclick = () => {
      if (list.Sorting.Value !== b.dataset.sort) { prev.disabled = false; b.disabled = true; prev = b; list.Sorting.Value = b.dataset.sort; }
    };
    $('sortOrder').onclick = () => {
      list.Ascending.Value = !list.Ascending.Value;
      $('sortOrderLabel').textContent = list.Ascending.Value ? 'Ascending' : 'Descending';
      const src = `assets/skin/ui/buttons/${list.Ascending.Value ? 'sort_ascend' : 'sort'}.png`;
      $('sortOrder').firstChild.src = src; sortBtn.firstChild.src = src;
    };
    // SearchPanel: typing anywhere focuses the (last) search box; presses elsewhere release focus
    const author = $('searchAuthor'), title = $('searchTitle');
    const icon = (inp) => { inp.previousElementSibling.style.opacity = inp.value === '' ? 0.498 : 1; };
    author.oninput = () => { icon(author); list.Search(null, author.value); };
    title.oninput = () => { icon(title); list.Search(title.value, null); };
    window.addEventListener('keydown', (e) => {
      if (!app.menuRunning || list.visible() === false || e.ctrlKey || e.altKey || e.metaKey || app.settingsMenu?.Shown) return;
      if (document.activeElement instanceof HTMLInputElement || e.code === 'Space' || e.code === 'Escape' || e.key.length !== 1) return;
      title.focus();
    }, true);
    window.addEventListener('mousedown', (e) => { if (!e.target.closest?.('.sPanel')) { author.blur(); title.blur(); } }, true);
  }
}
