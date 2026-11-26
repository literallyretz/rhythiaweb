// Godot ScrollContainer / RichTextLabel scrolling with the theme's scroll bars (scene/gui/scroll_container.cpp, rich_text_label.cpp, scroll_bar.cpp).
// The content is moved with a transform; the browser's own scrollbar is not used.
//   host: the clipping box. inner: the content (its size is the child's size, never below its minimum). margin: the panel style's content margin.
//   axis 'v' (VScrollBar, 4 px: theme scroll style content_margin_left 4) or 'h' (HScrollBar, 4 px: bottom border 4; track starts after content_margin_left 6).
//   divisor: wheel step = page / divisor (ScrollContainer: ScrollBar.PAGE_DIVISOR 8; RichTextLabel: page * 0.5 / 8).
//   stopAlways: mouse_filter STOP with mouse_force_pass_scroll_events = false, so every wheel event ends here.
const BAR = 4;

export class GodotScroll {
  constructor(host, inner, { axis = 'v', margin = 0, divisor = 8, stopAlways = false, onLayout = null }) {
    Object.assign(this, { host, inner, axis, margin, divisor, value: 0, visible: false, onLayout, page: 0, max: 0 });
    if (axis === 'v') inner._gsV = this;
    inner._gsT ??= { h: 0, v: 0 };
    this.lead = axis === 'h' ? 6 : 0;   // scroll style margin before the grabber area
    const bar = this.bar = document.createElement('div'); bar.className = `gsb gsb-${axis}`; bar.style.display = 'none';
    bar.innerHTML = '<i></i>'; this.grab = bar.firstChild; host.appendChild(bar);
    if (axis === 'v') Object.assign(bar.style, { top: `${margin}px`, bottom: `${margin}px`, right: `${margin}px`, width: `${BAR}px` });
    else Object.assign(bar.style, { left: `${margin}px`, right: `${margin}px`, bottom: `${margin}px`, height: `${BAR}px` });
    host.addEventListener('wheel', (e) => {
      if (!e.deltaY) return;
      const factor = e.deltaMode === 1 ? Math.abs(e.deltaY) / 3 : e.deltaMode === 2 ? Math.abs(e.deltaY) * 8 : Math.abs(e.deltaY) / 100;   // one notch = factor 1
      const before = this.value;
      if (this.axis === 'h' && this.inner._gsV?.visible) return;   // the vertical bar takes the wheel; the horizontal one only when there is no vertical one
      if (this.visible) this.scroll(Math.sign(e.deltaY) * (this.page / this.divisor) * factor);
      if (stopAlways || this.value !== before) e.stopPropagation();
    });
    let drag = null;   // ScrollBar.gui_input: click before/after the grabber pages, the grabber drags
    const pos = (e) => { const r = bar.getBoundingClientRect(); return (axis === 'v' ? e.clientY - r.top : e.clientX - r.left) - this.lead; };
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
      const ofs = pos(e), area = this.area(), gOfs = area * this.ratio(), gSize = this.page / this.max * area;
      if (ofs < gOfs) this.setValue(this.value - this.page);
      else if (ofs < gOfs + gSize) { drag = { posAtClick: ofs, valueAtClick: this.ratio(), area }; bar.setPointerCapture(e.pointerId); }
      else this.setValue(this.value + this.page);
    });
    bar.addEventListener('pointermove', (e) => { if (drag) this.setValue((drag.valueAtClick + (pos(e) - drag.posAtClick) / drag.area) * this.max); });   // set_as_ratio
    bar.addEventListener('pointerup', () => { drag = null; });
    new ResizeObserver(() => this.update()).observe(host);
    new ResizeObserver(() => this.update()).observe(inner);
    this.update();
  }
  size(el) { return this.axis === 'v' ? el.offsetHeight : el.offsetWidth; }
  area() { return (this.axis === 'v' ? this.bar.offsetHeight : this.bar.offsetWidth) - this.lead; }
  ratio() { return this.max > 0 ? Math.min(1, Math.max(0, this.value / this.max)) : 0; }
  scroll(d) { this.setValue(this.value + d); }
  setValue(v) { this.value = Math.max(0, Math.min(v, this.max - this.page)); this.draw(); }   // Range clamps to max - page
  update() {
    const hostSize = this.axis === 'v' ? this.host.clientHeight : this.host.clientWidth;
    this.page = hostSize - 2 * this.margin; this.max = this.size(this.inner);
    const visible = this.max > this.page + 0.5;
    if (visible !== this.visible) {
      this.visible = visible; this.bar.style.display = visible ? '' : 'none'; this.onLayout?.(visible ? BAR : 0);
      this.max = this.size(this.inner);
    }
    this.setValue(this.value);
  }
  draw() {
    const t = this.inner._gsT; t[this.axis] = this.value;
    this.inner.style.transform = t.h || t.v ? `translate(${-t.h}px,${-t.v}px)` : '';
    if (!this.visible) return;
    const area = this.area(), o = area * this.ratio(), s = (this.page / this.max) * area;
    if (this.axis === 'v') Object.assign(this.grab.style, { top: `${o}px`, height: `${s}px` });
    else Object.assign(this.grab.style, { left: `${this.lead + o}px`, width: `${s}px` });
  }
}
