import * as gstReturnRepository from './gst-return.repository.js';
import {
  toReturnRow,
  classifyRow,
  isNilRatedOrExempt,
  sumRows,
  groupRows,
  addTotals,
  subtractTotals,
  toPublicTotals,
  emptyTotals,
  placeOfSupplyKey,
  rateKey,
  toBusinessDate,
  withStateName,
  SUPPLY_CATEGORY,
} from './gst-return.dataset.js';

// GSTR-3B PREPARATION DATASET - the period summary.
//
// THIS IS PREPARATION DATA, NOT A FILED RETURN, AND NOT A TAX LIABILITY.
//
// WHAT THIS SYSTEM CAN AND CANNOT SAY
//   It can say what it charged and what it paid, because it recorded both.
//   It CANNOT say what is legally creditable. Input tax credit eligibility turns
//   on reverse charge, imports, ISD distribution, blocked credits under section
//   17(5), the supplier's own filing, and proportional reversal for exempt
//   supplies - and this system records none of those. So every rupee of input tax
//   goes into ONE bucket, "all other ITC", and everything that cannot be
//   determined is listed under `notDetermined` with a reason.
//
//   That is the deliberate choice: an explicit "we do not know" is worth more
//   than a confident number that is wrong.
//
// SIGN CONVENTION
//   Returns net off. Outward tax is invoices minus credit notes; input tax is
//   purchases minus purchase returns. Both reductions are also reported on their
//   own line, so the netting is visible rather than assumed.

const NOT_FILED =
  'GSTR-3B preparation dataset built from posted documents in this system. Not a filed return, not a legal tax liability, and not validated against the GST portal.';

const ITC_NOT_DETERMINED = [
  {
    item: 'Import of goods and services',
    reason: 'The system does not record whether a purchase is an import.',
  },
  {
    item: 'Inward supplies liable to reverse charge',
    reason: 'Reverse charge is not modelled: every purchase books ordinary input tax.',
  },
  {
    item: 'Input Service Distributor credit',
    reason: 'ISD documents are not modelled.',
  },
  {
    item: 'Ineligible credit under section 17(5)',
    reason:
      'Blocked-credit categories are not recorded against a purchase, so no credit is classified ineligible.',
  },
  {
    item: 'Reversal under rules 42 and 43',
    reason:
      'Proportional reversal for exempt supplies and capital goods is not computed; capital goods are not distinguished from stock.',
  },
];

/** Loads every posted row in the period once. */
async function loadRows(companyId, period) {
  const sources = ['SALES_INVOICE', 'SALES_RETURN', 'PURCHASE', 'PURCHASE_RETURN'];

  const loaded = await Promise.all(
    sources.map(async (source) => {
      const config = gstReturnRepository.returnSourceConfig(source);
      const lines = await gstReturnRepository.findPeriodLines(source, companyId, period);
      return [source, lines.map((row) => toReturnRow(source, config, row))];
    }),
  );

  return Object.fromEntries(loaded);
}

/**
 * @param {{ companyId: string }} currentUser
 * @param {{ fromDate: Date, toDate: Date }} period
 */
export async function buildGstr3b(currentUser, period) {
  const rows = await loadRows(currentUser.companyId, period);

  const invoices = rows.SALES_INVOICE;
  const creditNotes = rows.SALES_RETURN;
  const purchases = rows.PURCHASE;
  const purchaseReturns = rows.PURCHASE_RETURN;

  // --- 3.1 outward supplies ------------------------------------------------
  // Taxable and non-taxable are separated by TREATMENT, not by rate: a 0%
  // taxable supply is not an exempt one, and the two are reported differently.
  const taxableInvoices = invoices.filter((row) => !isNilRatedOrExempt(row));
  const taxableCreditNotes = creditNotes.filter((row) => !isNilRatedOrExempt(row));
  const nilRatedInvoices = invoices.filter(isNilRatedOrExempt);
  const nilRatedCreditNotes = creditNotes.filter(isNilRatedOrExempt);

  const outwardTaxable = subtractTotals(
    sumRows(taxableInvoices, { applySign: false }),
    sumRows(taxableCreditNotes, { applySign: false }),
  );
  const outwardNilRated = subtractTotals(
    sumRows(nilRatedInvoices, { applySign: false }),
    sumRows(nilRatedCreditNotes, { applySign: false }),
  );

  // --- 3.2 inter-state supplies to unregistered persons --------------------
  const interStateB2C = invoices.filter(
    (row) =>
      row.supplyType === 'INTER_STATE' &&
      classifyRow(row).category === SUPPLY_CATEGORY.B2C,
  );
  const interStateB2CCreditNotes = creditNotes.filter(
    (row) =>
      row.supplyType === 'INTER_STATE' &&
      classifyRow(row).category === SUPPLY_CATEGORY.B2C,
  );

  // --- 4 input tax credit --------------------------------------------------
  const itcAvailable = sumRows(purchases, { applySign: false });
  const itcReversed = sumRows(purchaseReturns, { applySign: false });
  const itcNet = subtractTotals(itcAvailable, itcReversed);

  // --- anything with no place of supply ------------------------------------
  const unclassified = [...invoices, ...creditNotes, ...purchases, ...purchaseReturns].filter(
    (row) => classifyRow(row).category === SUPPLY_CATEGORY.UNCLASSIFIED,
  );

  // --- the net position ----------------------------------------------------
  const netPosition = subtractTotals(outwardTaxable, itcNet);

  return {
    period: {
      fromDate: toBusinessDate(period.fromDate),
      toDate: toBusinessDate(period.toDate),
      boundsInclusive: true,
      basis: 'Document business date (invoice date / return date)',
      includedStatuses: ['POSTED'],
      excludedStatuses: ['DRAFT', 'CANCELLED'],
    },

    outwardSupplies: {
      description: '3.1 Details of outward supplies',
      taxableSupplies: {
        label: '(a) Outward taxable supplies, other than zero-rated, nil-rated and exempted',
        ...toPublicTotals(outwardTaxable),
        gross: toPublicTotals(sumRows(taxableInvoices, { applySign: false })),
        lessCreditNotes: toPublicTotals(sumRows(taxableCreditNotes, { applySign: false })),
      },
      nilRatedExemptSupplies: {
        label: '(c) Other outward supplies (nil-rated, exempted, zero-rated)',
        ...toPublicTotals(outwardNilRated),
      },
      reverseChargeSupplies: {
        label: '(d) Inward supplies liable to reverse charge',
        ...toPublicTotals(emptyTotals()),
        notDetermined: 'Reverse charge is not modelled by this system.',
      },
      totals: toPublicTotals(addTotals(outwardTaxable, outwardNilRated)),
    },

    interStateSuppliesToUnregistered: {
      description:
        '3.2 Of the supplies above, inter-state supplies made to unregistered persons, by place of supply',
      rows: groupRows(
        [...interStateB2C, ...interStateB2CCreditNotes],
        placeOfSupplyKey,
        (row) => row,
      ).map((group) => ({
        ...withStateName(group.meta.placeOfSupplyStateCode),
        ...toPublicTotals(group.totals),
      })),
      totals: toPublicTotals(
        subtractTotals(
          sumRows(interStateB2C, { applySign: false }),
          sumRows(interStateB2CCreditNotes, { applySign: false }),
        ),
      ),
    },

    inputTaxCredit: {
      description: '4 Eligible ITC',
      allOtherItc: {
        label: '(A)(5) All other ITC',
        ...toPublicTotals(itcAvailable),
        // Every rupee of recorded input tax lands here, because the system has no
        // basis on which to put it anywhere else.
        basis: 'All input tax recorded on posted purchases in the period.',
      },
      itcReversed: {
        label: '(B)(2) ITC reversed - others',
        ...toPublicTotals(itcReversed),
        basis: 'Input tax given back on posted purchase returns in the period.',
      },
      netItcAvailable: {
        label: '(C) Net ITC available (A - B)',
        ...toPublicTotals(itcNet),
      },
      notDetermined: {
        description:
          'Buckets this system cannot populate. They are reported as unknown rather than assumed to be zero or folded into the figures above.',
        items: ITC_NOT_DETERMINED,
      },
      byRate: groupRows(purchases, rateKey, (row) => row, { applySign: false }).map((group) => ({
        taxRate: group.key,
        ...toPublicTotals(group.totals),
      })),
    },

    netPosition: {
      description:
        'Outward tax less net input tax credit. An internal figure, not a payable amount.',
      ...toPublicTotals(netPosition),
      position: netPosition.tax.isNegative() ? 'CREDIT' : 'PAYABLE',
      notDetermined:
        'Interest, late fee, cash-ledger balances and the actual payment of tax are not modelled.',
    },

    unclassified: {
      description:
        'Posted documents with no place of supply, written before GST was enabled for this company. They are excluded from the tables above and reported here.',
      reason: 'NO_PLACE_OF_SUPPLY',
      documentCount: new Set(unclassified.map((row) => row.documentId)).size,
      totals: toPublicTotals(sumRows(unclassified, { applySign: false })),
    },

    sourceTotals: {
      description: 'The document totals every table above was derived from.',
      salesInvoices: toPublicTotals(sumRows(invoices, { applySign: false })),
      salesReturns: toPublicTotals(sumRows(creditNotes, { applySign: false })),
      purchases: toPublicTotals(sumRows(purchases, { applySign: false })),
      purchaseReturns: toPublicTotals(sumRows(purchaseReturns, { applySign: false })),
    },

    notFiled: NOT_FILED,
  };
}

export { NOT_FILED, ITC_NOT_DETERMINED };
