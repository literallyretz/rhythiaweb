import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':1280,'height':720})
    logs=[]; pg.on('pageerror', lambda e: logs.append(str(e)))
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); time.sleep(2)
    st=lambda: pg.evaluate('(()=>{const g=window.__rhythia.game,a=g.attempt;return {prog:Math.round(a.Progress),playing:g.runner.Playing,paused:g.paused,songPos:+window.__rhythia.sound.song.getPlaybackPosition().toFixed(2),q:a.Qualifies}})()')
    pg.keyboard.press('Escape'); time.sleep(.4); a=st(); time.sleep(1); b2=st()
    print('pause frozen:', a, b2, 'overlay visible:', pg.is_visible('#pause'))
    pg.click('#pResume'); time.sleep(.6); print('resume:', st())
    pg.keyboard.press('Backquote'); time.sleep(1.2); print('restart:', st())
    # idle -> fail
    pg.wait_for_selector('#results:not(.hidden)', timeout=60000); time.sleep(1)
    print('fail results:', pg.evaluate("['rStatus','rAcc','rHits','rMisses'].map(i=>document.getElementById(i).textContent)"))
    pg.screenshot(path='/tmp/shots/6_fail.png')
    pg.click('#rPlay'); time.sleep(1.5); print('replay:', st())
    pg.keyboard.press('Escape'); time.sleep(.3); pg.click('#pQuit'); pg.wait_for_selector('#results:not(.hidden)', timeout=10000)
    print('quit status:', pg.evaluate("document.getElementById('rStatus').textContent"))
    pg.click('#rBack'); time.sleep(1); print('home visible:', pg.is_visible('#btnPlay'), logs)
    b.close()
