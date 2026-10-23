import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import request from 'supertest';
import { app } from '../../src/app.js';
import { corsOrigins } from '../../src/config/env.js';

// Regression coverage for Phase 3A item 2: production CORS must be an explicit
// allow-list (no wildcard), untrusted origins are not granted CORS headers, and
// the server refuses to start in production without a valid CORS_ORIGIN.

const allowed = corsOrigins[0];
const BLOCKED = 'https://untrusted.invalid';

describe('CORS runtime behaviour', () => {
  it('grants an allowed origin its CORS header', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', allowed);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
  });

  it('does not grant CORS headers to an untrusted origin', async () => {
    expect(corsOrigins).not.toContain(BLOCKED);
    const res = await request(app).get('/api/v1/health').set('Origin', BLOCKED);
    // The request still reaches the server (CORS only governs browsers), but the
    // browser-facing allow-origin header must not echo the untrusted origin.
    expect(res.headers['access-control-allow-origin']).not.toBe(BLOCKED);
  });

  it('answers a preflight for an allowed origin', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'GET');
    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
  });
});

describe('CORS production configuration guard', () => {
  const envPath = path.resolve(fileURLToPath(new URL('../../src/config/env.js', import.meta.url)));
  const importUrl = pathToFileURL(envPath).href;

  // Loads config/env.js in a child process with a given environment and returns
  // the exit code. env.js calls process.exit(1) on invalid configuration.
  function loadEnvWith(overrides) {
    const childEnv = { ...process.env, ...overrides };
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

  it('refuses to start in production without CORS_ORIGIN', () => {
    expect(loadEnvWith({ NODE_ENV: 'production', CORS_ORIGIN: undefined })).not.toBe(0);
  });

  it('refuses to start in production with a wildcard CORS_ORIGIN', () => {
    expect(loadEnvWith({ NODE_ENV: 'production', CORS_ORIGIN: '*' })).not.toBe(0);
  });

  it('starts in production with explicit origins', () => {
    expect(
      loadEnvWith({ NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example.com,https://admin.example.com' }),
    ).toBe(0);
  });
});
