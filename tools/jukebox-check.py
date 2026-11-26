from playwright.sync_api import sync_playwright
J="({song:{p:__rhythia.sound.song.playing,pa:__rhythia.sound.song.paused,pos:__rhythia.sound.song.getPlaybackPosition()},mm:{p:__rhythia.sound.menuMusic.playing,pa:__rhythia.sound.menuMusic.paused},scope:__rhythia.sound.Scope,title:document.getElementById('jTitleText').textContent,ctx:__rhythia.sound.ctx.state})"
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']); pg=b.new_page(viewport={'width':1280,'height':720})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
    pg.goto('http://localhost:8765/'); pg.wait_for_function('window.__rhythiaReady',timeout=60000); pg.wait_for_timeout(2500)
    print('autoplay on :',pg.evaluate(J)); pg.screenshot(path='/tmp/j1.png')
    pg.click('#jPause'); pg.wait_for_timeout(300); print('after pause :',pg.evaluate(J))
    pg.click('#jPause'); pg.wait_for_timeout(300); print('after resume:',pg.evaluate(J))
    pg.evaluate("__rhythia.settings.AutoplayJukebox=false"); pg.evaluate("__rhythia.sound.stopScopedSession()"); pg.wait_for_timeout(800)
    print('autoplay off:',pg.evaluate(J)); pg.screenshot(path='/tmp/j2.png')
    pg.evaluate("__rhythia.settings.EnableMenuMusic=false"); pg.wait_for_timeout(400); print('menu music disabled:',pg.evaluate(J))
    print('errors',errs); b.close()
