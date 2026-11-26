from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/index.html')
    r = pg.evaluate('''async()=>{const {SoundManager}=await import('/src/audio/SoundManager.js');
      const sm=new SoundManager({VolumeMaster:50,VolumeMusic:50,VolumeHitSound:50,VolumeMissSound:50,VolumeSFX:50,EnableHitSound:true,EnableMissSound:true});
      await sm.resume();
      const buf=sm.ctx.createBuffer(1,sm.ctx.sampleRate*2,sm.ctx.sampleRate); sm.hitBuffer=buf;
      const o=sm.ctx.createOscillator();o.connect(sm.ctx.destination);o.start();
      // polyphony
      for(let i=0;i<20;i++) sm.playHitSound(); const voices=sm.hitVoices.length;
      // timing: error of reading vs a smooth reference (performance clock), raw vs corrected
      await new Promise(r=>setTimeout(r,200));
      const t0=performance.now(), c0=sm.ctx.currentTime; const raw=[],cor=[],since=[];
      await new Promise(res=>{const f=()=>{const el=(performance.now()-t0)/1000, ref=c0+el, s=sm.timeSinceLastMix();
        raw.push(sm.ctx.currentTime-ref); cor.push(sm.ctx.currentTime+s-ref); since.push(s);
        el<3?setTimeout(f,2):res()};f()});
      const sd=a=>{const m=a.reduce((x,y)=>x+y)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length)*1000};
      return {voices,sdRawMs:+sd(raw).toFixed(2),sdCorrectedMs:+sd(cor).toFixed(2),sinceMaxMs:+(Math.max(...since)*1000).toFixed(2),sinceMinMs:+(Math.min(...since)*1000).toFixed(2),
        vol:[sm.songGain.gain.value,sm.hitGain.gain.value]}}''')
    print(r, errs); b.close()
