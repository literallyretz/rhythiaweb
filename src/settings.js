// Port of database/settings/SettingsItem.cs + SettingsProfile.cs. The definitions (ids, titles, defaults, ranges, order) come from
// settings.defs.js, generated from the C#. Each setting is a SettingsItem; profile.<Id> reads/writes its Value, like the implicit
// conversion operator on SettingsItem<T>, so game code keeps using plain `settings.FoV`.
import { DEFS, SECTIONS } from './settings.defs.js';

// Hooks the C# UpdateActions call into (SoundManager.UpdateVolume, SoundManager.RefreshMenuMusicPlayback); main.js fills them in.
export const hooks = { updateVolume() {}, refreshMenuMusic() {} };

export class SettingsItem {
  constructor(def) {
    this.def = def; this.Id = ''; this.Type = def.type;
    this.Title = def.title ?? ''; this.Description = def.desc ?? ''; this.Slider = def.slider ?? null; this.Section = def.section;
    this.DefaultValue = def.def; this.UpdateAction = null; this.Buttons = []; this._listeners = []; this._init = false;
    this.Value = def.def;                       // ctor: Value = value (UpdateAction is still null and Id still "")
    this.Id = def.id;
  }
  get Value() { return this._v; }
  set Value(value) {                            // SettingsItem<T>.Value setter
    this._v = value;
    this.UpdateAction?.(value, !this._init);
    for (const fn of this._listeners) fn(this._v);   // Updated
    if (!this._init && this.Id !== '') this._init = true;
  }
  get Updated() { return { add: (fn) => this._listeners.push(fn) }; }
  GetVariant() { return this._v; }
  SetVariant(v) {
    if (this.Type === 'bool') v = !!v; else if (this.Type === 'double' || this.Type === 'int') v = Number(v);
    this.Value = v;
  }
  Reset() { this.Value = this.DefaultValue; }
}

export class SettingsProfile {
  constructor() {
    this.items = {};
    for (const d of DEFS) {
      const it = new SettingsItem(d); this.items[d.id] = it;
      Object.defineProperty(this, d.id, { get: () => it.Value, set: (v) => { it.Value = v; }, enumerable: true });
    }
    const I = this.items;
    const updateApproachTime = () => { I.ApproachTime.Value = I.ApproachDistance.Value / I.ApproachRate.Value; };   // updateApproachTime
    I.ApproachRate.UpdateAction = I.ApproachDistance.UpdateAction = () => updateApproachTime();
    for (const id of ['VolumeMaster', 'VolumeMusic', 'VolumeSFX', 'VolumeHitSound', 'VolumeMissSound', 'VolumeMenuMusic'])
      I[id].UpdateAction = (_, init) => { if (!init) hooks.updateVolume(); };
    I.EnableMenuMusic.UpdateAction = (_, init) => { if (!init) hooks.refreshMenuMusic(); };
    I.ResetToDefaults.Buttons = [{ Title: 'Reset', Description: 'WARNING: THIS RESETS YOUR CURRENT PROFILE', OnPressed: () => hooks.resetToDefaults() }];
    updateApproachTime();
  }
  // ToOrderedSectionList: section -> items in menu order (only ones this port shows)
  ToOrderedSectionList() {
    const out = new Map(SECTIONS.map((s) => [s, []]));
    for (const d of DEFS) if (d.ui) out.get(d.section).push(this.items[d.id]);
    return out;
  }
}
hooks.resetToDefaults = () => {};

export function createSettings() { return new SettingsProfile(); }
