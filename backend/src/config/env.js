import 'dotenv/config';
import { z } from 'zod';

// Every environment value used by the app is read here and nowhere else.
// If something is missing or wrong, the app fails at startup with a clear message
// instead of failing later at a random request.

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),

  // Used only by the admin seed script.
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().default('Administrator'),
  ADMIN_COMPANY_NAME: z.string().default('Default Company'),

  // The PLATFORM operator's own superadmin - the account that runs the SaaS
  // rather than a shop. Used only by: npm run seed:platform.
  //
  // Deliberately separate from ADMIN_* above, which seeds a SHOP's admin. The
  // two are different jobs and must not share an account: a shop admin who
  // could manage the platform would be able to reach every other shop.
  PLATFORM_ADMIN_EMAIL: z.string().email().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8).optional(),
  PLATFORM_ADMIN_NAME: z.string().default('Platform Administrator'),

  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // --- AI bill extraction ---------------------------------------------------
  //
  // ALL OPTIONAL, on purpose. The application runs perfectly without any of
  // them; bill import simply reports that it is not configured, and every other
  // feature is untouched. Nobody should have to hold an AI vendor account to run
  // an accounting system.
  //
  // LLAMA_API_KEY IS A SERVER SECRET. It is read here, used only in
  // llamacloud.client.js, and never travels to a browser: the upload endpoint
  // takes the file, the server calls the reader, and the browser only ever sees
  // the extracted fields. There is deliberately no NEXT_PUBLIC_ counterpart to
  // any of these.
  //
  // The key is a LlamaCloud key (cloud.llamaindex.ai), which starts "llx-".
  LLAMA_API_KEY: z.string().optional(),
  LLAMA_BASE_URL: z.string().url().default('https://api.cloud.llamaindex.ai'),
  /** LlamaExtract tier: fast | cost_effective | agentic | agentic_plus. */
  LLAMA_EXTRACT_TIER: z.string().default('cost_effective'),
  /** Only needed for an account with more than one project; the default is found. */
  LLAMA_PROJECT_ID: z.string().optional(),
  /** Budget for the whole read: upload, job and polling together. */
  LLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),

  /** Where uploaded bills are written. Outside the repo in any real deployment. */
  BILL_STORAGE_DIR: z.string().default('./storage/bills'),
  /** Hard ceiling on an uploaded bill, in bytes. Default 10 MB. */
  BILL_MAX_FILE_SIZE: z.coerce.number().int().positive().default(10 * 1024 * 1024),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${issues}\n\nCheck your .env file (see .env.example).`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
