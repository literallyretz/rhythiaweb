import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':320,'height':180})
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); time.sleep(3)
    pg.evaluate("window.__plays=0;const o=window.__rhythia.game.runner.Play.bind(window.__rhythia.game.runner);window.__rhythia.game.runner.Play=function(...x){window.__plays++;window.__st=new Error().stack;return o(...x)}")
    print('active:',pg.evaluate("document.activeElement.id||document.activeElement.tagName"))
    pg.keyboard.press('Space'); time.sleep(2)
    print('plays after space:',pg.evaluate("window.__plays"), pg.evaluate("Math.round(window.__rhythia.game.attempt.Progress)"))
    print(pg.evaluate("window.__st")); b.close()
