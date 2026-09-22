import { ApiError } from '../utils/api-error.js';

/**
 * Validates the request against Zod schemas so controllers never repeat validation.
 *
 *   router.post('/login', validate({ body: loginSchema }), controller.login)
 *
 * Validated values are available on req.validated ({ body, params, query }).
 * req.body is also replaced with the parsed value.
 * Note: req.query cannot be reassigned in Express 5, so read it from req.validated.query.
 *
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    const errors = [];

    for (const source of ['body', 'params', 'query']) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);

      if (result.success) {
        validated[source] = result.data;
      } else {
        for (const issue of result.error.issues) {
          const path = issue.path.join('.');
          errors.push({
            field: path ? `${source}.${path}` : source,
            message: issue.message,
          });
        }
      }
    }

    if (errors.length > 0) {
      return next(ApiError.badRequest('Validation failed', errors));
    }

    req.validated = validated;
    if (validated.body) req.body = validated.body;

    return next();
  };
}
