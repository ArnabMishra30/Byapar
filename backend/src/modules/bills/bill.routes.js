import { Router } from 'express';
import multer from 'multer';
import * as billController from './bill.controller.js';
import {
  uploadBillSchema,
  saveReviewSchema,
  confirmBillSchema,
  cancelBillSchema,
  listBillsQuerySchema,
} from './bill.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';
import { env } from '../../config/env.js';
import { ACCEPTED_MIME_TYPES } from './bill-storage.service.js';
import { ApiError } from '../../utils/api-error.js';

// RBAC, matching every other financial document in this project:
//
//   Upload, review, correct     ADMIN and STAFF
//   CONFIRM (which posts)       ADMIN
//
// Exactly the split purchases and sales already use. A staff member may prepare
// a document; only an admin may make it hit the books. Confirming an imported
// bill IS posting a purchase or a sale, so it would make no sense for the camera
// to be a way around that.

/**
 * In memory, not to a temp file.
 *
 * The bytes are needed twice - once to write to storage, once to send to the
 * model - and a 10 MB ceiling makes buffering safe. It also means a rejected
 * upload never touches the disk at all.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.BILL_MAX_FILE_SIZE,
    files: 1,
    // Only `direction` is expected alongside the file.
    fields: 5,
  },
  fileFilter: (_req, file, callback) => {
    if (!ACCEPTED_MIME_TYPES[file.mimetype]) {
      // Rejected before a byte is buffered. The declared type is only a first
      // pass - the real check is the magic bytes, in bill-storage.
      return callback(
        ApiError.business(
          422,
          'UNSUPPORTED_FILE_TYPE',
          'Upload a photo (JPG, PNG, WEBP or HEIC) or a PDF of the bill.',
        ),
      );
    }
    return callback(null, true);
  },
});

/** Turns multer's own errors into this project's error shape. */
function handleUploadErrors(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round(env.BILL_MAX_FILE_SIZE / (1024 * 1024));
      return next(
        ApiError.business(422, 'FILE_TOO_LARGE', `That file is too large. The limit is ${mb} MB.`),
      );
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(ApiError.business(422, 'TOO_MANY_FILES', 'Upload one bill at a time.'));
    }

    return next(error);
  });
}

export const billRoutes = Router();

billRoutes.use(requireAuth);

// Declared before /:id so neither is ever read as a bill id.
billRoutes.get('/summary', billController.summary);

billRoutes.get('/', validate({ query: listBillsQuerySchema }), billController.list);

billRoutes.post(
  '/',
  handleUploadErrors,
  validate({ body: uploadBillSchema }),
  billController.upload,
);

billRoutes.get('/:id', validate({ params: idParamSchema }), billController.get);

billRoutes.get('/:id/file', validate({ params: idParamSchema }), billController.file);

// What this bill looks like it refers to in the shop's own records. Read-only,
// and scoped to the caller's company like every other route here.
billRoutes.get('/:id/suggestions', validate({ params: idParamSchema }), billController.suggestions);

billRoutes.post('/:id/retry', validate({ params: idParamSchema }), billController.retry);

billRoutes.patch(
  '/:id/review',
  validate({ params: idParamSchema, body: saveReviewSchema }),
  billController.saveReview,
);

// THE POSTING STEP. Admin only, exactly as posting a purchase or a sale is.
billRoutes.post(
  '/:id/confirm',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: confirmBillSchema }),
  billController.confirm,
);

billRoutes.post(
  '/:id/cancel',
  validate({ params: idParamSchema, body: cancelBillSchema }),
  billController.cancel,
);
