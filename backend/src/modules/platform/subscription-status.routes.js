import { Router } from 'express';
import * as subscriptionService from './subscription.service.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { sendSuccess } from '../../utils/response.js';
import { ApiError } from '../../utils/api-error.js';

// THE ONE SUBSCRIPTION ROUTE A SHOP CALLS, and it asks only about itself.
//
// The shop application needs this to show "12 days left" and to put up the
// renewal screen instead of a form it knows will be refused. It is a courtesy,
// not a control: the guard inside the posting path is what actually refuses a
// write, so nothing here is load-bearing for security.
//
// The company is taken from req.user.companyId - never from the query string,
// never from the body. A shop can ask about its own subscription and there is no
// parameter with which to ask about anyone else's.

export const subscriptionStatusRoutes = Router();

subscriptionStatusRoutes.use(requireAuth);

subscriptionStatusRoutes.get('/', async (req, res, next) => {
  // Platform staff have no company, so this question is meaningless for them.
  if (!req.user.companyId) {
    return next(
      ApiError.business(
        400,
        'NOT_A_BUSINESS_USER',
        'This endpoint is for business users. Platform staff have no subscription of their own.',
      ),
    );
  }

  const subscription = await subscriptionService.getEntitlement(req.user.companyId);
  return sendSuccess(res, { subscription });
});
