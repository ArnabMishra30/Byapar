import { add, subtract, round, toDecimal, toMoneyString, isZero } from '../../utils/money.js';
import * as gstReturnRepository from './gst-return.repository.js';
import * as journalRepository from '../accounting/journal.repository.js';
import * as accountRepository from '../accounting/account.repository.js';
import { SYSTEM_ACCOUNT } from '../accounting/system-accounts.js';
import { deriveAccountBalance } from '../accounting/journal.service.js';
import {
  toReturnRow,
  sumRows,
  groupRows,
  componentDifference,
  addTotals,
  subtractTotals,
  emptyTotals,
  rateKey,
  hsnKey,
  placeOfSupplyKey,
  toBusinessDate,
} from './gst-return.dataset.js';
import { buildGstr1 } from './gstr1.service.js';
import { buildGstr3b } from './gstr3b.service.js';

// Does the return dataset actually agree with the documents it claims to
// summarise, and with the ledger those documents posted into?
//
// Every check compares two figures that were arrived at DIFFERENT WAYS. Comparing
// a number with itself proves nothing, so:
//
//   line rows        vs  document header columns   (does a document agree with its own lines)
//   grouped totals   vs  ungrouped totals          (did grouping lose anything)
//   dataset totals   vs  source documents          (does the return agree with the books)
//   dataset totals   vs  GL tax control accounts   (does the return agree with the ledger)
//
// A failing check is REPORTED, not thrown. A reconciliation endpoint that refuses
// to answer when something is wrong is useless precisely when it is needed.

const DISPLAY_DP = 2;
/** The precision amounts are actually stored at. */
const STORAGE_DP = 4;

/**
 * One comparison, with both sides and the difference shown.
 *
 * BOTH SIDES ARE ROUNDED TO THE SAME PRECISION before differencing. That matters:
 * the datasets publish 2 dp strings while the sources are full-precision
 * Decimals, and a tax component can legitimately hold 4 dp. Differencing a
 * rounded value against an unrounded one would report a false mismatch of a
 * fraction of a paisa on every check.
 *
 * Comparisons between two Decimals use STORAGE_DP, so a real sub-paisa
 * discrepancy is still caught. Comparisons against a published dataset value use
 * DISPLAY_DP, and the loss between the two precisions is reported by its own
 * check rather than smeared across all of them.
 */
function compare(name, description, expected, actual, { dp = DISPLAY_DP } = {}) {
  const left = round(toDecimal(expected ?? 0), dp);
  const right = round(toDecimal(actual ?? 0), dp);
  const difference = subtract(left, right);

  return {
    check: name,
    description,
    comparedAtDecimalPlaces: dp,
    expected: toMoneyString(left, DISPLAY_DP),
    actual: toMoneyString(right, DISPLAY_DP),
    difference: toMoneyString(difference, DISPLAY_DP),
    ok: isZero(difference),
  };
}

/** Compares every component of two totals at once, at storage precision. */
function compareTotals(prefix, description, expected, actual) {
  const options = { dp: STORAGE_DP };

  return [
    compare(`${prefix}.taxable`, `${description} - taxable value`, expected.taxableAmount, actual.taxableAmount, options),
    compare(`${prefix}.cgst`, `${description} - CGST`, expected.cgst, actual.cgst, options),
    compare(`${prefix}.sgst`, `${description} - SGST`, expected.sgst, actual.sgst, options),
    compare(`${prefix}.igst`, `${description} - IGST`, expected.igst, actual.igst, options),
    compare(`${prefix}.cess`, `${description} - Cess`, expected.cess, actual.cess, options),
    compare(`${prefix}.tax`, `${description} - total tax`, expected.tax, actual.tax, options),
  ];
}

/** Header-column totals, in the shape the row totals use. */
function headerTotals(sums) {
  return {
    taxableAmount: subtract(sums.grandTotal ?? 0, sums.taxTotal ?? 0),
    cgst: toDecimal(sums.cgstTotal ?? 0),
    sgst: toDecimal(sums.sgstTotal ?? 0),
    igst: toDecimal(sums.igstTotal ?? 0),
    cess: toDecimal(sums.cessTotal ?? 0),
    tax: toDecimal(sums.taxTotal ?? 0),
  };
}

/**
 * @param {{ companyId: string }} currentUser
 * @param {{ fromDate: Date, toDate: Date }} period
 */
export async function buildReconciliation(currentUser, period) {
  const { companyId } = currentUser;
  const checks = [];

  // --- load every posted row once, and the header sums independently -------
  const sources = ['SALES_INVOICE', 'SALES_RETURN', 'PURCHASE', 'PURCHASE_RETURN'];

  const loaded = {};
  const headerSums = {};

  for (const source of sources) {
    const config = gstReturnRepository.returnSourceConfig(source);
    const [lines, documents] = await Promise.all([
      gstReturnRepository.findPeriodLines(source, companyId, period),
      gstReturnRepository.sumPeriodDocuments(source, companyId, period),
    ]);

    loaded[source] = lines.map((row) => toReturnRow(source, config, row));
    headerSums[source] = documents;
  }

  const rowTotals = Object.fromEntries(
    sources.map((source) => [source, sumRows(loaded[source], { applySign: false })]),
  );

  // Rows carrying a GST split, and rows that never had one. Every check below
  // asks each group only what it can meaningfully answer.
  const splitRows = Object.fromEntries(
    sources.map((source) => [source, loaded[source].filter((row) => row.supplyType)]),
  );
  const unsplitRows = Object.fromEntries(
    sources.map((source) => [source, loaded[source].filter((row) => !row.supplyType)]),
  );
  const splitTotals = Object.fromEntries(
    sources.map((source) => [source, sumRows(splitRows[source], { applySign: false })]),
  );
  const unsplitTotals = Object.fromEntries(
    sources.map((source) => [source, sumRows(unsplitRows[source], { applySign: false })]),
  );

  // --- 1-4: each dataset against the documents it came from ----------------
  //
  // Line rows on one side, header columns on the other. These are stored
  // separately by the posting transaction, so agreement is a real check that a
  // document's totals match its own lines.
  const sourceLabels = {
    SALES_INVOICE: 'Sales invoices',
    SALES_RETURN: 'Sales returns / credit notes',
    PURCHASE: 'Purchases',
    PURCHASE_RETURN: 'Purchase returns',
  };

  for (const source of sources) {
    checks.push(
      ...compareTotals(
        `source.${source}`,
        `${sourceLabels[source]}: document totals vs the sum of their lines`,
        headerTotals(headerSums[source].sums),
        rowTotals[source],
      ),
    );
  }

  // --- 6: the component identity, wherever there is a split ----------------
  //
  // Only asked of rows that carry one. A pre-GST document has a tax amount and no
  // components by design, and demanding they add up would report a defect that
  // is not there.
  for (const source of sources) {
    const totals = splitTotals[source];
    const difference = componentDifference(totals);

    checks.push({
      check: `components.${source}`,
      description: `${sourceLabels[source]}: CGST + SGST + IGST + Cess equals total tax, on GST-split documents`,
      comparedAtDecimalPlaces: STORAGE_DP,
      expected: toMoneyString(totals.tax, DISPLAY_DP),
      actual: toMoneyString(
        add(add(totals.cgst, totals.sgst), add(totals.igst, totals.cess)),
        DISPLAY_DP,
      ),
      difference: toMoneyString(difference.negated(), DISPLAY_DP),
      ok: isZero(round(difference, STORAGE_DP)),
    });

    // And the mirror image: a document with no place of supply must not have
    // acquired a split from somewhere.
    const unsplit = unsplitTotals[source];
    const strayComponents = add(add(unsplit.cgst, unsplit.sgst), add(unsplit.igst, unsplit.cess));

    checks.push({
      check: `components.unsplit.${source}`,
      description: `${sourceLabels[source]}: documents with no place of supply carry no component split`,
      comparedAtDecimalPlaces: STORAGE_DP,
      expected: '0.00',
      actual: toMoneyString(strayComponents, DISPLAY_DP),
      difference: toMoneyString(strayComponents.negated(), DISPLAY_DP),
      ok: isZero(round(strayComponents, STORAGE_DP)),
    });
  }

  // --- 7: grouping loses nothing -------------------------------------------
  //
  // Every grouping key the datasets use, re-summed and compared with the
  // ungrouped total of the same rows.
  const allOutward = [...loaded.SALES_INVOICE, ...loaded.SALES_RETURN];
  const groupings = [
    ['rate', rateKey],
    ['hsn', hsnKey],
    ['placeOfSupply', placeOfSupplyKey],
    ['document', (row) => row.documentId],
  ];

  for (const [name, keyOf] of groupings) {
    const grouped = groupRows(allOutward, keyOf).reduce(
      (totals, group) => addTotals(totals, group.totals),
      emptyTotals(),
    );

    checks.push(
      ...compareTotals(
        `grouping.${name}`,
        `Outward supplies grouped by ${name} still add to the ungrouped total`,
        sumRows(allOutward),
        grouped,
      ),
    );
  }

  // --- 5: the GSTR-3B summary against the datasets it summarises -----------
  const [gstr1, gstr3b] = await Promise.all([
    buildGstr1(currentUser, period),
    buildGstr3b(currentUser, period),
  ]);

  const netOutward = subtractTotals(rowTotals.SALES_INVOICE, rowTotals.SALES_RETURN);
  const netInput = subtractTotals(rowTotals.PURCHASE, rowTotals.PURCHASE_RETURN);

  checks.push(
    compare(
      'gstr3b.outward.tax',
      'GSTR-3B outward tax equals invoices less credit notes',
      netOutward.tax,
      add(
        toDecimal(gstr3b.outwardSupplies.taxableSupplies.totalTax),
        toDecimal(gstr3b.outwardSupplies.nilRatedExemptSupplies.totalTax),
      ),
    ),
    compare(
      'gstr3b.outward.taxable',
      'GSTR-3B outward taxable value equals invoices less credit notes',
      netOutward.taxableAmount,
      toDecimal(gstr3b.outwardSupplies.totals.taxableAmount),
    ),
    compare(
      'gstr3b.itc.net',
      'GSTR-3B net ITC equals purchases less purchase returns',
      netInput.tax,
      toDecimal(gstr3b.inputTaxCredit.netItcAvailable.totalTax),
    ),
    compare(
      'gstr3b.itc.reversed',
      'GSTR-3B ITC reversed equals the purchase returns in the period',
      rowTotals.PURCHASE_RETURN.tax,
      toDecimal(gstr3b.inputTaxCredit.itcReversed.totalTax),
    ),
  );

  // --- 1-2: the GSTR-1 tables against the same rows ------------------------
  checks.push(
    compare(
      'gstr1.invoices.tax',
      'GSTR-1 invoice totals equal the posted sales invoices',
      rowTotals.SALES_INVOICE.tax,
      toDecimal(gstr1.totals.invoices.totalTax),
    ),
    compare(
      'gstr1.invoices.taxable',
      'GSTR-1 invoice taxable value equals the posted sales invoices',
      rowTotals.SALES_INVOICE.taxableAmount,
      toDecimal(gstr1.totals.invoices.taxableAmount),
    ),
    compare(
      'gstr1.creditNotes.tax',
      'GSTR-1 credit note totals equal the posted sales returns',
      rowTotals.SALES_RETURN.tax,
      toDecimal(gstr1.totals.creditNotes.totalTax),
    ),
    compare(
      'gstr1.net.tax',
      'GSTR-1 net outward tax equals invoices less credit notes',
      netOutward.tax,
      toDecimal(gstr1.totals.net.totalTax),
    ),
  );

  // Every posted invoice line lands in exactly one of b2b, b2c or unclassified,
  // and every credit note in exactly one of registered, unregistered or
  // unclassified. Both are asserted, on tax and on taxable value.
  const invoiceCategories = add(
    add(toDecimal(gstr1.b2b.totals.totalTax), toDecimal(gstr1.b2c.totals.totalTax)),
    toDecimal(gstr1.unclassified.invoiceTotals.totalTax),
  );
  const invoiceCategoriesTaxable = add(
    add(
      toDecimal(gstr1.b2b.totals.taxableAmount),
      toDecimal(gstr1.b2c.totals.taxableAmount),
    ),
    toDecimal(gstr1.unclassified.invoiceTotals.taxableAmount),
  );
  const creditNoteCategories = add(
    add(
      toDecimal(gstr1.creditNotes.registered.totals.totalTax),
      toDecimal(gstr1.creditNotes.unregistered.totals.totalTax),
    ),
    toDecimal(gstr1.unclassified.creditNoteTotals.totalTax),
  );

  checks.push(
    compare(
      'gstr1.classification.invoices.tax',
      'Every posted invoice line is in exactly one of b2b, b2c or unclassified',
      rowTotals.SALES_INVOICE.tax,
      invoiceCategories,
    ),
    compare(
      'gstr1.classification.invoices.taxable',
      'The same, on taxable value',
      rowTotals.SALES_INVOICE.taxableAmount,
      invoiceCategoriesTaxable,
    ),
    compare(
      'gstr1.classification.creditNotes',
      'Every credit note is in exactly one of registered, unregistered or unclassified',
      rowTotals.SALES_RETURN.tax,
      creditNoteCategories,
    ),
  );

  // --- 8: the ledger --------------------------------------------------------
  //
  // GST-split tax posted to the component accounts; un-split tax posted to the
  // aggregate ones. Both are compared, so no tax escapes the reconciliation
  // whichever way it was recorded.
  const ledger = await reconcileAgainstLedger(companyId, period, {
    splitOutward: subtractTotals(splitTotals.SALES_INVOICE, splitTotals.SALES_RETURN),
    splitInput: subtractTotals(splitTotals.PURCHASE, splitTotals.PURCHASE_RETURN),
    unsplitOutward: subtractTotals(unsplitTotals.SALES_INVOICE, unsplitTotals.SALES_RETURN),
    unsplitInput: subtractTotals(unsplitTotals.PURCHASE, unsplitTotals.PURCHASE_RETURN),
  });
  checks.push(...ledger.checks);

  // --- rounding: do the displayed parts add to the displayed whole? --------
  const displayedRateSum = gstr1.rateSummary.rows.reduce(
    (sum, row) => add(sum, toDecimal(row.totalTax)),
    toDecimal(0),
  );
  const roundingDifference = subtract(
    displayedRateSum,
    toDecimal(gstr1.rateSummary.totals.totalTax),
  );

  // What the published 2 dp figures cost against the full-precision source.
  // Reported on its own rather than allowed to fail unrelated checks.
  const publishedNet = toDecimal(gstr1.totals.net.totalTax);
  const precisionLoss = subtract(round(netOutward.tax, DISPLAY_DP), publishedNet);

  checks.push({
    check: 'rounding.precision',
    description:
      'The published 2 dp outward tax equals the full-precision figure rounded to 2 dp. Any residue below a paisa is reported here, not hidden.',
    comparedAtDecimalPlaces: DISPLAY_DP,
    expected: toMoneyString(netOutward.tax, DISPLAY_DP),
    actual: toMoneyString(publishedNet, DISPLAY_DP),
    difference: toMoneyString(precisionLoss, DISPLAY_DP),
    ok: isZero(precisionLoss),
    fullPrecisionValue: netOutward.tax.toFixed(STORAGE_DP),
  });

  checks.push({
    check: 'rounding.display',
    description:
      'The displayed rate-wise figures add up to the displayed total. A difference here is a presentation rounding artefact, reported rather than hidden.',
    comparedAtDecimalPlaces: DISPLAY_DP,
    expected: toMoneyString(gstr1.rateSummary.totals.totalTax, DISPLAY_DP),
    actual: toMoneyString(displayedRateSum, DISPLAY_DP),
    difference: toMoneyString(roundingDifference, DISPLAY_DP),
    ok: isZero(roundingDifference),
  });

  const failed = checks.filter((entry) => !entry.ok);

  return {
    period: {
      fromDate: toBusinessDate(period.fromDate),
      toDate: toBusinessDate(period.toDate),
      boundsInclusive: true,
      includedStatuses: ['POSTED'],
      excludedStatuses: ['DRAFT', 'CANCELLED'],
    },
    documentCounts: Object.fromEntries(
      sources.map((source) => [source, headerSums[source].documentCount]),
    ),
    summary: {
      totalChecks: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      isReconciled: failed.length === 0,
    },
    checks,
    failedChecks: failed,
    ledgerComparison: ledger.accounts,
    note: 'Internal reconciliation of the GST return preparation datasets against the documents and the general ledger. Not a filing validation.',
  };
}

/**
 * The GST control accounts, from the journal, against the return datasets.
 *
 * The two are computed from different places on purpose: one from document line
 * snapshots, one from posted journal lines. They agree only because the same
 * transaction wrote both, so a difference is a real defect.
 *
 * FOUR comparisons, not two. Tax with a GST split went to the component accounts
 * (1510-1540 / 2110-2140); tax written before GST was enabled went to the
 * aggregate accounts (1500 / 2100). Each is compared against the accounts it
 * actually posted to, so every rupee is accounted for either way.
 */
async function reconcileAgainstLedger(
  companyId,
  period,
  { splitOutward, splitInput, unsplitOutward, unsplitInput },
) {
  const inputCodes = [
    SYSTEM_ACCOUNT.INPUT_CGST,
    SYSTEM_ACCOUNT.INPUT_SGST,
    SYSTEM_ACCOUNT.INPUT_IGST,
    SYSTEM_ACCOUNT.INPUT_CESS,
  ];
  const outputCodes = [
    SYSTEM_ACCOUNT.OUTPUT_CGST,
    SYSTEM_ACCOUNT.OUTPUT_SGST,
    SYSTEM_ACCOUNT.OUTPUT_IGST,
    SYSTEM_ACCOUNT.OUTPUT_CESS,
  ];
  const aggregateCodes = [SYSTEM_ACCOUNT.INPUT_TAX_CREDIT, SYSTEM_ACCOUNT.TAX_PAYABLE];

  const [accounts, grouped] = await Promise.all([
    accountRepository.findManyByCodes(
      companyId,
      [...inputCodes, ...outputCodes, ...aggregateCodes],
    ),
    journalRepository.sumLinesGroupedByAccount(companyId, {
      dateFrom: period.fromDate,
      dateTo: period.toDate,
    }),
  ]);

  const sumsById = new Map(grouped.map((row) => [row.accountId, row._sum]));

  const rows = accounts
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((account) => {
      const sums = sumsById.get(account.id) ?? {};
      const debit = sums.debit ?? toDecimal(0);
      const credit = sums.credit ?? toDecimal(0);

      return {
        code: account.code,
        name: account.name,
        balance: deriveAccountBalance(account.type, debit, credit),
      };
    });

  const balanceOf = (codes) =>
    rows
      .filter((row) => codes.includes(row.code))
      .reduce((sum, row) => add(sum, row.balance), toDecimal(0));

  const aggregate = balanceOf(aggregateCodes);

  const checks = [
    compare(
      'ledger.outputTax',
      'Net outward tax on GST-split documents equals the Output CGST/SGST/IGST/Cess accounts',
      splitOutward.tax,
      balanceOf(outputCodes),
    ),
    compare(
      'ledger.inputTax',
      'Net input tax on GST-split documents equals the Input CGST/SGST/IGST/Cess accounts',
      splitInput.tax,
      balanceOf(inputCodes),
    ),
    compare(
      'ledger.aggregate.outputTax',
      'Net outward tax on documents with no split equals the aggregate Tax Payable account',
      unsplitOutward.tax,
      balanceOf([SYSTEM_ACCOUNT.TAX_PAYABLE]),
    ),
    compare(
      'ledger.aggregate.inputTax',
      'Net input tax on documents with no split equals the aggregate Input Tax Credit account',
      unsplitInput.tax,
      balanceOf([SYSTEM_ACCOUNT.INPUT_TAX_CREDIT]),
    ),
  ];

  return {
    checks,
    accounts: {
      description:
        'The GST control accounts for the period, read from the journal - an independent figure, not the one the datasets were built from.',
      rows: rows.map((row) => ({
        code: row.code,
        name: row.name,
        balance: toMoneyString(row.balance, DISPLAY_DP),
      })),
      aggregateAccounts: {
        description:
          'Tax posted before GST was enabled for this company went to the aggregate accounts (1500 / 2100). It is compared separately, against the documents that carry no component split.',
        balance: toMoneyString(aggregate, DISPLAY_DP),
        isZero: isZero(aggregate),
      },
    },
  };
}

export { compare, compareTotals, headerTotals };
