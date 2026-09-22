import { Router } from 'express';
import * as taxController from './tax.controller.js';
import {
  updateGstProfileSchema,
  validateGstinSchema,
  createTaxClassificationSchema,
  updateTaxClassificationSchema,
  listTaxClassificationsQuerySchema,
  gstReportQuerySchema,
  gstLinesQuerySchema,
  gstSourceParamsSchema,
  gstReturnPeriodQuerySchema,
} from './tax.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

// RBAC, following the convention the rest of the project uses:
//
//   READ  (profile, HSN list, every summary)         ADMIN and STAFF
//   WRITE (GST registration, HSN/SAC master)         ADMIN only
//
// There is deliberately no endpoint that writes a tax AMOUNT. Tax is computed by
// the server from the configured rates and the two states, inside the document's
// own posting transaction - so STAFF can raise a correctly taxed invoice without
// being able to change what the tax is.

export const gstRoutes = Router();

gstRoutes.use(requireAuth);

// --- company GST profile ---------------------------------------------------

gstRoutes.get('/profile', taxController.getProfile);

gstRoutes.patch(
  '/profile',
  requireRole('ADMIN'),
  validate({ body: updateGstProfileSchema }),
  taxController.updateProfile,
);

// A pure function of its input: it stores nothing and reveals nothing, so any
// authenticated user may call it while filling in a form.
gstRoutes.post(
  '/validate-gstin',
  validate({ body: validateGstinSchema }),
  taxController.validateGstin,
);

gstRoutes.get('/states', taxController.listStates);

// --- HSN / SAC classification ---------------------------------------------

gstRoutes.get(
  '/classifications',
  validate({ query: listTaxClassificationsQuerySchema }),
  taxController.listClassifications,
);

gstRoutes.get(
  '/classifications/:id',
  validate({ params: idParamSchema }),
  taxController.getClassification,
);

gstRoutes.post(
  '/classifications',
  requireRole('ADMIN'),
  validate({ body: createTaxClassificationSchema }),
  taxController.createClassification,
);

gstRoutes.patch(
  '/classifications/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateTaxClassificationSchema }),
  taxController.updateClassification,
);

// --- summaries -------------------------------------------------------------

gstRoutes.get(
  '/gst-summary',
  validate({ query: gstReportQuerySchema }),
  taxController.getSummary,
);

gstRoutes.get('/input-tax', validate({ query: gstReportQuerySchema }), taxController.getInputTax);

gstRoutes.get('/output-tax', validate({ query: gstReportQuerySchema }), taxController.getOutputTax);

gstRoutes.get(
  '/gst-purchases',
  validate({ query: gstLinesQuerySchema }),
  taxController.getPurchaseLines,
);

gstRoutes.get('/gst-sales', validate({ query: gstLinesQuerySchema }), taxController.getSalesLines);

// --- GST return preparation ------------------------------------------------
//
// Read-only, and mounted before the /:source routes so "returns" is never read
// as a document type. Same RBAC as every other GST read: ADMIN and STAFF.
gstRoutes.get(
  '/returns/gstr-1',
  validate({ query: gstReturnPeriodQuerySchema }),
  taxController.getGstr1,
);

gstRoutes.get(
  '/returns/gstr-3b',
  validate({ query: gstReturnPeriodQuerySchema }),
  taxController.getGstr3b,
);

gstRoutes.get(
  '/returns/reconciliation',
  validate({ query: gstReturnPeriodQuerySchema }),
  taxController.getReturnReconciliation,
);

// Declared last so the fixed paths above are never read as a :source.
gstRoutes.get(
  '/lines/:source',
  validate({ params: gstSourceParamsSchema, query: gstLinesQuerySchema }),
  taxController.getLinesBySource,
);

gstRoutes.get(
  '/hsn-summary/:source',
  validate({ params: gstSourceParamsSchema, query: gstReportQuerySchema }),
  taxController.getHsnSummary,
);
