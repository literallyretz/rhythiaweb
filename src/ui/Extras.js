// Port of the Menus/Extras panel of scenes/main_menu.tscn with scripts/ui/menu/extras (ExtrasPanel, StatsPanel, CreditsPanel),
// SoundSpaceButton.cs and the LinkPopupButton.cs buttons in it.
import { Stats } from '../Stats.js';
import { MapManager } from '../map/MapManager.js';
import { OptionPopup } from './OptionPopup.js';
import { cursorLight, moveCursorLight } from './MapList.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// LinkPopupButton: "Open Link" popup with InfoTemplate
export function linkPopupButton(button, link) {
  const popup = new OptionPopup('Open Link', '');
  popup.AddOption('Open', () => window.open(link, '_blank', 'noopener'), link);
  popup.AddOption('Cancel', () => popup.Hide());
  popup.UpdateInfo(`<p style="text-align:center"><span style="color:#dddddd">This will open the following link:</span><br><span style="color:#aaaaff"><i><u>${esc(link)}</u></i></span><br><br><span style="color:#dddddd">Are you sure?</span></p>`);
  button.addEventListener('click', () => popup.Show());
  return popup;
}

// StatsPanel rows: [node name, Key text, tooltip]
const ROWS = [
  ['GamePlaytime', 'Game Playtime', 'Time spent strictly being in a map'], ['TotalPlaytime', 'Total Playtime'], ['GamesOpened', 'Games Opened'],
  ['TotalDistance', 'Total Distance'], ['NotesHit', 'Notes Hit'], ['NotesMissed', 'Notes Missed'], ['HighestCombo', 'Highest Combo'],
  ['Attempts', 'Attempts'], ['Passes', 'Passes'], ['FullCombos', 'Full Combos'], ['HighestScore', 'Highest Score'], ['TotalScore', 'Total Score'],
  ['AverageAccuracy', 'Average Accuracy'], ['RageQuits', 'Rage Quits'], ['FavouriteMap', 'Favourite Map'],
];
const INITIAL = { GamePlaytime: '0h', TotalPlaytime: '0h', TotalDistance: '0m', AverageAccuracy: '0%', FavouriteMap: '' };
// Contributors: [name, modulate]
const CONTRIBUTORS = [
  ['nyuwaea', [0.8156863, 0.7411765, 1]], ['fog', [0.73922217, 0.46258998, 0.9705774]], ['nyarw', [0.2627451, 1, 0.9529412]],
  ['lulusuki', [1, 0.7411765, 1]], ['noobour', [0.05882353, 0.5058824, 0.7176471]], ['cake', [0.49546552, 0.9457299, 0.77711904]],
  ['allusionist', [0.9814784, 0.7174443, 0.6400969]], ['kiwie', [1, 0.8156863, 0.53333336]], ['snuz', [0.59607846, 0.9843137, 0.59607846]],
];
const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

export class Extras {
  constructor(app, el) {
    this.app = app; this.el = el;
    el.innerHTML = `<div class="exBg"><div class="exTile"></div></div>
      <button class="exSS"><img src="assets/textures/RhythiaSquircle.png" alt=""><div class="exSSl"><span>Inspired by </span><span class="n">Sound Space</span></div><i class="exSSb"></i></button>
      <div class="exPanel exStats"><div class="exPb"></div><div class="exHdr">STATISTICS</div><div class="exSc"><div class="exV exSv"></div></div><div class="mi-ol"></div></div>
      <div class="exPanel exCred"><div class="exPb"></div><div class="exHdr">CONTRIBUTORS</div><div class="exSc"><div class="exV exCv"></div></div><div class="mi-ol"></div></div>`;
    const q = (s) => el.querySelector(s);

    // SoundSpaceButton: the label's "Sound Space" turns white while hovered; the Button inside is a LinkPopupButton
    const ss = q('.exSS');
    ss.onmouseenter = () => ss.classList.add('hov'); ss.onmouseleave = () => ss.classList.remove('hov');
    linkPopupButton(ss, 'https://www.roblox.com/games/2677609345/Sound-Space');

    // StatsPanel
    this.values = {};
    for (const [name, key, tip] of ROWS) {
      const row = document.createElement('div'); row.className = 'exRow'; if (tip) row.title = tip;
      row.innerHTML = `<span class="k">${key}</span><span class="v">${INITIAL[name] ?? '0'}</span>`;
      q('.exSv').appendChild(row); this.values[name] = row.lastChild;
    }

    // CreditsPanel
    for (const [name, c] of CONTRIBUTORS) {
      const d = document.createElement('div'); d.className = 'exC'; d.style.color = rgb(c); d.textContent = name; q('.exCv').appendChild(d);
    }
    const jonvy = document.createElement('div'); jonvy.className = 'exC link'; jonvy.style.color = rgb([0.9607843, 0.60784316, 0.6784314]);
    jonvy.innerHTML = '<button class="exCb" tabindex="-1"></button><u>jonvy</u><br><span class="sub">"Redshift" (Menu theme) artist</span>';
    q('.exCv').appendChild(jonvy);
    linkPopupButton(jonvy.firstChild, 'https://soundcloud.com/jonvyost');

    // ExtrasPanel._Process: outline cursor_position = viewport mouse position
    this.ols = [...el.querySelectorAll('.mi-ol')]; for (const o of this.ols) o._cl = cursorLight(o);
    this.mouse = [0, 0];
    window.addEventListener('mousemove', (e) => { this.mouse = [e.clientX, e.clientY]; if (el.style.display !== 'none') this.Process(); });

    this.applyStats = (s) => this.apply(s);
    this.apply(Stats.Instance);
  }

  // StatsPanel._EnterTree / _ExitTree: listen while the panel is shown
  Shown(show) {
    const l = Stats.Instance.StatsUpdated;
    if (show) { this.apply(Stats.Instance); l.add(this.applyStats); this.Process(); } else l.delete(this.applyStats);
  }

  apply(stats) {   // StatsPanel.applyStats (TotalScore is never written there, so it keeps its "0")
    const v = this.values, div = (a, b) => Math.floor(a / b);
    v.GamePlaytime.textContent = `${div(stats.GamePlaytime, 3600)}h`;
    v.TotalPlaytime.textContent = `${div(stats.TotalPlaytime, 3600)}h`;
    v.GamesOpened.textContent = `${stats.GamesOpened}`;
    v.TotalDistance.textContent = `${div(stats.TotalDistance, 1000)}m`;
    v.NotesHit.textContent = `${stats.NotesHit}`;
    v.NotesMissed.textContent = `${stats.NotesMissed}`;
    v.HighestCombo.textContent = `${stats.HighestCombo}`;
    v.Attempts.textContent = `${stats.Attempts}`;
    v.Passes.textContent = `${stats.Passes}`;
    v.FullCombos.textContent = `${stats.FullCombos}`;
    v.HighestScore.textContent = `${stats.HighestScore}`;
    v.AverageAccuracy.textContent = stats.AverageAccuracy.toFixed(2);
    v.RageQuits.textContent = `${stats.RageQuits}`;
    const maps = MapManager.Maps;
    if (maps.length > 0) {
      const map = maps.reduce((m1, m2) => (m1.PlayCount > m2.PlayCount ? m1 : m2));
      if (map.PlayCount > 0) v.FavouriteMap.textContent = `${map.Title}`;
    }
  }

  Process() {
    for (const o of this.ols) { const r = o.getBoundingClientRect(); moveCursorLight(o._cl, this.mouse[0] - r.left, this.mouse[1] - r.top); }
  }
}
