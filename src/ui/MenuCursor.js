// Port of ui/MenuCursor.cs (+ the Cursor node in main.tscn): a TextureRect (expand_mode IgnoreSize, 32 px * CursorScale, z_index 2) that follows the
// mouse (Position = mouse - Size / 2), textured with the skin's game/cursor.png, shown while UseCursorInMenus. UpdateVisible also sets
// Input.MouseMode (Hidden / Visible) unless updateNativeCursor is false.
export class MenuCursor {
  constructor(app) {
    const s = app.settings;
    this.el = document.createElement('img'); this.el.id = 'menuCursor'; this.el.src = 'assets/skin/game/cursor.png'; this.el.draggable = false;
    document.body.appendChild(this.el);
    this.x = innerWidth / 2; this.y = innerHeight / 2; this.size = 32;
    window.addEventListener('pointermove', (e) => { if (document.pointerLockElement || (!e.clientX && !e.clientY)) return; this.x = e.clientX; this.y = e.clientY; this.place(); }, true);   // a stray (0,0) is reported when the pointer lock starts (seen in headless Chromium): not a real position
    s.items.CursorScale.Updated.add((v) => this.UpdateSize(v));
    s.items.UseCursorInMenus.Updated.add((v) => this.UpdateVisible(v));
    this.UpdateSize(s.CursorScale); this.UpdateVisible(s.UseCursorInMenus);
  }
  place() { this.el.style.transform = `translate(${this.x - this.size / 2}px,${this.y - this.size / 2}px)`; }
  UpdateSize(scale) { this.size = 32 * scale; this.el.style.width = this.el.style.height = `${this.size}px`; this.place(); }
  UpdateVisible(visible, updateNativeCursor = true) {
    this.el.style.display = visible ? 'block' : 'none';
    if (updateNativeCursor) document.body.classList.toggle('noNative', visible);   // MouseMode Hidden / Visible
  }
}
