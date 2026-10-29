import { describe, it, expect } from 'vitest';
import { renderStatementPdf, formatInr } from '../../src/modules/parties/party-statement.pdf.js';
import { renderStatementXlsx } from '../../src/modules/parties/party-statement.xlsx.js';

// Renderer-level tests: the export builders are pure (statement object -> bytes),
// so a long statement can be checked for multi-page output and Indian currency
// formatting without standing up the database.

function syntheticStatement(lineCount) {
  const lines = [];
  let receivable = 0;
  for (let i = 0; i < lineCount; i += 1) {
    const total = 1000 + i * 37;
    receivable += total;
    lines.push({
      date: '2026-09-01',
      side: 'customer',
      entryType: 'SALE',
      kind: 'SALE',
      label: 'Sale',
      documentId: `d${i}`,
      documentNumber: `INV-2026-${String(i).padStart(6, '0')}`,
      referenceType: 'SALES_INVOICE',
      reference: null,
      dueDate: null,
      paymentMethod: null,
      paymentStatus: 'UNPAID',
      total: total.toFixed(2),
      receivedPaid: '0.00',
      txnBalance: total.toFixed(2),
      currentOutstanding: total.toFixed(2),
      debit: total.toFixed(2),
      credit: '0.00',
      receivableBalance: receivable.toFixed(2),
      payableBalance: '0.00',
      document: {
        subtotal: total.toFixed(2),
        discount: null,
        tax: '0.00',
        total: total.toFixed(2),
        outstanding: total.toFixed(2),
        paid: '0.00',
        items: [
          { sno: 1, name: 'Glutathione capsules 1000mg (large pack)', hsn: '3004', unit: 'PCS', quantity: '15', unitPrice: '1500.00', discount: null, tax: '0.00', amount: '22500.00' },
          { sno: 2, name: 'Vitamin C Capsules 1000mg', hsn: null, unit: 'PCS', quantity: '15', unitPrice: '300.00', discount: null, tax: '0.00', amount: '4500.00' },
        ],
        allocations: null,
      },
    });
  }
  // A couple of payment rows so the payment-metadata rendering path is covered.
  lines.push({
    date: '2026-09-15', side: 'customer', entryType: 'PAYMENT', kind: 'RECEIPT', label: 'Payment In',
    documentId: 'pay1', documentNumber: 'RCP-2026-000001', referenceType: 'CUSTOMER_PAYMENT', reference: 'UPI-77',
    dueDate: null, paymentMethod: 'UPI',
    payment: { mode: 'UPI', modeLabel: 'UPI', reference: 'UPI-77', notes: 'Advance for next order', allocated: '5000.00', unallocated: '2000.00', allocations: [{ documentNumber: 'INV-2026-000001', amount: '5000.00' }] },
    paymentStatus: 'UNUSED', total: '7000.00', receivedPaid: '7000.00', txnBalance: '2000.00', currentOutstanding: null,
    debit: '0.00', credit: '7000.00', receivableBalance: receivable.toFixed(2), payableBalance: '0.00', document: null,
  });

  return {
    party: { id: 'p1', name: 'Long Statement Party', contactPerson: null, phone: '9000000000', email: null, address: 'Somewhere', gstin: null, stateCode: null, relationship: 'BOTH', customerId: 'c1', supplierId: 's1' },
    company: { name: 'Demo Co', legalName: null, address: 'Addr', phone: '1', email: null, gstin: null, stateCode: null, stateName: null },
    period: { fromDate: null, toDate: null, label: 'All transactions' },
    filters: { type: 'ALL', search: null, includeItems: true },
    generatedAt: new Date().toISOString(),
    openingReceivable: '0.00',
    openingPayable: '0.00',
    lines,
    summary: {
      closingReceivable: receivable.toFixed(2),
      closingPayable: '0.00',
      customerAdvance: '0.00',
      supplierAdvance: '0.00',
      totalSales: receivable.toFixed(2),
      totalReceived: '0.00',
      totalPurchases: '0.00',
      totalPaid: '0.00',
      totalSalesReturns: '0.00',
      totalPurchaseReturns: '0.00',
      entryCount: lineCount,
      shownCount: lineCount,
    },
    basis: 'test basis',
  };
}

/** Count page objects in a PDF (every page dict is `/Type /Page`, not `/Pages`). */
function pdfPageCount(buffer) {
  const text = buffer.toString('latin1');
  return (text.match(/\/Type\s*\/Page(?![s])/g) || []).length;
}

describe('party statement PDF renderer', () => {
  it('formats money in Indian grouping with the rupee sign', () => {
    expect(formatInr('103065')).toBe('₹ 1,03,065.00');
    expect(formatInr('2500.5')).toBe('₹ 2,500.50');
    expect(formatInr('100')).toBe('₹ 100.00');
  });

  it('produces a valid, multi-page PDF for a long statement', async () => {
    const pdf = await renderStatementPdf(syntheticStatement(60));
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
    expect(pdfPageCount(pdf)).toBeGreaterThanOrEqual(2);
  });

  it('produces a valid .xlsx for a long statement', async () => {
    const xlsx = await renderStatementXlsx(syntheticStatement(60));
    expect(xlsx.slice(0, 2).toString()).toBe('PK');
    expect(xlsx.length).toBeGreaterThan(2000);
  });
});
