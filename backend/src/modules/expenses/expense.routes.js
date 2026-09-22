import { Router } from 'express';
import * as expenseController from './expense.controller.js';
import {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesQuerySchema,
} from './expense.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

// RBAC, matching every other financial document in this project:
//
//   Read and draft handling            ADMIN and STAFF
//   Posting, cancelling, reversing     ADMIN
//
// That is the same split purchases, sales and sales returns use: a staff member
// may prepare a document, and only an admin may make it hit the books. There is
// no DELETE - a draft is cancelled, a posted expense is reversed.

export const expenseRoutes = Router();

expenseRoutes.use(requireAuth);

// Declared before /:id so "categories" is never read as an expense id.
expenseRoutes.get('/categories', expenseController.listCategories);

expenseRoutes.get('/', validate({ query: listExpensesQuerySchema }), expenseController.list);

expenseRoutes.get('/:id', validate({ params: idParamSchema }), expenseController.get);

expenseRoutes.post('/', validate({ body: createExpenseSchema }), expenseController.create);

expenseRoutes.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateExpenseSchema }),
  expenseController.update,
);

expenseRoutes.post(
  '/:id/post',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  expenseController.post,
);

expenseRoutes.post(
  '/:id/cancel',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  expenseController.cancel,
);

// A posted expense is never deleted or edited. This creates a NEW, opposite
// journal entry and leaves the original exactly as it was.
expenseRoutes.post(
  '/:id/reverse',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  expenseController.reverse,
);
