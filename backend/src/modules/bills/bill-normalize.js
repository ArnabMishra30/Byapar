// TURNING WHAT THE MODEL READ INTO A BILL WE CAN TRUST TO SHOW.
//
// Pure functions, no I/O, so every rule is unit-tested. The model transcribes;
// this file applies the arithmetic and the rules a careful clerk would:
//
//   - the party is the SELLER on a bill we received and the BUYER on one we
//     issued, so the right name is picked from whichever side was printed;
//   - a GSTIN that is not a real GSTIN ("DEMO-GSTIN-NOT-VALID") and a phone
//     with Xs in it are dropped, not saved;
//   - "500 g" of a sweet priced per kg is 0.5 kg - proven by quantity x rate =
//     amount - never 500;
//   - a tax rate printed once at the bottom (CGST 2.5% + SGST 2.5%) applies to
//     every line;
//   - "Payment: Cash / UPI" on a bill with nothing owing means paid in full;
//   - HSN codes keep their leading zero (0713 is not 713);
//   - dates in any Indian layout become YYYY-MM-DD.
//
// Anything it changes or doubts is said in `warnings`, which the review screen
// shows. Nothing here decides what gets posted - the person reviewing does.

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "₹1,250.50", "Rs. 1250.5", 1250.5 -> "1250.5"; anything else -> null. */
export function toNumberText(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value)
    .replace(/[■₹,\s]/g, '')
    .replace(/^(rs\.?|inr)/i, '')
    .trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
}

const num = (value) => {
  const text = toNumberText(value);
  return text === null ? null : Number(text);
};

/** Two decimals, as a string, without float noise. */
const money = (value) => (value === null || value === undefined || Number.isNaN(value) ? null : (Math.round(value * 100) / 100).toFixed(2));

/** Up to 3 decimals, trailing zeros off: 0.5, 2, 1.25. */
const qty = (value) => (value === null || value === undefined ? null : String(Math.round(value * 1000) / 1000));

const close = (a, b, tolerance = 0.01) => a !== null && b !== null && Math.abs(a - b) <= tolerance;

export function normalizeGstin(value) {
  const text = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  return GSTIN.test(text) ? text : null;
}

/** A usable 10-digit Indian phone, or null for "98XXXXXXXX" and the like. */
export function normalizePhone(value) {
  const text = String(value ?? '');
  if (!text || /x/i.test(text)) return null;
  const digits = text.replace(/\D+/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** 06-Oct-2026, 06/10/2026, 6.10.26, 2026-10-06, October 6, 2026 -> 2026-10-06. */
export function normalizeDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const year4 = (y) => (y < 100 ? 2000 + y : y);
  const valid = (y, m, d) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  };
  const out = (y, m, d) => (valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null);

  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return out(Number(m[1]), Number(m[2]), Number(m[3]));
  // Indian order: day first.
  m = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) return out(year4(Number(m[3])), Number(m[2]), Number(m[1]));
  m = text.match(/^(\d{1,2})[\s./-]*([A-Za-z]{3,9})[\s.,/-]*(\d{2,4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return out(year4(Number(m[3])), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
  }
  m = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return out(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  return null;
}

/** HSN/SAC as printed, digits only; a 3/5/7-digit one lost its leading zero. */
export function normalizeHsn(value) {
  const text = String(value ?? '').replace(/\s+/g, '');
  if (!text) return null;
  if (!/^\d+$/.test(text)) return null;
  return text.length % 2 === 1 && text.length < 8 ? `0${text}` : text;
}

const UNIT_ALIASES = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', gr: 'g',
  l: 'l', ltr: 'l', ltrs: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l', lt: 'l',
  ml: 'ml', mls: 'ml',
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', nos: 'pcs', no: 'pcs', unit: 'pcs', units: 'pcs', pkt: 'pack', pack: 'pack', packet: 'pack',
  box: 'box', boxes: 'box', doz: 'dozen', dozen: 'dozen', dz: 'dozen', bag: 'bag', bags: 'bag', btl: 'bottle', bottle: 'bottle',
  m: 'm', mtr: 'm', meter: 'm', metre: 'm', ft: 'ft', feet: 'ft',
};

export function normalizeUnit(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!key) return null;
  return UNIT_ALIASES[key] ?? key.slice(0, 20);
}

/** "500 g" -> { quantity: 500, unit: 'g' }; "2" -> { quantity: 2, unit: null }. */
export function parseQuantityText(value) {
  const text = String(value ?? '').trim();
  const m = text.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z.]*)$/);
  if (!m) return { quantity: num(text), unit: null };
  return { quantity: Number(m[1]), unit: m[2] ? normalizeUnit(m[2]) : null };
}

// A smaller unit sold at a bigger unit's price: 500 g at a per-kg rate.
const SMALLER_UNIT = { g: { to: 'kg', factor: 1000 }, ml: { to: 'l', factor: 1000 } };

/**
 * One line, made consistent: quantity x rate = amount.
 * @returns {{ line: object, warnings: string[] }}
 */
export function normalizeLine(raw) {
  const warnings = [];
  const name = String(raw.description ?? '').trim() || null;
  const parsed = parseQuantityText(raw.quantityText ?? raw.quantity);
  let quantity = parsed.quantity ?? num(raw.quantity);
  let unit = normalizeUnit(raw.unit) ?? parsed.unit;
  // "Red Label Tea 250 g" x 1 is one packet, not one gram: a unit that only
  // comes from the pack size in the name is not the unit being sold.
  if (unit && !parsed.unit && name) {
    const sizes = [...name.matchAll(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g)].map((m) => normalizeUnit(m[2]));
    if (sizes.includes(unit)) unit = null;
  }
  const rate = num(raw.unitPrice);
  const amount = num(raw.lineTotal);
  const discount = num(raw.discount);
  const gross = (q) => (q === null || rate === null ? null : q * rate - (discount ?? 0));

  if (quantity !== null && rate !== null && amount !== null && !close(gross(quantity), amount, 0.05)) {
    const smaller = SMALLER_UNIT[unit];
    if (smaller && close(gross(quantity / smaller.factor), amount, 0.05)) {
      warnings.push(`${name}: ${qty(quantity)} ${unit} at the per-${smaller.to} price - read as ${qty(quantity / smaller.factor)} ${smaller.to}`);
      quantity /= smaller.factor;
      unit = smaller.to;
    } else if (rate > 0) {
      const implied = (amount + (discount ?? 0)) / rate;
      if (Math.abs(implied * 1000 - Math.round(implied * 1000)) < 1e-6) {
        warnings.push(`${name}: quantity ${qty(quantity)} did not match rate x amount - read as ${qty(implied)}`);
        quantity = implied;
      } else {
        warnings.push(`${name}: quantity x rate does not equal the amount printed - please check`);
      }
    }
  }
  // Only an amount and a quantity: the rate follows.
  const unitPrice = rate ?? (amount !== null && quantity ? (amount + (discount ?? 0)) / quantity : null);

  return {
    line: {
      description: name,
      hsnCode: normalizeHsn(raw.hsnCode),
      batch: String(raw.batch ?? '').trim() || null,
      quantity: qty(quantity),
      unit,
      unitPrice: money(unitPrice),
      discount: discount === null ? null : money(discount),
      taxRate: num(raw.taxRate) === null ? null : qty(num(raw.taxRate)),
      lineTotal: amount === null ? (quantity !== null && unitPrice !== null ? money(gross(quantity)) : null) : money(amount),
    },
    warnings: warnings.map((w) => w.slice(0, 300)).slice(0, 50),
  };
}

const PAID_WORDS = /\b(cash|upi|card|paid|online|gpay|phonepe|paytm|neft|imps|rtgs|bank\s*transfer|cheque)\b/i;
const CREDIT_WORDS = /\b(credit|due|unpaid|pending|balance)\b/i;

/**
 * One invoice as read by the model -> the review shape, with warnings.
 * @param {'IN'|'OUT'} direction IN = a supplier's bill (party = seller)
 */
export function normalizeInvoice(raw, direction) {
  const warnings = [];
  const pick = (seller, buyer) => (direction === 'IN' ? seller : buyer);

  const party = {
    name: pick(raw.sellerName, raw.buyerName) ?? null,
    gstin: pick(raw.sellerGstin, raw.buyerGstin),
    phone: pick(raw.sellerPhone, raw.buyerPhone),
    address: pick(raw.sellerAddress, raw.buyerAddress),
  };
  const partyGstin = normalizeGstin(party.gstin);
  if (party.gstin && !partyGstin) warnings.push(`GSTIN "${String(party.gstin).trim()}" is not a valid GSTIN - left blank`);

  const lines = [];
  for (const rawLine of raw.lines ?? []) {
    if (!rawLine || (!rawLine.description && !rawLine.lineTotal)) continue;
    const { line, warnings: lineWarnings } = normalizeLine(rawLine);
    lines.push(line);
    warnings.push(...lineWarnings);
  }

  // Tax printed once for the whole bill: one combined rate for every line.
  const taxLines = (raw.taxLines ?? [])
    .map((t) => ({ label: String(t.label ?? ''), rate: num(t.rate), amount: num(t.amount) }))
    .filter((t) => t.amount !== null || t.rate !== null);
  const totalTax = num(raw.totalTax) ?? (taxLines.length ? taxLines.reduce((s, t) => s + (t.amount ?? 0), 0) : null);
  const combinedRate = (() => {
    const rated = taxLines.filter((t) => t.rate !== null && !/cess/i.test(t.label));
    if (rated.length === 0) return null;
    const isIgst = rated.some((t) => /igst/i.test(t.label));
    return isIgst ? rated.find((t) => /igst/i.test(t.label)).rate : rated.reduce((s, t) => s + t.rate, 0);
  })();
  const distinctLineRates = new Set(lines.map((l) => l.taxRate).filter(Boolean));
  if (combinedRate !== null && distinctLineRates.size === 0 && lines.length > 0) {
    for (const line of lines) line.taxRate = qty(combinedRate);
  }

  const linesSum = lines.reduce((s, l) => s + (num(l.lineTotal) ?? 0), 0);
  const subtotal = num(raw.subtotal) ?? (lines.length ? linesSum : null);
  const grandTotal = num(raw.grandTotal);
  const roundOff = num(raw.roundOff) ?? 0;

  if (lines.length && subtotal !== null && !close(linesSum, subtotal, 1)) {
    warnings.push(`The items add up to ${money(linesSum)}, but the bill says ${money(subtotal)} before tax - a line may be misread`);
  }
  if (grandTotal !== null && subtotal !== null) {
    const expected = subtotal + (totalTax ?? 0) - (num(raw.totalDiscount) ?? 0) + roundOff;
    if (!close(expected, grandTotal, 1)) {
      warnings.push(`Subtotal + tax is ${money(expected)}, but the total printed is ${money(grandTotal)} - please check`);
    }
  }

  // Paid on the spot: what the bill says, else a payment mode with nothing owing.
  let amountPaid = num(raw.amountPaid);
  const balanceDue = num(raw.balanceDue);
  const paymentMode = String(raw.paymentMode ?? '').trim() || null;
  if (amountPaid === null && grandTotal !== null && paymentMode && PAID_WORDS.test(paymentMode) && !CREDIT_WORDS.test(paymentMode) && !(balanceDue > 0)) {
    amountPaid = grandTotal;
    warnings.push(`Marked paid in full (bill says "Payment: ${paymentMode}")`);
  }

  return {
    partyName: party.name ? String(party.name).trim() : null,
    partyGstin,
    partyPhone: normalizePhone(party.phone),
    partyAddress: party.address ? String(party.address).trim() : null,
    invoiceNumber: raw.invoiceNumber ? String(raw.invoiceNumber).trim() : null,
    invoiceDate: normalizeDate(raw.invoiceDate),
    paymentMode,
    subtotal: money(subtotal),
    totalTax: money(totalTax),
    totalDiscount: money(num(raw.totalDiscount)),
    grandTotal: money(grandTotal),
    amountPaid: money(amountPaid),
    balanceDue: money(balanceDue),
    lines,
    confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(raw.confidence) ? raw.confidence : null,
    notes: raw.notes ? String(raw.notes).slice(0, 1000) : null,
    warnings: warnings.map((w) => w.slice(0, 300)).slice(0, 50),
  };
}
