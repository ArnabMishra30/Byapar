import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { env, isProduction, isTest } from './config/env.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { userRoutes } from './modules/users/user.routes.js';
import { companyRoutes } from './modules/companies/company.routes.js';
import { companySettingsRoutes } from './modules/company-settings/company-settings.routes.js';
import { categoryRoutes } from './modules/categories/category.routes.js';
import { unitRoutes } from './modules/units/unit.routes.js';
import { taxRoutes } from './modules/taxes/tax.routes.js';
import { warehouseRoutes } from './modules/warehouses/warehouse.routes.js';
import { productRoutes } from './modules/products/product.routes.js';
import { supplierRoutes } from './modules/suppliers/supplier.routes.js';
import { customerRoutes } from './modules/customers/customer.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { purchaseRoutes } from './modules/purchases/purchase.routes.js';
import { purchaseReturnRoutes } from './modules/purchase-returns/purchase-return.routes.js';
import {
  supplierPayableRoutes,
  supplierLedgerRoutes,
} from './modules/supplier-payables/supplier-payable.routes.js';
import { supplierPaymentRoutes } from './modules/supplier-payments/supplier-payment.routes.js';
import { salesRoutes } from './modules/sales/sales.routes.js';
import {
  customerReceivableRoutes,
  customerLedgerRoutes,
} from './modules/customer-receivables/customer-receivable.routes.js';
import { customerPaymentRoutes } from './modules/customer-payments/customer-payment.routes.js';
import { expenseRoutes } from './modules/expenses/expense.routes.js';
import { salesReturnRoutes } from './modules/sales-returns/sales-return.routes.js';
import {
  accountRoutes,
  journalEntryRoutes,
  generalLedgerRoutes,
  accountingRoutes,
} from './modules/accounting/accounting.routes.js';
import { gstRoutes } from './modules/tax/tax.routes.js';
import {
  dashboardRoutes,
  reportRoutes,
  creditRoutes,
} from './modules/reports/reports.routes.js';
import {
  creditCollectionRoutes,
  customerCreditRoutes,
  supplierCreditRoutes,
} from './modules/credit/credit.routes.js';
import { periodRoutes } from './modules/periods/period.routes.js';
import { openingBalanceRoutes } from './modules/opening-balances/opening-balance.routes.js';
import {
  planRoutes,
  subscriptionRoutes,
  subscriptionPaymentRoutes,
  businessRoutes,
  salesTeamRoutes,
} from './modules/platform/platform.routes.js';
import { subscriptionStatusRoutes } from './modules/platform/subscription-status.routes.js';
import { publicRoutes } from './modules/platform/public.routes.js';
import { billRoutes } from './modules/bills/bill.routes.js';

export const app = express();

app.disable('x-powered-by');

// In production the app runs behind the host's load balancer (Render). Trusting
// that one hop makes req.ip the visitor's address rather than the proxy's. The
// rate limiters below key on req.ip: without this, every user on the platform
// would share a single limit, and 20 logins in 15 minutes would lock out all.
if (isProduction) {
  app.set('trust proxy', 1);
}

// --- security and parsing -------------------------------------------------
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Rate limiting is skipped during tests so the suite is not throttled.
if (!isTest) {
  app.use(
    '/api/',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: 'Too many requests, please try again later' },
    }),
  );

  // Stricter limit for login to slow down password guessing.
  app.use(
    '/api/v1/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: 'Too many login attempts, please try again later' },
    }),
  );
}

// --- request logging ------------------------------------------------------
// Method, path, status and duration only. Never headers or bodies.
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});

// --- routes ---------------------------------------------------------------
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/companies', companyRoutes);
app.use('/api/v1/company-settings', companySettingsRoutes);

// Business master data
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/units', unitRoutes);
app.use('/api/v1/taxes', taxRoutes);
app.use('/api/v1/warehouses', warehouseRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/suppliers', supplierRoutes);
app.use('/api/v1/customers', customerRoutes);

// Inventory ledger
app.use('/api/v1/inventory', inventoryRoutes);

// Purchases (drafts do not touch stock; posting does)
app.use('/api/v1/purchases', purchaseRoutes);
app.use('/api/v1/purchase-returns', purchaseReturnRoutes);

// Supplier sub-ledger: payables, ledger and payments
app.use('/api/v1/supplier-payables', supplierPayableRoutes);
app.use('/api/v1/supplier-payments', supplierPaymentRoutes);
// Ledger views hang off the supplier itself; two-segment paths, so they never
// collide with the suppliers module's own /:id route.
app.use('/api/v1/suppliers', supplierLedgerRoutes);

// Sales and the customer sub-ledger
app.use('/api/v1/sales', salesRoutes);
app.use('/api/v1/sales-returns', salesReturnRoutes);
app.use('/api/v1/customer-receivables', customerReceivableRoutes);
app.use('/api/v1/customer-payments', customerPaymentRoutes);
// Ledger views hang off the customer itself; two-segment paths, so they never
// collide with the customers module's own /:id route.
app.use('/api/v1/customers', customerLedgerRoutes);

// Operating expenses: rent, electricity, salaries. A category is an EXPENSE
// account, and posting writes one balanced journal entry. No GST involved.
app.use('/api/v1/expenses', expenseRoutes);

// General ledger: the chart of accounts, the journal, and the financial
// statements derived from it. Every operational document above posts into it.
app.use('/api/v1/accounts', accountRoutes);
app.use('/api/v1/journal-entries', journalEntryRoutes);
app.use('/api/v1/general-ledger', generalLedgerRoutes);
app.use('/api/v1/accounting', accountingRoutes);

// GST: the company registration, HSN/SAC master and the tax summaries derived
// from posted documents. The tax itself is computed inside each document.
app.use('/api/v1/tax', gstRoutes);

// The universal business layer: the dashboard, the reports and the credit book.
// Read-only, and none of it requires GST to be configured.
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/credit', creditRoutes);

// Credit and collections: statements, credit limits and the chase list. Every
// figure is read from the sub-ledgers that already maintain it - this layer adds
// no financial fact of its own. Mounted after the credit book so the book's own
// routes keep their paths, and onto the party modules so a statement reads as a
// property of the customer or supplier.
app.use('/api/v1/credit', creditCollectionRoutes);
app.use('/api/v1/customers', customerCreditRoutes);
app.use('/api/v1/suppliers', supplierCreditRoutes);

// Opening balances and accounting periods: how a business that already exists
// starts here, and how it stops people posting into a month it has closed. Both
// go through the existing GL - opening balances write one balanced journal entry,
// and the period guard sits at the single point every posting passes through.
app.use('/api/v1/opening-balances', openingBalanceRoutes);
app.use('/api/v1/accounting-periods', periodRoutes);

// The SaaS layer. These belong to the platform operator, not to a shop: every
// route is permission-gated and none of them reads a shop's companyId.
// Unauthenticated: the price list the marketing site shows. Nothing else.
app.use('/api/v1/public', publicRoutes);

app.use('/api/v1/plans', planRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/subscription-payments', subscriptionPaymentRoutes);
app.use('/api/v1/businesses', businessRoutes);
app.use('/api/v1/sales-team', salesTeamRoutes);

// The one subscription route a SHOP calls, about itself.
app.use('/api/v1/my-subscription', subscriptionStatusRoutes);

// AI bill import. A staging area in front of the existing purchase and sales
// flows - it posts through them, never around them.
app.use('/api/v1/bills', billRoutes);

// --- error handling (must stay last) --------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);
