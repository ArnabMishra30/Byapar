// The only error type controllers and services should throw on purpose.
// Anything else that reaches the error handler is treated as an unexpected 500.

export class ApiError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} message Message safe to show to the API consumer
   * @param {Array<{ field: string, message: string }>} [errors] Field level details
   * @param {string} [code] Stable machine-readable code for business errors,
   *   e.g. INSUFFICIENT_STOCK. Clients can branch on it instead of parsing text.
   */
  constructor(status, message, errors, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (errors) this.errors = errors;
    if (code) this.code = code;
  }

  /** A rule of the business was broken, e.g. not enough stock to remove. */
  static business(status, code, message) {
    return new ApiError(status, message, undefined, code);
  }

  static badRequest(message, errors) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }
}
