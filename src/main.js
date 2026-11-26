// Boot sequence + scene routing: Loading -> Home -> Game -> Results (-> Home / Game).
import { hooks } from './settings.js';
import { SettingsManager } from './SettingsManager.js';
import { SettingsMenu } from './scenes/SettingsMenu.js';
import { initPopups } from './ui/Popups.js';
import { createPerf } from './util/perf.js';
import { JukeboxPanel } from './ui/JukeboxPanel.js';
import { MenuCursor } from './ui/MenuCursor.js';
import { VERSION } from './constants.js';
import { initNews } from './ui/News.js';
import { parseColor } from './util/misc.js';
import { userContent } from './userContent.js';
import { notify } from './ui/Toast.js';
import { tweenOpacity } from './util/tween.js';
import { parseSSPM } from './map/MapParser.js';
import { MapManager } from './map/MapManager.js';
import { Lobby } from './Lobby.js';
import { MainMenu } from './ui/MainMenu.js';
import { SoundManager } from './audio/SoundManager.js';
import { GameRenderer } from './render/GameRenderer.js';
import { MenuBackground } from './render/MenuBackground.js';
import { LoadingScene } from './scenes/Loading.js';
import { GameScene } from './scenes/Game.js';
import { ResultsScene } from './scenes/Results.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
SettingsManager.Init({ FadeOut: 25, NoteSize: 1, GridGuides: false });   // first run only: the values chosen earlier for this port
const app = { get speed() { return Lobby.Speed; }, settings: SettingsManager.Settings, canvas: $('gameCanvas'), noteColors: [], map: null, coverURL: null };
window.__rhythia = app; // handy for debugging / the automated tests

// SceneManager.Load: Transition self_modulate tween, 0.25 s, TransitionType.Quad (ease in-out)
const fade = (to) => tweenOpacity($('fade'), to ? 1 : 0, 0.25);

// Port-only notice (not in the original): phones are unsupported; this warns but never blocks.
const phone = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
if (phone || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))) {   // last test: iPadOS reports a Mac UA
  $('phoneWarn').classList.remove('hidden');
  $('pwOk').onclick = () => $('phoneWarn').classList.add('hidden');
}

async function boot() {
  const loading = new LoadingScene(); app.loading = loading;
  const steps = [];
  const step = (label, fn) => steps.push([label, fn]);
  const MAP_URL = new URLSearchParams(location.search).get('map') || 'assets/maps/girls_legend_u.sspm';

  step('fonts', () => Promise.all(['400 16px Ubuntu', '500 16px Ubuntu', '700 16px Roboto', '500 16px Roboto', '700 16px Nunito', '600 16px Nunito'].map((f) => document.fonts.load(f))));
  // SkinManager.Load: note mesh + colorset. "skin" = the skin's config (default skin: squircle / default); a missing mesh falls back to squircle, a missing colorset keeps the skin's colours
  app.loadSkinContent = async () => {
    const s = app.settings, text = (k, n) => userContent.read(k, n);
    const mesh = s.NoteMesh === 'skin' ? 'squircle' : s.NoteMesh, colors = s.NoteColors === 'skin' ? 'default' : s.NoteColors;
    const [obj, set] = await Promise.all([text('meshes', mesh), text('colorsets', colors)]);
    if (set !== null) app.noteColors = set.trim().replace(/\r\n|[\r\n\u2028\u2029\u0085]/g, ',').split(',').map((c) => parseColor(c));   // StripEdges().ReplaceLineEndings(",").Split(",")
    app.noteMeshText = obj ?? await text('meshes', 'squircle');
    app.renderer?.setNoteMesh(app.noteMeshText);
  };
  step('colorset', async () => { await userContent.load(); app.settings.refreshUserLists(); await app.loadSkinContent(); });
  step('audio', async () => {
    app.sound = new SoundManager(app.settings);
    const get = async (u) => app.sound.decode(await (await fetch(u)).arrayBuffer());
    [app.sound.hitBuffer, app.sound.missBuffer, app.sound.failBuffer, app.sound.menuMusic.buffer] = await Promise.all([get('assets/skin/hit.mp3'), get('assets/skin/miss.mp3'), get('assets/skin/fail.mp3'), get('assets/skin/menu.mp3')]);   // SoundManager.UpdateSkin
    app.sound.sceneName = () => (app.menuRunning ? 'SceneMenu' : app.results.shown ? 'SceneResults' : '');   // SceneManager.Scene.Name
    Object.defineProperty(app.sound, 'lobbySpeed', { get: () => Lobby.Speed });                                  // Lobby.Speed
  });
  step('game renderer', async () => { app.renderer = new GameRenderer(app.canvas); await app.renderer.load('assets/'); if (app.noteMeshText) app.renderer.setNoteMesh(app.noteMeshText); });
  step('perf overlay', () => { app.perf = createPerf(app.renderer.gl, app.canvas, { title: 'GAME', extra: (a) => `notes ${a.notes}  ` }); });
  step('HUD textures', () => Promise.all(['cursor', 'health', 'health_background', 'hits', 'misses', 'miss_feedback', 'panel_left_background', 'panel_right_background', 'progress', 'progress_background']
    .map((n) => { const i = new Image(); i.src = `assets/skin/game/${n}.png`; return i.decode(); })));
  // MapManager._Ready -> MapCache.Load(true). The bundled map is imported once on first run, like any other map (it stands in for a file already in the maps folder)
  app.ensureAudio = async (map) => {   // Map.Audio: decoded from audio.<ext> when first needed
    if (map.decodedAudio) return map.decodedAudio;
    const buf = await MapManager.readAudio(map);
    if (buf) map.decodedAudio = await app.sound.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    return map.decodedAudio;
  };
  step('map', async () => {
    const seeded = (() => { try { return localStorage.getItem('rhythia/seeded'); } catch { return '1'; } })();
    if (!seeded || new URLSearchParams(location.search).get('map')) {
      const res = await fetch(MAP_URL); if (!res.ok) throw new Error(`Map not found: ${MAP_URL}`);
      const map = parseSSPM(new Uint8Array(await res.arrayBuffer()), MAP_URL.split('/').pop().replace(/\.sspm$/, ''));
      await MapManager.encode(map);
      try { localStorage.setItem('rhythia/seeded', '1'); } catch {}
    }
    await MapManager.initialize();
    const map = MapManager.Maps[0] ?? null; app.map = map;
    Object.defineProperty(app.sound, 'maps', { get: () => MapManager.Maps, set() {}, configurable: true });   // MapManager.Maps
    for (const m of MapManager.Maps) await app.ensureAudio(m);
    if (map?.CoverBuffer) { app.coverBlob = new Blob([map.CoverBuffer], { type: 'image/png' }); app.coverURL = URL.createObjectURL(app.coverBlob); }
  });
  step('menu background', async () => { app.menuBg = new MenuBackground($('menuCanvas')); app.menuPerf = createPerf(app.menuBg.gl, app.menuBg.canvas, { title: 'MENU (home, play)', labels: ['tick', '-', 'background'], extra: () => `dom nodes ${document.getElementsByTagName('*').length}  ` }); if (app.coverBlob) await app.menuBg.setCover(app.coverBlob); });

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
  $('newsBase').textContent = VERSION; initNews(VERSION);
  $('ver').textContent = `v${VERSION}`; $('btnNotes').href = $('btnNotes').href.replace('VERSION', VERSION);
  // Settings: scenes/main.tscn Settings node (SettingsMenu) + the SETTINGS buttons (SettingsMenuButton.cs, PauseMenu.cs)
  hooks.updateVolume = () => app.sound.updateVolume(); SettingsManager.onLoaded(() => app.sound.updateVolume());
  window.addEventListener('pagehide', () => SettingsManager.Save());
  app.settingsMenu = new SettingsMenu(app); initPopups(app); app.menuCursor = new MenuCursor(app);
  $('btnSettings').disabled = false; $('btnSettings').onclick = () => app.settingsMenu.showMenu();
  $('pSettings').disabled = false; $('pSettings').onclick = () => app.settingsMenu.showMenu();
  document.addEventListener('mousemove', (e) => { if (app.menuBg) app.menuBg.mouseX = e.clientX - window.innerWidth / 2; });
  hooks.refreshMenuMusic = () => app.sound.refreshMenuMusicPlayback(); hooks.reloadSkin = () => app.loadSkinContent();
  hooks.importUserFiles = (kind) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: kind === 'meshes' ? '.obj' : '.txt' });
    inp.onchange = async () => { const n = await userContent.importFiles(kind, inp.files); app.settings.refreshUserLists(); notify(`Imported ${n} ${kind}`); };
    inp.click();
  };
  Lobby.init(); app.mainMenu = new MainMenu(app);                                   // Lobby._Ready, MainMenu._Ready
  app.jukeboxPanel = new JukeboxPanel(app, $('menu'));                               // JukeboxPanel node of main_menu.tscn
  let lastT = performance.now();
  const tick = (now) => { const dt = Math.max(0, (now - lastT) / 1000); lastT = now; const q = app.menuPerf ? performance.now() : 0; if (app.menuRunning) app.mainMenu.MapInfo.Process(dt); app.sound.process(); app.jukeboxPanel.process(now); if (q) app.tickMs = performance.now() - q; requestAnimationFrame(tick); };   // _Process of SoundManager / JukeboxPanel
  requestAnimationFrame(tick);
  app.sound.resume().catch(() => {}); app.menuRunning = true; app.mainMenu.MapInfo.ApplyPendingSelection(); app.sound.start(); app.sound_ready();   // MapsInitialized -> start()
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
  app.mainMenu?.MapInfo.ApplyPendingSelection();   // MainMenu.Load: the cached menu scene keeps its state (InfoContainer.Refresh only reloads the leaderboard, not ported)
  app.menuCursor?.UpdateVisible(app.settings.UseCursorInMenus);   // Input.MouseMode = UseCursorInMenus ? Hidden : Visible
  app.sound.refreshMenuMusicPlayback();
  if (app.settings.AutoplayJukebox && !app.sound.song.playing && app.sound.Map != null) app.sound.playJukeboxIndex(app.sound.JukeboxIndex);
  const loop = () => { if (!app.menuRunning) return; const pf = app.menuPerf; pf?.begin(); const t = pf ? performance.now() : 0; app.menuBg.frame(); pf?.end(app.tickMs || 0, 0, performance.now() - t, 0); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  await fade(0);
};

// Game.Play(map, ...): the played map is the one the Lobby holds
app.playMap = async (map) => {
  if (!map || app.starting) return;
  app.starting = true;
  try {
    app.map = map; await app.ensureAudio(map);
    app.coverURL = app.mainMenu.MapList.coverURL(map);
    await app.play();
  } finally { app.starting = false; }
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
