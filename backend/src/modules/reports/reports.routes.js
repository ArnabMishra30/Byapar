import { Router } from 'express';
import * as offerService from '../offers/offer.service.js';
import { z } from 'zod';
import { sendSuccess } from '../../utils/response.js';
import { requireRole } from '../../middlewares/require-role.js';
import * as billerReportService from './biller-report.service.js';
import { requireShopPermission } from '../users/shop-permissions.js';
import * as reportsController from './reports.controller.js';
import {
  dashboardQuerySchema,
  salesReportQuerySchema,
  purchasesReportQuerySchema,
  paymentsReceivedQuerySchema,
  supplierPaymentsQuerySchema,
  dateRangeQuerySchema,
  generalLedgerReportQuerySchema,
  cashBankReportQuerySchema,
  expenseReportQuerySchema,
  inventoryValuationQuerySchema,
  ledgerReportQuerySchema,
  creditQuerySchema,
  partyIdParamSchema,
} from './reports.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';

// RBAC: reads are open to ADMIN and STAFF, exactly like every other read in this
// project. There is no write endpoint anywhere in this module, so no role can
// change a posted document, a balance or a journal entry through it - which is
// the strongest form of "reports never mutate accounting data".
//
// Nothing here requires GST. A shop that has never registered gets the whole
// dashboard, the whole credit book and every report below.

// --- /api/v1/dashboard -----------------------------------------------------

export const dashboardRoutes = Router();
dashboardRoutes.use(requireAuth);
// Shop-wide figures: only for people allowed to see reports.
dashboardRoutes.use(requireShopPermission('REPORTS_VIEW'));

dashboardRoutes.get('/', validate({ query: dashboardQuerySchema }), reportsController.getDashboard);

// --- /api/v1/reports -------------------------------------------------------

export const reportRoutes = Router();
reportRoutes.use(requireAuth);
// Shop-wide figures: only for people allowed to see reports.
reportRoutes.use(requireShopPermission('REPORTS_VIEW'));

reportRoutes.get(
  '/sales',
  validate({ query: salesReportQuerySchema }),
  reportsController.getSalesReport,
);

reportRoutes.get(
  '/purchases',
  validate({ query: purchasesReportQuerySchema }),
  reportsController.getPurchasesReport,
);

reportRoutes.get(
  '/customer-outstanding',
  validate({ query: creditQuerySchema }),
  reportsController.getCustomerOutstandingReport,
);

reportRoutes.get(
  '/supplier-outstanding',
  validate({ query: creditQuerySchema }),
  reportsController.getSupplierOutstandingReport,
);

// Declared before any bare /:id route would be, so these never collide.
reportRoutes.get(
  '/customer-ledger/:id',
  validate({ params: partyIdParamSchema, query: ledgerReportQuerySchema }),
  reportsController.getCustomerLedgerReport,
);

reportRoutes.get(
  '/supplier-ledger/:id',
  validate({ params: partyIdParamSchema, query: ledgerReportQuerySchema }),
  reportsController.getSupplierLedgerReport,
);

reportRoutes.get(
  '/payments-received',
  validate({ query: paymentsReceivedQuerySchema }),
  reportsController.getPaymentsReceivedReport,
);

reportRoutes.get(
  '/supplier-payments',
  validate({ query: supplierPaymentsQuerySchema }),
  reportsController.getSupplierPaymentsReport,
);

reportRoutes.get(
  '/expenses',
  validate({ query: expenseReportQuerySchema }),
  reportsController.getExpensesReport,
);

reportRoutes.get(
  '/inventory-valuation',
  validate({ query: inventoryValuationQuerySchema }),
  reportsController.getInventoryValuationReport,
);

reportRoutes.get(
  '/profit-loss',
  validate({ query: dateRangeQuerySchema }),
  reportsController.getProfitAndLossReport,
);

reportRoutes.get(
  '/general-ledger',
  validate({ query: generalLedgerReportQuerySchema }),
  reportsController.getGeneralLedgerReport,
);

reportRoutes.get(
  '/cash-bank',
  validate({ query: cashBankReportQuerySchema }),
  reportsController.getCashBankReport,
);

// --- /api/v1/credit --------------------------------------------------------
//
// The credit book, in the words a shopkeeper uses.

export const creditRoutes = Router();
creditRoutes.use(requireAuth);
// Shop-wide figures: only for people allowed to see reports.
creditRoutes.use(requireShopPermission('REPORTS_VIEW'));

creditRoutes.get('/', validate({ query: creditQuerySchema }), reportsController.getCreditSummary);

creditRoutes.get(
  '/receivables',
  validate({ query: creditQuerySchema }),
  reportsController.getReceivables,
);

creditRoutes.get(
  '/payables',
  validate({ query: creditQuerySchema }),
  reportsController.getPayables,
);

creditRoutes.get(
  '/customers/:id',
  validate({ params: partyIdParamSchema, query: ledgerReportQuerySchema }),
  reportsController.getCustomerCredit,
);

creditRoutes.get(
  '/suppliers/:id',
  validate({ params: partyIdParamSchema, query: ledgerReportQuerySchema }),
  reportsController.getSupplierCredit,
);

// --- who billed what ---------------------------------------------------------

const billerDayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
});

/** Every person's sales and money taken on a day (reportRoutes: REPORTS_VIEW). */
reportRoutes.get('/billers', validate({ query: billerDayQuerySchema }), async (req, res) =>
  sendSuccess(res, await billerReportService.getBillerDay(req.user, req.validated.query)),
);

// /api/v1/my-day: the signed-in shop user's own figures, for a biller who may
// not see the shop's totals. Any shop user; never anyone else's numbers.
export const myDayRoutes = Router();
myDayRoutes.use(requireAuth);
myDayRoutes.get('/', requireRole('ADMIN', 'STAFF'), validate({ query: billerDayQuerySchema }), async (req, res) =>
  sendSuccess(res, await billerReportService.getMyDay(req.user, req.validated.query)),
);

/** Free goods given away in a period, per offer and by hand per person (REPORTS_VIEW). */
reportRoutes.get(
  '/offers',
  validate({
    query: z.object({
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  }),
  async (req, res) => {
    const { fromDate, toDate } = req.validated.query;
    const day = (value) => (value ? new Date(`${value}T00:00:00.000Z`) : undefined);
    return sendSuccess(res, await offerService.report(req.user, { fromDate: day(fromDate), toDate: day(toDate) }));
  },
);
