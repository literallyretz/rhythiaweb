// Port of scripts/ui/OptionPopup.cs + prefabs/option_popup.tscn. Added to the scene root (here: #app), hidden until Show().
import { tween, quadInOut } from '../util/tween.js';

export class OptionPopup {
  constructor(header, info) {
    this.Header = header; this.Info = info; this.Shown = false; this.Options = {};
    const el = this.el = document.createElement('div'); el.className = 'opop';
    el.innerHTML = '<div class="op-bg"></div><button class="op-hide" tabindex="-1"></button><div class="op-hold"><div class="op-hdr"></div><div class="op-info"></div><div class="op-btns"></div></div>';
    this.headerLabel = el.querySelector('.op-hdr'); this.infoLabel = el.querySelector('.op-info'); this.buttons = el.querySelector('.op-btns');
    this.headerLabel.textContent = header; this.infoLabel.innerHTML = info;
    el.querySelector('.op-hide').addEventListener('mousedown', () => this.Hide());   // Hide button, action_mode press, button_mask 7
    el.querySelector('.op-hide').addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => { if (this.Shown && e.key === 'Escape') { this.Hide(); e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    el.style.display = 'none'; this.alpha = 0; el.style.opacity = 0;
    document.getElementById('app').appendChild(el);
  }
  AddOption(text, callback, tooltip = null) {
    const b = document.createElement('button'); b.className = 'gb op-b'; b.textContent = text; if (tooltip) b.title = tooltip;
    b.onclick = () => { this.Hide(); callback(); };
    this.buttons.appendChild(b); this.Options[text] = b;
  }
  UpdateInfo(info) { this.Info = info; this.infoLabel.innerHTML = info; }
  Show(show = true) {
    this.Shown = show;
    this.el.parentNode.appendChild(this.el);   // MoveToFront
    if (show) this.el.style.display = '';
    const from = this.alpha, to = show ? 1 : 0;   // modulate tween, Quad (ease in-out), 0.1 s, then Visible = Shown
    tween(0.1, quadInOut, (k) => { this.alpha = from + (to - from) * k; this.el.style.opacity = this.alpha; })
      .then(() => { this.el.style.display = this.Shown ? '' : 'none'; });
  }
  Hide() { this.Show(false); }
}
