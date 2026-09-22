import { ZodError } from 'zod';
import { ApiError } from '../utils/api-error.js';
import { sendError } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { isProduction } from '../config/env.js';

// Express 5 forwards rejected promises from async handlers to this middleware,
// so controllers do not need try/catch.

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args)
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return sendError(res, err.status, err.message, err.errors, err.code);
  }

  // A Zod error thrown outside the validate() middleware.
  if (err instanceof ZodError) {
    const errors = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return sendError(res, 400, 'Validation failed', errors);
  }

  // Body parser rejected malformed JSON.
  if (err?.type === 'entity.parse.failed') {
    return sendError(res, 400, 'Invalid JSON body');
  }
  if (err?.type === 'entity.too.large') {
    return sendError(res, 413, 'Request body too large');
  }

  // Prisma unique constraint violation.
  if (err?.code === 'P2002') {
    const fields = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : 'field';
    return sendError(res, 409, `A record with this ${fields} already exists`);
  }

  logger.error('Unhandled error', isProduction ? { message: err?.message } : err);

  return sendError(res, 500, isProduction ? 'Internal server error' : (err?.message ?? 'Internal server error'));
}
