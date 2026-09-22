import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import { logger } from '../../utils/logger.js';

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

  lines: z.array(lineSchema).max(200).optional().default([]),

  /** The model's own view of how legible the bill was. Advisory only. */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).nullable().optional().default(null),
  notes: z.string().trim().max(1000).nullable().optional().default(null),
});

const SYSTEM_PROMPT = [
  'You read photographs and PDFs of Indian retail and wholesale bills and return structured data.',
  '',
  'Return ONLY a JSON object. No prose, no markdown, no code fences.',
  '',
  'Rules:',
  '- Transcribe what is printed. Never calculate, correct or infer a missing value.',
  '- If a field is not clearly legible, return null for it. Do not guess.',
  '- Money and quantities: digits only, a dot for decimals, no currency symbol, no thousands separators.',
  '- Dates: YYYY-MM-DD. An Indian bill showing 03/04/2025 means 3 April 2025.',
  '- Return every line item you can read, in the order printed.',
  '- confidence: HIGH if the bill is crisp and complete, MEDIUM if parts are unclear, LOW if you are mostly guessing.',
  '',
  'Schema:',
  '{"partyName":string|null,"partyGstin":string|null,"partyPhone":string|null,"partyAddress":string|null,',
  '"invoiceNumber":string|null,"invoiceDate":"YYYY-MM-DD"|null,"subtotal":string|null,"totalTax":string|null,',
  '"totalDiscount":string|null,"grandTotal":string|null,"confidence":"HIGH"|"MEDIUM"|"LOW","notes":string|null,',
  '"lines":[{"description":string|null,"hsnCode":string|null,"quantity":string|null,"unit":string|null,',
  '"unitPrice":string|null,"discount":string|null,"taxRate":string|null,"lineTotal":string|null}]}',
].join('\n');

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

  const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
  const wording =
    direction === 'IN'
      ? 'This is a bill this shop RECEIVED from a supplier.'
      : 'This is a bill this shop ISSUED to a customer.';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LLAMA_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${env.LLAMA_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // The secret. Read from env, used here, and nowhere else in the system.
        Authorization: `Bearer ${env.LLAMA_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.LLAMA_MODEL,
        temperature: 0,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `${wording} Read it and return the JSON object.` },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    clearTimeout(timer);

    if (error.name === 'AbortError') {
      throw ApiError.business(
        504,
        'EXTRACTION_TIMEOUT',
        'Reading the bill took too long. Try again, or enter it manually.',
      );
    }

    // The vendor's error may quote the request. Log ours, show the user none of it.
    logger.error({ err: error.message }, 'Bill extraction request failed');
    throw ApiError.business(
      502,
      'EXTRACTION_UNAVAILABLE',
      'The bill reading service could not be reached. Try again, or enter it manually.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Body may echo the Authorization header back in some vendors' errors, so it
    // is logged at a length that is useful and never returned to the caller.
    const body = await response.text().catch(() => '');
    logger.error(
      { status: response.status, body: body.slice(0, 500) },
      'Bill extraction returned an error',
    );

    throw ApiError.business(
      response.status === 429 ? 429 : 502,
      response.status === 429 ? 'EXTRACTION_RATE_LIMITED' : 'EXTRACTION_FAILED',
      response.status === 429
        ? 'The bill reading service is busy. Wait a moment and try again.'
        : 'The bill could not be read automatically. Enter it manually, or try another photo.',
    );
  }

  const payload = await response.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content;

  // Some responses come back as an array of content parts rather than a string.
  const text = Array.isArray(content)
    ? content.map((part) => part?.text ?? '').join('')
    : content;

  const parsedJson = extractJsonObject(text);

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
    model: env.LLAMA_MODEL,
    /** Kept verbatim for audit - what the model actually said, before our shaping. */
    raw: parsedJson,
  };
}
