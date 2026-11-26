// Optional frame-cost overlay: open the page with ?perf=1. Shows where a frame's time goes while playing (not part of the original).
export function createPerf(gl, canvas) {
  if (!new URLSearchParams(location.search).has('perf')) return null;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const box = document.createElement('pre'); box.id = 'perf';
  box.style.cssText = 'position:fixed;right:6px;top:6px;z-index:99;margin:0;padding:4px 6px;background:rgba(0,0,0,.7);color:#8f8;font:12px/1.3 monospace;pointer-events:none;white-space:pre';
  document.body.appendChild(box);
  const acc = { n: 0, frame: 0, proc: 0, hud: 0, render: 0, gpu: 0, gpuN: 0, notes: 0, maxFrame: 0, over: 0 };
  let pending = [], last = performance.now(), t0 = 0, q = null;
  return {
    mark: () => performance.now(),
    begin() { t0 = performance.now(); if (ext && !q) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } },
    end(proc, hud, render, notes) {
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); q = null; }
      for (const p of pending.slice()) {                         // collect finished GPU queries
        if (gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) { acc.gpu += gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6; acc.gpuN++; }
        if (gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) { gl.deleteQuery(p); pending.splice(pending.indexOf(p), 1); }
      }
      const now = performance.now(), ft = now - last; last = now;
      acc.n++; acc.frame += ft; acc.proc += proc; acc.hud += hud; acc.render += render; acc.notes = Math.max(acc.notes, notes); acc.maxFrame = Math.max(acc.maxFrame, ft); if (ft > 20) acc.over++;
      if (acc.frame >= 500) {
        const n = acc.n, f = (v) => v.toFixed(2);
        box.textContent = `fps ${(1000 * n / acc.frame).toFixed(0)}  frame avg ${f(acc.frame / n)} max ${f(acc.maxFrame)} ms  (>20ms: ${acc.over})\nCPU  process ${f(acc.proc / n)}  hud ${f(acc.hud / n)}  render ${f(acc.render / n)} ms\nGPU  ${ext ? (acc.gpuN ? f(acc.gpu / acc.gpuN) : '…') + ' ms' : 'timer unsupported'}\nnotes ${acc.notes}  canvas ${canvas.width}x${canvas.height}  dpr ${window.devicePixelRatio}`;
        Object.assign(acc, { n: 0, frame: 0, proc: 0, hud: 0, render: 0, gpu: 0, gpuN: 0, notes: 0, maxFrame: 0, over: 0 });
      }
    },
  };
}
