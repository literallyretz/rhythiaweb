# Rhythia Web

Rhythia in your browser. Play it here: https://rhythiaweb.onrender.com

This is a fan-made port of [Rhythia](https://github.com/Rhythia/Client), the rhythm game. It isn't made by the Rhythia team, and they haven't endorsed it or had anything to do with it. The game, its art and the code this is based on are theirs, under the AGPL-3.0 licence.

## What you get

The main menu, the gameplay with the original's HUD and settings, the results screen and the menu music player. One map is bundled for now. There's no map list or map import yet, so you can't play your own maps.

## Run it yourself

You need Python. In the project folder:

    python3 serve.py 8000

then open http://localhost:8000/ in your browser.

## How it was made

Literallyretz directed and tested the port. The code was translated from the original C# / Godot source with Claude Sonnet 5.5 (Anthropic): each part was read from the original, ported, then run and checked in a browser.

If you want the details (how it's built, what's checked, and everywhere it differs from the original), they're in [TECHNICAL.md](TECHNICAL.md).

## Credits

- **Rhythia** by the Rhythia developers. Original source: https://github.com/Rhythia/Client
- **Bundled map:** *GIRLS' LEGEND U (Game Ver.)*, mapped by Sequiora, from https://www.rhythia.com/maps/11913. The song belongs to its rights holders.
- **Takedown / rights:** if you own something in this repo or on the site and want it removed, open an issue at https://github.com/literallyretz/rhythiaweb/issues.
