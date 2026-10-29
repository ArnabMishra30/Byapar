import PdfPrinter from 'pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts.js';

// THE PARTY STATEMENT AS A REAL PDF.
//
// A traditional accounting statement, built from the statement service's own
// data with pdfmake - a document, not a screenshot. The layout follows the
// Vyapar-style reference: a logo + business block, a centred underlined title,
// a full-width ledger with a grey header, item-detail tables tucked under each
// sale/purchase/return, and a closing summary. pdfmake repeats the table header
// on every page (`headerRows`), keeps rows whole across breaks, and numbers the
// pages in the footer.
//
// Fonts are Roboto, decoded from the copy pdfmake ships for its browser build.
// Roboto carries the ₹ glyph, so Indian currency prints correctly with no font
// files to vendor. The "logo" is a monogram badge drawn from the business name
// (the Company model has no logo image field yet).

const vfs = vfsFonts.default ?? vfsFonts;
const fonts = {
  Roboto: {
    normal: Buffer.from(vfs['Roboto-Regular.ttf'], 'base64'),
    bold: Buffer.from(vfs['Roboto-Medium.ttf'], 'base64'),
    italics: Buffer.from(vfs['Roboto-Italic.ttf'], 'base64'),
    bolditalics: Buffer.from(vfs['Roboto-MediumItalic.ttf'], 'base64'),
  },
};
const printer = new PdfPrinter(fonts);

const INK = '#1f2937';
const GREY = '#6b7280';
const LINE = '#cbd5e1';
const HEAD_BG = '#e5e9f0';
const BADGE = '#334155';

/** A money string like "103065.00" as "₹ 1,03,065.00" with Indian grouping. */
function inr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value == null ? '' : String(value);
  const negative = n < 0;
  const [whole, frac] = Math.abs(n).toFixed(2).split('.');
  let grouped = whole;
  if (whole.length > 3) {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  }
  return `${negative ? '-' : ''}₹ ${grouped}.${frac}`;
}

const STATUS_LABEL = {
  PAID: 'Paid',
  PARTIAL: 'Partial',
  UNPAID: 'Unpaid',
  CREDITED: 'Credited',
  UNUSED: 'Unused',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
};

const dash = (value) => (value == null || value === '' ? '—' : value);
const hasValue = (value) => value != null && Number(value) !== 0;
const trimQty = (value) => String(Number(Number(value || 0).toFixed(3)));

/** A monogram badge from the business name - stands in for a configured logo. */
function monogram(name) {
  const initials =
    (name || 'B')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || 'B';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46">`,
    `<circle cx="23" cy="23" r="22" fill="${BADGE}"/>`,
    `<text x="23" y="30" font-size="17" font-weight="bold" fill="#ffffff" text-anchor="middle" font-family="Roboto">${initials}</text>`,
    `</svg>`,
  ].join('');
}

/** The item detail for one document, styled like the reference's sub-table. */
function itemsBlock(line) {
  const items = line.document?.items;
  if (!items || items.length === 0) return null;
  const doc = line.document;

  // The reference shows a compact 6-column item table; Discount and Tax columns
  // appear only when the document actually carries them (a GST shop), so a
  // non-GST statement reads exactly like the reference.
  const showDiscount = items.some((it) => hasValue(it.discount)) || hasValue(doc.discount);
  const showTax = items.some((it) => hasValue(it.tax)) || hasValue(doc.tax);

  const cols = [
    { key: 'sno', head: '#', align: 'left', width: 16 },
    { key: 'name', head: 'Item name', align: 'left', width: '*' },
    { key: 'hsn', head: 'HSN/SAC', align: 'left', width: 54 },
    { key: 'qty', head: 'Quantity', align: 'right', width: 54 },
    { key: 'price', head: 'Price/unit', align: 'right', width: 62 },
    ...(showDiscount ? [{ key: 'disc', head: 'Discount', align: 'right', width: 54 }] : []),
    ...(showTax ? [{ key: 'tax', head: 'Tax', align: 'right', width: 50 }] : []),
    { key: 'amount', head: 'Amount', align: 'right', width: 68 },
  ];
  const n = cols.length;

  const cell = (text, style, align) => ({ text, style, alignment: align });
  const header = cols.map((c) => cell(c.head, 'itemHead', c.align));

  const body = items.map((it) =>
    cols.map((c) => {
      switch (c.key) {
        case 'sno':
          return cell(String(it.sno), 'item', 'left');
        case 'name':
          return cell(dash(it.name), 'itemName', 'left');
        case 'hsn':
          return cell(dash(it.hsn), 'item', 'left');
        case 'qty':
          return cell(`${trimQty(it.quantity)}${it.unit ? ` ${it.unit}` : ''}`, 'item', 'right');
        case 'price':
          return cell(inr(it.unitPrice), 'item', 'right');
        case 'disc':
          return cell(hasValue(it.discount) ? inr(it.discount) : '—', 'item', 'right');
        case 'tax':
          return cell(hasValue(it.tax) ? inr(it.tax) : '—', 'item', 'right');
        case 'amount':
          return cell(inr(it.amount), 'item', 'right');
        default:
          return cell('', 'item', 'left');
      }
    }),
  );

  const qtyTotal = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
  const lineSum = items.reduce((sum, it) => sum + Number(it.amount || 0), 0);

  // "Total" row: the quantity total and the line-amount total, bold, ruled off.
  const totalRow = cols.map((c) => {
    const base = { border: [false, true, false, false], style: 'itemFoot' };
    if (c.key === 'name') return { ...base, text: 'Total', alignment: 'left' };
    if (c.key === 'qty') return { ...base, text: trimQty(qtyTotal), alignment: 'right' };
    if (c.key === 'amount') return { ...base, text: inr(lineSum), alignment: 'right' };
    return { ...base, text: '' };
  });

  const spanRow = (label, value, strong) => {
    const row = new Array(n).fill(null).map(() => ({ text: '', border: [false, false, false, false] }));
    row[0] = {
      text: label,
      colSpan: n - 1,
      alignment: 'right',
      style: strong ? 'itemFoot' : 'item',
      border: [false, false, false, false],
    };
    row[n - 1] = {
      text: inr(value),
      alignment: 'right',
      style: strong ? 'itemFoot' : 'item',
      border: [false, false, false, false],
    };
    return row;
  };

  const footRows = [totalRow, spanRow('Sub Total', doc.subtotal ?? lineSum, false)];
  if (hasValue(doc.tax)) footRows.push(spanRow('Tax', doc.tax, false));
  if (doc.total != null && Number(doc.total) !== Number(doc.subtotal ?? lineSum)) {
    footRows.push(spanRow('Grand Total', doc.total, true));
  }

  const table = {
    table: {
      headerRows: 1,
      widths: cols.map((c) => c.width),
      body: [header, ...body, ...footRows],
    },
    layout: {
      hLineWidth: (i) => (i <= 1 ? 0.5 : 0.25),
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      paddingTop: () => 2,
      paddingBottom: () => 2,
      paddingLeft: () => 3,
      paddingRight: () => 3,
    },
  };

  // The item table only - no editorial notes between rows, so the ledger reads
  // as one continuous day-to-day run of transactions, like the reference. The
  // document's live outstanding stays in the web view and the Excel export.
  return { colSpan: 9, margin: [16, 3, 2, 8], table: table.table, layout: table.layout };
}

/** A payment's method, reference, notes and allocation, shown beneath its row. */
function paymentMetaBlock(line) {
  const p = line.payment;
  if (!p) return null;

  const lines = [];
  const head = [`Payment mode: ${p.modeLabel ?? 'Not specified'}`];
  if (p.reference) head.push(`Reference: ${p.reference}`);
  lines.push(head.join('      '));

  const money = [];
  if (p.allocated != null && Number(p.allocated) > 0) money.push(`Allocated to invoices: ${inr(p.allocated)}`);
  if (p.unallocated != null && Number(p.unallocated) > 0) money.push(`Unused advance: ${inr(p.unallocated)}`);
  if (money.length) lines.push(money.join('      '));

  const allocated = (p.allocations ?? []).filter((a) => a.documentNumber);
  if (allocated.length) {
    lines.push(`Against: ${allocated.map((a) => `${a.documentNumber} ${inr(a.amount)}`).join(',  ')}`);
  }
  if (p.notes) lines.push(`Notes: ${p.notes}`);

  return {
    colSpan: 9,
    margin: [16, 1, 2, 5],
    stack: lines.map((text) => ({ text, style: 'paymentMeta' })),
  };
}

/** The main ledger table body: a header row, then each transaction (+ items). */
function ledgerBody(statement) {
  const header = [
    'Date',
    'Txn Type',
    'Ref No.',
    'Payment Status',
    'Total',
    'Received / Paid',
    'Txn Balance',
    'Receivable Balance',
    'Payable Balance',
  ].map((text, i) => ({ text, style: 'th', alignment: i >= 4 ? 'right' : 'left' }));

  const body = [header];

  for (const line of statement.lines) {
    body.push([
      { text: dash(line.date), style: 'td', noWrap: true },
      { text: line.label, style: 'tdBold' },
      { text: dash(line.documentNumber), style: 'td', noWrap: true },
      { text: line.paymentStatus ? STATUS_LABEL[line.paymentStatus] ?? line.paymentStatus : '—', style: 'td' },
      { text: inr(line.total), style: 'numBold', alignment: 'right' },
      // Always a figure (₹0.00 on an invoice/bill), as the reference shows it.
      { text: inr(line.receivedPaid), style: 'num', alignment: 'right' },
      { text: inr(line.txnBalance), style: 'num', alignment: 'right' },
      { text: inr(line.receivableBalance), style: 'numBold', alignment: 'right' },
      { text: inr(line.payableBalance), style: 'numBold', alignment: 'right' },
    ]);
    const items = itemsBlock(line);
    if (items) body.push([items, {}, {}, {}, {}, {}, {}, {}, {}]);
    // A payment's method, reference and allocation sit immediately beneath it,
    // before the next dated transaction - as in the reference.
    const meta = paymentMetaBlock(line);
    if (meta) body.push([meta, {}, {}, {}, {}, {}, {}, {}, {}]);
  }

  if (statement.lines.length === 0) {
    body.push([
      { text: 'No transactions in this period.', colSpan: 9, style: 'td', alignment: 'center', margin: [0, 10, 0, 10] },
      {}, {}, {}, {}, {}, {}, {}, {},
    ]);
  }

  return body;
}

function businessHeader(statement) {
  const c = statement.company;
  const meta = [];
  if (c.address) meta.push({ text: c.address, style: 'meta', alignment: 'right' });
  const contact = [c.phone ? `Phone: ${c.phone}` : null, c.email ? `Email: ${c.email}` : null]
    .filter(Boolean)
    .join('   ');
  if (contact) meta.push({ text: contact, style: 'meta', alignment: 'right' });
  const gst = [
    c.gstin ? `GSTIN: ${c.gstin}` : null,
    c.stateCode ? `State: ${c.stateCode}${c.stateName ? `-${c.stateName}` : ''}` : null,
  ]
    .filter(Boolean)
    .join('   ');
  if (gst) meta.push({ text: gst, style: 'meta', alignment: 'right' });

  return {
    columns: [
      { width: 48, svg: monogram(c.name), fit: [46, 46] },
      {
        width: '*',
        stack: [{ text: c.name ?? 'Statement', style: 'company', alignment: 'right' }, ...meta],
      },
    ],
    columnGap: 10,
    margin: [0, 0, 0, 6],
  };
}

function partyBlock(statement) {
  const p = statement.party;
  const period =
    statement.period.fromDate || statement.period.toDate
      ? `${statement.period.fromDate ?? 'Start'} to ${statement.period.toDate ?? 'Today'}`
      : 'All transactions';

  const line = (label, value, strong = false) => ({
    columns: [
      { width: 74, text: `${label}:`, style: 'kvKey' },
      { width: '*', text: String(value), style: strong ? 'kvStrong' : 'kv' },
    ],
    columnGap: 4,
  });

  const rows = [
    line('Party name', p.name, true),
    line('Contact No.', p.phone ?? '—'),
    line('Address', p.address ?? '—'),
  ];
  if (p.gstin) rows.push(line('GSTIN', p.gstin));
  rows.push(line('Period', period));
  rows.push(line('Generated', statement.generatedAt.slice(0, 16).replace('T', ' ')));

  return { stack: rows, margin: [0, 0, 0, 8] };
}

function summaryBlock(statement) {
  const s = statement.summary;
  const pair = (label, value, strong = false) => [
    { text: label, style: strong ? 'sumKeyStrong' : 'sumKey' },
    { text: inr(value), style: strong ? 'sumValStrong' : 'sumVal', alignment: 'right' },
  ];
  const body = [
    pair('Total sales', s.totalSales),
    pair('Total received', s.totalReceived),
    pair('Total purchases', s.totalPurchases),
    pair('Total paid', s.totalPaid),
  ];
  if (Number(s.totalSalesReturns)) body.push(pair('Sales returns', s.totalSalesReturns));
  if (Number(s.totalPurchaseReturns)) body.push(pair('Purchase returns', s.totalPurchaseReturns));
  body.push(pair('Receivable (they owe you)', s.closingReceivable, true));
  body.push(pair('Payable (you owe them)', s.closingPayable, true));
  if (Number(s.customerAdvance)) body.push(pair('Advance held from them', s.customerAdvance));
  if (Number(s.supplierAdvance)) body.push(pair('Advance paid to them', s.supplierAdvance));

  return {
    unbreakable: true,
    columns: [
      { width: '*', text: '' },
      {
        width: 270,
        table: { widths: ['*', 'auto'], body },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.9 : 0.3),
          vLineWidth: () => 0,
          hLineColor: () => LINE,
          paddingTop: () => 3.5,
          paddingBottom: () => 3.5,
          paddingLeft: () => 6,
          paddingRight: () => 6,
        },
      },
    ],
    margin: [0, 14, 0, 0],
  };
}

/**
 * Renders the statement to a PDF Buffer.
 *
 * @param {object} statement  the shape returned by getPartyStatement
 * @returns {Promise<Buffer>}
 */
export function renderStatementPdf(statement) {
  const windowed = Boolean(statement.period.fromDate || statement.period.toDate);

  const docDefinition = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [22, 30, 22, 40],
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: INK, lineHeight: 1.12 },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: 'Party statement', style: 'footer', margin: [22, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, style: 'footer', alignment: 'right', margin: [0, 0, 22, 0] },
      ],
    }),
    content: [
      businessHeader(statement),
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 551, y2: 0, lineWidth: 1, lineColor: LINE }], margin: [0, 0, 0, 10] },
      { text: 'Party Statement', style: 'title', alignment: 'center' },
      partyBlock(statement),
      windowed
        ? {
            text: `Opening balance — Receivable: ${inr(statement.openingReceivable)}      Payable: ${inr(statement.openingPayable)}`,
            style: 'opening',
            margin: [0, 0, 0, 7],
          }
        : null,
      {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: [54, 48, '*', 42, 56, 52, 54, 58, 58],
          body: ledgerBody(statement),
        },
        layout: {
          fillColor: (rowIndex) => (rowIndex === 0 ? HEAD_BG : null),
          hLineWidth: (i) => (i <= 1 ? 0.7 : 0.4),
          vLineWidth: () => 0,
          hLineColor: () => LINE,
          paddingTop: () => 4.5,
          paddingBottom: () => 4.5,
          paddingLeft: () => 3,
          paddingRight: () => 3,
        },
      },
      summaryBlock(statement),
    ].filter(Boolean),
    styles: {
      company: { fontSize: 16, bold: true, color: INK },
      title: { fontSize: 17, bold: true, decoration: 'underline', margin: [0, 2, 0, 10] },
      meta: { fontSize: 8.5, color: GREY, lineHeight: 1.2 },
      kvKey: { fontSize: 9, bold: true, color: INK },
      kv: { fontSize: 9, color: INK },
      kvStrong: { fontSize: 12, bold: true, color: INK },
      opening: { fontSize: 9, bold: true, color: GREY },
      th: { fontSize: 8, bold: true, color: '#111827' },
      td: { fontSize: 8, color: INK },
      tdBold: { fontSize: 8, bold: true, color: INK },
      // Money columns a touch smaller, so even a ₹-crore running balance fits
      // its column in portrait without clipping or wrapping.
      num: { fontSize: 7.5, color: INK },
      numBold: { fontSize: 7.5, bold: true, color: INK },
      itemHead: { fontSize: 8, bold: true, color: '#111827' },
      item: { fontSize: 8, color: '#374151' },
      itemName: { fontSize: 8, bold: true, color: INK },
      itemFoot: { fontSize: 8, bold: true, color: INK },
      paymentMeta: { fontSize: 7.5, color: '#475569' },
      outstanding: { fontSize: 7.8, italics: true, color: GREY },
      sumKey: { fontSize: 9 },
      sumVal: { fontSize: 9 },
      sumKeyStrong: { fontSize: 10.5, bold: true },
      sumValStrong: { fontSize: 10.5, bold: true },
      footer: { fontSize: 7.5, color: GREY },
      legend: { fontSize: 7.2, color: GREY, italics: true },
    },
  };

  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export { inr as formatInr };
