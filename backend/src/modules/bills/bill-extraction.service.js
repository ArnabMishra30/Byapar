import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import { logger } from '../../utils/logger.js';
import { extractWithLlamaCloud } from './llamacloud.client.js';
import { normalizeInvoice } from './bill-normalize.js';

// READING A BILL WITH A MODEL.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: what comes back from the model is
// UNTRUSTED INPUT. It is treated exactly the way a request body is treated -
// parsed, validated, coerced, and rejected if it is not the shape we asked for.
// Nothing it returns is ever posted to the books. It lands in a REVIEW record
// that a human confirms, and the confirmation is what posts.
//
// That is not caution about this particular model. An OCR pass over a creased
// photo of a handwritten bill will misread digits sometimes, and a system that
// posted those directly would be manufacturing false accounting records at
// scale, silently. The review step is the product, not an obstacle to it.
//
// THE API KEY NEVER LEAVES THIS PROCESS. It is read from env here, used in the
// Authorization header here, and appears nowhere else - no response body, no log
// line, no error message, and above all nothing prefixed NEXT_PUBLIC_. The
// browser uploads a file to our server; our server talks to the model.

/**
 * The shape we demand back. Everything is nullable, because a real bill often
 * genuinely lacks a field and inventing one would be worse than admitting it.
 *
 * MONEY IS A STRING. It travels as a string from the model, through validation,
 * into the review record, and reaches the existing purchase/sales services as a
 * string, which turn it into Decimal. It never passes through a JavaScript
 * float, because 0.1 + 0.2 has no place anywhere near an invoice total.
 */
const moneyLike = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim().replace(/[,\s₹]/g, '');
    return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
  });

const quantityLike = moneyLike;

const lineSchema = z.object({
  description: z.string().trim().max(500).nullable().optional().default(null),
  hsnCode: z.string().trim().max(20).nullable().optional().default(null),
  batch: z.string().trim().max(60).nullable().optional().default(null),
  quantity: quantityLike,
  unit: z.string().trim().max(30).nullable().optional().default(null),
  unitPrice: moneyLike,
  discount: moneyLike,
  taxRate: moneyLike,
  lineTotal: moneyLike,
});

export const extractionSchema = z.object({
  /** Who the bill is from or to, as printed. Matched to a party during review. */
  partyName: z.string().trim().max(200).nullable().optional().default(null),
  partyGstin: z.string().trim().max(20).nullable().optional().default(null),
  partyPhone: z.string().trim().max(30).nullable().optional().default(null),
  partyAddress: z.string().trim().max(500).nullable().optional().default(null),

  invoiceNumber: z.string().trim().max(60).nullable().optional().default(null),
  invoiceDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .catch(null)
    .default(null),

  subtotal: moneyLike,
  totalTax: moneyLike,
  totalDiscount: moneyLike,
  grandTotal: moneyLike,

  /** Paid on the spot, and what is left owing. A paper bill usually says both. */
  amountPaid: moneyLike,
  balanceDue: moneyLike,

  lines: z.array(lineSchema).max(200).optional().default([]),

  /** How it was paid, as printed ("Cash", "UPI", "Credit"). */
  paymentMode: z.string().trim().max(60).nullable().optional().default(null),

  /** The model's own view of how legible the bill was. Advisory only. */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).nullable().optional().default(null),
  notes: z.string().trim().max(1000).nullable().optional().default(null),

  /** What the reader changed or doubts - shown on the review screen. */
  warnings: z.array(z.string().max(300)).max(50).optional().default([]),
});

const SYSTEM_PROMPT = [
  'You are reading a photograph or PDF of Indian bills (tax invoices, retail bills, cash memos).',
  '',
  'Rules:',
  '- One file may hold SEVERAL separate invoices (e.g. one per page, each with its own invoice number). Return each one as its own entry in "invoices", in order. Never merge two invoices.',
  '- For every invoice give BOTH sides: the seller (who issued it - the name in the header) and the buyer (Bill To / Customer). "Walk-in Customer" is a valid buyer name.',
  '- Transcribe what is printed. Do not invent values that are not on the bill.',
  '- Money: digits and a dot only, no currency symbol (the rupee sign may appear as ■ or a box), no thousands separators.',
  '- Quantities: copy the quantity cell exactly into quantityText, including any unit written in it ("2 Kg", "500 g", "4 pcs"). Put the unit the RATE is charged per (often from the item name or column header) in unit when it is clear.',
  '- HSN/SAC: copy as printed, keeping leading zeros ("0713"). A Batch / Lot column is NOT the HSN and NOT the quantity - put it in batch.',
  '- Tax: list every tax row of the totals box in taxLines (e.g. CGST @ 2.5% -> label "CGST", rate 2.5, amount). Only fill a line\'s taxRate when the line itself prints a rate.',
  '- grandTotal is the final total figure (Total / Grand Total / Net Amount), not the rounded amount in words.',
  '- paymentMode: what the bill says about payment ("Cash", "UPI", "Credit") if printed. amountPaid / balanceDue only if printed as amounts.',
  '- GSTIN: copy exactly as printed, even if it looks fake. Phone: copy as printed, even if masked with X.',
  '- Dates: copy as printed, or YYYY-MM-DD. Indian dates are day first: 03/04/2025 is 3 April 2025.',
  '- Return every line item in printed order. Skip subtotal / tax / total rows - they are not items.',
  '- confidence: HIGH if crisp and complete, MEDIUM if parts are unclear, LOW if you are mostly guessing.',
].join('\n');

/**
 * What we ask the vendor for. Richer than the review shape on purpose: both
 * parties, the tax rows and the quantity cell exactly as printed, so the
 * deterministic rules in bill-normalize.js - not the model - do the arithmetic.
 *
 * IT IS NOT THE VALIDATION. Whatever comes back is normalized and then forced
 * through extractionSchema.
 */
const str = (description) => ({ type: 'string', description });
const amount = (what) => str(`${what}, digits only, e.g. "1234.50"`);

const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    sellerName: str('Business that issued the bill (the header name)'),
    sellerGstin: str('Seller GSTIN exactly as printed'),
    sellerPhone: str('Seller phone exactly as printed'),
    sellerAddress: str('Seller address'),
    buyerName: str('Bill To / Customer name, e.g. "Walk-in Customer"'),
    buyerGstin: str('Buyer GSTIN exactly as printed'),
    buyerPhone: str('Buyer phone exactly as printed'),
    buyerAddress: str('Buyer address / place'),
    invoiceNumber: str('Invoice / Bill number'),
    invoiceDate: str('Invoice date as printed or YYYY-MM-DD'),
    paymentMode: str('Payment as printed: Cash, UPI, Card, Credit...'),
    subtotal: amount('Taxable amount / total before tax'),
    taxLines: {
      type: 'array',
      description: 'Each tax row of the totals box',
      items: {
        type: 'object',
        properties: {
          label: str('CGST, SGST, IGST, CESS or VAT'),
          rate: amount('Percentage, e.g. "2.5"'),
          amount: amount('Tax amount'),
        },
      },
    },
    totalTax: amount('Total tax, if printed as one figure'),
    totalDiscount: amount('Total discount'),
    roundOff: amount('Round off adjustment, negative if subtracted'),
    grandTotal: amount('Final total payable'),
    amountPaid: amount('Amount paid, if printed as an amount'),
    balanceDue: amount('Balance / due, if printed as an amount'),
    notes: str('Anything unclear or unusual'),
    lines: {
      type: 'array',
      description: 'One entry per item row, in printed order',
      items: {
        type: 'object',
        properties: {
          description: str('Item name as printed'),
          hsnCode: str('HSN/SAC exactly as printed, keep leading zeros'),
          batch: str('Batch / lot number, if there is such a column'),
          quantityText: str('The quantity cell exactly as printed, e.g. "2", "500 g", "4 pcs"'),
          unit: str('Unit the rate is charged per: kg, g, l, ml, pcs, box...'),
          unitPrice: amount('Rate per unit'),
          discount: amount('Discount on this line'),
          taxRate: amount('Tax percentage printed on this line'),
          lineTotal: amount('Amount for this line'),
        },
      },
    },
  },
};

const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    invoices: { type: 'array', description: 'Every separate invoice in the file, in order', items: INVOICE_SCHEMA },
    confidence: str('HIGH, MEDIUM or LOW'),
  },
};

/** Whether bill extraction can run at all. */
export function isExtractionConfigured() {
  return Boolean(env.LLAMA_API_KEY);
}

/**
 * Pulls the first JSON object out of a model response.
 *
 * Models wrap JSON in code fences and add a friendly sentence in front of it
 * however firmly they are asked not to, so this is expected rather than
 * exceptional.
 */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;

  const withoutFences = text
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Asks the model to read a bill.
 *
 * @param {Buffer} fileBuffer
 * @param {string} mimeType
 * @param {'IN'|'OUT'} direction  only used to word the prompt
 * @returns {Promise<{ data: object, model: string, raw: object }>}
 */
export async function extractBill(fileBuffer, mimeType, direction) {
  const documents = await extractBillDocuments(fileBuffer, mimeType, direction);
  const [first] = documents;
  return {
    data: first.data,
    model: first.model,
    raw: first.raw,
    /** Every invoice found in the file. More than one: each becomes its own bill. */
    documents,
  };
}

/**
 * Reads every invoice in a file.
 *
 * @returns {Promise<Array<{ data: object, model: string, raw: object }>>}
 */
export async function extractBillDocuments(fileBuffer, mimeType, direction) {
  if (!isExtractionConfigured()) {
    throw ApiError.business(
      503,
      'EXTRACTION_NOT_CONFIGURED',
      'Automatic bill reading is not set up on this server. Enter the bill manually for now.',
    );
  }

  // The direction decides which side of the bill is "the party": the seller on
  // a bill we received, the buyer on one we issued.
  const wording =
    direction === 'IN'
      ? 'This shop RECEIVED these bills from a supplier (the seller is the supplier).'
      : 'This shop ISSUED these bills to customers (the buyer is the customer).';

  const { result, model } = await extractWithLlamaCloud(fileBuffer, mimeType, {
    jsonSchema: EXTRACTION_JSON_SCHEMA,
    systemPrompt: `${SYSTEM_PROMPT}\n\n${wording}`,
  });

  const parsedJson = typeof result === 'string' ? extractJsonObject(result) : result;
  if (!parsedJson) {
    throw ApiError.business(
      422,
      'EXTRACTION_UNREADABLE',
      'The bill could not be read. Try a clearer, straight-on photo, or enter it manually.',
    );
  }

  // An older-style single bill (no "invoices" list) is still accepted.
  const rawInvoices = Array.isArray(parsedJson.invoices) ? parsedJson.invoices : [parsedJson];
  const documents = [];

  rawInvoices.forEach((rawInvoice, index) => {
    if (!rawInvoice || typeof rawInvoice !== 'object') return;
    const normalized = normalizeInvoice(
      { ...rawInvoice, confidence: rawInvoice.confidence ?? parsedJson.confidence },
      direction,
    );
    if (!normalized.invoiceNumber && !normalized.grandTotal && normalized.lines.length === 0) return;

    // THE GATE. The normalized result still faces the schema a request body would.
    const validated = extractionSchema.safeParse(normalized);
    if (!validated.success) {
      logger.warn({ issues: validated.error.issues.slice(0, 5) }, 'Bill extraction did not match the expected shape');
      return;
    }
    documents.push({
      data: validated.data,
      model,
      // Verbatim, for audit: what the model said for THIS invoice, and where it sat.
      raw: { documentIndex: index, documentCount: rawInvoices.length, invoice: rawInvoice },
    });
  });

  if (documents.length === 0) {
    throw ApiError.business(
      422,
      'EXTRACTION_INVALID',
      'The bill was read but the result did not make sense. Enter it manually.',
    );
  }
  return documents;
}
