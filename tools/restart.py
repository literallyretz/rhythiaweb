import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':320,'height':180}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    pg.click('#btnPlay'); time.sleep(3)
    # mark every note of attempt 1 as missed (simulates a played-through attempt), then restart
    pg.evaluate("window.__rhythia.game.attempt.Map.Notes.forEach(n=>{n.LastResult=2;n.Hittable=true})")
    pg.keyboard.press('Backquote'); time.sleep(3)
    print(pg.evaluate("(()=>{const a=window.__rhythia.game.attempt;return {prog:Math.round(a.Progress),dirty:a.Map.Notes.filter(n=>n.LastResult!==0).length,start:window.__rhythia.game.runner.ObjectIndicesStart.Note}})()"), errs)
    b.close()
