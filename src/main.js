import { frameLimit } from './util/frameLimit.js';   // first: wraps requestAnimationFrame before anything schedules a frame
// Boot sequence + scene routing: Loading -> Home -> Game -> Results (-> Home / Game).
import { hooks } from './settings.js';
import { SettingsManager } from './SettingsManager.js';
import { SettingsMenu } from './scenes/SettingsMenu.js';
import { initPopups } from './ui/Popups.js';
import { createPerf } from './util/perf.js';
import { offBackground } from './util/debugOff.js';
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
import { Stats, STARTED } from './Stats.js';
import { parseReplay, sameReplay } from './map/Replay.js';
import { Lobby } from './Lobby.js';
import { MainMenu } from './ui/MainMenu.js';
import { SoundManager } from './audio/SoundManager.js';
import { GameRenderer } from './render/GameRenderer.js';
import { MenuBackground } from './render/MenuBackground.js';
import { SpaceRenderer } from './render/Spaces.js';
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

// Video settings. Lock FPS / FPS -> Engine.MaxFps (frameLimit); Anti Aliasing -> Msaa3D on both 3D views;
// Fullscreen -> the Fullscreen API. A page can only go fullscreen after a click or key press, so with Fullscreen on it enters on the first
// one; leaving it (Esc) turns the setting off, as the toggle would otherwise show a mode the window isn't in.
function initVideoSettings() {
  const I = app.settings.items, MSAA = { '2x (rough)': 2, '4x (smooth)': 4, '8x (smoothest)': 8 };
  const fps = () => { frameLimit.fps = I.LockFPS.Value ? I.FPS.Value : 0; };
  I.LockFPS.Updated.add(fps); I.FPS.Updated.add(fps); fps();
  const aa = () => { const n = MSAA[I.AntiAliasing.Value] || 0; app.renderer?.setMsaa(n); app.menuBg?.setMsaa(n); app.spaces?.setMsaa(n); };
  I.AntiAliasing.Updated.add(aa); aa();
  const isFs = () => !!document.fullscreenElement;
  let syncing = false;
  const apply = (on) => { if (syncing) return; if (on && !isFs()) document.documentElement.requestFullscreen?.().catch(() => {}); else if (!on && isFs()) document.exitFullscreen?.().catch(() => {}); };
  I.Fullscreen.Updated.add(apply);
  document.addEventListener('fullscreenchange', () => { if (I.Fullscreen.Value !== isFs()) { syncing = true; I.Fullscreen.Value = isFs(); syncing = false; } });
  const first = () => { removeEventListener('pointerdown', first, true); removeEventListener('keydown', first, true); if (I.Fullscreen.Value) apply(true); };
  if (I.Fullscreen.Value && !isFs()) { addEventListener('pointerdown', first, true); addEventListener('keydown', first, true); }
}

// Port-only (not in the original): watches the menu frame rate while the waves background runs. Slow 2 s windows (a fifth of the frames
// over 20 ms) either lower the background resolution step by step (Adaptive Menu Resolution) or show a toast (8 s, one at a time) suggesting it.
const menuSpeed = {
  adaptive: null, win: [], last: 0, warned: false, calm: 0,
  scale(s) { const set = s.MenuSpaceResolution; return s.AdaptiveMenuResolution && this.adaptive != null ? Math.min(set, this.adaptive) : set; },
  sample(now, s) {
    if (document.hidden || !this.last || now - this.last > 250) { this.last = now; this.win = []; return; }   // tab switches and hitches aren't the background
    this.win.push(now - this.last); this.last = now;
    if (this.win.reduce((a, b) => a + b, 0) < 2000) return;
    const slow = this.win.filter((x) => x > 20).length / this.win.length; this.win = [];
    if (slow >= 0.2) {
      this.calm = 0;
      if (s.AdaptiveMenuResolution) this.adaptive = Math.max(0.25, Math.round((this.scale(s) - 0.1) * 20) / 20);
      else if (!this.warned) {   // repeats while the menu stays slow, but never while the previous one is still on screen
        this.warned = true;
        notify('The menu is running slow on this device. Lower "Menu Resolution" or turn on "Adaptive Menu Resolution" in Settings > Video.', 1, true, 8000).finally(() => { this.warned = false; });
      }
    } else if (s.AdaptiveMenuResolution && this.adaptive != null && slow === 0 && ++this.calm >= 3) {   // 6 s without a slow frame: step back up
      this.calm = 0; this.adaptive = Math.min(s.MenuSpaceResolution, this.adaptive + 0.05); if (this.adaptive >= s.MenuSpaceResolution) this.adaptive = null;
    }
  },
};

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
    await Stats.Initialize(); Stats.Instance.GamesOpened++;   // Rhythia._Ready (Stats.Initialize runs on the same database)
    const map = MapManager.Maps[0] ?? null; app.map = map;
    Object.defineProperty(app.sound, 'maps', { get: () => MapManager.Maps, set() {}, configurable: true });   // MapManager.Maps
    for (const m of MapManager.Maps) await app.ensureAudio(m);
    if (map?.CoverBuffer) { app.coverBlob = new Blob([map.CoverBuffer], { type: 'image/png' }); app.coverURL = URL.createObjectURL(app.coverBlob); }
  });
  step('menu background', async () => { app.menuBg = new MenuBackground($('menuCanvas')); app.menuPerf = createPerf(app.menuBg.gl, app.menuBg.canvas, { title: 'MENU (home, play)', labels: ['tick', '-', 'background'], extra: () => `dom nodes ${document.getElementsByTagName('*').length}  ` }); if (app.coverBlob) await app.menuBg.setCover(app.coverBlob); });
  step('video settings', () => initVideoSettings());

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
  window.addEventListener('pagehide', () => { if (!app.Quitting) app.quit(true); });   // NotificationWMCloseRequest
  app.settingsMenu = new SettingsMenu(app); initPopups(app); app.menuCursor = new MenuCursor(app);
  $('btnSettings').disabled = false; $('btnSettings').onclick = () => app.settingsMenu.showMenu();
  $('pSettings').disabled = false; $('pSettings').onclick = () => app.settingsMenu.showMenu();
  document.addEventListener('mousemove', (e) => {
    if (app.menuBg) app.menuBg.mouseX = e.clientX - window.innerWidth / 2;
    if (app.spaces) { app.spaces.mouseX = e.clientX - window.innerWidth / 2; app.spaces.mouseY = e.clientY - window.innerHeight / 2; }   // viewport mouse - visible size / 2
  });
  hooks.refreshMenuMusic = () => app.sound.refreshMenuMusicPlayback(); hooks.reloadSkin = () => { app.renderer?.resetSpaces();   // SkinManager.Load: new MenuSpace / GameSpace instances
    return app.loadSkinContent(); };
  hooks.importUserFiles = (kind) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: kind === 'meshes' ? '.obj' : '.txt' });
    inp.onchange = async () => { const n = await userContent.importFiles(kind, inp.files); app.settings.refreshUserLists(); notify(`Imported ${n} ${kind}`); };
    inp.click();
  };
  // Rhythia._Ready: files_dropped -> maps are bulk-imported (and the menu moves to Play), .phxr replays are played together when they match the first
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (app.game?.active) return;   // not while a map is being played
    const files = [...(e.dataTransfer?.files ?? [])], maps = [], replays = [];
    for (const file of files) {
      const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
      if (['sspm', 'phxm', 'txt', 'rhm'].includes(ext)) maps.push(file);
      else if (ext === 'phxr') { const r = await parseReplay(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.[^.]*$/, '')); if (r.Valid) replays.push(r); }
    }
    if (maps.length > 0) { MapManager.bulkImport(maps); if (app.menuRunning) app.mainMenu.Transition(app.mainMenu.PlayMenu); }
    if (replays.length > 0) app.playReplay(replays.filter((r) => sameReplay(r, replays[0])));
  });
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

// Rhythia.Quit / _Notification(NotificationWMCloseRequest). Closing the tab is the browser's close request; the
// QUIT button (QuitButton.cs) sends the same request. The browser may end the page before the saves finish.
let playtimeMark = STARTED;
app.quit = (closeRequest) => {
  if (closeRequest && app.game?.active) Stats.Instance.RageQuits++;   // SceneManager.Scene is Game
  app.Quitting = true;
  const r = app.game?.runner;
  if (r?.Playing && !r.Attempt?.IsReplay) r.Stop(false);
  const now = performance.now(); Stats.Instance.TotalPlaytime += Math.floor((now - playtimeMark) / 1000); playtimeMark = now;
  return Promise.all([SettingsManager.Save(), Stats.Save()]);
};
// QuitButton.quit: the close request, then GetTree().Quit() 0.5 s later while MainMenu._Process fades the music
// (VolumeDb lerps to -80 at delta * 2). A page can only close a tab that a script opened, so otherwise it leaves to a blank page.
app.quitGame = () => {
  app.quit(true);
  const g = app.sound.songGain.gain, t0 = performance.now(); let db = 20 * Math.log10(Math.max(g.value, 1e-9)), last = t0;
  const fadeStep = (now) => { const d = (now - last) / 1000; last = now; db += (-80 - db) * Math.min(1, d * 2); g.value = 10 ** (db / 20); if (now - t0 < 500) requestAnimationFrame(fadeStep); };
  requestAnimationFrame(fadeStep);
  setTimeout(() => { window.close(); setTimeout(() => location.replace('about:blank'), 100); }, 500);
};
window.addEventListener('pageshow', (e) => { if (e.persisted) app.Quitting = false; });   // restored from the back/forward cache
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
  app.mainMenu?.MapInfo.ApplyPendingSelection();   // MainMenu.Load: the cached menu scene keeps its state
  app.mainMenu?.MapInfo.InfoContainer?.Refresh();   // MapInfo.InfoContainer?.Refresh(): reloads the leaderboard
  app.menuCursor?.UpdateVisible(app.settings.UseCursorInMenus);   // Input.MouseMode = UseCursorInMenus ? Hidden : Visible
  app.sound.refreshMenuMusicPlayback();
  if (app.settings.AutoplayJukebox && !app.sound.song.playing && app.sound.Map != null) app.sound.playJukeboxIndex(app.sound.JukeboxIndex);
  const loop = (now) => {
    if (!app.menuRunning) return; const pf = app.menuPerf; pf?.begin(); const t = pf ? performance.now() : 0;
    const space = app.settings.MenuSpace === 'skin' ? 'waves' : app.settings.MenuSpace;   // SkinManager: "skin" = the skin's MenuSpace (default skin: waves)
    if (offBackground) {} else if (space === 'waves') app.menuBg.frame(menuSpeed.scale(app.settings));
    else if (space === 'void' || space === 'solid') app.menuBg.clear(space);
    else (app.spaces ??= new SpaceRenderer(app.menuBg.gl, app)).frame(space, app.menuBg.canvas, menuSpeed.scale(app.settings), app.settings);
    pf?.end(app.tickMs || 0, 0, performance.now() - t, 0);
    if (space !== 'void' && space !== 'solid') menuSpeed.sample(now, app.settings);
    requestAnimationFrame(loop);
  }; requestAnimationFrame(loop);
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
// Game.Play(MapParser.Decode(replay.MapFilePath), replay.Speed, replay.StartFrom, replay.CameraMode, replay.Modifiers, null, replays)
app.playReplay = async (replays) => {
  const map = replays[0].Map;
  if (!map || app.starting) return;
  app.starting = true;
  try {
    app.map = map; await app.ensureAudio(map);
    app.coverURL = app.mainMenu.MapList.coverURL(map);
    const r = replays[0];
    await app.play(false, { speed: r.Speed, startFrom: r.StartFrom, mods: r.Modifiers, cameraMode: r.CameraMode, replays });
  } finally { app.starting = false; }
};
app.play = async (fromResults, spec = null) => {
  await app.sound.resume();
  await fade(1);
  app.menuRunning = false; $('menuCanvas').style.display = 'none'; $('menu').classList.add('hidden'); app.results.hide();
  $('hud').classList.remove('hidden');
  await app.game.start(spec);
  await fade(0);
};

app.showResults = async (attempt) => {
  await fade(1);
  $('hud').classList.add('hidden');
  app.results.show(attempt);
  await fade(0);
};

boot().catch((e) => { console.error(e); const f = $('fatal'); f.classList.remove('hidden'); f.textContent = `Rhythia failed to start.\n\n${e.stack || e}`; });
