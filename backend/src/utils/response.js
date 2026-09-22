// Every successful response goes through here so the shape stays consistent:
//   { "success": true, "data": {...} }
//   { "success": true, "data": {...}, "message": "..." }   (message is optional)

export function sendSuccess(res, data, status = 200, message) {
  const body = { success: true, data };
  if (message) body.message = message;
  return res.status(status).json(body);
}

/**
 * List response. The pagination block sits next to data, not inside it:
 *   { "success": true, "data": [...], "pagination": { page, limit, total, totalPages } }
 */
export function sendPaginated(res, data, pagination, status = 200) {
  return res.status(status).json({ success: true, data, pagination });
}

// Errors are sent by the central error handler, not from controllers.
export function sendError(res, status, message, errors, code) {
  const body = { success: false, message };
  // Only present on business errors that define one, so existing error shapes
  // are unchanged.
  if (code) body.code = code;
  if (errors) body.errors = errors;
  return res.status(status).json(body);
}
