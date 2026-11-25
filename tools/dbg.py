import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':1280,'height':720})
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); time.sleep(1.5)
    print(pg.evaluate('(()=>{const a=window.__rhythia.game.attempt,r=window.__rhythia.game.runner;return {first:a.Map.Notes.slice(0,3).map(n=>[n.Millisecond,n.X,n.Y]),startIdx:r.ObjectIndicesStart,n:a.Objects.Note.length,prog:a.Progress,len:a.Length,ar:a.Settings.ApproachTime}})()'))
    b.close()
