import test from 'node:test';
import assert from 'node:assert/strict';
import { autoBackupName, isAutoBackupName, isEmptyState, namesToPrune, whenText } from './autobackup.js';

test('name has date and time with seconds, and is recognised', () => {
  const n = autoBackupName(new Date(2026, 10, 11, 9, 5, 7));
  assert.equal(n, 'auto-backup-20261111-090507.json');
  assert.ok(isAutoBackupName(n));
  assert.ok(!isAutoBackupName('pool-ledger-backup-20261111-0905.json'));
  assert.ok(!isAutoBackupName('auto-backup-20261111-090507 (1).json'));
});

test('prune keeps the newest 10 and never touches other files', () => {
  const names = [];
  for (let i = 1; i <= 12; i++) names.push(autoBackupName(new Date(2026, 10, i, 10, 0, 0)));
  names.push('pool-ledger-backup-20261101-1000.json', 'Shop-ledger-20261105-1000.pdf', 'notes.txt');
  const gone = namesToPrune(names.reverse());
  assert.deepEqual(gone, [autoBackupName(new Date(2026, 10, 1, 10)), autoBackupName(new Date(2026, 10, 2, 10))]);
  assert.deepEqual(namesToPrune(names.slice(0, 5)), []);
});

test('empty state is not worth a backup', () => {
  assert.ok(isEmptyState({ sources: [], transactions: [] }));
  assert.ok(!isEmptyState({ sources: [{ id: 'a' }], transactions: [] }));
});

test('whenText: today, yesterday, older', () => {
  const now = new Date(2026, 10, 11, 12, 0);
  assert.equal(whenText(new Date(2026, 10, 11, 10, 48).toISOString(), now), 'today 10:48');
  assert.equal(whenText(new Date(2026, 10, 10, 21, 5).toISOString(), now), 'yesterday 21:05');
  assert.equal(whenText(new Date(2026, 10, 3, 8, 0).toISOString(), now), '3 Nov 08:00');
  assert.equal(whenText(null, now), '');
});
