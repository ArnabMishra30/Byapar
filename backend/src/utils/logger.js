import { env, isTest } from '../config/env.js';

// Deliberately simple. Console output is enough for now.
// Never pass passwords, tokens or authorization headers into these functions.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[env.LOG_LEVEL] ?? LEVELS.info;

function write(level, message, meta) {
  // Keep test output readable: only errors are printed while testing.
  if (isTest && level !== 'error') return;
  if (LEVELS[level] < threshold) return;

  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  const output = level === 'error' ? console.error : console.log;

  if (meta === undefined) output(line);
  else output(line, meta);
}

export const logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
