import { Router } from 'express';
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

dashboardRoutes.get('/', validate({ query: dashboardQuerySchema }), reportsController.getDashboard);

// --- /api/v1/reports -------------------------------------------------------

export const reportRoutes = Router();
reportRoutes.use(requireAuth);

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
