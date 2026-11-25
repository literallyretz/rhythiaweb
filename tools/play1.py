import time, json
from playwright.sync_api import sync_playwright
BOT = '''
window.__bot = { on:false };
(function(){
  const app = window.__rhythia;
  const iv = setInterval(() => {
    const g = app.game; if (!g || !g.runner || g.runner.__bot === g.runner) return;
    const r = g.runner, orig = r.process.bind(r); r.__bot = r;
    r.process = (dt) => {
      if (window.__bot.on) {
        const a = g.attempt, notes = a.Objects.Note; let n = null;
        for (let i = r.ObjectIndicesStart.Note; i < notes.length; i++) { if (notes[i].LastResult === 0) { n = notes[i]; break; } }
        if (n) { a.CursorPosition.x = n.X; a.CursorPosition.y = n.Y; }
      }
      return orig(dt);
    };
  }, 5);
})();
'''
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if 'GL Driver' not in m.text else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.goto('http://localhost:8765/index.html')
    pg.wait_for_function('window.__rhythiaReady === true', timeout=60000)
    pg.evaluate(BOT)
    pg.click('#btnPlay')
    time.sleep(2.2)
    st = lambda: pg.evaluate('(()=>{const g=window.__rhythia.game,a=g.attempt;return {progress:Math.round(a.Progress),steps:g.stepCount,hits:a.Hits,misses:a.Misses,score:a.Score,combo:a.Combo,mult:a.ComboMultiplier,hp:+a.Health.toFixed(2),acc:a.Accuracy,playing:g.runner.Playing,songPlaying:window.__rhythia.sound.song.playing,songPos:+window.__rhythia.sound.song.getPlaybackPosition().toFixed(3),cur:a.CursorPosition}})()')
    print('t+2s', st())
    pg.evaluate('window.__bot.on = true')
    time.sleep(8); pg.screenshot(path='/tmp/shots/3_game_bot.png'); print('mid', st())
    pg.wait_for_selector('#results:not(.hidden)', timeout=150000); time.sleep(1.5)
    pg.screenshot(path='/tmp/shots/5_results.png')
    print('results', pg.evaluate("['rTitle','rDiff','rMappers','rSpeed','rAcc','rHits','rScore','rStatus'].map(i=>document.getElementById(i).textContent)"))
    print('\n'.join(logs[:20]))
    b.close()
