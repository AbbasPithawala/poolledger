// Pure ledger logic: no React, no storage. Everything here is covered by ledger.test.mjs.
//
// State shape (see project brief, section 4):
//   { sources: [{ id, name }], transactions: [{ id, type, sourceId, amount, date, note,
//                                              counterId?, transferId?, settlement? }] }

export const TOLERANCE = 0.005;

export const emptyState = () => ({ sources: [], transactions: [] });

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const CURRENCY = '\u20B9'; // rupee sign

function groupDigits(v) {
  const [whole, dec] = Math.abs(v).toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

// "\u20B91,500.00"  (negative: "-\u20B95,000.00")
export function fmt(n) {
  const v = round2(n);
  return `${v < 0 ? '-' : ''}${CURRENCY}${groupDigits(v)}`;
}

// "1,500.00" (no symbol, used in table cells)
export const fmtPlain = (n) => groupDigits(round2(n));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "9 Nov 26"
export function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}

// "4:10 pm"
export function fmtTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'pm' : 'am'}`;
}

export const sourceName = (state, id) =>
  (state.sources.find((s) => s.id === id) || { name: '(deleted)' }).name;

// ---------- calculations (section 5) ----------

// Balance of one source: credits minus debits (plain entries and transfers both count).
// `filter` ('all' | 'cash' | 'upi') limits it to entries with that payment type.
const matchesFilter = (t, filter) => filter === 'all' || t.payment === filter;

export function totals(transactions, sourceId, filter = 'all') {
  let credit = 0;
  let debit = 0;
  for (const t of transactions) {
    if (t.sourceId !== sourceId || !matchesFilter(t, filter)) continue;
    if (t.type === 'credit') credit += t.amount;
    else debit += t.amount;
  }
  credit = round2(credit);
  debit = round2(debit);
  return { credit, debit, balance: round2(credit - debit) };
}

// Sum of the optional profit on a source's entries (same optional payment filter).
export const totalProfit = (transactions, sourceId, filter = 'all') =>
  round2(
    transactions.reduce(
      (sum, t) =>
        t.sourceId === sourceId && matchesFilter(t, filter) && typeof t.profit === 'number'
          ? sum + t.profit
          : sum,
      0
    )
  );

export const totalBalance = (state) =>
  round2(state.sources.reduce((sum, s) => sum + totals(state.transactions, s.id).balance, 0));

// Net of source S with source X: credits(counterId = X) - debits(counterId = X), seen from S.
//   net > 0  -> S holds money from X and owes it back.
//   net < 0  -> S lent money to X (X owes S).
export function netWith(transactions, sourceId, counterId) {
  let net = 0;
  for (const t of transactions) {
    if (t.sourceId !== sourceId || t.counterId !== counterId) continue;
    net += t.type === 'credit' ? t.amount : -t.amount;
  }
  return round2(net);
}

// Everything outstanding for one source: [{ counterId, net }], zero nets hidden.
export function outstandingFor(state, sourceId) {
  const ids = new Set();
  for (const t of state.transactions) {
    if (t.sourceId === sourceId && t.counterId) ids.add(t.counterId);
  }
  const out = [];
  for (const counterId of ids) {
    const net = netWith(state.transactions, sourceId, counterId);
    if (Math.abs(net) >= TOLERANCE) out.push({ counterId, net });
  }
  return out;
}

// Home screen list: one entry per pair of sources, { debtorId, creditorId, amount }.
export function owedBetween(state) {
  const list = [];
  const { sources, transactions } = state;
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i].id;
      const b = sources[j].id;
      const net = netWith(transactions, a, b); // seen from a
      if (Math.abs(net) < TOLERANCE) continue;
      if (net > 0) list.push({ debtorId: a, creditorId: b, amount: net });
      else list.push({ debtorId: b, creditorId: a, amount: -net });
    }
  }
  return list;
}

// ---------- table rows (section 7) ----------

// Newest first. `other` is the counter source name (blank for plain entries).
// `filter`: 'all' | 'cash' | 'upi'. Old entries saved without a payment type only show under 'all'.
export function ledgerRows(state, sourceId, filter = 'all') {
  return state.transactions
    .filter((t) => t.sourceId === sourceId && matchesFilter(t, filter))
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.id.localeCompare(a.id))
    .map((t) => ({
      id: t.id,
      date: t.date,
      credit: t.type === 'credit' ? t.amount : null,
      debit: t.type === 'debit' ? t.amount : null,
      other: t.counterId ? sourceName(state, t.counterId) : '',
      settlement: !!t.settlement,
      note: t.note || '',
      payment: t.payment || '',
      profit: typeof t.profit === 'number' ? t.profit : null,
      isTransfer: !!t.transferId,
    }));
}

// ---------- mutations: all return a NEW state ----------

export function addSource(state, name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Enter a name.');
  if (state.sources.some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('A source with this name already exists.');
  }
  return { ...state, sources: [...state.sources, { id: uid(), name: clean }] };
}

export function renameSource(state, id, name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Enter a name.');
  if (state.sources.some((s) => s.id !== id && s.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('A source with this name already exists.');
  }
  return { ...state, sources: state.sources.map((s) => (s.id === id ? { ...s, name: clean } : s)) };
}

// A source can be deleted only when nothing is owed to or by it (all loans settled).
export const canDeleteSource = (state, id) => outstandingFor(state, id).length === 0;

// Removes the source and all its entries, plus the matching legs on other sources.
// Those legs net to zero against this source (nothing outstanding), so no other balance changes.
export function deleteSource(state, id) {
  if (!canDeleteSource(state, id)) {
    throw new Error('Settle this source first: money is still owed.');
  }
  return {
    sources: state.sources.filter((s) => s.id !== id),
    transactions: state.transactions.filter((t) => t.sourceId !== id && t.counterId !== id),
  };
}

function checkAmount(amount) {
  const a = round2(amount);
  if (!(a > 0)) throw new Error('Enter an amount greater than zero.');
  return a;
}

export const PAYMENT_TYPES = ['cash', 'upi'];
export const paymentLabel = (p) => (p === 'cash' ? 'Cash' : p === 'upi' ? 'UPI' : '');

// Payment type is mandatory on every new or edited entry.
function checkPayment(payment) {
  if (!PAYMENT_TYPES.includes(payment)) throw new Error('Choose a payment type: Cash or UPI.');
  return payment;
}

// Profit is optional. Blank -> null. Otherwise a number from 0 up to the amount.
function checkProfit(profit, amount) {
  if (profit === undefined || profit === null || String(profit).trim() === '') return null;
  const p = round2(String(profit).replace(/,/g, ''));
  if (Number.isNaN(p) || p < 0) throw new Error('Profit must be a number, zero or more.');
  if (p > amount) throw new Error('Profit cannot be more than the amount.');
  return p;
}

// kind: 'credit' | 'debit' (plain)  |  'from' (borrowed: credit here, debit on other)
//       | 'to' (lent: debit here, credit on other)
export function addEntry(
  state,
  { kind, sourceId, otherId, amount, date, note, payment, profit, settlement = false }
) {
  const amt = checkAmount(amount);
  const pay = checkPayment(payment);
  const iso = new Date(date).toISOString();
  const noteText = (note || '').trim();

  if (kind === 'credit' || kind === 'debit') {
    const tx = { id: uid(), type: kind, sourceId, amount: amt, date: iso, note: noteText, payment: pay };
    const pr = checkProfit(profit, amt);
    if (pr !== null) tx.profit = pr;
    return { ...state, transactions: [...state.transactions, tx] };
  }

  if (kind !== 'from' && kind !== 'to') throw new Error('Unknown entry type.');
  if (!otherId) throw new Error('Choose the other source.');
  if (otherId === sourceId) throw new Error('Choose a different source.');

  const transferId = uid();
  const mine = kind === 'from' ? 'credit' : 'debit';
  const theirs = kind === 'from' ? 'debit' : 'credit';
  const base = { amount: amt, date: iso, note: noteText, payment: pay, transferId, settlement };
  const legs = [
    { id: uid(), type: mine, sourceId, counterId: otherId, ...base },
    { id: uid(), type: theirs, sourceId: otherId, counterId: sourceId, ...base },
  ];
  return { ...state, transactions: [...state.transactions, ...legs] };
}

// Edit a plain entry (type, amount, date, note) or a transfer (amount, date, note on both legs).
export function editEntry(state, id, { type, amount, date, note, payment, profit }) {
  const target = state.transactions.find((t) => t.id === id);
  if (!target) throw new Error('Entry not found.');
  const amt = checkAmount(amount);
  const pay = checkPayment(payment);
  const iso = new Date(date).toISOString();
  const noteText = (note || '').trim();
  const pr = target.transferId ? null : checkProfit(profit, amt);

  const transactions = state.transactions.map((t) => {
    if (target.transferId) {
      if (t.transferId !== target.transferId) return t;
      return { ...t, amount: amt, date: iso, note: noteText, payment: pay };
    }
    if (t.id !== id) return t;
    const next = { ...t, type: type || t.type, amount: amt, date: iso, note: noteText, payment: pay };
    if (pr === null) delete next.profit;
    else next.profit = pr;
    return next;
  });
  return { ...state, transactions };
}

// Deleting one leg of a transfer removes both legs.
export function deleteEntry(state, id) {
  const target = state.transactions.find((t) => t.id === id);
  if (!target) return state;
  return {
    ...state,
    transactions: state.transactions.filter((t) =>
      target.transferId ? t.transferId !== target.transferId : t.id !== id
    ),
  };
}

// Settle `amount` of what is outstanding between sourceId and counterId.
//   If the source owes (net > 0): debit on this source, credit on the other.
//   If the other owes (net < 0): credit on this source, debit on the other.
// The amount can be lowered for a part payment but not raised above the outstanding amount.
export function settle(state, { sourceId, counterId, amount, date, note, payment }) {
  const net = netWith(state.transactions, sourceId, counterId);
  if (Math.abs(net) < TOLERANCE) throw new Error('Nothing is outstanding.');
  const amt = checkAmount(amount);
  if (amt > Math.abs(net) + TOLERANCE) {
    throw new Error(`The amount cannot be more than ${fmt(Math.abs(net))}.`);
  }
  return addEntry(state, {
    kind: net > 0 ? 'to' : 'from',
    sourceId,
    otherId: counterId,
    amount: amt,
    date,
    note,
    payment,
    settlement: true,
  });
}

// ---------- backup ----------

export function serialize(state) {
  return JSON.stringify({ app: 'ledger', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2);
}

// Returns a clean state or throws a readable error.
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('This file is not valid JSON.');
  }
  if (!data || !Array.isArray(data.sources) || !Array.isArray(data.transactions)) {
    throw new Error('This file is not a ledger backup.');
  }
  const ids = new Set();
  for (const s of data.sources) {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string') {
      throw new Error('Backup has a broken source.');
    }
    ids.add(s.id);
  }
  for (const t of data.transactions) {
    const ok =
      t &&
      typeof t.id === 'string' &&
      (t.type === 'credit' || t.type === 'debit') &&
      ids.has(t.sourceId) &&
      typeof t.amount === 'number' &&
      t.amount > 0 &&
      !Number.isNaN(new Date(t.date).getTime()) &&
      (!t.counterId || ids.has(t.counterId)) &&
      (t.payment === undefined || PAYMENT_TYPES.includes(t.payment)) &&
      (t.profit === undefined || (typeof t.profit === 'number' && t.profit >= 0));
    if (!ok) throw new Error('Backup has a broken entry.');
  }
  return {
    sources: data.sources.map((s) => ({ id: s.id, name: s.name })),
    transactions: data.transactions,
  };
}

// ---------- wording ----------
// Sentences are returned as { parts, text }. `parts` mixes plain strings and { b } (bold)
// pieces so the screen can bold amounts and source names; `text` is the plain version
// for the PDF, Excel and tests.

const B = (t) => ({ b: String(t) });
const sentence = (...parts) => ({
  parts,
  text: parts.map((p) => (typeof p === 'string' ? p : p.b)).join(''),
});

// 'Borrowed and lent' lines on the source screen.
export function borrowedLentLines(state, sourceId) {
  return outstandingFor(state, sourceId).map(({ counterId, net }) => {
    const name = sourceName(state, counterId);
    return net > 0
      ? sentence(B(fmt(net)), ' is from ', B(name))
      : sentence('You lent ', B(fmt(-net)), ' to ', B(name));
  });
}

// Settle screen lines: 'You owe House \u20B9500.00' / 'Brother owes you \u20B91,000.00'.
export function settleItems(state, sourceId) {
  return outstandingFor(state, sourceId).map(({ counterId, net }) => {
    const name = sourceName(state, counterId);
    const line =
      net > 0
        ? sentence('You owe ', B(name), ' ', B(fmt(net)))
        : sentence(B(name), ' owes you ', B(fmt(-net)));
    return { counterId, amount: Math.abs(net), youOwe: net > 0, line, label: line.text };
  });
}

// Home screen line: 'Shop owes Household \u20B92,000.00'.
export const owedLine = (state, o) =>
  sentence(
    B(sourceName(state, o.debtorId)),
    ' owes ',
    B(sourceName(state, o.creditorId)),
    ' ',
    B(fmt(o.amount))
  );
