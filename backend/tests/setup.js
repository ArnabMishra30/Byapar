import { existsSync } from 'node:fs';
import { config } from 'dotenv';

// Tests must use their own database. If .env.test is missing we stop immediately
// rather than silently running against the development database.
if (!existsSync('.env.test')) {
  throw new Error('.env.test not found. Copy .env.test.example to .env.test before running tests.');
}

config({ path: '.env.test', override: true });
// src/config/env.js also loads .env (without override). Anything .env.test does
// not set would otherwise leak in from the developer's .env - above all a real
// LLAMA_API_KEY, which turns every bill test into a paid network call that
// times out. Tests that need a key set one in .env.test explicitly.
process.env.LLAMA_API_KEY ??= '';
process.env.NODE_ENV = 'test';
