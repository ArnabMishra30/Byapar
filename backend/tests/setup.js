import { existsSync } from 'node:fs';
import { config } from 'dotenv';

// Tests must use their own database. If .env.test is missing we stop immediately
// rather than silently running against the development database.
if (!existsSync('.env.test')) {
  throw new Error('.env.test not found. Copy .env.test.example to .env.test before running tests.');
}

config({ path: '.env.test', override: true });
process.env.NODE_ENV = 'test';
