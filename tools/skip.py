import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':1280,'height':720}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); time.sleep(2)
    st='(()=>{const g=window.__rhythia.game,a=g.attempt,r=g.runner;return {prog:Math.round(a.Progress),can:a.CanSkip,start:r.ObjectIndicesStart.Note,end:r.ObjectIndicesEnd.Note,songPos:+window.__rhythia.sound.song.getPlaybackPosition().toFixed(2),playing:window.__rhythia.sound.song.playing}})()'
    print('before', pg.evaluate(st)); pg.keyboard.press('Space'); time.sleep(.3); print('after ', pg.evaluate(st))
    time.sleep(.8); print('+0.8s ', pg.evaluate(st))
    pg.screenshot(path='/tmp/shots/13_skip.png', timeout=60000); print(errs); b.close()
