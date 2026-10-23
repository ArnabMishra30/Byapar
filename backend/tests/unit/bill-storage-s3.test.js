import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Unit coverage for the S3 storage provider (Phase 3A item 1). The AWS SDK is
// MOCKED — this does NOT talk to a live S3/R2 bucket; it proves the provider
// issues the right commands (bucket + key + content type), returns bytes, maps a
// missing object to a `notFound` error, and that the env guard requires S3
// credentials when the provider is 's3'.

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => {
  const cmd = (type) =>
    class {
      constructor(input) {
        this.input = input;
        this.type = type;
      }
    };
  return {
    S3Client: class {
      send(command) {
        return sendMock(command);
      }
    },
    PutObjectCommand: cmd('Put'),
    GetObjectCommand: cmd('Get'),
    DeleteObjectCommand: cmd('Delete'),
  };
});

import * as s3 from '../../src/modules/bills/storage/s3-provider.js';
import { env } from '../../src/config/env.js';

beforeEach(() => sendMock.mockReset());

describe('S3 storage provider (mocked SDK)', () => {
  const KEY = 'company-123/2026-06/abcd.png';

  it('puts an object with the configured bucket, the storage key, and content type', async () => {
    sendMock.mockResolvedValue({});
    await s3.put(KEY, Buffer.from('bytes'), 'image/png');

    const command = sendMock.mock.calls[0][0];
    expect(command.type).toBe('Put');
    expect(command.input.Bucket).toBe(env.BILL_S3_BUCKET);
    expect(command.input.Key).toBe(KEY);
    expect(command.input.ContentType).toBe('image/png');
    expect(Buffer.isBuffer(command.input.Body)).toBe(true);
  });

  it('gets an object and returns its bytes as a Buffer', async () => {
    sendMock.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    const out = await s3.get(KEY);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect([...out]).toEqual([1, 2, 3]);
    expect(sendMock.mock.calls[0][0].input.Key).toBe(KEY);
  });

  it('recognises a missing object (NoSuchKey) so get() can map it to notFound', () => {
    expect(s3.isNotFoundError(Object.assign(new Error('nope'), { name: 'NoSuchKey' }))).toBe(true);
  });

  it('recognises a 404 metadata status as missing', () => {
    expect(s3.isNotFoundError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
  });

  it('does not treat a non-missing error (e.g. access denied) as notFound', () => {
    expect(s3.isNotFoundError(Object.assign(new Error('denied'), { name: 'AccessDenied' }))).toBe(false);
    expect(s3.isNotFoundError(undefined)).toBe(false);
  });

  it('deletes by key', async () => {
    sendMock.mockResolvedValue({});
    await s3.remove(KEY);
    const command = sendMock.mock.calls[0][0];
    expect(command.type).toBe('Delete');
    expect(command.input.Key).toBe(KEY);
  });
});

describe('S3 configuration guard', () => {
  const envPath = path.resolve(fileURLToPath(new URL('../../src/config/env.js', import.meta.url)));
  const importUrl = pathToFileURL(envPath).href;

  function loadEnvWith(overrides) {
    const childEnv = { ...process.env, NODE_ENV: 'development', ...overrides };
    for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete childEnv[k];
    try {
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', `import(${JSON.stringify(importUrl)}).then(() => process.exit(0))`],
        { env: childEnv, stdio: 'pipe' },
      );
      return 0;
    } catch (err) {
      return err.status ?? 1;
    }
  }

  it('refuses to start with provider s3 but missing S3 credentials', () => {
    expect(
      loadEnvWith({
        BILL_STORAGE_PROVIDER: 's3',
        BILL_S3_BUCKET: undefined,
        BILL_S3_REGION: undefined,
        BILL_S3_ACCESS_KEY_ID: undefined,
        BILL_S3_SECRET_ACCESS_KEY: undefined,
      }),
    ).not.toBe(0);
  });

  it('starts with provider s3 when all S3 settings are present', () => {
    expect(
      loadEnvWith({
        BILL_STORAGE_PROVIDER: 's3',
        BILL_S3_BUCKET: 'bills',
        BILL_S3_REGION: 'ap-south-1',
        BILL_S3_ACCESS_KEY_ID: 'AKIA_TEST',
        BILL_S3_SECRET_ACCESS_KEY: 'secret_test_value',
      }),
    ).toBe(0);
  });
});
