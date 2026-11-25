import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':1280,'height':720})
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); time.sleep(3)
    st='(()=>{const g=window.__rhythia.game,a=g.attempt,r=g.runner;return {prog:Math.round(a.Progress),play:r.Playing,stopped:a.Stopped,can:a.CanSkip,n:a.Map.Notes.length,first:a.Map.Notes[0].Millisecond,ts:r.noteTimestamps.length,ts0:r.noteTimestamps[0],start:r.ObjectIndicesStart.Note,end:r.ObjectIndicesEnd.Note,len:a.Length,at:r.settings.ApproachTime,sp:r.Speed}})()'
    print(pg.evaluate(st)); pg.keyboard.press('Space'); time.sleep(.3); print(pg.evaluate(st)); time.sleep(1); print(pg.evaluate(st)); b.close()
