import { Router } from 'express';
import * as subscriptionService from './subscription.service.js';
import { sendSuccess } from '../../utils/response.js';

// THE ONLY UNAUTHENTICATED ROUTE IN THE PLATFORM MODULE.
//
// A marketing site has to show prices, and a price list is public by definition -
// it is the thing the operator most wants strangers to read. Everything else
// about plans (creating, repricing, withdrawing) stays behind requireAuth and a
// permission, exactly as before.
//
// WHAT IS DELIBERATELY NOT HERE:
//
//   Withdrawn plans. Only what is actually on sale today is listed, so the
//   pricing page cannot advertise something a rep is unable to sell.
//
//   Anything about shops. No counts, no subscriber numbers, no revenue. This
//   endpoint knows nothing about who has bought what, and an anonymous caller
//   learns nothing about the operator's business from it.
//
//   Anything a caller could enumerate. There is no /public/plans/:id, no search
//   and no pagination cursor - it is one small list, or nothing.

export const publicRoutes = Router();

/**
 * The plans a visitor can be sold, for the marketing site's pricing section.
 *
 * Prices come from the database, so the pricing page and what a rep actually
 * charges cannot drift apart. Nothing about pricing is hardcoded in any frontend.
 */
publicRoutes.get('/plans', async (_req, res) => {
  // page and limit are supplied explicitly: the authenticated routes get their
  // defaults from paginationQuerySchema, and this route has no schema in front
  // of it. Without a page, toSkipTake computes NaN and Prisma rejects the query.
  const { plans } = await subscriptionService.listPlans({ page: 1, limit: 100, isActive: true });

  return sendSuccess(res, {
    // Re-shaped rather than passed through, so that adding an internal field to
    // a plan tomorrow cannot silently publish it to the internet.
    plans: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      currency: plan.currency,
      durationValue: plan.durationValue,
      durationUnit: plan.durationUnit,
      durationLabel: plan.durationLabel,
    })),
  });
});
