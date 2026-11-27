# Rhythia Web

Rhythia, but in your browser. You can play it here: https://rhythiaweb.onrender.com

I'm a fan of [Rhythia](https://github.com/Rhythia/Client) and wanted to be able to open it from any tab, so I ported it. To be clear, I'm not part of the Rhythia team and they haven't endorsed this or had anything to do with it. The game, the art and the code this is based on are all theirs, under the AGPL-3.0 licence.

## What works right now

The main menu, the Play menu with a map list (search, sort, random), map import (`.phxm`, `.sspm`, `.rhm`, `.txt`) and export, speed and start-from, gameplay with the original HUD and settings, the results screen and the menu music player. The menu background can be switched (waves, void, solid) and its resolution lowered for weaker GPUs. One map is bundled. All nine modifiers work (including Autoplay). Camera modes, the Grid layout and local leaderboards aren't done yet.

## Running it yourself

You need Python. In the project folder:

    python3 serve.py 8000

Then open http://localhost:8000/ in your browser.

## How I made it

This is a big game to rebuild by hand, and doing every line myself would have taken me a very long time. So I used Claude Sonnet 5.5 (Anthropic) as a tool to do the heavy lifting. It read the original C# / Godot source and translated it piece by piece into JavaScript, and I decided what to build, what order to do it in and how closely to stick to the original. Then I ran it and tested it in the browser, found what was off and sent it back to be fixed. Most of the code was written by Claude, so I'd rather say that up front than have you wonder.

If you want the nerdy details (how it's put together and everywhere it differs from the original), they're in [TECHNICAL.md](TECHNICAL.md).

## Credits

- **Rhythia** by the Rhythia developers. Original source: https://github.com/Rhythia/Client
- **Bundled map:** *GIRLS' LEGEND U (Game Ver.)*, mapped by Sequiora, from https://www.rhythia.com/maps/11913. The song belongs to its rights holders.
- **Takedown / rights:** if you own something in this repo or on the site and want it removed, open an issue at https://github.com/literallyretz/rhythiaweb/issues.
