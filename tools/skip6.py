import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':480,'height':270})
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.add_style_tag(content='#hud,#hud *{display:none!important}')
    pg.click('#btnPlay'); time.sleep(2.5)
    pg.evaluate('''()=>{const R=window.__rhythia,g=R.game,r=g.runner,a=g.attempt,ren=R.app?R.app.renderer:g.app.renderer;window.__log=[];
      const ob=ren.buildNotes.bind(ren);ren.buildNotes=function(...x){const o=ob(...x);window.__n=(o.behind.length+o.front.length)/7;return o};
      const o=r.process.bind(r);r.process=function(d){o(d);const s=R.sound.song;window.__log.push([Math.round(d*1000),Math.round(a.Progress),r.ObjectIndicesStart.Note,r.ObjectIndicesEnd.Note,window.__n,Math.round(a.Progress-1000*s.getPlaybackPosition()),a.Hits,a.Misses])}}''')
    pg.keyboard.press('Space'); time.sleep(1.5)
    L=pg.evaluate('window.__log'); print(len(L)); [print(x) for x in L[:14]]; b.close()
