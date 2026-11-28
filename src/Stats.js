// Port of scripts/database/Stats.cs. The original keeps one row (Id "_STATS") in its SQLite database;
// here the row is a JSON object stored under "_STATS" in the same IndexedDB file store as the rest of the user folder.
import { MapManager } from './map/MapManager.js';

const ID = '_STATS';
const FIELDS = ['GamePlaytime', 'TotalPlaytime', 'GamesOpened', 'TotalDistance', 'NotesHit', 'NotesMissed', 'HighestCombo', 'Attempts', 'Passes', 'FullCombos', 'HighestScore', 'TotalScore', 'RageQuits', 'AverageAccuracy'];

class StatsRow {
  constructor() { this.Id = ID; for (const f of FIELDS) this[f] = 0; this.listeners = new Set(); }
  get StatsUpdated() { return this.listeners; }   // event Action<Stats> StatsUpdated (add / delete)
  ForceUpdate() { for (const l of this.listeners) l(this); }   // Forces a sync for stats
}

export const Stats = {
  Instance: new StatsRow(),
  async Initialize() {
    const row = await MapManager.readFile(ID).catch(() => null);
    const inst = new StatsRow();
    if (row && typeof row === 'object') for (const f of FIELDS) if (typeof row[f] === 'number') inst[f] = row[f];
    this.Instance = inst;
    if (!row) await this.Save();   // connection.Insert(result)
  },
  Save() {   // connection.InsertOrReplace(Instance)
    const row = { Id: ID }; for (const f of FIELDS) row[f] = this.Instance[f];
    return MapManager.writeFile(ID, row).then(() => console.log('Saved stats'));
  },
};
// Constants.STARTED (Time.GetTicksUsec at startup), in ms
export const STARTED = performance.now();
