import base64, io, sys
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
W,H=1280,720
src=np.asarray(Image.open('assets/textures/boot_splash.png').convert('RGBA'),dtype=np.float64)/255.0
ih,iw=src.shape[:2]
def ref(shift,W=W,H=H):
    cw,ch,cy=W,H*0.6,H*0.2
    tw=int(iw*ch/ih); th=int(ch)
    if tw>cw: tw=int(cw); th=ih*tw//iw
    ox=(cw-tw)/2; oy=cy+(ch-th)/2
    out=np.zeros((H,W,4))
    ys,xs=np.mgrid[0:H,0:W]; px=xs+0.5; py=ys+0.5
    inr=(px>=ox)&(px<ox+tw)&(py>=oy)&(py<oy+th)
    u=(px-ox)/tw; v=(py-oy)/th
    split=np.float32(0.400000019)
    d=np.where(u<split,-1.0,1.0); u2=u+d*(1-shift)/2
    fx=np.clip(u2*iw-0.5,0,iw-1); fy=np.clip(v*ih-0.5,0,ih-1)
    x0=np.floor(fx).astype(int); y0=np.floor(fy).astype(int); x1=np.minimum(x0+1,iw-1); y1=np.minimum(y0+1,ih-1)
    ax=(fx-x0)[...,None]; ay=(fy-y0)[...,None]
    # clamp-to-edge: u outside [0,1] -> edge texel
    c=(src[y0,x0]*(1-ax)+src[y0,x1]*ax)*(1-ay)+(src[y1,x0]*(1-ax)+src[y1,x1]*ax)*ay
    c[...,:3]*=c[...,3:4]
    out[inr]=c[inr]; return out
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':W,'height':H}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:8765/index.html')
    pg.wait_for_function('window.__rhythia&&window.__rhythia.loading&&window.__rhythia.loading.img',timeout=60000)
    for sh in (0.0,0.2,0.6,1.0):
        url=pg.evaluate('''(sh)=>{const l=window.__rhythia.loading;l.done=true;document.getElementById('loading').classList.remove('hidden');l.shift=sh;l.drawSplash();
            const c=document.getElementById('splash');const t=document.createElement('canvas');t.width=c.width;t.height=c.height;const g=t.getContext('2d');g.drawImage(c,0,0);return t.toDataURL('image/png')}''',sh)
        got=np.asarray(Image.open(io.BytesIO(base64.b64decode(url.split(',')[1]))).convert('RGBA'),dtype=np.float64)/255.0
        exp=ref(sh)
        # got is straight-alpha after 2D draw; compare alpha and premultiplied colour
        gp=got.copy(); gp[...,:3]*=gp[...,3:4]
        def bb(a):
            m=a[...,3]>0.1
            return None if not m.any() else (np.where(m.any(0))[0][[0,-1]].tolist(), np.where(m.any(1))[0][[0,-1]].tolist())
        print('shift',sh,'size',got.shape[:2][::-1],'mean|d| %.5f'%np.abs(gp-exp).mean(),'max %.3f'%np.abs(gp-exp).max(),'bbox got',bb(got),'exp',bb(exp))
    print('errors',errs); b.close()
