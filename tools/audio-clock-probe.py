from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(); pg.goto('http://localhost:8765/index.html')
    r = pg.evaluate('''async()=>{const c=new AudioContext({latencyHint:'interactive'});await c.resume();
      const o=c.createOscillator();o.connect(c.destination);o.start();
      const steps=[],lat=[];let last=c.currentTime,t0=performance.now();
      await new Promise(res=>{const f=()=>{const t=c.currentTime;if(t!==last){steps.push(+(t-last).toFixed(5));last=t}
        const ts=c.getOutputTimestamp();lat.push(+(t-(ts.contextTime+(performance.now()-ts.performanceTime)/1000)).toFixed(4));
        performance.now()-t0<1500?setTimeout(f,1):res()};f()});
      return {rate:c.sampleRate,base:c.baseLatency,out:c.outputLatency,steps:steps.slice(0,12),nsteps:steps.length,lat:lat.slice(-5),ts:c.getOutputTimestamp()}}''')
    print(r); b.close()
