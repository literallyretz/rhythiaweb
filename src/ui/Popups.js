// Ports of the on-screen extras in scenes/main.tscn: Volume + Offset panels (driven by SoundManager._UnhandledInput / _Process) and FPSCounter.cs.
import { tween, quadInOut } from '../util/tween.js';
import { SettingsManager } from '../SettingsManager.js';

const el = (tag, id, parent) => { const e = document.createElement(tag); if (id) e.id = id; parent.appendChild(e); return e; };

// TweenProperty(obj, prop, target, dur) with SetTrans(Quad) (default ease in-out): start value is read when the tween first steps
const tweenTo = (get, set, target, dur) => { let from = null; tween(dur, quadInOut, (k) => { from ??= get(); set(from + (target - from) * k); }); };

export function initPopups(app) {
  const host = document.getElementById('app');
  el('div', 'toasts', document.body);

  // Volume panel: 256 x 6 at the bottom centre (offset -38..-32), Label above it, white Main bar = anchor_right * 256, Background grows 2 px
  const vol = el('div', 'volume', host), vBg = el('div', null, vol), vMain = el('div', null, vol), vLabel = el('div', null, vol);
  vBg.className = 'vbg'; vMain.className = 'vmain'; vLabel.className = 'plabel';
  const st = { op: 0, right: 0, lbl: 1 };     // modulate alpha, Main anchor_right, Label anchor_bottom (starts at 2 in the .tscn)
  st.lbl = 2;
  const drawVol = () => { vol.style.opacity = st.op; vol.style.visibility = st.op > 0 ? 'visible' : 'hidden';   // hidden panels must not be painted (text-stroke is costly)
    vMain.style.width = `${st.right * 100}%`; vLabel.style.bottom = `${6 - st.lbl * 6}px`; };
  vLabel.style.top = '-14px'; drawVol();
  // Offset panel: Label at anchor_top -10.667 .. -6.333 of a 6 px panel
  const off = el('div', 'offsetPanel', host), oLabel = el('div', null, off); oLabel.className = 'plabel'; oLabel.style.top = `${-10.667 * 6}px`; oLabel.style.height = `${(10.667 - 6.333) * 6}px`;
  const so = { op: 0 }; off.style.opacity = 0; off.style.visibility = 'hidden';
  const drawOff = () => { off.style.opacity = so.op; off.style.visibility = so.op > 0 ? 'visible' : 'hidden'; };

  let volShown = false, lastVol = 0, offShown = false, lastOff = 0;
  window.addEventListener('wheel', (e) => {
    if (SettingsManager.Shown || !(e.ctrlKey || e.altKey || e.shiftKey)) return;   // the open settings menu's Hide button swallows these
    const s = app.settings, up = e.deltaY < 0; if (!e.deltaY) return;
    if (e.ctrlKey || e.altKey) {
      s.VolumeMaster = up ? Math.min(100, Math.round(s.VolumeMaster) + 5) : Math.max(0, Math.round(s.VolumeMaster) - 5);
      vLabel.textContent = String(s.VolumeMaster);
      tweenTo(() => st.op, (v) => { st.op = v; drawVol(); }, 1, 0.25);
      tweenTo(() => st.right, (v) => { st.right = v; drawVol(); }, s.VolumeMaster / 100, 0.15);
      tweenTo(() => st.lbl, (v) => { st.lbl = v; drawVol(); }, 0, 0.15);
      volShown = true; lastVol = performance.now(); app.sound.updateVolume();
    } else {
      s.LocalOffset = up ? Math.round(s.LocalOffset) + 1 : Math.round(s.LocalOffset) - 1;
      oLabel.textContent = `Local Offset: ${s.LocalOffset}ms`;
      tweenTo(() => so.op, (v) => { so.op = v; drawOff(); }, 1, 0.25);
      offShown = true; lastOff = performance.now();
    }
    e.preventDefault();
  }, { passive: false });

  // FPSCounter.cs: Frames++ / time += delta each frame; "N FPS" once a second
  const fps = el('div', 'fps', host), fpsText = el('span', null, fps); fpsText.textContent = '0 FPS';
  let frames = 0, time = 0, prev = performance.now();
  const setVis = (v) => { fps.style.display = v ? '' : 'none'; };
  setVis(app.settings.DisplayFPS); app.settings.items.DisplayFPS.Updated.add(setVis);
  const process = (now) => {
    const delta = (now - prev) / 1000; prev = now;
    frames++; time += delta; if (time >= 1) { fpsText.textContent = `${frames} FPS`; time--; frames = 0; }
    // SoundManager._Process: hide the panels one second after the last change
    if (volShown && now - lastVol >= 1000) {
      volShown = false; tweenTo(() => st.op, (v) => { st.op = v; drawVol(); }, 0, 0.25); tweenTo(() => st.lbl, (v) => { st.lbl = v; drawVol(); }, 1, 0.35);
    }
    if (offShown && now - lastOff >= 1000) { offShown = false; tweenTo(() => so.op, (v) => { so.op = v; drawOff(); }, 0, 0.25); }
    requestAnimationFrame(process);
  };
  requestAnimationFrame(process);
}
