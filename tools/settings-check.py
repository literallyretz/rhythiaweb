from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']); pg=b.new_page(viewport={'width':1280,'height':720})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
    pg.goto('http://localhost:8765/'); pg.wait_for_function('window.__rhythiaReady',timeout=60000)
    pg.click('#btnSettings'); pg.wait_for_timeout(800); pg.screenshot(path='/tmp/set1.png')
    pg.click('.sbcat:nth-child(3) button'); pg.wait_for_timeout(300); pg.screenshot(path='/tmp/set2.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    print('shown after esc', pg.evaluate("document.getElementById('settings').classList.contains('hidden')"), errs)
    b.close()
