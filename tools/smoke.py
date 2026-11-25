import sys, time, json
from playwright.sync_api import sync_playwright
URL = 'http://localhost:8765/index.html'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.goto(URL)
    time.sleep(0.9); pg.screenshot(path='/tmp/shots/1_loading_early.png')
    pg.wait_for_function('window.__rhythiaReady === true', timeout=60000)
    time.sleep(2.0); pg.screenshot(path='/tmp/shots/2_home.png')
    print('\n'.join(logs[:30]))
    b.close()
