// Pure helpers for the automatic backups (no phone APIs here, so they can be tested with node).
//
// Auto-backups are written next to the manual exports, as auto-backup-YYYYMMDD-HHMMSS.json, and only
// the newest KEEP of them are kept. Files with any other name are never touched.

export const KEEP = 10;
const NAME = /^auto-backup-(\d{8})-(\d{6})\.json$/;

const pad = (n) => String(n).padStart(2, '0');

export function autoBackupName(date) {
  const d = date instanceof Date ? date : new Date(date);
  return (
    `auto-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`
  );
}

export const isAutoBackupName = (name) => NAME.test(String(name || ''));

// Names to delete so only the newest `keep` automatic backups remain.
// Android may rename a clashing file to "name (1).json"; those are not ours and are left alone.
export function namesToPrune(names, keep = KEEP) {
  const ours = names.filter(isAutoBackupName).sort(); // the stamp sorts oldest -> newest
  return ours.slice(0, Math.max(0, ours.length - keep));
}

// Nothing worth saving yet: skip, so an empty state can never push good backups out.
export const isEmptyState = (state) =>
  !state || ((state.sources || []).length === 0 && (state.transactions || []).length === 0);

// "today 10:48", "yesterday 21:05", "3 Nov 10:48"
export function whenText(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `today ${time}`;
  if (diff === 1) return `yesterday ${time}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${time}`;
}
