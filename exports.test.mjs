import test from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, addSource, emptyState } from './ledger.js';
import { buildHtml, buildReport, buildSheetRows } from './exports.js';

function demo() {
  let s = addSource(addSource(emptyState(), 'Shop'), 'House');
  const [shop, house] = s.sources.map((x) => x.id);
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 100, date: '2026-11-07T09:30:00.000Z', payment: 'cash', profit: 20, note: 'sales <ok>' });
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 1000, date: '2026-11-08T13:00:00.000Z', payment: 'upi' });
  return { s, shop };
}

test('report: header numbers, rows newest first', () => {
  const { s, shop } = demo();
  const r = buildReport(s, shop, new Date('2026-11-10T10:00:00.000Z'));
  assert.equal(r.name, 'Shop');
  assert.equal(r.credit, 100);
  assert.equal(r.debit, 1000);
  assert.equal(r.balance, -900);
  assert.deepEqual(r.lines, ['You lent ₹1,000.00 to House']);
  assert.deepEqual(r.rows.map((x) => x.sourceText), ['House', '']);
});

test('html: escapes notes and has a totals row', () => {
  const { s, shop } = demo();
  const html = buildHtml(buildReport(s, shop));
  assert.match(html, /sales &lt;ok&gt;/);
  assert.match(html, /<tfoot>.*1,000\.00/s);
});

test('xlsx rows: amounts are numbers, payment and profit columns, totals row last', () => {
  const { s, shop } = demo();
  const { aoa, headerRow } = buildSheetRows(buildReport(s, shop));
  assert.deepEqual(aoa[headerRow], ['Date and time', 'Credit', 'Debit', 'Source', 'Payment', 'Profit', 'Note']);
  assert.equal(typeof aoa[headerRow + 1][2], 'number');
  assert.deepEqual(aoa.at(-1), ['Total', 100, 1000, '', '', 20, '']);
  const credit = aoa.slice(headerRow + 1).find((r) => r[1] === 100); // the plain sale row
  assert.deepEqual([credit[4], credit[5]], ['Cash', 20]);
});

test('report follows the cash / upi filter: rows, totals and a note in the header', () => {
  const { s, shop } = demo();
  const upi = buildReport(s, shop, new Date('2026-11-10T10:00:00.000Z'), 'upi');
  assert.equal(upi.rows.length, 1);
  assert.equal(upi.shownDebit, 1000);
  assert.equal(upi.shownCredit, 0);
  assert.equal(upi.credit, 0);                   // the summary follows the filter too
  assert.equal(upi.debit, 1000);
  assert.equal(upi.balance, -1000);
  assert.equal(upi.profit, 0);
  const cash = buildReport(s, shop, new Date('2026-11-10T10:00:00.000Z'), 'cash');
  assert.deepEqual([cash.credit, cash.debit, cash.balance, cash.profit], [100, 0, 100, 20]);
  assert.match(buildHtml(cash), /Total profit: ₹20\.00/);
  assert.doesNotMatch(buildHtml(upi), /Total profit/);
  assert.match(buildHtml(upi), /Showing UPI entries only/);
  assert.deepEqual(buildSheetRows(upi).aoa.find((r) => r[0] === 'Showing'), ['Showing', 'UPI entries only']);
  const all = buildReport(s, shop);
  assert.equal(all.filterText, '');
  assert.doesNotMatch(buildHtml(all), /Showing/);
});
