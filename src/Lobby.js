// Port of scripts/multiplayer/Lobby.cs (the single-player parts: selected map, speed, start-from). Camera mode and modifiers are added with their ports.
import { MapManager } from './map/MapManager.js';

export const Lobby = {
  Map: null,
  Speed: 1,
  StartFrom: 0,   // millisecond timestamp to start the map from
  _l: { MapChanged: [], SpeedChanged: [], StartFromChanged: [] },
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
};
