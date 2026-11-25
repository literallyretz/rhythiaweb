import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':320,'height':180})
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); time.sleep(3)
    pg.evaluate('''()=>{const r=window.__rhythia.game.runner,a=window.__rhythia.game.attempt;window.__log=[];const o=r.process.bind(r);r.process=function(d){o(d);window.__log.push([Math.round(d*1000),Math.round(a.Progress),r.ObjectIndicesStart.Note,r.ObjectIndicesEnd.Note,a.Stopped,a.Alive,+window.__rhythia.sound.song.getPlaybackPosition().toFixed(2),window.__rhythia.sound.song.pitchScale.toFixed(3),window.__rhythia.sound.song.playing])}}''')
    pg.keyboard.press('Space'); time.sleep(1.5)
    for l in pg.evaluate('window.__log')[:25]: print(l)
    b.close()
