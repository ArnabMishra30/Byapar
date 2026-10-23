import 'dotenv/config';
import { z } from 'zod';

// Every environment value used by the app is read here and nowhere else.
// If something is missing or wrong, the app fails at startup with a clear message
// instead of failing later at a random request.

/** Split a comma-separated origin list into trimmed, non-empty entries. */
function parseOrigins(value) {
  return String(value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// The localhost origins the two frontends run on in local development. Used only
// when CORS_ORIGIN is not set, and never in production (which requires an
// explicit value - see the superRefine below).
const DEVELOPMENT_CORS_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Lifetime of the ACCESS token (a jsonwebtoken duration such as "15m"). Kept
  // short on purpose: the refresh token below renews it quietly, and a short
  // life limits what a stolen one is worth.
  JWT_EXPIRES_IN: z.string().default('15m'),
  /** How long a sign-in lasts without activity. Each refresh restarts the clock. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // How many proxies sit in front of this server, for req.ip (and so the rate
  // limiters). 1 = the host's load balancer only. When the browser reaches the
  // API through a frontend's /api/v1 proxy (the default deployment), that
  // frontend is a second hop: set 2, or every visitor shares one rate limit.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

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

  // The browser origins allowed to call the API, comma-separated. No wildcard
  // default: in production an explicit, non-"*" value is REQUIRED (enforced
  // below) so the API never silently accepts every origin. In development it may
  // be left unset and sensible localhost defaults are used (see corsOrigins).
  CORS_ORIGIN: z.string().optional(),
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

  // HOW LONG A TRANSACTION MAY TAKE.
  //
  // Prisma's own defaults are 2s to get a connection and 5s to finish, which is
  // generous against a database on the same machine and far too tight against a
  // managed one in another region: posting a document is dozens of round trips,
  // and a hosted database that has scaled to zero spends the first of them
  // waking up. Exceeding the limit aborts mid-posting and surfaces as a 500.
  DB_TRANSACTION_MAX_WAIT_MS: z.coerce.number().int().positive().default(10000),
  DB_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  /** Where uploaded bills are written when the provider is 'local'. */
  BILL_STORAGE_DIR: z.string().default('./storage/bills'),
  /** Hard ceiling on an uploaded bill, in bytes. Default 10 MB. */
  BILL_MAX_FILE_SIZE: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  // WHERE BILL FILES ARE STORED.
  //
  // 'local' writes to BILL_STORAGE_DIR on the server filesystem - fine for local
  // development and for a host with a persistent disk, but EPHEMERAL on a
  // platform like Render's default instances (files vanish on every redeploy).
  // 's3' uses any S3-compatible object store (AWS S3, Cloudflare R2, MinIO) and
  // survives redeploys. The S3_* values are required when the provider is 's3'
  // (enforced below). BILL_S3_SECRET_ACCESS_KEY is a server secret and never
  // leaves the backend.
  BILL_STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  BILL_S3_BUCKET: z.string().optional(),
  BILL_S3_REGION: z.string().optional(),
  /** Custom endpoint for an S3-compatible store (R2/MinIO). Omit for AWS S3. */
  BILL_S3_ENDPOINT: z.string().url().optional(),
  BILL_S3_ACCESS_KEY_ID: z.string().optional(),
  BILL_S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Path-style addressing, needed by some S3-compatible stores (e.g. MinIO). */
  BILL_S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}).superRefine((data, ctx) => {
  // In production the API must be told exactly which origins may call it. A
  // missing value or a wildcard is a configuration error, not a warning: fail
  // startup with a clear message rather than accept every website.
  if (data.NODE_ENV === 'production') {
    const origins = parseOrigins(data.CORS_ORIGIN);
    if (origins.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN is required in production: set it to the frontend origin(s), comma-separated (e.g. https://app.example.com).',
      });
    } else if (origins.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN must not be "*" in production. List the explicit frontend origin(s), comma-separated.',
      });
    }
  }

  // Object storage needs its connection details, or startup is a configuration
  // error rather than a failure on the first bill upload.
  if (data.BILL_STORAGE_PROVIDER === 's3') {
    for (const key of ['BILL_S3_BUCKET', 'BILL_S3_REGION', 'BILL_S3_ACCESS_KEY_ID', 'BILL_S3_SECRET_ACCESS_KEY']) {
      if (!data[key] || String(data[key]).trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when BILL_STORAGE_PROVIDER is "s3".`,
        });
      }
    }
  }
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

// The concrete list of allowed CORS origins the app enforces. An explicit
// CORS_ORIGIN (any environment) wins; otherwise development/test fall back to
// the localhost frontends. Production can never reach the fallback: it fails
// validation above unless an explicit, non-"*" value is set.
export const corsOrigins = (() => {
  const configured = parseOrigins(env.CORS_ORIGIN);
  if (configured.length > 0) return configured;
  return DEVELOPMENT_CORS_ORIGINS;
})();
