// Run with: npm test   (uses Node's built-in test runner)
// Mirrors the worked examples in section 13 of the project brief.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addEntry, addSource, borrowedLentLines, canDeleteSource, deleteEntry, deleteSource,
  editEntry, emptyState, fmt, ledgerRows, netWith, outstandingFor, owedBetween, owedLine,
  parseBackup, renameSource, serialize, settle, settleItems, totalBalance, totalProfit, totals,
} from './ledger.js';

const D = '2026-11-09T10:40:00.000Z';

function setup() {
  let s = emptyState();
  s = addSource(s, 'Shop');
  s = addSource(s, 'Household');
  s = addSource(s, "Brother's Savings");
  const id = (n) => s.sources.find((x) => x.name === n).id;
  return { s, shop: id('Shop'), house: id('Household'), bro: id("Brother's Savings") };
}

test('fmt: ₹with thousands separators and 2 decimals', () => {
  assert.equal(fmt(1500), '₹1,500.00');
  assert.equal(fmt(0.1 + 0.2), '₹0.30');
  assert.equal(fmt(1234567.891), '₹1,234,567.89');
});

test('Shop lends ₹1,000 to Household', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 1000, date: D, payment: 'cash' });
  const [a, b] = s.transactions;
  assert.equal(a.transferId, b.transferId);
  assert.deepEqual([a.type, a.sourceId, a.counterId], ['debit', shop, house]);
  assert.deepEqual([b.type, b.sourceId, b.counterId], ['credit', house, shop]);
  assert.deepEqual(borrowedLentLines(s, shop).map((l) => l.text), ['You lent ₹1,000.00 to Household']);
  assert.deepEqual(borrowedLentLines(s, house).map((l) => l.text), ['₹1,000.00 is from Shop']);
  assert.deepEqual(owedBetween(s).map((o) => owedLine(s, o).text), ['Household owes Shop ₹1,000.00']);
});

test('Household repays ₹400 (settlement)', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 1000, date: D, payment: 'cash' });
  s = settle(s, { sourceId: house, counterId: shop, amount: 400, date: D, payment: 'cash' });
  const legs = s.transactions.filter((t) => t.settlement);
  assert.equal(legs.length, 2);
  assert.deepEqual(legs.map((t) => [t.sourceId, t.type]), [[house, 'debit'], [shop, 'credit']]);
  assert.equal(netWith(s.transactions, house, shop), 600);
  assert.equal(owedBetween(s)[0].amount, 600);
  // Settlement shows in both history tables.
  assert.equal(ledgerRows(s, shop).filter((r) => r.settlement).length, 1);
  assert.equal(ledgerRows(s, house).filter((r) => r.settlement).length, 1);
});

test('Settle: other side owes -> credit on this source; cannot exceed outstanding', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 1000, date: D, payment: 'cash' });
  assert.throws(() => settle(s, { sourceId: shop, counterId: house, amount: 1000.5, date: D, payment: 'cash' }), /cannot be more/);
  s = settle(s, { sourceId: shop, counterId: house, amount: 1000, date: D, payment: 'cash' });
  const mine = s.transactions.filter((t) => t.sourceId === shop && t.settlement);
  assert.equal(mine[0].type, 'credit');
  assert.deepEqual(owedBetween(s), []);          // fully settled -> hidden
  assert.deepEqual(outstandingFor(s, shop), []);
  assert.throws(() => settle(s, { sourceId: shop, counterId: house, amount: 1, date: D, payment: 'cash' }), /Nothing/);
});

test('Brother gives ₹3,000 more savings (plain credit)', () => {
  let { s, bro } = setup();
  s = addEntry(s, { kind: 'credit', sourceId: bro, amount: 3000, date: D, payment: 'cash' });
  assert.equal(totals(s.transactions, bro).balance, 3000);
  assert.deepEqual(owedBetween(s), []);
  assert.equal(ledgerRows(s, bro)[0].other, '');
});

test("Shop takes ₹5,000 from Brother's Savings", () => {
  let { s, shop, bro } = setup();
  s = addEntry(s, { kind: 'from', sourceId: shop, otherId: bro, amount: 5000, date: D, payment: 'cash' });
  const shopLeg = s.transactions.find((t) => t.sourceId === shop);
  const broLeg = s.transactions.find((t) => t.sourceId === bro);
  assert.equal(shopLeg.type, 'credit');
  assert.equal(broLeg.type, 'debit');
  assert.deepEqual(owedBetween(s).map((o) => owedLine(s, o).text), ["Shop owes Brother's Savings ₹5,000.00"]);
});

test('Delete a transfer removes both legs; balances and owed lines update', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 1000, date: D, payment: 'cash' });
  s = deleteEntry(s, s.transactions[1].id); // delete via the OTHER leg
  assert.equal(s.transactions.length, 0);
  assert.equal(totalBalance(s), 0);
  assert.deepEqual(owedBetween(s), []);
});

test('Total balance: transfers net to zero, plain entries count', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 500, date: D, payment: 'cash' });
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 200, date: D, payment: 'cash' });
  s = addEntry(s, { kind: 'debit', sourceId: house, amount: 50, date: D, payment: 'cash' });
  assert.equal(totals(s.transactions, shop).balance, 300);
  assert.equal(totals(s.transactions, house).balance, 150);
  assert.equal(totalBalance(s), 450);
});

test('Amounts are rounded to 2 decimals; zero/negative rejected', () => {
  let { s, shop } = setup();
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: '10.456', date: D, payment: 'cash' });
  assert.equal(s.transactions[0].amount, 10.46);
  assert.throws(() => addEntry(s, { kind: 'credit', sourceId: shop, amount: 0, date: D, payment: 'cash' }));
  assert.throws(() => addEntry(s, { kind: 'debit', sourceId: shop, amount: 'abc', date: D, payment: 'cash' }));
});

test('Nets that round to zero are hidden (tolerance 0.005)', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 0.1, date: D, payment: 'cash' });
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 0.2, date: D, payment: 'cash' });
  s = settle(s, { sourceId: house, counterId: shop, amount: 0.3, date: D, payment: 'cash' });
  assert.deepEqual(owedBetween(s), []);
});

test('Transfers need another source', () => {
  const { s, shop } = setup();
  assert.throws(() => addEntry(s, { kind: 'to', sourceId: shop, amount: 5, date: D, payment: 'cash' }), /other source/);
  assert.throws(() => addEntry(s, { kind: 'to', sourceId: shop, otherId: shop, amount: 5, date: D, payment: 'cash' }), /different/);
});

test('Editing a transfer changes amount/date/note on both sides', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 1000, date: D, payment: 'cash' });
  s = editEntry(s, s.transactions[0].id, { amount: 750, date: '2026-11-10T08:00:00.000Z', note: 'fixed', payment: 'upi' });
  for (const t of s.transactions) {
    assert.equal(t.amount, 750);
    assert.equal(t.note, 'fixed');
    assert.equal(t.payment, 'upi');
    assert.equal(t.date, '2026-11-10T08:00:00.000Z');
  }
  assert.equal(netWith(s.transactions, house, shop), 750);
});

test('Editing a plain entry can switch credit/debit', () => {
  let { s, shop } = setup();
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 100, date: D, payment: 'cash' });
  s = editEntry(s, s.transactions[0].id, { type: 'debit', amount: 100, date: D, note: '', payment: 'cash' });
  assert.equal(totals(s.transactions, shop).balance, -100);
});

test('Ledger rows are newest first', () => {
  let { s, shop } = setup();
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 1, date: '2026-11-07T09:30:00.000Z', payment: 'cash' });
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 2, date: '2026-11-09T09:30:00.000Z', payment: 'cash' });
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 3, date: '2026-11-08T09:30:00.000Z', payment: 'cash' });
  assert.deepEqual(ledgerRows(s, shop).map((r) => r.credit), [2, 3, 1]);
});

test('A source with money still owed cannot be deleted', () => {
  let { s, shop, house, bro } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 10, date: D, payment: 'cash' });
  assert.equal(canDeleteSource(s, shop), false);   // lender
  assert.equal(canDeleteSource(s, house), false);  // borrower
  assert.throws(() => deleteSource(s, shop), /Settle/);
  assert.equal(canDeleteSource(s, bro), true);     // unrelated, empty
  assert.equal(deleteSource(s, bro).sources.length, 2);
});

test('After settling, a source can be deleted with its entries; others keep their balance', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 500, date: D, payment: 'cash' });
  s = addEntry(s, { kind: 'credit', sourceId: house, amount: 70, date: D, payment: 'cash' });
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 1000, date: D, payment: 'cash' });
  s = settle(s, { sourceId: house, counterId: shop, amount: 1000, date: D, payment: 'cash' });
  const shopBefore = totals(s.transactions, shop).balance;
  assert.equal(canDeleteSource(s, house), true);
  const after = deleteSource(s, house);
  assert.deepEqual(after.sources.map((x) => x.id), [shop, s.sources[2].id]);
  // Household's own rows and the matching legs on Shop are gone, nothing else is.
  assert.equal(after.transactions.some((t) => t.sourceId === house || t.counterId === house), false);
  assert.equal(after.transactions.length, 1);
  assert.equal(totals(after.transactions, shop).balance, shopBefore);
  assert.equal(shopBefore, 500);
});

test('Source names: trimmed, required, unique', () => {
  let { s, shop } = setup();
  assert.throws(() => addSource(s, '  '));
  assert.throws(() => addSource(s, 'shop'), /already exists/);
  s = renameSource(s, shop, '  Main Shop ');
  assert.equal(s.sources[0].name, 'Main Shop');
});

test('settleItems wording', () => {
  let { s, shop, house, bro } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 1000, date: D, payment: 'cash' });
  s = addEntry(s, { kind: 'from', sourceId: shop, otherId: bro, amount: 500, date: D, payment: 'cash' });
  const labels = settleItems(s, shop).map((i) => i.label).sort();
  assert.deepEqual(labels, ["Household owes you ₹1,000.00", "You owe Brother's Savings ₹500.00"]);
});

test('Backup round trip, and bad files are rejected', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 1000, date: D, payment: 'cash' });
  assert.deepEqual(parseBackup(serialize(s)), s);
  assert.throws(() => parseBackup('not json'), /not valid JSON/);
  assert.throws(() => parseBackup('{"hello":1}'), /not a ledger backup/);
  const bad = JSON.parse(serialize(s));
  bad.transactions[0].sourceId = 'nope';
  assert.throws(() => parseBackup(JSON.stringify(bad)), /broken entry/);
});

test('Sentences carry bold parts for the amount and source names', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 5000, date: D, payment: 'cash' });
  const [line] = borrowedLentLines(s, shop);
  assert.deepEqual(line.parts, ['You lent ', { b: '₹5,000.00' }, ' to ', { b: 'Household' }]);
  assert.equal(line.text, 'You lent ₹5,000.00 to Household');
  assert.deepEqual(fmt(-5000), '-₹5,000.00');
});

test('Payment type is mandatory and must be cash or upi', () => {
  const { s, shop, house } = setup();
  const base = { sourceId: shop, amount: 100, date: D };
  assert.throws(() => addEntry(s, { kind: 'credit', ...base }), /payment type/);
  assert.throws(() => addEntry(s, { kind: 'credit', ...base, payment: 'card' }), /payment type/);
  assert.throws(() => addEntry(s, { kind: 'to', ...base, otherId: house }), /payment type/);
  const ok = addEntry(s, { kind: 'credit', ...base, payment: 'upi' });
  assert.equal(ok.transactions[0].payment, 'upi');
  // editing also needs it, and settling too
  assert.throws(() => editEntry(ok, ok.transactions[0].id, { amount: 5, date: D }), /payment type/);
  let loan = addEntry(s, { kind: 'to', ...base, otherId: house, payment: 'cash' });
  assert.throws(() => settle(loan, { sourceId: house, counterId: shop, amount: 10, date: D }), /payment type/);
});

test('Both legs of a transfer carry the same payment type; no profit on transfers', () => {
  let { s, shop, house } = setup();
  s = addEntry(s, { kind: 'to', sourceId: shop, otherId: house, amount: 100, date: D, payment: 'upi', profit: 30 });
  assert.deepEqual(s.transactions.map((t) => t.payment), ['upi', 'upi']);
  assert.equal(s.transactions.some((t) => 'profit' in t), false);
});

test('Profit is optional, validated, rounded and totalled', () => {
  let { s, shop } = setup();
  const e = (extra) => addEntry(s, { kind: 'credit', sourceId: shop, amount: 100, date: D, payment: 'cash', ...extra });
  assert.equal('profit' in e({}).transactions[0], false);          // omitted
  assert.equal('profit' in e({ profit: '' }).transactions[0], false); // blank
  assert.equal(e({ profit: '20' }).transactions[0].profit, 20);
  assert.equal(e({ profit: '12.345' }).transactions[0].profit, 12.35);
  assert.equal(e({ profit: 0 }).transactions[0].profit, 0);
  assert.throws(() => e({ profit: 'abc' }), /Profit/);
  assert.throws(() => e({ profit: -5 }), /Profit/);
  assert.throws(() => e({ profit: 150 }), /cannot be more/);
  s = e({ profit: 20 });
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 50, date: D, payment: 'upi', profit: 5.5 });
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 70, date: D, payment: 'upi' });
  assert.equal(totalProfit(s.transactions, shop), 25.5);
});

test('Editing can add, change and clear the profit', () => {
  let { s, shop } = setup();
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 100, date: D, payment: 'cash' });
  const id = s.transactions[0].id;
  s = editEntry(s, id, { amount: 100, date: D, payment: 'cash', profit: 15 });
  assert.equal(s.transactions[0].profit, 15);
  s = editEntry(s, id, { amount: 100, date: D, payment: 'upi', profit: '' });
  assert.equal('profit' in s.transactions[0], false);
  assert.equal(s.transactions[0].payment, 'upi');
});

test('Table rows carry payment and profit, and can be filtered by cash / upi / all', () => {
  let { s, shop } = setup();
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 100, date: '2026-11-07T09:00:00.000Z', payment: 'cash', profit: 20 });
  s = addEntry(s, { kind: 'credit', sourceId: shop, amount: 200, date: '2026-11-08T09:00:00.000Z', payment: 'upi' });
  s = addEntry(s, { kind: 'debit', sourceId: shop, amount: 50, date: '2026-11-09T09:00:00.000Z', payment: 'upi' });
  assert.equal(ledgerRows(s, shop).length, 3);
  assert.equal(ledgerRows(s, shop, 'all').length, 3);
  assert.deepEqual(ledgerRows(s, shop, 'upi').map((r) => r.payment), ['upi', 'upi']);
  const cash = ledgerRows(s, shop, 'cash');
  assert.deepEqual(cash.map((r) => [r.payment, r.profit, r.credit]), [['cash', 20, 100]]);
  assert.equal(ledgerRows(s, shop, 'upi')[0].profit, null);
});

test('Old entries without a payment type still load, show under All only', () => {
  const old = { app: 'ledger', version: 1, sources: [{ id: 'a', name: 'Shop' }],
    transactions: [{ id: 't1', type: 'credit', sourceId: 'a', amount: 10, date: D, note: '' }] };
  const s = parseBackup(JSON.stringify(old));
  assert.equal(ledgerRows(s, 'a').length, 1);
  assert.equal(ledgerRows(s, 'a')[0].payment, '');
  assert.equal(ledgerRows(s, 'a', 'cash').length, 0);
  assert.equal(ledgerRows(s, 'a', 'upi').length, 0);
  const bad = JSON.parse(JSON.stringify(old)); bad.transactions[0].payment = 'card';
  assert.throws(() => parseBackup(JSON.stringify(bad)), /broken entry/);
});

test('Totals and profit follow the cash / upi filter (balance card)', () => {
  let { s, shop } = setup();
  const add = (kind, amount, payment, profit) =>
    (s = addEntry(s, { kind, sourceId: shop, amount, date: D, payment, profit }));
  add('credit', 1000, 'cash', 200);
  add('credit', 500, 'upi', 50);
  add('debit', 300, 'cash');
  add('debit', 100, 'upi');
  assert.deepEqual(totals(s.transactions, shop), { credit: 1500, debit: 400, balance: 1100 });
  assert.deepEqual(totals(s.transactions, shop, 'all'), { credit: 1500, debit: 400, balance: 1100 });
  assert.deepEqual(totals(s.transactions, shop, 'cash'), { credit: 1000, debit: 300, balance: 700 });
  assert.deepEqual(totals(s.transactions, shop, 'upi'), { credit: 500, debit: 100, balance: 400 });
  assert.equal(totalProfit(s.transactions, shop), 250);
  assert.equal(totalProfit(s.transactions, shop, 'cash'), 200);
  assert.equal(totalProfit(s.transactions, shop, 'upi'), 50);
  // cash + upi balances add up to the whole balance when every entry has a payment type
  assert.equal(
    totals(s.transactions, shop, 'cash').balance + totals(s.transactions, shop, 'upi').balance,
    totals(s.transactions, shop).balance
  );
});

test('Filtered totals leave out old entries that have no payment type', () => {
  const old = { app: 'ledger', sources: [{ id: 'a', name: 'Shop' }],
    transactions: [
      { id: 't1', type: 'credit', sourceId: 'a', amount: 100, date: D },
      { id: 't2', type: 'credit', sourceId: 'a', amount: 40, date: D, payment: 'cash' },
    ] };
  const s = parseBackup(JSON.stringify(old));
  assert.equal(totals(s.transactions, 'a').balance, 140);
  assert.equal(totals(s.transactions, 'a', 'cash').balance, 40);
  assert.equal(totals(s.transactions, 'a', 'upi').balance, 0);
});
