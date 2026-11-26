from playwright.sync_api import sync_playwright
q=lambda t: 2*t*t if t<.5 else 1-(-2*t+2)**2/2
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':320,'height':180}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/index.html'); pg.wait_for_function('window.__rhythiaReady===true',timeout=60000)
    # fade samples (frame-time stamped)
    pg.evaluate('''()=>{window.__s=[];const t0=performance.now();const f=()=>{window.__s.push([performance.now()-t0,parseFloat(getComputedStyle(document.getElementById('fade')).opacity)]);if(performance.now()-t0<700)requestAnimationFrame(f)};requestAnimationFrame(f);document.getElementById('btnPlay').click()}''')
    pg.wait_for_function('window.__rhythia.game && window.__rhythia.game.runner && window.__rhythia.game.runner.Playing', timeout=60000)
    s=pg.evaluate('window.__s'); 
    rise=[(t,o) for t,o in s if 0<o<1][:60]
    t0=rise[0][0]-16
    err=max(abs(o-q(min(1,(t-t0)/250))) for t,o in rise if t-t0<250)
    print('fade samples',len(rise),'max dev from quadInOut(ms-offset guess) %.3f'%err)
    # pause
    pg.evaluate('''()=>{window.__r=[];const g=window.__rhythia.game;g.togglePause();window.__x=0;void 0;(()=>{})();
      const t0=performance.now();const f=()=>{const e=document.getElementById('pause');window.__r.push([performance.now()-t0,parseFloat(getComputedStyle(e).opacity),e.classList.contains('hidden')]);if(performance.now()-t0<500)requestAnimationFrame(f)};requestAnimationFrame(f)}''')
    pg.wait_for_timeout(700); r=pg.evaluate('window.__r')
    print('pause opacity (ms,op,hidden) head/mid/tail:', [ (round(a),round(b,3),c) for a,b,c in (r[:2]+r[len(r)//2:len(r)//2+1]+r[-2:]) ])
    print('errors',errs); b.close()
