# Rhythia Web: technical notes

The short README is [README.md](README.md). This is the longer version: how the port is organised and where it differs from the original.

Rhythia Web is a JS / WebGL2 / Web Audio translation of the Rhythia Godot 4 C# client (AGPL-3.0, see `LICENSE.original`). Godot is not used at runtime. Where the original source could be translated it was; anything else is listed under "Where it differs".

## Run / embed
- `python3 serve.py 8000`, then open http://localhost:8000/. ES modules need HTTP, so `file://` won't work. Any static host does the job.
- Embed with `<iframe src="…/index.html" allow="autoplay; fullscreen">`. Pointer lock needs a click first (the PLAY button).
- Another map: `index.html?map=assets/maps/other.sspm` (SSPM v1/v2).
- Controls: mouse to aim, Esc to pause, Space to skip, ` to restart. Ctrl+O opens settings.
- URL flags (not in the original): `?scale=0.75` renders the 3D view at 75% resolution, `?perf=1` shows a per-frame cost overlay.

## Layout
`src/game` Runner, Attempt, CameraLock · `src/map` notes and the SSPM parser · `src/audio` SoundManager · `src/render` the WebGL2 game view and menu background · `src/scenes` Loading, Hud, Game, Results, Settings · `src/ui` menu pieces · `tools` helper and test scripts · `assets` the original's files plus the bundled map.

## Settings
Settings are the original's, in its layout (Gameplay, Visual, Audio, Other). Profiles are JSON in localStorage, in the same format as the original's. `src/settings.defs.js` is generated from `SettingsProfile.cs` by `tools/gen-settings-defs.py`, which also decides which settings the menu shows. Some settings are shown but do nothing here, as in the original (HUDParallax, SpaceEffects, SpaceHitEffects).

## Where it differs
Not a direct translation, or different because a browser can't do the same thing:
- **Pointer:** a browser can't confine the pointer. Absolute Input therefore asks for fullscreen when you press Play, and pauses (and won't resume) when the page isn't fullscreen. This rule isn't in the original. The mouse-warp when the pause menu opens isn't possible either, so the cursor stays where it was.
- **Mouse deltas:** Chromium's raw movement matches Godot's raw counts. Firefox reports CSS pixels, so it's scaled by the device pixel ratio there (unverified).
- **Audio:** the de-sync corrector uses an approximation of `GetTimeSinceLastMix` built from the browser's output timestamp. Menu and results music start after the first click or key press, because of autoplay rules.
- **Frame pacing:** judging runs once per rendered frame, like the original, but requestAnimationFrame is capped to the display refresh and the original runs uncapped.
- **Rendering:** the HUD and menus are DOM, CSS and canvas built from the `.tscn` values, and the shaders are GLSL written from the Godot material settings. Fog follows Godot's depth-fog formula.
- **Cursor trail:** each trail instance is its own draw call (at most about 120).
- **User folder:** a browser has no folder to drop colorsets and meshes into. The bundled ones are listed in `assets/user.json` (`tools/gen-user-manifest.py`), and your own files go in through a file picker into IndexedDB. The two "Import Nightly" slots in Other are used as Import Meshes and Import Colorsets.
- **News panel:** the original ships it hidden with old 0.1.2 notes. Here it carries this port's notice, credits and a version line that compares the latest GitHub release of Rhythia/Client with the base version (0.2.0). A browser can't self-update, so it only reports.
- **Branding:** the title shows a small red "Web" under "Rhythia", and the version reads "v0.2.0" where the original shows a bare "0.2.0".
- **First-run defaults:** new profiles start with FadeOut 25, NoteSize 1 and GridGuides off. The Reset button restores the original's defaults (75, 0.875, on).
- **Not ported:** replays, modifiers, Extras, song select and the map list. Extras, Quit and the top-bar tabs are disabled, and settings that need those features aren't shown.
