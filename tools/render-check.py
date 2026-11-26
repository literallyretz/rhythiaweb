import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':960,'height':540}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); pg.wait_for_function('window.__rhythia.game && window.__rhythia.game.runner && window.__rhythia.game.runner.Playing', timeout=30000)
    pg.evaluate('''(()=>{const g=window.__rhythia.game,r=g.runner,a=g.attempt;r.Playing=false;a.Health=1e9;
      const t=a.Map.Notes[40].Millisecond-300; r.Seek(t); a.Progress=t;})()''')
    time.sleep(2)
    print('hdr', pg.evaluate('window.__rhythia.app ? window.__rhythia.app.renderer.hdr : window.__rhythia.game.app.renderer.hdr'))
    pg.screenshot(path='/tmp/shots/render.png', timeout=90000); print(errs); b.close()
