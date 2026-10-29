import ExcelJS from 'exceljs';

// THE PARTY STATEMENT AS A REAL .xlsx.
//
// A genuine workbook, not a CSV with a spreadsheet extension: three sheets,
// numeric currency cells (so a reader can sum and filter them), real dates,
// frozen header rows and auto-filters. Every figure is the one the statement
// service computed - this file only lays it out.

// Indian lakh/crore grouping with a rupee sign. Excel renders '#,##,##0.00' as
// 1,00,000.00, which is what an Indian shopkeeper expects.
const CURRENCY = '"₹" #,##,##0.00';
const DATE_FMT = 'yyyy-mm-dd';
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const asDate = (value) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

const STATUS_LABEL = {
  PAID: 'Paid',
  PARTIAL: 'Partial',
  UNPAID: 'Unpaid',
  CREDITED: 'Credited',
  UNUSED: 'Unused',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
};

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = HEAD_FILL;
    cell.alignment = { vertical: 'middle' };
  });
}

function buildStatementSheet(wb, statement) {
  const ws = wb.addWorksheet('Party Statement');
  const c = statement.company;
  const p = statement.party;

  const title = (text, opts = {}) => {
    const row = ws.addRow([text]);
    row.getCell(1).font = { bold: opts.big ?? false, size: opts.size ?? 11 };
    return row;
  };

  title(c.name ?? 'Statement', { big: true, size: 15 });
  if (c.address) title(c.address, { size: 9 });
  const contact = [c.phone, c.email].filter(Boolean).join('  |  ');
  if (contact) title(contact, { size: 9 });
  const gst = [c.gstin ? `GSTIN: ${c.gstin}` : null, c.stateCode ? `State: ${c.stateCode}${c.stateName ? `-${c.stateName}` : ''}` : null].filter(Boolean).join('   ');
  if (gst) title(gst, { size: 9 });
  ws.addRow([]);
  title('Party Statement', { big: true, size: 13 });

  const kv = (k, v) => {
    const row = ws.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  };
  kv('Party name', p.name);
  kv('Contact', p.phone ?? '—');
  kv('Address', p.address ?? '—');
  if (p.gstin) kv('GSTIN', p.gstin);
  kv('Period', statement.period.fromDate || statement.period.toDate
    ? `${statement.period.fromDate ?? 'Start'} to ${statement.period.toDate ?? 'Today'}`
    : 'All transactions');
  kv('Generated', statement.generatedAt.slice(0, 16).replace('T', ' '));
  if (statement.period.fromDate || statement.period.toDate) {
    kv('Opening receivable', num(statement.openingReceivable));
    kv('Opening payable', num(statement.openingPayable));
  }
  ws.addRow([]);

  // "Txn Balance" is the transaction's own amount at posting; "Outstanding (now)"
  // is the document's live open amount - kept in a separate column so the two are
  // never confused, and neither is confused with the running Receivable/Payable.
  const headers = [
    'Date',
    'Type',
    'Ref No.',
    'Status',
    'Total',
    'Received / Paid',
    'Txn Balance',
    'Outstanding (now)',
    'Receivable (running)',
    'Payable (running)',
    // Payment metadata - populated for receipt / payment rows only.
    'Payment Mode',
    'Payment Ref',
    'Allocated',
    'Unused Advance',
    'Notes',
  ];
  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow);
  const headerRowNumber = headerRow.number;

  for (const line of statement.lines) {
    const pay = line.payment;
    const row = ws.addRow([
      asDate(line.date),
      line.label,
      line.documentNumber ?? '—',
      line.paymentStatus ? STATUS_LABEL[line.paymentStatus] ?? line.paymentStatus : '—',
      num(line.total),
      num(line.receivedPaid),
      num(line.txnBalance),
      line.currentOutstanding != null ? num(line.currentOutstanding) : null,
      num(line.receivableBalance),
      num(line.payableBalance),
      pay?.modeLabel ?? null,
      pay?.reference ?? null,
      pay?.allocated != null ? num(pay.allocated) : null,
      pay?.unallocated != null ? num(pay.unallocated) : null,
      pay?.notes ?? null,
    ]);
    row.getCell(1).numFmt = DATE_FMT;
    for (const col of [5, 6, 7, 8, 9, 10, 13, 14]) row.getCell(col).numFmt = CURRENCY;
  }

  // A totals line under the ledger, so the sheet foots up on inspection.
  const totals = ws.addRow([
    'Closing', '', '', '',
    '', '', '', '',
    num(statement.summary.closingReceivable),
    num(statement.summary.closingPayable),
  ]);
  totals.font = { bold: true };
  totals.getCell(9).numFmt = CURRENCY;
  totals.getCell(10).numFmt = CURRENCY;

  ws.columns = [
    { width: 13 }, { width: 15 }, { width: 18 }, { width: 11 },
    { width: 15 }, { width: 16 }, { width: 15 }, { width: 16 }, { width: 18 }, { width: 18 },
    { width: 14 }, { width: 16 }, { width: 14 }, { width: 15 }, { width: 24 },
  ];
  ws.views = [{ state: 'frozen', ySplit: headerRowNumber }];
  ws.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: headers.length },
  };
}

function buildLineItemsSheet(wb, statement) {
  const ws = wb.addWorksheet('Line Items');
  const headers = ['Document Date', 'Document Type', 'Document No.', 'S.No', 'Item', 'HSN/SAC', 'Qty', 'Price/Unit', 'Discount', 'Tax', 'Amount'];
  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow);

  for (const line of statement.lines) {
    const items = line.document?.items;
    if (!items || items.length === 0) continue;
    for (const it of items) {
      const row = ws.addRow([
        asDate(line.date),
        line.label,
        line.documentNumber ?? '—',
        it.sno,
        it.name,
        it.hsn ?? '—',
        `${it.quantity}${it.unit ? ` ${it.unit}` : ''}`,
        num(it.unitPrice),
        it.discount != null ? num(it.discount) : 0,
        it.tax != null ? num(it.tax) : 0,
        num(it.amount),
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      for (const col of [8, 9, 10, 11]) row.getCell(col).numFmt = CURRENCY;
    }
  }

  ws.columns = [
    { width: 14 }, { width: 15 }, { width: 18 }, { width: 6 }, { width: 30 },
    { width: 12 }, { width: 10 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 14 },
  ];
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function buildSummarySheet(wb, statement) {
  const ws = wb.addWorksheet('Summary');
  const s = statement.summary;
  const c = statement.company;
  const p = statement.party;

  const label = (text) => {
    const row = ws.addRow([text]);
    row.getCell(1).font = { bold: true, size: 11 };
  };
  const kv = (k, v, currency = false) => {
    const row = ws.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    if (currency) row.getCell(2).numFmt = CURRENCY;
  };

  label('Business');
  kv('Name', c.name ?? '—');
  if (c.gstin) kv('GSTIN', c.gstin);
  ws.addRow([]);
  label('Party');
  kv('Name', p.name);
  kv('Contact', p.phone ?? '—');
  kv('Relationship', p.relationship);
  ws.addRow([]);
  label('Period');
  kv('From', statement.period.fromDate ?? 'Start');
  kv('To', statement.period.toDate ?? 'Today');
  kv('Transactions', s.entryCount);
  ws.addRow([]);
  label('Balances');
  kv('Opening receivable', num(statement.openingReceivable), true);
  kv('Opening payable', num(statement.openingPayable), true);
  kv('Total sales', num(s.totalSales), true);
  kv('Total received', num(s.totalReceived), true);
  kv('Total purchases', num(s.totalPurchases), true);
  kv('Total paid', num(s.totalPaid), true);
  if (Number(s.totalSalesReturns)) kv('Sales returns', num(s.totalSalesReturns), true);
  if (Number(s.totalPurchaseReturns)) kv('Purchase returns', num(s.totalPurchaseReturns), true);
  kv('Closing receivable (they owe you)', num(s.closingReceivable), true);
  kv('Closing payable (you owe them)', num(s.closingPayable), true);
  if (Number(s.customerAdvance)) kv('Advance held from them', num(s.customerAdvance), true);
  if (Number(s.supplierAdvance)) kv('Advance paid to them', num(s.supplierAdvance), true);

  ws.columns = [{ width: 34 }, { width: 20 }];
}

/**
 * Renders the statement to an .xlsx Buffer with three sheets.
 *
 * @param {object} statement  the shape returned by getPartyStatement
 * @returns {Promise<Buffer>}
 */
export async function renderStatementXlsx(statement) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Byapar';
  wb.created = new Date();

  buildStatementSheet(wb, statement);
  buildLineItemsSheet(wb, statement);
  buildSummarySheet(wb, statement);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
