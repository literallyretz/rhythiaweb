// Port of scripts/multiplayer/Lobby.cs (the single-player parts: selected map, speed, start-from, modifiers). Camera mode is added with its port.
import { MapManager } from './map/MapManager.js';

export const Lobby = {
  Map: null,
  Speed: 1,
  StartFrom: 0,   // millisecond timestamp to start the map from
  Modifiers: [],
  _l: { MapChanged: [], SpeedChanged: [], StartFromChanged: [], ModifiersChanged: [] },
  on(ev, fn) { this._l[ev].push(fn); },
  _emit(ev, v) { for (const f of this._l[ev]) f(v); },
  init() {        // Lobby._Ready
    MapManager.Selected.ValueChanged.push(() => {
      const map = MapManager.Selected.Value;
      if (this.Map == null || this.Map.Name !== map.Name) this.SetMap(map);
    });
  },
  SetMap(map) { this.Map = map; this.SetStartFrom(0); this._emit('MapChanged', map); },
  SetSpeed(speed) { this.Speed = speed; this._emit('SpeedChanged', speed); },
  SetStartFrom(startFrom) { this.StartFrom = startFrom; this._emit('StartFromChanged', startFrom); },
  SetModifier(mod, active) {
    if (active === this.Modifiers.some((m) => m.Name === mod.Name)) return;
    if (active) this.Modifiers.push(mod);
    else this.Modifiers.splice(this.Modifiers.findIndex((m) => m.Name === mod.Name), 1);
    this._emit('ModifiersChanged', this.Modifiers.map((m) => m.Name));
  },
};
