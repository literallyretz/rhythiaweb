from playwright.sync_api import sync_playwright
q=lambda t: 2*t*t if t<.5 else 1-(-2*t+2)**2/2
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.goto('http://localhost:8765/README.md')
    r = pg.evaluate('''async()=>{const {tweenOpacity}=await import('/src/util/tween.js');
      const el=document.createElement('div');document.body.appendChild(el);el.style.opacity=0;
      const s=[];let t0=null;const pr=tweenOpacity(el,1,0.25);
      await new Promise(res=>{const f=(n)=>{if(t0===null)t0=n;s.push([n-t0,parseFloat(el.style.opacity||0)]);if(el.style.opacity==='1')res();else requestAnimationFrame(f)};requestAnimationFrame(f)});
      await pr;
      // interrupted: show then hide mid-way, starts from current value
      el.style.opacity=0; const a=tweenOpacity(el,1,0.25); await new Promise(r=>setTimeout(r,120)); const mid=parseFloat(el.style.opacity); const b2=tweenOpacity(el,0,0.25); await new Promise(r=>setTimeout(r,40)); const early=parseFloat(el.style.opacity);
      await b2; return {s,mid,early,end:el.style.opacity}}''')
    s=r['s']; t0=s[0][0]
    dev=max(abs(o-q(min(1,(t-t0)/250))) for t,o in s if o<1)
    print('samples',len(s),'last frames',[(round(t),round(o,3)) for t,o in s[-3:]],'| max dev vs Quad in-out (frame timing alignment ~1 frame): %.3f'%dev)
    print('interrupt: mid',round(r['mid'],3),'early',round(r['early'],3),'end',r['end']); b.close()
