import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { extractWithLlamaCloud } from '../../src/modules/bills/llamacloud.client.js';

// THE VENDOR'S FAILURES, TRANSLATED.
//
// A shop owner holding a phone must never be shown a vendor's status code, and
// must never be told their photograph was bad when the truth is the operator's
// API key is wrong. These tests pin that mapping down, and check the one thing
// that would be unforgivable: the key appearing in something a browser sees.

const SCHEMA = { type: 'object', properties: { grandTotal: { type: 'string' } } };
const FILE = Buffer.from([0x25, 0x50, 0x44, 0x46]); // "%PDF"

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let originalKey;
let originalProject;

beforeEach(() => {
  originalKey = env.LLAMA_API_KEY;
  originalProject = env.LLAMA_PROJECT_ID;
  env.LLAMA_API_KEY = 'llx-test-key-never-logged';
  // Set, so the client does not have to look the default project up.
  env.LLAMA_PROJECT_ID = 'project-test';
});

afterEach(() => {
  env.LLAMA_API_KEY = originalKey;
  env.LLAMA_PROJECT_ID = originalProject;
  vi.unstubAllGlobals();
});

describe('extractWithLlamaCloud', () => {
  it('uploads, starts a job, polls, and returns the extracted object', async () => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        calls.push({ url: String(url), method: options?.method ?? 'GET', headers: options?.headers });
        if (String(url).includes('/api/v1/beta/files')) return jsonResponse({ id: 'file-1' });
        if (options?.method === 'POST') return jsonResponse({ id: 'ext-1' });
        return jsonResponse({
          status: 'COMPLETED',
          extract_result: { grandTotal: '1868.80' },
          configuration: { tier: 'cost_effective' },
        });
      }),
    );

    const { result, model } = await extractWithLlamaCloud(FILE, 'application/pdf', {
      jsonSchema: SCHEMA,
      systemPrompt: 'read it',
    });

    expect(result).toEqual({ grandTotal: '1868.80' });
    expect(model).toBe('llamacloud/extract/cost_effective');

    // Upload, then job, then poll - and every one of them authenticated.
    expect(calls[0].url).toContain('/api/v1/beta/files');
    expect(calls[1].url).toContain('/api/v2/extract?project_id=project-test');
    expect(calls[2].url).toContain('/api/v2/extract/ext-1');
    for (const call of calls) {
      expect(call.headers.Authorization).toBe('Bearer llx-test-key-never-logged');
    }
  });

  it('reports a rejected key as a server configuration problem, not a bad photo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'Authentication Error' }, 401)));

    await expect(
      extractWithLlamaCloud(FILE, 'application/pdf', { jsonSchema: SCHEMA, systemPrompt: '' }),
    ).rejects.toMatchObject({ status: 503, code: 'EXTRACTION_NOT_CONFIGURED' });
  });

  it('passes a rate limit through as a rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'slow down' }, 429)));

    await expect(
      extractWithLlamaCloud(FILE, 'application/pdf', { jsonSchema: SCHEMA, systemPrompt: '' }),
    ).rejects.toMatchObject({ status: 429, code: 'EXTRACTION_RATE_LIMITED' });
  });

  it('fails cleanly when the job itself ends in an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        if (String(url).includes('/api/v1/beta/files')) return jsonResponse({ id: 'file-1' });
        if (options?.method === 'POST') return jsonResponse({ id: 'ext-1' });
        return jsonResponse({ status: 'ERROR', error_message: 'could not read document' });
      }),
    );

    await expect(
      extractWithLlamaCloud(FILE, 'application/pdf', { jsonSchema: SCHEMA, systemPrompt: '' }),
    ).rejects.toMatchObject({ status: 502, code: 'EXTRACTION_FAILED' });
  });

  it('never puts the API key in the error a caller could see', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ echo: `Bearer ${env.LLAMA_API_KEY}` }, 500)),
    );

    const error = await extractWithLlamaCloud(FILE, 'application/pdf', {
      jsonSchema: SCHEMA,
      systemPrompt: '',
    }).catch((caught) => caught);

    expect(JSON.stringify({ message: error.message, code: error.code })).not.toContain('llx-');
  });
});
