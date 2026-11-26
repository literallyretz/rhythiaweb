// Port of SettingsManager.cs + SettingsProfileConverter.cs. The user folder (profiles/*.json, current_profile.txt) becomes localStorage:
//   rhythia/profiles/<name>.json -> same JSON the C# writes ("_Version": 1, one key per setting, floats rounded to 4 decimals)
//   rhythia/current_profile.txt   -> profile name
import { SettingsProfile, hooks } from './settings.js';
import { notify } from './ui/Toast.js';

const PREFIX = 'rhythia/';
const store = {
  get: (k) => { try { return localStorage.getItem(PREFIX + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(PREFIX + k, v); } catch {} },
};

// Math.Round((float)value, 4): float32, then .NET Math.Round(double, 4) (banker's rounding)
function roundFloat4(v) {
  const x = Math.fround(v), y = x * 1e4, fl = Math.floor(y), d = y - fl;
  const r = d < 0.5 ? fl : d > 0.5 ? fl + 1 : (fl % 2 === 0 ? fl : fl + 1);
  return r / 1e4;
}

export const SettingsManager = {
  Settings: new SettingsProfile(),
  Shown: false, Menu: null, HideNotifications: false, ready: false,
  _loaded: [], _saved: [],
  onLoaded(fn) { this._loaded.push(fn); }, onSaved(fn) { this._saved.push(fn); },

  // SettingsProfileConverter.Serialize
  Serialize(profile = this.Settings) {
    const data = { _Version: 1 };
    for (const [id, item] of Object.entries(profile.items)) {
      if (item.Type === 'Variant') continue;   // buttons: SaveToDisk false in practice (nothing to store)
      data[id] = item.Type === 'double' ? roundFloat4(item.GetVariant()) : item.GetVariant();
    }
    return JSON.stringify(data, null, '\t');
  },
  // SettingsProfileConverter.Deserialize: missing keys are reset to their defaults
  Deserialize(text, profile = this.Settings) {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object') throw new Error('not a dictionary');
    for (const [id, item] of Object.entries(profile.items)) {
      if (item.Type === 'Variant') continue;
      if (id in data) item.SetVariant(data[id]); else item.Reset();
    }
  },

  Save(profile = null) {
    profile ??= this.GetCurrentProfile();
    store.set(`profiles/${profile}.json`, this.Serialize());
    this._saved.forEach((fn) => fn());
  },
  Load(profile = null) {
    profile ??= this.GetCurrentProfile();
    try {
      this.Deserialize(store.get(`profiles/${profile}.json`), this.Settings);
      if (this.ready) notify(`Loaded profile [${profile}]`);   // ToastNotification returns early while no scene exists (boot)
    } catch (e) {
      notify('Settings file corrupted', 2); console.error(e);
    }
    this._loaded.forEach((fn) => fn());
  },
  Reload() { this.Save(); this.Load(); },
  SetCurrentProfile(profile = null) { store.set('current_profile.txt', profile ?? this.GetCurrentProfile()); },
  GetCurrentProfile() { return store.get('current_profile.txt') ?? 'default'; },
  // Directory.GetFiles(".../profiles")
  GetProfiles() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const m = k.startsWith(PREFIX + 'profiles/') && k.endsWith('.json') ? k.slice((PREFIX + 'profiles/').length, -5) : null; if (m) out.push(m); } } catch {}
    return out.sort();
  },
  // SettingsManager.ResetToDefaults (SetUserFolderPath / dialog items are not part of this port): current = a fresh SettingsProfile's value (defs.GetVariant(),
  // not DefaultValue: the fresh profile's constructor already ran updateApproachTime, so ApproachTime is AD / AR, not its declared default)
  ResetToDefaults() {
    this.HideNotifications = true;
    const defaults = new SettingsProfile();
    for (const [id, item] of Object.entries(this.Settings.items)) if (item.Type !== 'Variant') item.SetVariant(defaults.items[id].GetVariant());
    this.Save();
    this.HideNotifications = false;
    notify('Settings reset to default successfully!');
  },
  // Rhythia._Ready: create default.json on first run, then Load (a bad file is overwritten with the current values)
  // `firstRun` holds the values this build shipped with before it had a settings menu (FadeOut 25, NoteSize 1, grid guides off).
  Init(firstRun = {}) {
    if (store.get('profiles/default.json') === null) {
      for (const [id, v] of Object.entries(firstRun)) this.Settings.items[id].SetVariant(v);
      this.Save('default');
    }
    try { this.Load(); } catch (e) { console.error(e); this.Save(); }
    this.ready = true;
  },
};
hooks.resetToDefaults = () => SettingsManager.ResetToDefaults();
