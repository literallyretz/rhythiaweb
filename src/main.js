// Boot sequence + scene routing: Loading -> Home -> Game -> Results (-> Home / Game).
import { hooks } from './settings.js';
import { SettingsManager } from './SettingsManager.js';
import { SettingsMenu } from './scenes/SettingsMenu.js';
import { initPopups } from './ui/Popups.js';
import { createPerf } from './util/perf.js';
import { JukeboxPanel } from './ui/JukeboxPanel.js';
import { VERSION } from './constants.js';
import { hexColor } from './util/misc.js';
import { tweenOpacity } from './util/tween.js';
import { parseSSPM } from './map/MapParser.js';
import { SoundManager } from './audio/SoundManager.js';
import { GameRenderer } from './render/GameRenderer.js';
import { MenuBackground } from './render/MenuBackground.js';
import { LoadingScene } from './scenes/Loading.js';
import { GameScene } from './scenes/Game.js';
import { ResultsScene } from './scenes/Results.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
SettingsManager.Init({ FadeOut: 25, NoteSize: 1, GridGuides: false });   // first run only: the values chosen earlier for this port
const app = { settings: SettingsManager.Settings, speed: 1, canvas: $('gameCanvas'), noteColors: [], map: null, coverURL: null };
window.__rhythia = app; // handy for debugging / the automated tests

// SceneManager.Load: Transition self_modulate tween, 0.25 s, TransitionType.Quad (ease in-out)
const fade = (to) => tweenOpacity($('fade'), to ? 1 : 0, 0.25);

async function boot() {
  const loading = new LoadingScene(); app.loading = loading;
  const steps = [];
  const step = (label, fn) => steps.push([label, fn]);
  const MAP_URL = new URLSearchParams(location.search).get('map') || 'assets/maps/girls_legend_u.sspm';

  step('fonts', () => Promise.all(['400 16px Ubuntu', '500 16px Ubuntu', '700 16px Roboto', '500 16px Roboto', '700 16px Nunito', '600 16px Nunito'].map((f) => document.fonts.load(f))));
  step('colorset', async () => { const t = await (await fetch('assets/skin/colorset_default.txt')).text(); app.noteColors = t.trim().split(/[\r\n,]+/).map(hexColor); });
  step('audio', async () => {
    app.sound = new SoundManager(app.settings);
    const get = async (u) => app.sound.decode(await (await fetch(u)).arrayBuffer());
    [app.sound.hitBuffer, app.sound.missBuffer, app.sound.failBuffer, app.sound.menuMusic.buffer] = await Promise.all([get('assets/skin/hit.mp3'), get('assets/skin/miss.mp3'), get('assets/skin/fail.mp3'), get('assets/skin/menu.mp3')]);   // SoundManager.UpdateSkin
    app.sound.sceneName = () => (app.menuRunning ? 'SceneMenu' : app.results.shown ? 'SceneResults' : '');   // SceneManager.Scene.Name
    Object.defineProperty(app.sound, 'lobbySpeed', { get: () => app.speed });                                  // Lobby.Speed
  });
  step('game renderer', async () => { app.renderer = new GameRenderer(app.canvas); await app.renderer.load('assets/'); });
  step('perf overlay', () => { app.perf = createPerf(app.renderer.gl, app.canvas); });
  step('HUD textures', () => Promise.all(['cursor', 'health', 'health_background', 'hits', 'misses', 'miss_feedback', 'panel_left_background', 'panel_right_background', 'progress', 'progress_background']
    .map((n) => { const i = new Image(); i.src = `assets/skin/game/${n}.png`; return i.decode(); })));
  step('map', async () => {
    const res = await fetch(MAP_URL); if (!res.ok) throw new Error(`Map not found: ${MAP_URL}`);
    app.mapBytes = new Uint8Array(await res.arrayBuffer()); app.mapName = MAP_URL.split('/').pop().replace(/\.sspm$/, '');
    const map = parseSSPM(app.mapBytes, app.mapName);
    if (map.AudioBuffer) map.decodedAudio = await app.sound.decode(map.AudioBuffer.buffer.slice(map.AudioBuffer.byteOffset, map.AudioBuffer.byteOffset + map.AudioBuffer.byteLength));
    app.map = map; app.sound.maps = [map];   // MapManager.Maps
    if (map.CoverBuffer) { app.coverBlob = new Blob([map.CoverBuffer], { type: 'image/png' }); app.coverURL = URL.createObjectURL(app.coverBlob); }
  });
  step('menu background', async () => { app.menuBg = new MenuBackground($('menuCanvas')); if (app.coverBlob) await app.menuBg.setCover(app.coverBlob); });

  await loading.setSplash('assets/textures/boot_splash.png');
  await document.fonts.load('400 16px Ubuntu');
  loading.start(app);
  loading.setProgress(0, steps.length, 'Initializing maps');
  const minEnter = wait(1500);   // enter() tween length (shift tween 1.5 s) // enter() tween length so the intro animation always plays out
  for (let i = 0; i < steps.length; i++) {
    await steps[i][1]();
    loading.setProgress(i + 1, steps.length, i + 1 === steps.length ? 'Done!' : `Initializing maps (${i + 1}/${steps.length})`);   // Loading.mapInitializeStep
  }
  await minEnter;

  app.game = new GameScene(app); app.results = new ResultsScene(app);
  $('ver').textContent = VERSION; $('btnNotes').href = $('btnNotes').href.replace('VERSION', VERSION);
  $('btnPlay').onclick = () => app.play();
  // Settings: scenes/main.tscn Settings node (SettingsMenu) + the SETTINGS buttons (SettingsMenuButton.cs, PauseMenu.cs)
  hooks.updateVolume = () => app.sound.updateVolume(); SettingsManager.onLoaded(() => app.sound.updateVolume());
  window.addEventListener('pagehide', () => SettingsManager.Save());
  app.settingsMenu = new SettingsMenu(app); initPopups(app);
  $('btnSettings').disabled = false; $('btnSettings').onclick = () => app.settingsMenu.showMenu();
  $('pSettings').disabled = false; $('pSettings').onclick = () => app.settingsMenu.showMenu();
  document.addEventListener('mousemove', (e) => { if (app.menuBg) app.menuBg.mouseX = e.clientX - window.innerWidth / 2; });
  hooks.refreshMenuMusic = () => app.sound.refreshMenuMusicPlayback();
  app.jukeboxPanel = new JukeboxPanel(app, $('menu'));                               // JukeboxPanel node of main_menu.tscn
  const tick = (now) => { app.sound.process(); app.jukeboxPanel.process(now); requestAnimationFrame(tick); };   // _Process of SoundManager / JukeboxPanel
  requestAnimationFrame(tick);
  app.sound.resume().catch(() => {}); app.menuRunning = true; app.sound.start(); app.sound_ready();   // MapsInitialized -> start()
  await loading.exit();
  app.toMenu(false);
  $('fade').style.opacity = 0;
  window.__rhythiaReady = true;
}

app.sound_ready = () => { // browsers keep the AudioContext suspended until the first user gesture
  const go = () => { app.sound.resume(); };   // the browser keeps the context suspended; playback queued by start() begins when it resumes
  if (app.sound.ctx.state === 'running') return;
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, go, { once: true, capture: true });
};
app.toMenu = async (withFade) => {
  if (withFade) await fade(1);
  app.results.hide(); $('hud').classList.add('hidden'); $('gameCanvas').style.visibility = 'hidden';
  $('menuCanvas').style.display = 'block'; $('menu').classList.remove('hidden');
  app.menuBg.t0 = performance.now(); app.menuBg.coverage = 0; app.menuBg.pitch = 0; app.menuBg.fov = 90; app.menuBg._last = null;
  app.menuRunning = true;
  // MainMenu._Ready
  app.sound.refreshMenuMusicPlayback();
  if (app.settings.AutoplayJukebox && !app.sound.song.playing && app.sound.Map != null) app.sound.playJukeboxIndex(app.sound.JukeboxIndex);
  const loop = () => { if (!app.menuRunning) return; app.menuBg.frame(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  await fade(0);
};

app.play = async (fromResults) => {
  await app.sound.resume();
  await fade(1);
  app.menuRunning = false; $('menuCanvas').style.display = 'none'; $('menu').classList.add('hidden'); app.results.hide();
  $('hud').classList.remove('hidden');
  await app.game.start();
  await fade(0);
};

app.showResults = async (attempt) => {
  await fade(1);
  $('hud').classList.add('hidden');
  app.results.show(attempt);
  await fade(0);
};

boot().catch((e) => { console.error(e); const f = $('fatal'); f.classList.remove('hidden'); f.textContent = `Rhythia failed to start.\n\n${e.stack || e}`; });
