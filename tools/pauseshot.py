import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':1280,'height':720}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); time.sleep(2); pg.keyboard.press('Escape'); time.sleep(.6)
    pg.screenshot(path='/tmp/shots/9_pause.png')
    pg.mouse.click(100,100); time.sleep(.6); print('closed by outside click:', pg.evaluate('!window.__rhythia.game.paused'), pg.is_hidden('#pause'), errs); b.close()
