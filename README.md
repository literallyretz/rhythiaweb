# Rhythia Web – browser port (minimal playable + settings, jukebox)

Source-faithful JS/WebGL2/Web Audio translation of the Rhythia Godot 4 C# client (AGPL-3.0, see LICENSE.original). Godot is not used at runtime. Where the source can be translated it is; anything else is listed under "Known deviations".

## Run / embed
- `python3 serve.py 8000` then open http://localhost:8000/ (ES modules need HTTP, not file://). Any static host works.
- Embed: serve the folder and use `<iframe src="…/index.html" allow="autoplay; fullscreen">`. Pointer lock needs a user click (the PLAY button).
- Other map: `index.html?map=assets/maps/other.sspm` (SSPM v1/v2).
- Controls: mouse = aim (pointer-locked), Esc = pause, Space = skip, ` = restart.

## Layout
`src/game` Runner/Attempt/CameraLock · `src/map` Note, SSPM parser · `src/audio` SoundManager · `src/render` WebGL2 game + menu background · `src/scenes` Loading/Hud/Game/Results · `tools` tests · `assets` original files only.

## Checklist
| Item | Status |
|---|---|
| Loading screen (real load progress) | done, screenshot-tested |
| Home + working Play | done, tested |
| SSPM parse, notes spawn/move, 3x3 grid, relative aim | done, parser checked vs independent decoder (593 notes) |
| Hit detection, judgement, score, accuracy, combo, health, fail | done, Node tests + browser run |
| Original audio (map, hit, miss, fail) | decoded + plays (state verified; actual sound output NOT heard) |
| Pause / resume / restart / quit / skip | pause, resume, restart, quit tested; skip untested |
| Results screen | done, tested (PASSED / FAILED) |
| Settings menu, profiles, volume/offset popups, FPS counter, toasts | done, browser-tested (layout, persistence round-trip) |
| Menu music + jukebox panel (queue, pause/skip/rewind, spectrum) | done, state tested in headless Chromium; audio output NOT heard |
| Menu cursor (UseCursorInMenus / CursorScale; menu, results, pause) | done, state tested in headless Chromium |
| Cursor trail (CursorTrail / TrailTime / TrailDetail) | done (TrailRenderer.cs), state + render checked in headless Chromium at low fps only |
| HUD options (SimpleHUD, SuperSimpleHUD, AltComboCounter), VisibilityAssist, NoteColors / NoteMesh (OptionButton rows), AbsoluteInput / AbsoluteSensitivity, HUDParallax, SpaceEffects, SpaceHitEffects | in the menu and read from source; HUDParallax, SpaceEffects and SpaceHitEffects are shown but have no effect on our Grid space (same as the original); checked headless at low fps only |
| Cursor rotation, grid guides (settings) | done |
| HUD lag on real GPU (panel uploads) | fixed (HUD canvases are CPU-backed), confirmed stable at 60 FPS on the author's laptop |

## Test results
- `node tools/test-logic.mjs`: 33/33.
- Browser (headless Chromium, SwiftShader): full flow; perfect-aim script → 593/593, 100.00%, 468,800, PASSED; idle → FAILED after 5 misses; pause freezes progress and song.
- Not verified: real GPU rendering/performance, real pointer lock + mouse feel (tests inject mousemove), audio audibility/sync by ear, other browsers, mobile.

## Known deviations (what is not a direct translation)
- Judging runs once per rendered frame like Runner._Process, but rAF is capped to the display refresh; the original runs uncapped (vsync off).
- Loading splash: runs uv_split.gdshader unchanged in WebGL2; the draw rect follows TextureRect KEEP_ASPECT_CENTERED (int truncation, UV spans the drawn image, not the control); shift starts at 0 (Loading._Ready), then tweens 0.2 -> 1 (Quint out, 1.5 s). Verified against an independent numpy reimplementation (tools/splash-check.py).
- Animations: scene fades (SceneManager.Load, 0.25 s) and the pause menu fade use util/tween.js = Godot Quad ease-in-out computed per frame (was CSS easing). Loading, hit/miss popups (Quint out), Skip (Sine) and HUD lerps were already exact formulas. Godot reads a tween's trans/ease when each tweener is added (tween.cpp append -> set_tween), which Loading.js already matches.
- Colorset / mesh lists: a browser cannot list a folder, so the names of the bundled colorsets and meshes are listed in `src/userContent.js` (the original uses Directory.GetFiles on the user folder). No user folder, so no custom files.
- Absolute input: a browser cannot confine the pointer, so ConfinedHidden (after resume) is a hidden native cursor and Visible a shown one; the pointer lock is not used.
- VisibilityAssist: drawn as a fog-coloured quad (the original fog saturates at that distance) rather than by running the scene's fog on it.
- Cursor trail: the trail uses the cursor's own texture object, whose material uses anisotropic filtering (cursor material texture_filter 5); the original trail material uses the default filter. Not measurable face-on. Each instance is its own draw call (at most about 120).
- Menu cursor (MenuCursor.cs): the skin cursor follows the real mouse. Godot also warps the mouse to the window centre when the pause menu opens (Input.WarpMouse); browsers cannot move the pointer, so it stays where the pointer lock left it.
- Audio: Runner's de-sync corrector uses song position + AudioServer.GetTimeSinceLastMix. The browser has no such call, so SoundManager.timeSinceLastMix() rebuilds it from getOutputTimestamp()/outputLatency, clamped to one 512-frame mix chunk (approximation; measured effect in headless Chromium is small, real devices unverified). Hit/miss players follow MaxPolyphony 16 (oldest voice stopped). Volume dB math runs in float32 like ComputeVolumeDb.
- Mouse deltas: Godot (Windows, captured) reports raw device counts with no DPI scaling; Chromium's movementX with unadjustedMovement is the same raw count, so it is used as is. Firefox reports CSS pixels, so only there it is multiplied by devicePixelRatio (unverified). Cursor math runs in float32 like Godot's Vector2. Still unverified on real hardware.
- Menu/results song starts after the first click/keypress (browser autoplay rules).
- HUD/menus are DOM/CSS/canvas built from the .tscn values; renderer shaders are my GLSL from the Godot material settings.
- Not ported: replays, modifiers, extras, song select, map list, News panel (hidden in the original anyway). Extras/Quit and top-bar tabs are disabled. Settings that need unported features are not shown in the settings menu.
- "Web" mark: the title shows "Rhythia" with a small red "Web" under it (menu and results), and the version reads "v0.2.0" (the original shows a bare "0.2.0"). Both are intentional additions.
- First run: new profiles start with FadeOut 25, NoteSize 1, GridGuides off (chosen for this port); the settings Reset button restores the original defaults (75, 0.875, on).

## Settings menu
Settings button (main menu + pause) / Ctrl+O opens the original-layout settings menu (Gameplay, Visual, Audio, Other); only settings this port uses are shown. Profiles are JSON in localStorage (same format/rounding as SettingsProfileConverter). Ctrl/Alt+wheel = master volume, Shift+wheel = local offset, DisplayFPS shows the FPS counter. Toggle/arrow icons, button/popup styles and wheel step are the engine's own (default_theme.cpp, icons SVGs, scroll_bar.cpp); the FPS/volume font is Godot's default Open Sans SemiBold. Remaining deviation: HTML controls instead of Godot's, settings saved on change/page close instead of at quit. First run uses FadeOut 25 / NoteSize 1 / GridGuides off; "Reset" restores the original defaults.

## Jukebox + menu music
Ported from scripts/SoundManager.cs, scripts/ui/menu/JukeboxPanel.cs and scripts/ui/AudioSpectrum.cs (queue, scoped playback, pause/skip/rewind, "Menu Theme", spectrum + progress shader). With AutoplayJukebox on (default) the loaded map plays on the menu and the menu theme never starts (the original blocks it while the song is playing); turn AutoplayJukebox off and the menu theme (assets/skin/menu.mp3) plays on the menu if EnableMenuMusic is on. Skip/rewind restart the single map; GoTo is a no-op (the one map is always selected). Deviations: the panel blur is CSS backdrop-filter blur(2px) brightness(.5) (derived from textureLod LOD 2), spectrum magnitudes come from a Web Audio AnalyserNode (mono) instead of Godot's stereo analyzer.

## Perf overlay
Open `index.html` via the local server with `?perf=1` (e.g. `http://localhost:8765/?perf=1`) to show per-frame CPU/GPU cost, note count and canvas size while playing. Not part of the original.

Render scale: add `&scale=0.75` to the URL to render the 3D view at 75% resolution (GPU-limited machines). Not in the original.

Diagnostics (not in the original): `?hdr=0` renders to an 8-bit target; `?off=prepass,notes,grid,hud` skips those draws, to find what costs GPU time.
