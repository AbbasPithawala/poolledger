// Report building for PDF and Excel export (project brief, section 9).
// Pure functions: the file writing / sharing lives in App.js.
import {
  borrowedLentLines,
  fmt,
  fmtDate,
  fmtPlain,
  fmtTime,
  ledgerRows,
  paymentLabel,
  round2,
  sourceName,
  totalProfit,
  totals,
} from './ledger.js';

// `filter` ('all' | 'cash' | 'upi') is the same filter as on the screen: the balance, credit/debit
// and profit summary, the table and its totals row all cover only the entries with that payment type.
export function buildReport(state, sourceId, exportDate = new Date(), filter = 'all') {
  const t = totals(state.transactions, sourceId, filter);
  const rows = ledgerRows(state, sourceId, filter).map((r) => ({
    ...r,
    paymentText: paymentLabel(r.payment),
    dateText: `${fmtDate(r.date)} ${fmtTime(r.date)}`,
    sourceText: r.other ? (r.settlement ? `${r.other} (settlement)` : r.other) : '',
  }));
  return {
    name: sourceName(state, sourceId),
    exportedOn: `${fmtDate(exportDate.toISOString())} ${fmtTime(exportDate.toISOString())}`,
    balance: t.balance,
    credit: t.credit,
    debit: t.debit,
    profit: totalProfit(state.transactions, sourceId, filter),
    lines: borrowedLentLines(state, sourceId).map((l) => l.text),
    filterText: filter === 'all' ? '' : paymentLabel(filter),
    rows,
    shownCredit: round2(rows.reduce((s, r) => s + (r.credit || 0), 0)),
    shownDebit: round2(rows.reduce((s, r) => s + (r.debit || 0), 0)),
    shownProfit: round2(rows.reduce((s, r) => s + (r.profit || 0), 0)),
  };
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildHtml(report) {
  const body = report.rows
    .map(
      (r) => `<tr>
  <td>${esc(r.dateText)}${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}</td>
  <td class="num cr">${r.credit != null ? fmtPlain(r.credit) : ''}</td>
  <td class="num dr">${r.debit != null ? fmtPlain(r.debit) : ''}</td>
  <td>${esc(r.sourceText)}</td>
  <td>${esc(r.paymentText)}</td>
  <td class="num">${r.profit != null ? fmtPlain(r.profit) : ''}</td>
</tr>`
    )
    .join('\n');
  const lines = report.lines.length
    ? `<ul>${report.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body { font-family: Roboto, Arial, sans-serif; color: #202124; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #5F6368; font-size: 12px; }
  .summary { margin: 14px 0; font-size: 13px; }
  .summary div { margin: 2px 0; }
  ul { margin: 6px 0 0; padding-left: 18px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
  th { background: #F1F3F4; text-align: left; padding: 8px; border: 1px solid #DADCE0; }
  td { padding: 8px; border: 1px solid #DADCE0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  th.num { text-align: right; }
  .cr { color: #188038; } .dr { color: #D93025; }
  .note { color: #5F6368; font-size: 10px; margin-top: 2px; }
  tfoot td { font-weight: bold; background: #F8F9FA; }
</style></head><body>
<h1>${esc(report.name)}</h1>
<div class="muted">Exported ${esc(report.exportedOn)}${report.filterText ? ` &middot; Showing ${esc(report.filterText)} entries only` : ''}</div>
<div class="summary">
  <div>Balance: <b>${fmt(report.balance)}</b></div>
  <div>Total credit: ${fmt(report.credit)}</div>
  <div>Total debit: ${fmt(report.debit)}</div>
  ${report.profit > 0 ? `<div>Total profit: ${fmt(report.profit)}</div>` : ''}
  ${lines}
</div>
<table>
  <thead><tr><th>Date and time</th><th class="num">Credit</th><th class="num">Debit</th><th>Source</th><th>Payment</th><th class="num">Profit</th></tr></thead>
  <tbody>
${body}
  </tbody>
  <tfoot><tr><td>Total</td><td class="num cr">${fmtPlain(report.shownCredit)}</td><td class="num dr">${fmtPlain(report.shownDebit)}</td><td></td><td></td><td class="num">${fmtPlain(report.shownProfit)}</td></tr></tfoot>
</table>
</body></html>`;
}

// Array-of-arrays for the xlsx library. Amounts are real numbers, not text.
export function buildSheetRows(report) {
  const aoa = [
    ['Source', report.name],
    ['Exported', report.exportedOn],
    ...(report.filterText ? [['Showing', `${report.filterText} entries only`]] : []),
    ['Balance', report.balance],
    ['Total credit', report.credit],
    ['Total debit', report.debit],
    ...(report.profit > 0 ? [['Total profit', report.profit]] : []),
  ];
  for (const l of report.lines) aoa.push(['', l]);
  aoa.push([]);
  const headerRow = aoa.length;
  aoa.push(['Date and time', 'Credit', 'Debit', 'Source', 'Payment', 'Profit', 'Note']);
  for (const r of report.rows) {
    aoa.push([r.dateText, r.credit, r.debit, r.sourceText, r.paymentText, r.profit, r.note]);
  }
  aoa.push(['Total', report.shownCredit, report.shownDebit, '', '', report.shownProfit, '']);
  return { aoa, headerRow };
}
