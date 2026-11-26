// Port-only (not in the original, which has stretch mode "disabled"): the menu and results layers are scaled uniformly by
// min(width / 1280, height / 720), the project's base viewport, clamped to 0.5..2. `?ui=off` turns it off.
// Layout code keeps working in the layer's own pixels; the helpers below convert client (screen) coordinates into them.
export const ui = { s: 1 };
const layers = ['menu', 'results'];
const off = new URLSearchParams(location.search).get('ui') === 'off';

export function applyUIScale() {
  ui.s = off ? 1 : Math.min(2, Math.max(0.5, Math.min(innerWidth / 1280, innerHeight / 720)));
  for (const id of layers) {
    const el = document.getElementById(id); if (!el) continue;
    const st = el.style;
    if (ui.s === 1) { st.width = st.height = st.transform = st.transformOrigin = ''; continue; }
    st.width = `${innerWidth / ui.s}px`; st.height = `${innerHeight / ui.s}px`; st.transformOrigin = '0 0'; st.transform = `scale(${ui.s})`;
  }
}
export const lx = (clientX) => clientX / ui.s;
export const lrect = (el) => { const r = el.getBoundingClientRect(), k = ui.s; return { left: r.left / k, top: r.top / k, width: r.width / k, height: r.height / k }; };
