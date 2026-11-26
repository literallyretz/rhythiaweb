import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    for dpr in (1, 2):
        pg = b.new_page(viewport={'width':320,'height':180}, device_scale_factor=dpr); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
        pg.click('#btnPlay'); pg.wait_for_function('window.__rhythia.game && window.__rhythia.game.runner && window.__rhythia.game.runner.Playing', timeout=30000)
        r = pg.evaluate('''()=>{const g=window.__rhythia.game,a=g.attempt;g.runner.Playing=true;a.CursorPosition={x:0,y:0};a.RawCursorPosition={x:0,y:0};a.DistanceMM=0;
          document.dispatchEvent(new PointerEvent('pointermove',{movementX:120,movementY:-60}));
          return {dpr:window.devicePixelRatio,x:a.CursorPosition.x,y:a.CursorPosition.y,mm:a.DistanceMM,sens:a.Settings.Sensitivity,fov:a.Settings.FoV}}''')
        print(r, errs); pg.close()
    b.close()
