import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import { logger } from '../../utils/logger.js';
import { extractWithLlamaCloud } from './llamacloud.client.js';

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

  /** The model's own view of how legible the bill was. Advisory only. */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).nullable().optional().default(null),
  notes: z.string().trim().max(1000).nullable().optional().default(null),
});

const SYSTEM_PROMPT = [
  'You are reading a photograph or PDF of an Indian retail or wholesale bill.',
  '',
  'Rules:',
  '- Transcribe what is printed. Never calculate, correct or infer a missing value.',
  '- If a field is not clearly legible, leave it out. Do not guess.',
  '- Money and quantities: digits only, a dot for decimals, no currency symbol, no thousands separators.',
  '- Dates: YYYY-MM-DD. An Indian bill showing 03/04/2025 means 3 April 2025.',
  '- Return every line item you can read, in the order printed.',
  '- amountPaid is what was paid on the spot (Paid, Cash, Received); balanceDue is what is still owing.',
  '- confidence: HIGH if the bill is crisp and complete, MEDIUM if parts are unclear, LOW if you are mostly guessing.',
].join('\n');

/**
 * The same shape as extractionSchema, in the JSON Schema the vendor accepts.
 *
 * IT IS NOT THE VALIDATION. Whatever comes back is still forced through
 * extractionSchema below - this only tells the reader what to look for, and a
 * service that ignored it would change nothing about what reaches the books.
 */
const money = (what) => ({ type: 'string', description: `${what}, digits only, e.g. "1234.50"` });

const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    partyName: { type: 'string', description: 'The other business on the bill, as printed' },
    partyGstin: { type: 'string', description: 'Their 15-character GSTIN, if printed' },
    partyPhone: { type: 'string', description: 'Their phone number, if printed' },
    partyAddress: { type: 'string', description: 'Their address, if printed' },
    invoiceNumber: { type: 'string', description: 'The bill or invoice number' },
    invoiceDate: { type: 'string', description: 'The bill date as YYYY-MM-DD' },
    subtotal: money('Total before tax'),
    totalTax: money('Total tax charged'),
    totalDiscount: money('Total discount given'),
    grandTotal: money('The final amount payable'),
    amountPaid: money('Amount already paid, shown as Paid, Cash paid or Received'),
    balanceDue: money('Amount still owing, shown as Balance, Due or Credit'),
    confidence: {
      type: 'string',
      description: 'HIGH if the bill is crisp and complete, MEDIUM if parts are unclear, LOW if mostly guessing',
    },
    notes: { type: 'string', description: 'Anything unclear or unusual about this bill' },
    lines: {
      type: 'array',
      description: 'One entry per line item printed on the bill, in order',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'The item name as printed' },
          hsnCode: { type: 'string', description: 'HSN or SAC code, if printed' },
          quantity: money('Quantity'),
          unit: { type: 'string', description: 'Unit such as kg, pcs, box' },
          unitPrice: money('Price per unit'),
          discount: money('Discount on this line'),
          taxRate: money('Tax percentage on this line'),
          lineTotal: money('Total for this line'),
        },
      },
    },
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
  if (!isExtractionConfigured()) {
    throw ApiError.business(
      503,
      'EXTRACTION_NOT_CONFIGURED',
      'Automatic bill reading is not set up on this server. Enter the bill manually for now.',
    );
  }

  // WORDING, NOT LOGIC. The direction only tells the reader whose bill this is.
  // What gets posted is decided later, by the person who reviews it.
  const wording =
    direction === 'IN'
      ? 'This is a bill this shop RECEIVED from a supplier.'
      : 'This is a bill this shop ISSUED to a customer.';

  const { result, model } = await extractWithLlamaCloud(fileBuffer, mimeType, {
    jsonSchema: EXTRACTION_JSON_SCHEMA,
    systemPrompt: `${SYSTEM_PROMPT}\n\n${wording}`,
  });

  // An object is what this service returns. A string is still accepted, because
  // wrapping JSON in prose is a known habit of the things that read documents.
  const parsedJson = typeof result === 'string' ? extractJsonObject(result) : result;


  if (!parsedJson) {
    throw ApiError.business(
      422,
      'EXTRACTION_UNREADABLE',
      'The bill could not be read. Try a clearer, straight-on photo, or enter it manually.',
    );
  }

  // THE GATE. Whatever the model produced is now forced through the same kind of
  // schema a request body goes through. A hallucinated extra field is dropped; a
  // total that came back as "approximately 4500" becomes null rather than
  // becoming a number nobody typed.
  const validated = extractionSchema.safeParse(parsedJson);

  if (!validated.success) {
    logger.warn(
      { issues: validated.error.issues.slice(0, 5) },
      'Bill extraction did not match the expected shape',
    );
    throw ApiError.business(
      422,
      'EXTRACTION_INVALID',
      'The bill was read but the result did not make sense. Enter it manually.',
    );
  }

  return {
    data: validated.data,
    model,
    /** Kept verbatim for audit - what the model actually said, before our shaping. */
    raw: parsedJson,
  };
}
