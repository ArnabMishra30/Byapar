import { ApiError } from '../../utils/api-error.js';

// WHAT A SHOP'S STAFF MAY DO.
//
// Two login roles stay as they always were: ADMIN is the shop owner and may do
// everything; STAFF is everyone else. What a particular STAFF member may do is
// the list of permissions below, chosen by the owner - usually by picking a
// ready-made role (Cashier, Store keeper, ...) and adjusting it.
//
// A STAFF user with no shopRole is a pre-existing staff account and keeps
// exactly what staff could always do (LEGACY_STAFF), so no shop changes
// behaviour until its owner decides to.
//
// These never apply to the platform's own users (PLATFORM_ADMIN, SALES_STAFF),
// whose `permissions` hold a different, platform vocabulary.

export const SHOP_PERMISSIONS = {
  SALES_CREATE: 'Make sales (save as draft)',
  SALES_POST: 'Complete sales (incl. Quick Billing)',
  SALES_DISCOUNT: 'Give discounts / change prices',
  SALES_CANCEL: 'Undo completed sales (sales returns / credit notes)',
  SALES_VIEW_ALL: "See everyone's sales and receipts (not just their own)",
  MONEY_RECEIVE: 'Receive money from customers',
  MONEY_PAY: 'Pay suppliers',
  PURCHASES_MANAGE: 'Record purchases and purchase returns',
  PARTIES_MANAGE: 'Add / edit customers and suppliers',
  CUSTOMERS_CREATE: 'Add new customers while billing (cannot edit existing ones)',
  PRODUCTS_MANAGE: 'Add / edit products',
  STOCK_ADJUST: 'Opening stock and stock adjustments',
  EXPENSES_MANAGE: 'Record expenses',
  BILLS_CONFIRM: 'Save scanned bills (Bill Import)',
  SHARE_LINKS: 'Share bills and accounts with customers',
  REPORTS_VIEW: 'See dashboard totals, reports and account statements',
};

export const SHOP_PERMISSION_KEYS = Object.keys(SHOP_PERMISSIONS);

/** Ready-made roles. The owner picks one and may then tick or untick anything. */
export const SHOP_ROLE_TEMPLATES = {
  CASHIER: {
    label: 'Cashier / Biller',
    permissions: ['SALES_CREATE', 'SALES_POST', 'SALES_DISCOUNT', 'MONEY_RECEIVE', 'SHARE_LINKS', 'CUSTOMERS_CREATE'],
  },
  STOREKEEPER: {
    label: 'Store keeper',
    permissions: ['PURCHASES_MANAGE', 'PRODUCTS_MANAGE', 'STOCK_ADJUST', 'BILLS_CONFIRM'],
  },
  ACCOUNTANT: {
    label: 'Accountant',
    permissions: ['SALES_VIEW_ALL', 'REPORTS_VIEW', 'MONEY_RECEIVE', 'MONEY_PAY', 'EXPENSES_MANAGE'],
  },
  MANAGER: {
    label: 'Manager',
    permissions: SHOP_PERMISSION_KEYS,
  },
  CUSTOM: { label: 'Custom', permissions: [] },
};

export const SHOP_ROLE_KEYS = Object.keys(SHOP_ROLE_TEMPLATES);

/** What staff could always do, before per-user permissions existed. */
// LEGACY_DRAFTS is internal (never grantable): the drafts old staff could always
// prepare - purchase returns, sales returns, expenses - kept so nothing changes.
export const LEGACY_STAFF = ['SALES_CREATE', 'SALES_DISCOUNT', 'SALES_VIEW_ALL', 'REPORTS_VIEW', 'LEGACY_DRAFTS'];

/**
 * The role and permission list to store for a staff member.
 * A template role with no explicit list gets the template's permissions.
 */
export function resolveStaffAccess({ shopRole, permissions }) {
  const role = shopRole ?? 'CUSTOM';
  const list = permissions ?? SHOP_ROLE_TEMPLATES[role].permissions;
  return { shopRole: role, permissions: [...new Set(list)].filter((key) => SHOP_PERMISSION_KEYS.includes(key)) };
}

/**
 * The permissions a shop user actually has.
 * ADMIN: all. STAFF: their own list, or LEGACY_STAFF when never configured.
 */
export function shopPermissionsOf(user) {
  if (!user || !user.companyId) return [];
  if (user.role === 'ADMIN') return SHOP_PERMISSION_KEYS;
  if (user.role !== 'STAFF') return [];
  if (!user.shopRole) return LEGACY_STAFF;
  return (user.permissions ?? []).filter((key) => SHOP_PERMISSION_KEYS.includes(key));
}

export function hasShopPermission(user, permission) {
  return shopPermissionsOf(user).includes(permission);
}

/**
 * Route guard: the shop user must hold at least one of the permissions.
 * Platform users have no shop and are refused outright.
 */
export function requireShopPermission(...anyOf) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    const held = shopPermissionsOf(req.user);
    if (anyOf.some((permission) => held.includes(permission))) return next();
    return next(ApiError.forbidden('You do not have permission to perform this action'));
  };
}

/**
 * For lists and details of sales, receipts and returns: whose records this
 * user may see. Null means everyone's; otherwise only those they created.
 */
export function ownRecordsFilter(user) {
  return hasShopPermission(user, 'SALES_VIEW_ALL') ? null : user.id;
}
