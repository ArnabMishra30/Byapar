import { describe, it, expect } from 'vitest';
import {
  extractJsonObject,
  extractionSchema,
} from '../../src/modules/bills/bill-extraction.service.js';
import {
  sanitizeFilename,
  looksLikeDeclaredType,
  ACCEPTED_MIME_TYPES,
} from '../../src/modules/bills/bill-storage.service.js';

// THE UNTRUSTED BOUNDARY.
//
// Everything a model returns is treated the way a request body is treated. These
// tests are the proof of that, and they are deliberately hostile: they feed the
// parser the kinds of things a language model actually does on a bad day.

describe('extractJsonObject', () => {
  it('reads a plain JSON object', () => {
    expect(extractJsonObject('{"partyName":"ABC"}')).toEqual({ partyName: 'ABC' });
  });

  it('reads JSON out of a markdown code fence', () => {
    const text = '```json\n{"partyName":"ABC"}\n```';
    expect(extractJsonObject(text)).toEqual({ partyName: 'ABC' });
  });

  it('reads JSON despite a chatty preamble', () => {
    const text = 'Sure! Here is the bill data:\n\n{"partyName":"ABC"}\n\nLet me know if you need more.';
    expect(extractJsonObject(text)).toEqual({ partyName: 'ABC' });
  });

  it('returns null for prose with no JSON at all', () => {
    expect(extractJsonObject('I cannot read this image.')).toBeNull();
  });

  it('returns null for malformed JSON rather than guessing', () => {
    expect(extractJsonObject('{"partyName": }')).toBeNull();
  });

  it('returns null for a non-string input', () => {
    expect(extractJsonObject(null)).toBeNull();
    expect(extractJsonObject(undefined)).toBeNull();
    expect(extractJsonObject(42)).toBeNull();
  });
});

describe('extractionSchema', () => {
  it('accepts a well-formed extraction', () => {
    const result = extractionSchema.safeParse({
      partyName: 'ABC Traders',
      invoiceNumber: 'INV-001',
      invoiceDate: '2026-06-15',
      grandTotal: '1250.50',
      lines: [{ description: 'Sugar 1kg', quantity: '10', unitPrice: '45.00' }],
    });

    expect(result.success).toBe(true);
    expect(result.data.grandTotal).toBe('1250.50');
    expect(result.data.lines).toHaveLength(1);
  });

  // MONEY NEVER BECOMES A FLOAT. It arrives as a string and stays a string all
  // the way to Prisma, which turns it into Decimal.
  it('keeps money as a string, never a number', () => {
    const result = extractionSchema.safeParse({ grandTotal: 1250.5 });
    expect(result.success).toBe(true);
    expect(result.data.grandTotal).toBe('1250.5');
    expect(typeof result.data.grandTotal).toBe('string');
  });

  it('strips currency symbols and thousands separators', () => {
    const result = extractionSchema.safeParse({ grandTotal: '₹1,250.50' });
    expect(result.success).toBe(true);
    expect(result.data.grandTotal).toBe('1250.50');
  });

  // A model that hedges must produce NOTHING, not a number nobody typed.
  it('turns a hedged amount into null rather than inventing a figure', () => {
    const result = extractionSchema.safeParse({ grandTotal: 'approximately 4500' });
    expect(result.success).toBe(true);
    expect(result.data.grandTotal).toBeNull();
  });

  it('turns an unreadable amount into null', () => {
    for (const value of ['illegible', 'N/A', '???', '']) {
      const result = extractionSchema.safeParse({ grandTotal: value });
      expect(result.success).toBe(true);
      expect(result.data.grandTotal).toBeNull();
    }
  });

  it('drops a date that is not YYYY-MM-DD instead of guessing the format', () => {
    const result = extractionSchema.safeParse({ invoiceDate: '15/06/2026' });
    expect(result.success).toBe(true);
    expect(result.data.invoiceDate).toBeNull();
  });

  it('drops fields the schema does not define', () => {
    const result = extractionSchema.safeParse({
      partyName: 'ABC',
      // A hallucinated field, and one that would be dangerous if it survived.
      companyId: 'some-other-company',
      isPosted: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.companyId).toBeUndefined();
    expect(result.data.isPosted).toBeUndefined();
  });

  it('defaults everything to null or empty when the model returns {}', () => {
    const result = extractionSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data.partyName).toBeNull();
    expect(result.data.grandTotal).toBeNull();
    expect(result.data.lines).toEqual([]);
  });

  it('refuses an absurd number of line items', () => {
    const lines = Array.from({ length: 201 }, () => ({ description: 'x' }));
    expect(extractionSchema.safeParse({ lines }).success).toBe(false);
  });

  it('refuses a confidence value it did not define', () => {
    expect(extractionSchema.safeParse({ confidence: 'PRETTY_SURE' }).success).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  // The name is for display only and never becomes a path - but a name is still
  // rendered into a page and a Content-Disposition header.
  it('strips directory separators', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFilename('..\\..\\windows\\system32')).not.toContain('\\');
  });

  it('collapses traversal sequences', () => {
    expect(sanitizeFilename('....//bill.pdf')).not.toContain('..');
  });

  it('keeps an ordinary name readable', () => {
    expect(sanitizeFilename('Supplier Bill 2026-06.pdf')).toBe('Supplier Bill 2026-06.pdf');
  });

  it('replaces characters that could break a header', () => {
    expect(sanitizeFilename('bill";drop.pdf')).not.toContain('"');
  });

  it('falls back to a name when nothing usable is left', () => {
    expect(sanitizeFilename('')).toBe('bill');
    expect(sanitizeFilename(null)).toBe('bill');
  });

  it('caps the length', () => {
    expect(sanitizeFilename('a'.repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe('looksLikeDeclaredType', () => {
  // A Content-Type header is a claim. This checks the bytes.
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const pdfHeader = Buffer.from('%PDF-1.7\n');

  it('accepts real PNG, JPEG and PDF headers', () => {
    expect(looksLikeDeclaredType(pngHeader, 'image/png')).toBe(true);
    expect(looksLikeDeclaredType(jpegHeader, 'image/jpeg')).toBe(true);
    expect(looksLikeDeclaredType(pdfHeader, 'application/pdf')).toBe(true);
  });

  it('rejects a file whose bytes do not match its declared type', () => {
    // An executable, or a script, posted as an image.
    const notAnImage = Buffer.from('MZ\x90\x00 this is not a png');
    expect(looksLikeDeclaredType(notAnImage, 'image/png')).toBe(false);
  });

  it('rejects a PDF renamed to a PNG', () => {
    expect(looksLikeDeclaredType(pdfHeader, 'image/png')).toBe(false);
  });

  it('rejects an empty buffer', () => {
    expect(looksLikeDeclaredType(Buffer.alloc(0), 'image/png')).toBe(false);
  });

  it('accepts a real WEBP, which needs bytes at two offsets', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
    ]);
    expect(looksLikeDeclaredType(webp, 'image/webp')).toBe(true);
    // RIFF alone is not enough - a WAV file also starts with RIFF.
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE'),
    ]);
    expect(looksLikeDeclaredType(wav, 'image/webp')).toBe(false);
  });

  it('offers only the types the product actually supports', () => {
    expect(Object.keys(ACCEPTED_MIME_TYPES).sort()).toEqual([
      'application/pdf',
      'image/heic',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});
