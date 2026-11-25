import time
exec(open('tools/play1.py').read().split("with sync_playwright")[0])
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':1280,'height':720}); logs=[]
    pg.on('console', lambda m: logs.append(m.text) if 'GL Driver' not in m.text else None); pg.on('pageerror', lambda e: logs.append('ERR '+str(e)))
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.evaluate(BOT); pg.click('#btnPlay'); time.sleep(2); pg.evaluate('window.__bot.on=true')
    for i in range(6):
        time.sleep(2)
        try: print(pg.evaluate('(()=>{const g=window.__rhythia.game;return [Math.round(g.attempt.Progress),g.attempt.Hits,document.querySelectorAll(".popup").length]})()'), flush=True)
        except Exception as e: print('eval fail', str(e)[:80]); break
    print(logs[:6]); b.close()
