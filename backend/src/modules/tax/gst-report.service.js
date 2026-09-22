import { add, subtract, toDecimal, toMoneyString } from '../../utils/money.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import * as gstReportRepository from './gst-report.repository.js';
import * as journalRepository from '../accounting/journal.repository.js';
import * as accountRepository from '../accounting/account.repository.js';
import { SYSTEM_ACCOUNT } from '../accounting/system-accounts.js';
import { deriveAccountBalance } from '../accounting/journal.service.js';
import { stateName } from './state-codes.js';

// GST summaries, computed from the posted documents every time they are asked for.
//
// THIS IS AN INTERNAL TAX SUMMARY, NOT A FILED RETURN.
//
// It tells a business what its books say it collected and paid. It is not GSTR-1,
// it is not GSTR-3B, and the net figure is not a legal liability: eligibility
// rules, reverse charge, ineligible credits, and reconciliation against the
// supplier's own filing all sit outside this system. Every response says so.
//
// Every figure traces back: a summary row can be expanded into the document lines
// that produced it, and each of those documents has a journal entry reachable
// through sourceType + sourceId.

const MONEY_DP = 4;

const DISCLAIMER =
  'Internal accounting summary computed from posted documents. Not a filed GST return, and not a legal tax liability.';

// --- shaping ---------------------------------------------------------------

function emptyTotals() {
  return {
    taxableAmount: toDecimal(0),
    cgst: toDecimal(0),
    sgst: toDecimal(0),
    igst: toDecimal(0),
    cess: toDecimal(0),
    taxAmount: toDecimal(0),
  };
}

/** Folds one aggregate row in, applying the source's sign (returns subtract). */
function accumulate(totals, sums, { sign, taxableField }) {
  const signed = (value) => {
    const amount = toDecimal(value ?? 0);
    return sign === -1 ? amount.negated() : amount;
  };

  return {
    taxableAmount: add(totals.taxableAmount, signed(sums[taxableField])),
    cgst: add(totals.cgst, signed(sums.cgstAmount)),
    sgst: add(totals.sgst, signed(sums.sgstAmount)),
    igst: add(totals.igst, signed(sums.igstAmount)),
    cess: add(totals.cess, signed(sums.cessAmount)),
    taxAmount: add(totals.taxAmount, signed(sums.taxAmount)),
  };
}

function toPublicTotals(totals) {
  return {
    taxableAmount: toMoneyString(totals.taxableAmount, 2),
    cgst: toMoneyString(totals.cgst, 2),
    sgst: toMoneyString(totals.sgst, 2),
    igst: toMoneyString(totals.igst, 2),
    cess: toMoneyString(totals.cess, 2),
    totalTax: toMoneyString(totals.taxAmount, 2),
  };
}

function toDateRange(filters) {
  return {
    fromDate: filters.dateFrom ? filters.dateFrom.toISOString().slice(0, 10) : null,
    toDate: filters.dateTo ? filters.dateTo.toISOString().slice(0, 10) : null,
  };
}

// --- one side of the ledger ------------------------------------------------

/**
 * Input tax (purchases less purchase returns) or output tax (sales less sales
 * returns), with the rate-wise breakdown a return is filed on.
 *
 * @param {'INPUT'|'OUTPUT'} direction
 */
async function summariseDirection(companyId, direction, filters) {
  const sources =
    direction === 'INPUT' ? ['PURCHASE', 'PURCHASE_RETURN'] : ['SALES_INVOICE', 'SALES_RETURN'];

  let totals = emptyTotals();
  const byDocument = {};
  const byRate = new Map();

  for (const source of sources) {
    const config = gstReportRepository.sourceConfig(source);

    const [sums, rateRows] = await Promise.all([
      gstReportRepository.sumBySource(source, companyId, filters),
      gstReportRepository.groupBySourceAndRate(source, companyId, filters),
    ]);

    totals = accumulate(totals, sums._sum, config);
    byDocument[source] = toPublicTotals(accumulate(emptyTotals(), sums._sum, {
      ...config,
      // Shown as its own positive figure; the sign is applied to the net above.
      sign: 1,
    }));

    for (const row of rateRows) {
      const key = row.taxRateSnapshot === null ? 'UNRATED' : toMoneyString(row.taxRateSnapshot, 2);
      byRate.set(key, accumulate(byRate.get(key) ?? emptyTotals(), row._sum, config));
    }
  }

  return {
    ...toPublicTotals(totals),
    byDocumentType: byDocument,
    byRate: [...byRate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([rate, amounts]) => ({ taxRate: rate, ...toPublicTotals(amounts) })),
  };
}

export async function getInputTax(currentUser, filters) {
  return {
    ...toDateRange(filters),
    direction: 'INPUT',
    ...(await summariseDirection(currentUser.companyId, 'INPUT', filters)),
    note: DISCLAIMER,
  };
}

export async function getOutputTax(currentUser, filters) {
  return {
    ...toDateRange(filters),
    direction: 'OUTPUT',
    ...(await summariseDirection(currentUser.companyId, 'OUTPUT', filters)),
    note: DISCLAIMER,
  };
}

// --- the headline summary --------------------------------------------------

/**
 * Output tax less input tax: what the books say is owed, or recoverable.
 *
 * The reconciliation block compares those figures with the GST control accounts
 * in the general ledger. They should agree exactly, because the same posting
 * transaction wrote both - so a difference is a real defect, and it is reported
 * rather than hidden.
 */
export async function getGstSummary(currentUser, filters) {
  const { companyId } = currentUser;

  const [input, output, ledger] = await Promise.all([
    summariseDirection(companyId, 'INPUT', filters),
    summariseDirection(companyId, 'OUTPUT', filters),
    getLedgerTaxBalances(companyId, filters),
  ]);

  const net = {
    cgst: subtract(output.cgst, input.cgst),
    sgst: subtract(output.sgst, input.sgst),
    igst: subtract(output.igst, input.igst),
    cess: subtract(output.cess, input.cess),
    total: subtract(output.totalTax, input.totalTax),
  };

  const netPayable = toDecimal(net.total);

  return {
    ...toDateRange(filters),
    outputTax: output,
    inputTax: input,
    net: {
      cgst: toMoneyString(net.cgst, 2),
      sgst: toMoneyString(net.sgst, 2),
      igst: toMoneyString(net.igst, 2),
      cess: toMoneyString(net.cess, 2),
      // Positive: the books say tax is owed. Negative: credit carried forward.
      netTax: toMoneyString(netPayable, 2),
      position: netPayable.isNegative() ? 'CREDIT' : 'PAYABLE',
    },
    ledgerReconciliation: ledger,
    note: DISCLAIMER,
  };
}

/**
 * The GST control accounts, straight from the journal.
 *
 * Deliberately independent of the document queries above: if the two ever
 * disagree, something posted a journal that does not match its document, and
 * that has to be visible.
 */
async function getLedgerTaxBalances(companyId, filters) {
  const codes = [
    SYSTEM_ACCOUNT.INPUT_CGST,
    SYSTEM_ACCOUNT.INPUT_SGST,
    SYSTEM_ACCOUNT.INPUT_IGST,
    SYSTEM_ACCOUNT.INPUT_CESS,
    SYSTEM_ACCOUNT.OUTPUT_CGST,
    SYSTEM_ACCOUNT.OUTPUT_SGST,
    SYSTEM_ACCOUNT.OUTPUT_IGST,
    SYSTEM_ACCOUNT.OUTPUT_CESS,
  ];

  const [accounts, grouped] = await Promise.all([
    accountRepository.findManyByCodes(companyId, codes),
    journalRepository.sumLinesGroupedByAccount(companyId, {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    }),
  ]);

  const sumsById = new Map(grouped.map((row) => [row.accountId, row._sum]));

  return accounts
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((account) => {
      const sums = sumsById.get(account.id) ?? {};
      const debit = sums.debit ?? toDecimal(0);
      const credit = sums.credit ?? toDecimal(0);

      return {
        code: account.code,
        name: account.name,
        debit: toMoneyString(debit, 2),
        credit: toMoneyString(credit, 2),
        balance: toMoneyString(deriveAccountBalance(account.type, debit, credit), 2),
      };
    });
}

// --- traceable detail ------------------------------------------------------

/**
 * The document lines behind a summary figure. This is what makes every number
 * answerable: each row names its document, its HSN, its rate and its split.
 */
export async function listTaxLines(currentUser, source, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });
  const config = gstReportRepository.sourceConfig(source);

  const { items, total } = await gstReportRepository.listLines(
    source,
    currentUser.companyId,
    filters,
    { skip, take },
  );

  return {
    source,
    direction: config.direction,
    lines: items.map((item) => {
      const header = item[config.relation];

      return {
        id: item.id,
        documentId: header.id,
        documentNumber: header[config.numberField],
        documentDate: header[config.dateField]
          ? header[config.dateField].toISOString().slice(0, 10)
          : null,
        product: item.productNameSnapshot,
        hsn: item.hsnCodeSnapshot,
        taxTreatment: item.taxTreatmentSnapshot,
        taxRate: item.taxRateSnapshot === null ? null : toMoneyString(item.taxRateSnapshot, 2),
        supplyType: header.supplyType,
        sellerGstin: header.sellerGstin,
        buyerGstin: header.buyerGstin,
        placeOfSupply: header.placeOfSupplyStateCode,
        placeOfSupplyName: stateName(header.placeOfSupplyStateCode),
        taxableAmount: toMoneyString(item[config.taxableField], 2),
        cgst: toMoneyString(item.cgstAmount, 2),
        sgst: toMoneyString(item.sgstAmount, 2),
        igst: toMoneyString(item.igstAmount, 2),
        cess: toMoneyString(item.cessAmount, 2),
        totalTax: toMoneyString(item.taxAmount, 2),
      };
    }),
    pagination: buildPagination({ page, limit, total }),
    note: DISCLAIMER,
  };
}

/** HSN-wise summary - the shape a GST return's HSN table wants. */
export async function getHsnSummary(currentUser, source, filters) {
  const config = gstReportRepository.sourceConfig(source);

  const rows = await gstReportRepository.groupBySourceAndHsn(
    source,
    currentUser.companyId,
    filters,
  );

  return {
    ...toDateRange(filters),
    source,
    direction: config.direction,
    rows: rows
      .map((row) => ({
        hsn: row.hsnCodeSnapshot,
        ...toPublicTotals(accumulate(emptyTotals(), row._sum, { ...config, sign: 1 })),
      }))
      .sort((a, b) => String(a.hsn ?? '').localeCompare(String(b.hsn ?? ''))),
    note: DISCLAIMER,
  };
}

export { MONEY_DP };
