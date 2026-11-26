// Diagnostics only (not in the original): ?off=blur,mask,blend,stroke,outline,mapinfo,bg turns the menu effect off so ?perf=1 shows what it costs.
// (the game renderer reads the same ?off list for prepass,notes,grid,hud)
const OFF = new Set((new URLSearchParams(location.search).get('off') || '').split(','));
const CSS = {
  blur: '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',                       // the ui_blur panels behind the top bar, list and jukebox
  mask: '*,*::before,*::after{-webkit-mask:none!important;mask:none!important}',                         // outline rings and the cover tint
  blend: '*,*::before,*::after{mix-blend-mode:normal!important}',                                         // cover tint multiply
  stroke: '*{-webkit-text-stroke:0!important}',                                                           // text outlines
  outline: '.mi-ol{display:none!important}',                                                              // cursor-lit outlines of the map info panels
  mapinfo: '#mapInfo{display:none!important}',                                                            // the whole map info panel
};
const css = Object.keys(CSS).filter((k) => OFF.has(k)).map((k) => CSS[k]).join('\n');
if (css) { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }
export const offBackground = OFF.has('bg');                                                               // skip drawing the menu background shader
