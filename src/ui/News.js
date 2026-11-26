// Menus/Home/News (main_menu.tscn): the right-hand panel the original ships hidden (visible = false, 0.1.2 patch notes). Shown here with this port's own
// text. The version line follows Loading.cs / Releases.CheckForUpdatesAsync (latest GitHub release of Rhythia/Client vs the current version), but is
// displayed in the panel instead of an "Update Found" popup, because a browser port cannot self-update.
const API = 'https://api.github.com/repos/Rhythia/Client/releases/latest';
const parts = (v) => String(v).replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
export const compareVersions = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return Math.sign(d); } return 0; };

export function initNews(version) {
  const el = document.getElementById('newsStatus'); if (!el) return;
  document.getElementById('newsHeader').textContent = `${version} (web port)`;
  const say = (cls, text) => { el.className = cls; el.textContent = text; };
  say('', 'Checking for a newer Rhythia release…');
  fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((rel) => {
      const tag = rel.tag_name, c = compareVersions(tag, version);
      if (c === 0) say('ok', `Up to date: matches the latest Rhythia release (${tag}).`);
      else if (c > 0) say('old', `Rhythia ${tag} is out. This port is based on ${version} and may be missing changes.`);
      else say('ok', `Based on ${version}, newer than the latest release (${tag}).`);
    })
    .catch(() => say('', 'Could not check for a newer Rhythia release.'));
}
