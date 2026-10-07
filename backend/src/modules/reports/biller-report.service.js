import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { add, toDecimal, toMoneyString } from '../../utils/money.js';
import * as companySettingsRepository from '../company-settings/company-settings.repository.js';
import { todayIn, toBusinessDate, toDateString } from './period.js';

// WHO BILLED WHAT, PER DAY.
//
// For the owner: each person's completed sales and the money they took, so the
// cash in each counter can be checked at closing. For a biller: the same figures
// for themselves only ("My day") - never anyone else's, and never the shop total.
//
// Read straight from the documents: a sale counts for the person who made it,
// on its invoice date, once it is completed; a receipt counts for the person
// who recorded it, on its payment date, once posted. Nothing is stored.

const money = (value) => toMoneyString(value ?? 0, 2);

async function resolveDate(companyId, requested) {
  if (requested) return toBusinessDate(requested);
  const settings = await companySettingsRepository.findByCompany(companyId);
  return toBusinessDate(todayIn(settings?.timezone ?? 'UTC'));
}

async function figures(companyId, date, userId = null) {
  const byUser = userId ? { createdById: userId } : {};

  // Lines sold at a price other than the product's own (combos included), per
  // person: the trace of every price change made at the counter.
  const priceChanges = prisma.$queryRaw`
    SELECT si."createdById" AS "userId", COUNT(*)::int AS "count"
    FROM sales_invoice_items it
    JOIN sales_invoices si ON si.id = it."salesInvoiceId"
    WHERE si."companyId" = ${companyId}
      AND si.status = 'POSTED'
      AND si."invoiceDate" = ${toDateString(date)}::date
      AND it."listPriceSnapshot" IS NOT NULL
      AND it."isFree" = false
      AND ROUND(it."unitPrice", 2) <> ROUND(it."listPriceSnapshot", 2)
      ${userId ? Prisma.sql`AND si."createdById" = ${userId}` : Prisma.empty}
    GROUP BY si."createdById"
  `;

  const [sales, cancelled, receipts, changed] = await Promise.all([
    prisma.salesInvoice.groupBy({
      by: ['createdById'],
      where: { companyId, status: 'POSTED', invoiceDate: date, ...byUser },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    prisma.salesInvoice.groupBy({
      by: ['createdById'],
      where: { companyId, status: 'CANCELLED', invoiceDate: date, ...byUser },
      _count: { _all: true },
    }),
    prisma.customerPayment.groupBy({
      by: ['createdById', 'paymentMethod'],
      where: { companyId, status: 'POSTED', paymentDate: date, ...byUser },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    priceChanges,
  ]);

  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) {
      rows.set(id, {
        userId: id,
        salesCount: 0,
        salesTotal: toDecimal(0),
        cancelledCount: 0,
        collected: toDecimal(0),
        byMethod: {},
        priceChangedCount: 0,
      });
    }
    return rows.get(id);
  };
  for (const c of changed) row(c.userId).priceChangedCount = c.count;

  for (const s of sales) {
    const r = row(s.createdById);
    r.salesCount = s._count._all;
    r.salesTotal = toDecimal(s._sum.grandTotal ?? 0);
  }
  for (const c of cancelled) row(c.createdById).cancelledCount = c._count._all;
  for (const p of receipts) {
    const r = row(p.createdById);
    r.collected = add(r.collected, p._sum.amount ?? 0);
    r.byMethod[p.paymentMethod] = money(p._sum.amount);
  }
  return [...rows.values()];
}

function toPublic(row, user) {
  return {
    user: user ? { id: user.id, name: user.name, role: user.role, shopRole: user.shopRole ?? null } : { id: row.userId, name: 'Unknown' },
    salesCount: row.salesCount,
    salesTotal: money(row.salesTotal),
    cancelledCount: row.cancelledCount,
    collected: money(row.collected),
    collectedByMethod: row.byMethod,
    // Lines sold at a changed price (the bill shows which, and from what).
    priceChangedCount: row.priceChangedCount ?? 0,
  };
}

/** Every person's day, for the owner or anyone allowed to see reports. */
export async function getBillerDay(currentUser, { date } = {}) {
  const { companyId } = currentUser;
  const day = await resolveDate(companyId, date);
  const rows = await figures(companyId, day);

  const users = await prisma.user.findMany({
    where: { companyId },
    select: { id: true, name: true, role: true, shopRole: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  // Everyone active is listed, even with nothing today: "did not bill" is an answer.
  const ids = new Set([...users.filter((u) => u.isActive).map((u) => u.id), ...rows.map((r) => r.userId)]);
  const rowById = new Map(rows.map((r) => [r.userId, r]));

  const people = [...ids].map((id) =>
    toPublic(
      rowById.get(id) ?? { userId: id, salesCount: 0, salesTotal: 0, cancelledCount: 0, collected: 0, byMethod: {} },
      byId.get(id),
    ),
  );
  people.sort((a, b) => Number(b.salesTotal) - Number(a.salesTotal) || a.user.name.localeCompare(b.user.name));

  const total = rows.reduce(
    (sum, r) => ({ sales: add(sum.sales, r.salesTotal), collected: add(sum.collected, r.collected), count: sum.count + r.salesCount }),
    { sales: toDecimal(0), collected: toDecimal(0), count: 0 },
  );

  return {
    date: toDateString(day),
    people,
    totals: { salesCount: total.count, salesTotal: money(total.sales), collected: money(total.collected) },
  };
}

/** The signed-in person's own day, and nothing else. */
export async function getMyDay(currentUser, { date } = {}) {
  const day = await resolveDate(currentUser.companyId, date);
  const [row] = await figures(currentUser.companyId, day, currentUser.id);
  const mine = toPublic(
    row ?? { userId: currentUser.id, salesCount: 0, salesTotal: 0, cancelledCount: 0, collected: 0, byMethod: {} },
    currentUser,
  );
  return { date: toDateString(day), ...mine };
}
