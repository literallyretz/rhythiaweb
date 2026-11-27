// Port of scenes/Results.cs + results.tscn + ui/results/Graph.cs. Replay button/modifiers omitted (no replays/mods in scope).
import { padMagnitude } from '../util/misc.js';

export class ResultsScene {
  constructor(app) {
    this.app = app; this.mouse = [0, 0]; this.hold = [0, 0];
    document.getElementById('rBack').onclick = () => this.back();
    document.getElementById('rPlay').onclick = () => this.replay();
    document.addEventListener('mousemove', (e) => { this.mouse = [e.clientX, e.clientY]; });
    document.addEventListener('keydown', (e) => { if (!this.shown || e.repeat) return; if (e.code === 'Escape') this.back(); else if (e.code === 'Backquote') this.replay(); });
  }
  show(attempt) {
    this.shown = true; this.attempt = attempt;
    this.app.menuCursor?.UpdateVisible(this.app.settings.UseCursorInMenus);   // Results._Ready: MouseMode + MenuCursor.Visible
    const m = attempt.Map, $ = (id) => document.getElementById(id);
    const set = (id, t) => { $(id).innerHTML = ''; const s = document.createElement('span'); s.textContent = t; $(id).appendChild(s); };
    set('rTitle', m.PrettyTitle); set('rDiff', m.DifficultyName); set('rMappers', `by ${m.PrettyMappers}`);
    set('rAcc', `${attempt.Accuracy.toFixed(2)}%`); set('rScore', padMagnitude(attempt.Score));
    set('rHits', `${padMagnitude(attempt.Hits)} / ${padMagnitude(attempt.Sum)}`);
    set('rStatus', attempt.Alive ? (attempt.Qualifies ? 'PASSED' : 'DISQUALIFIED') : 'FAILED');
    set('rSpeed', `${attempt.Speed.toFixed(2)}x`);
    $('rMods').innerHTML = '';   // one ModifierTemplate duplicate per attempt modifier
    for (const mod of attempt.Modifiers) { const i = document.createElement('img'); i.alt = mod.Name; i.src = `assets/skin/modifiers/${mod.Name.toLowerCase()}.png`; $('rMods').appendChild(i); }
    if (this.app.coverURL) { $('resCoverBg').style.backgroundImage = `url(${this.app.coverURL})`; $('resCover').style.backgroundImage = `url(${this.app.coverURL})`; }
    this.app.sound.menuMusic.stop();                           // Results._Ready: stops menu music after going to results scene
    // Results._Ready: if the song is not playing start it; PitchScale = attempt speed
    const song = this.app.sound.song; if (!song.playing && m.decodedAudio) song.play(0); song.pitchScale = attempt.Speed;
    document.getElementById('results').classList.remove('hidden');
    this.hold = [0, 0]; this._last = performance.now();
    requestAnimationFrame(() => this.drawGraph());
    const loop = () => { if (!this.shown) return; this.process(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  }
  // Results._Process: Holder.Position lerps toward (size/2 - MousePosition) * (8 / size.Y) at min(1, delta*16)
  process() {
    const now = performance.now(), dt = (now - this._last) / 1000; this._last = now;
    const W = window.innerWidth, H = window.innerHeight, k = Math.min(1, dt * 16), tx = (W / 2 - this.mouse[0]) * (8 / H), ty = (H / 2 - this.mouse[1]) * (8 / H);
    this.hold[0] += (tx - this.hold[0]) * k; this.hold[1] += (ty - this.hold[1]) * k;
    document.getElementById('resHolder').style.transform = `translate(${this.hold[0]}px,${this.hold[1]}px)`;
  }
  // Graph._Draw
  drawGraph() {
    const a = this.attempt, c = document.getElementById('rGraphC'), W = c.clientWidth, H = c.clientHeight; c.width = W; c.height = H;
    const g = c.getContext('2d'), info = a.HitsInfo, death = a.DeathTime;
    for (let i = a.FirstNote; i < info.length; i++) {
      const off = info[i], ms = a.Map.Notes[i].Millisecond, np = ms / a.Map.Length;
      if (ms > death && death !== -1) break;
      if (off < 0) { const x = Math.trunc(W * np); g.fillStyle = 'rgba(255,0,0,0.267)'; g.fillRect(x, 0, 1, H); }
      else { g.fillStyle = '#00ff00'; g.fillRect(W * np, H * (off / 55), 1, 1); }
    }
    if (death >= 0) { const x = Math.trunc(W * death / a.Map.Length); if (x < W) { g.fillStyle = '#ffff00'; g.fillRect(x - 1, 0, 3, H); } }
  }
  hide() { this.shown = false; document.getElementById('results').classList.add('hidden'); }
  back() { this.app.toMenu(true); }   // Results.Stop only loads the menu scene; the song keeps playing
  replay() { this.app.sound.song.stop(); this.app.play(true); }
}
