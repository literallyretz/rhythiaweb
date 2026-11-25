import time,sys
from playwright.sync_api import sync_playwright
skip = sys.argv[1]=='1'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':320,'height':180})
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay')
    time.sleep(3)
    pg.evaluate('''()=>{const R=window.__rhythia,r=R.game.runner,a=R.game.attempt;window.__log=[];const o=r.process.bind(r);r.process=function(d){o(d);const s=R.sound.song;window.__log.push([Math.round(d*1000),Math.round(a.Progress),Math.round(a.Progress-1000*s.getPlaybackPosition()),+s.pitchScale.toFixed(3)])}}''')
    if skip: pg.keyboard.press('Space')
    time.sleep(2)
    L=pg.evaluate('window.__log'); print('frames',len(L)); print(L[:6]); print(L[-4:]); b.close()
