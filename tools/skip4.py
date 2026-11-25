import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':640,'height':360})
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); time.sleep(3)
    print(pg.evaluate('''()=>{const R=window.__rhythia,g=R.game,r=g.runner,a=g.attempt,ren=R.app?R.app.renderer:g.app.renderer;
      const out=[];r.Skip();
      const song=R.sound.song;
      for(let i=0;i<400;i++){r.process(1/120); if(i%50==0){const nb=ren&&ren.buildNotes?ren.buildNotes(a,r,a.Progress,g.app.settings,g.app.noteColors):null; out.push([Math.round(a.Progress),r.ObjectIndicesStart.Note,r.ObjectIndicesEnd.Note,nb?(nb.behind.length+nb.front.length)/7:'?',+song.getPlaybackPosition().toFixed(2),song.pitchScale.toFixed(3),song.playing])}}
      return JSON.stringify({keys:Object.keys(g),out})}'''))
    b.close()
