import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':1280,'height':720}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/index.html'); time.sleep(1.2); pg.screenshot(path='/tmp/shots/12_loading.png', timeout=60000)
    pg.wait_for_function('window.__rhythiaReady===true',timeout=60000); time.sleep(1.5)
    print('song playing at home:', pg.evaluate('window.__rhythia.sound.song.playing'), 'pos', pg.evaluate('window.__rhythia.sound.song.getPlaybackPosition()'), errs); b.close()
