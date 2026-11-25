# Rhythia – browser port (minimal playable)

Source-faithful JS/WebGL2/Web Audio translation of the Rhythia Godot 4 C# client (AGPL-3.0, see LICENSE.original). Godot is not used at runtime.

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

## Test results
- `node tools/test-logic.mjs`: 34/34.
- Browser (headless Chromium, SwiftShader): full flow; perfect-aim script → 593/593, 100.00%, 468,800, PASSED; idle → FAILED after 5 misses; pause freezes progress and song.
- Not verified: real GPU rendering/performance, real pointer lock + mouse feel (tests inject mousemove), audio audibility/sync by ear, other browsers, mobile.

## Known deviations (what is not a direct translation)
- Judging runs once per rendered frame like Runner._Process, but rAF is capped to the display refresh; the original runs uncapped (vsync off).
- Mouse deltas are scaled by devicePixelRatio (Godot reports physical pixels). Unverified on real hardware.
- Menu/results song starts after the first click/keypress (browser autoplay rules).
- HUD/menus are DOM/CSS/canvas built from the .tscn values; renderer shaders are my GLSL from the Godot material settings.
- Not ported: replays, modifiers, settings UI, jukebox panel, extras, song select, News panel (hidden in the original anyway). Settings/Extras/Quit and top-bar tabs are disabled.
- Tween easings use CSS/closed-form equivalents of Godot's.
