import { z } from 'zod';

// The project-wide pagination convention. Reuse this for products, customers,
// suppliers, purchases, sales, inventory and reports - do not invent a second one.

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Merge into a route's query schema: validate({ query: paginationQuerySchema }) */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

/** Turns validated page/limit into Prisma's skip/take. */
export function toSkipTake({ page, limit }) {
  return { skip: (page - 1) * limit, take: limit };
}

/** Builds the pagination block returned next to the data array. */
export function buildPagination({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
