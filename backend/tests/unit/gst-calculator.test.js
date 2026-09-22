import { describe, it, expect } from 'vitest';
import {
  determineSupplyType,
  calculateGstAmounts,
  deriveComponentRates,
  assertComponentRatesConsistent,
  assertGstTotalsConsistent,
  sumGstComponents,
  isTaxEffectiveOn,
  isNonTaxableTreatment,
  taxableAmountFromInclusive,
  SUPPLY_TYPE,
  TAX_TREATMENT,
} from '../../src/modules/tax/gst.calculator.js';
import { calculateLine, calculateTotals } from '../../src/modules/purchases/purchase.calculator.js';

// The GST arithmetic, tested without a database.
//
// The assertion that matters most is `expectSplitAddsUp`: it re-checks, on every
// case, that the components add up to the tax charged. That invariant is what the
// ledger, the reports and the returns all rely on.

/** The components must account for the whole tax, at every rate. */
function expectSplitAddsUp(result) {
  const sum = result.cgstAmount
    .plus(result.sgstAmount)
    .plus(result.igstAmount)
    .plus(result.cessAmount);
  expect(sum.toFixed(4)).toBe(result.taxAmount.toFixed(4));
}

const gstRates = (rate) => ({
  cgstRate: String(rate / 2),
  sgstRate: String(rate / 2),
  igstRate: String(rate),
});

describe('deciding intra-state versus inter-state', () => {
  it('is intra-state when the seller and the place of supply share a state', () => {
    expect(determineSupplyType('27', '27')).toBe(SUPPLY_TYPE.INTRA_STATE);
  });

  it('is inter-state when they differ', () => {
    expect(determineSupplyType('27', '29')).toBe(SUPPLY_TYPE.INTER_STATE);
  });

  it('refuses to guess when either state is unknown', () => {
    // Guessing here would charge the wrong tax on a real invoice.
    expect(determineSupplyType(null, '27')).toBeNull();
    expect(determineSupplyType('27', null)).toBeNull();
    expect(determineSupplyType(null, null)).toBeNull();
    expect(determineSupplyType('', '27')).toBeNull();
  });
});

describe('splitting tax at each GST slab', () => {
  const cases = [
    { rate: 5, taxable: '1000', cgst: '25', sgst: '25', igst: '50' },
    { rate: 12, taxable: '1000', cgst: '60', sgst: '60', igst: '120' },
    { rate: 18, taxable: '1000', cgst: '90', sgst: '90', igst: '180' },
    { rate: 28, taxable: '1000', cgst: '140', sgst: '140', igst: '280' },
  ];

  for (const { rate, taxable, cgst, sgst, igst } of cases) {
    it(`splits ${rate}% intra-state into CGST and SGST`, () => {
      const result = calculateGstAmounts({
        taxableAmount: taxable,
        ...gstRates(rate),
        supplyType: SUPPLY_TYPE.INTRA_STATE,
      });

      expect(result.cgstAmount.toString()).toBe(cgst);
      expect(result.sgstAmount.toString()).toBe(sgst);
      expect(result.igstAmount.toString()).toBe('0');
      expect(result.taxAmount.toString()).toBe(igst);
      expectSplitAddsUp(result);
    });

    it(`charges ${rate}% inter-state entirely as IGST`, () => {
      const result = calculateGstAmounts({
        taxableAmount: taxable,
        ...gstRates(rate),
        supplyType: SUPPLY_TYPE.INTER_STATE,
      });

      expect(result.igstAmount.toString()).toBe(igst);
      expect(result.cgstAmount.toString()).toBe('0');
      expect(result.sgstAmount.toString()).toBe('0');
      expect(result.taxAmount.toString()).toBe(igst);
      expectSplitAddsUp(result);
    });
  }

  it('charges the same total either way - only the split differs', () => {
    const intra = calculateGstAmounts({
      taxableAmount: '4567.89',
      ...gstRates(18),
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });
    const inter = calculateGstAmounts({
      taxableAmount: '4567.89',
      ...gstRates(18),
      supplyType: SUPPLY_TYPE.INTER_STATE,
    });

    expect(intra.taxAmount.toFixed(4)).toBe(inter.taxAmount.toFixed(4));
    expect(intra.totalAmount.toFixed(4)).toBe(inter.totalAmount.toFixed(4));
  });
});

describe('rounding and decimals', () => {
  it('rounds each component once, to four places', () => {
    // 333.335 * 9% = 30.00015 -> 30.0002 (half away from zero)
    const result = calculateGstAmounts({
      taxableAmount: '333.335',
      ...gstRates(18),
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });

    expect(result.cgstAmount.toString()).toBe('30.0002');
    expect(result.sgstAmount.toString()).toBe('30.0002');
    expect(result.taxAmount.toString()).toBe('60.0004');
    expectSplitAddsUp(result);
  });

  it('keeps the split adding up even when halves do not divide evenly', () => {
    // A taxable amount whose 2.5% share ends in a half-paise on both sides.
    const result = calculateGstAmounts({
      taxableAmount: '0.0001',
      ...gstRates(5),
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });

    expectSplitAddsUp(result);
  });

  it('handles a decimal quantity and price without floating point drift', () => {
    // 2.5 units at 33.33 = 83.325, at 12%.
    const line = calculateLine({
      quantity: '2.5',
      unitCost: '33.33',
      discountType: 'NONE',
      discountValue: '0',
      taxRate: '12',
      index: 0,
      gst: { supplyType: SUPPLY_TYPE.INTRA_STATE, ...gstRates(12) },
    });

    expect(line.taxableAmount.toString()).toBe('83.325');
    expect(line.cgstAmount.plus(line.sgstAmount).toFixed(4)).toBe(line.taxAmount.toFixed(4));
    expect(line.lineTotal.toFixed(4)).toBe(
      line.taxableAmount.plus(line.taxAmount).toFixed(4),
    );
  });

  it('never produces a fraction beyond the stored precision', () => {
    const result = calculateGstAmounts({
      taxableAmount: '1234.5678',
      ...gstRates(28),
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });

    for (const amount of [result.cgstAmount, result.sgstAmount, result.taxAmount]) {
      expect(amount.decimalPlaces()).toBeLessThanOrEqual(4);
    }
  });
});

describe('zero tax, exempt, nil-rated and zero-rated', () => {
  it('charges nothing at a 0% rate but still treats the supply as taxable', () => {
    const result = calculateGstAmounts({
      taxableAmount: '1000',
      ...gstRates(0),
      supplyType: SUPPLY_TYPE.INTRA_STATE,
      treatment: TAX_TREATMENT.TAXABLE,
    });

    expect(result.taxAmount.toString()).toBe('0');
    expect(result.totalAmount.toString()).toBe('1000');
  });

  it('charges nothing on an exempt line even when a rate is configured', () => {
    // The treatment is the authority, not the number. A misconfigured rate must
    // not put tax on an exempt supply.
    const result = calculateGstAmounts({
      taxableAmount: '1000',
      ...gstRates(18),
      supplyType: SUPPLY_TYPE.INTRA_STATE,
      treatment: TAX_TREATMENT.EXEMPT,
    });

    expect(result.taxAmount.toString()).toBe('0');
    expect(result.cgstAmount.toString()).toBe('0');
  });

  it('does the same for nil-rated and zero-rated', () => {
    for (const treatment of [TAX_TREATMENT.NIL_RATED, TAX_TREATMENT.ZERO_RATED]) {
      const result = calculateGstAmounts({
        taxableAmount: '1000',
        ...gstRates(18),
        supplyType: SUPPLY_TYPE.INTER_STATE,
        treatment,
      });
      expect(`${treatment}:${result.taxAmount.toString()}`).toBe(`${treatment}:0`);
    }
  });

  it('distinguishes the four treatments explicitly', () => {
    expect(isNonTaxableTreatment(TAX_TREATMENT.TAXABLE)).toBe(false);
    expect(isNonTaxableTreatment(TAX_TREATMENT.EXEMPT)).toBe(true);
    expect(isNonTaxableTreatment(TAX_TREATMENT.NIL_RATED)).toBe(true);
    expect(isNonTaxableTreatment(TAX_TREATMENT.ZERO_RATED)).toBe(true);
  });

  it('charges nothing at all when the supply type is unknown', () => {
    const result = calculateGstAmounts({
      taxableAmount: '1000',
      ...gstRates(18),
      supplyType: null,
    });

    expect(result.taxAmount.toString()).toBe('0');
  });
});

describe('cess', () => {
  it('is charged on top of GST, on both kinds of supply', () => {
    const intra = calculateGstAmounts({
      taxableAmount: '1000',
      ...gstRates(28),
      cessRate: '12',
      supplyType: SUPPLY_TYPE.INTRA_STATE,
    });

    expect(intra.cessAmount.toString()).toBe('120');
    expect(intra.taxAmount.toString()).toBe('400');
    expectSplitAddsUp(intra);

    const inter = calculateGstAmounts({
      taxableAmount: '1000',
      ...gstRates(28),
      cessRate: '12',
      supplyType: SUPPLY_TYPE.INTER_STATE,
    });

    expect(inter.igstAmount.toString()).toBe('280');
    expect(inter.cessAmount.toString()).toBe('120');
    expectSplitAddsUp(inter);
  });
});

describe('deriving component rates from a headline rate', () => {
  it('halves the rate for CGST and SGST and gives IGST the whole rate', () => {
    for (const rate of ['5', '12', '18', '28']) {
      const derived = deriveComponentRates(rate);
      expect(derived.cgstRate.plus(derived.sgstRate).toString()).toBe(rate);
      expect(derived.igstRate.toString()).toBe(rate);
    }
  });

  it('refuses a rate it cannot halve exactly rather than losing half a paisa', () => {
    expect(() => deriveComponentRates('5.01')).toThrowError(/cannot be split evenly/i);
  });

  it('accepts a consistent explicit split', () => {
    expect(() =>
      assertComponentRatesConsistent({ rate: '18', cgstRate: '9', sgstRate: '9', igstRate: '18' }),
    ).not.toThrow();
  });

  it('rejects halves that do not add up to the rate', () => {
    expect(() =>
      assertComponentRatesConsistent({ rate: '18', cgstRate: '9', sgstRate: '8', igstRate: '18' }),
    ).toThrowError(/must equal the total rate/i);
  });

  it('rejects an IGST that disagrees with the rate', () => {
    expect(() =>
      assertComponentRatesConsistent({ rate: '18', cgstRate: '9', sgstRate: '9', igstRate: '12' }),
    ).toThrowError(/IGST/);
  });
});

describe('document-level invariants', () => {
  it('accepts an intra-state document carrying only CGST and SGST', () => {
    expect(() =>
      assertGstTotalsConsistent({
        supplyType: SUPPLY_TYPE.INTRA_STATE,
        cgstTotal: '90',
        sgstTotal: '90',
        igstTotal: '0',
        cessTotal: '0',
        taxTotal: '180',
      }),
    ).not.toThrow();
  });

  it('rejects a document carrying CGST/SGST and IGST together', () => {
    expect(() =>
      assertGstTotalsConsistent({
        supplyType: SUPPLY_TYPE.INTRA_STATE,
        cgstTotal: '90',
        sgstTotal: '90',
        igstTotal: '180',
        cessTotal: '0',
        taxTotal: '360',
      }),
    ).toThrowError(/cannot carry CGST\/SGST and IGST/i);
  });

  it('rejects CGST/SGST on an inter-state supply', () => {
    expect(() =>
      assertGstTotalsConsistent({
        supplyType: SUPPLY_TYPE.INTER_STATE,
        cgstTotal: '90',
        sgstTotal: '90',
        igstTotal: '0',
        cessTotal: '0',
        taxTotal: '180',
      }),
    ).toThrowError(/inter-state supply is taxed with IGST/i);
  });

  it('rejects IGST on an intra-state supply', () => {
    expect(() =>
      assertGstTotalsConsistent({
        supplyType: SUPPLY_TYPE.INTRA_STATE,
        cgstTotal: '0',
        sgstTotal: '0',
        igstTotal: '180',
        cessTotal: '0',
        taxTotal: '180',
      }),
    ).toThrowError(/intra-state supply is taxed with CGST and SGST/i);
  });

  it('rejects components that do not add up to the tax charged', () => {
    expect(() =>
      assertGstTotalsConsistent({
        supplyType: SUPPLY_TYPE.INTRA_STATE,
        cgstTotal: '90',
        sgstTotal: '90',
        igstTotal: '0',
        cessTotal: '0',
        taxTotal: '200',
      }),
    ).toThrowError(/do not add up/i);
  });

  it('allows a pre-GST document, which has no split at all', () => {
    // A company that never enabled GST posts a single tax amount and no split.
    expect(() =>
      assertGstTotalsConsistent({
        supplyType: null,
        cgstTotal: '0',
        sgstTotal: '0',
        igstTotal: '0',
        cessTotal: '0',
        taxTotal: '180',
      }),
    ).not.toThrow();
  });

  it('rejects a split on a document that has no place of supply', () => {
    expect(() =>
      assertGstTotalsConsistent({
        supplyType: null,
        cgstTotal: '90',
        sgstTotal: '90',
        igstTotal: '0',
        cessTotal: '0',
        taxTotal: '180',
      }),
    ).toThrowError(/no place of supply/i);
  });
});

describe('multi-rate documents', () => {
  it('totals a 5% + 12% + 18% invoice from its lines', () => {
    const lines = [
      calculateLine({
        quantity: '10',
        unitCost: '100',
        discountType: 'NONE',
        discountValue: '0',
        taxRate: '5',
        index: 0,
        gst: { supplyType: SUPPLY_TYPE.INTRA_STATE, ...gstRates(5) },
      }),
      calculateLine({
        quantity: '5',
        unitCost: '200',
        discountType: 'NONE',
        discountValue: '0',
        taxRate: '12',
        index: 1,
        gst: { supplyType: SUPPLY_TYPE.INTRA_STATE, ...gstRates(12) },
      }),
      calculateLine({
        quantity: '2',
        unitCost: '500',
        discountType: 'NONE',
        discountValue: '0',
        taxRate: '18',
        index: 2,
        gst: { supplyType: SUPPLY_TYPE.INTRA_STATE, ...gstRates(18) },
      }),
    ];

    const totals = calculateTotals(lines);

    // 1000 + 1000 + 1000 taxable; tax 50 + 120 + 180.
    expect(totals.subtotal.toString()).toBe('3000');
    expect(totals.taxTotal.toString()).toBe('350');
    expect(totals.cgstTotal.toString()).toBe('175');
    expect(totals.sgstTotal.toString()).toBe('175');
    expect(totals.igstTotal.toString()).toBe('0');
    expect(totals.grandTotal.toString()).toBe('3350');

    // The document total is exactly the sum of the line components.
    expect(totals.cgstTotal.plus(totals.sgstTotal).toFixed(4)).toBe(totals.taxTotal.toFixed(4));
  });

  it('sums the components of several lines', () => {
    const summed = sumGstComponents([
      { cgstAmount: '25', sgstAmount: '25', igstAmount: '0', cessAmount: '0' },
      { cgstAmount: '60', sgstAmount: '60', igstAmount: '0', cessAmount: '5' },
    ]);

    expect(summed.cgstTotal.toString()).toBe('85');
    expect(summed.sgstTotal.toString()).toBe('85');
    expect(summed.cessTotal.toString()).toBe('5');
  });

  it('treats a line with no tax as contributing nothing', () => {
    const summed = sumGstComponents([{}, { cgstAmount: '10' }]);
    expect(summed.cgstTotal.toString()).toBe('10');
    expect(summed.igstTotal.toString()).toBe('0');
  });
});

describe('a rate has an effective window', () => {
  const march = new Date('2026-03-01T00:00:00.000Z');
  const june = new Date('2026-06-01T00:00:00.000Z');
  const december = new Date('2026-12-01T00:00:00.000Z');

  it('applies when there is no window at all', () => {
    expect(isTaxEffectiveOn({ effectiveFrom: null, effectiveTo: null }, june)).toBe(true);
  });

  it('does not apply before it starts', () => {
    expect(isTaxEffectiveOn({ effectiveFrom: june, effectiveTo: null }, march)).toBe(false);
    expect(isTaxEffectiveOn({ effectiveFrom: june, effectiveTo: null }, june)).toBe(true);
  });

  it('does not apply after it ends', () => {
    expect(isTaxEffectiveOn({ effectiveFrom: null, effectiveTo: june }, december)).toBe(false);
    expect(isTaxEffectiveOn({ effectiveFrom: null, effectiveTo: june }, june)).toBe(true);
  });

  it('applies to any document when the date is unknown', () => {
    expect(isTaxEffectiveOn({ effectiveFrom: june, effectiveTo: june }, null)).toBe(true);
  });
});

describe('tax-inclusive pricing', () => {
  it('works back to the taxable amount from a tax-inclusive price', () => {
    // 1180 including 18% is 1000 plus 180.
    expect(taxableAmountFromInclusive('1180', '18').toString()).toBe('1000');
    expect(taxableAmountFromInclusive('1050', '5').toString()).toBe('1000');
  });

  it('returns the amount unchanged at a zero rate', () => {
    expect(taxableAmountFromInclusive('1000', '0').toString()).toBe('1000');
  });

  it('rejects a negative rate', () => {
    expect(() => taxableAmountFromInclusive('1000', '-5')).toThrowError(/cannot be negative/i);
  });
});
