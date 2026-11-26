import sys, json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']); pg=b.new_page(viewport={'width':1280,'height':720})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:8765/'); pg.wait_for_function('window.__rhythiaReady',timeout=60000); pg.wait_for_timeout(1500)
    pg.click('#btnPlay'); pg.wait_for_timeout(6000)   # notes on screen
    c=pg.context.new_cdp_session(pg); c.send('Profiler.enable'); c.send('Profiler.start'); pg.wait_for_timeout(5000); prof=c.send('Profiler.stop')['profile']
    nodes={n['id']:n for n in prof['nodes']}; self_t={}
    dt=prof['timeDeltas']; 
    for sid,d in zip(prof['samples'],dt): self_t[sid]=self_t.get(sid,0)+d
    agg={}
    for sid,t in self_t.items():
        cf=nodes[sid]['callFrame']; k=f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber']}"; agg[k]=agg.get(k,0)+t
    tot=sum(agg.values())
    for k,v in sorted(agg.items(),key=lambda x:-x[1])[:14]: print(f"{v/1000:8.0f} ms {100*v/tot:5.1f}%  {k}")
    print(errs); b.close()
