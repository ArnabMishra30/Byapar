/**
 * PLATFORM PERMISSIONS.
 *
 * The shop side of this system has two roles and no permission table, and that
 * is right for it: a shop has an owner and some staff, and the split between
 * "prepare a document" and "post it to the books" is the only distinction that
 * matters there.
 *
 * The PLATFORM side is different. Sales staff go door to door, and what one is
 * trusted to do - register a shop, take cash, activate an account - varies by
 * person and by how new they are. So platform staff carry an explicit list of
 * permissions, stored on the user.
 *
 * TWO ROLES NEED NO LIST:
 *   PLATFORM_ADMIN  can do everything. The operator of the SaaS.
 *   Everyone else   has exactly what is in their permissions array.
 *
 * This is deliberately NOT a general-purpose RBAC engine. There is no role
 * table, no permission table and no inheritance: a flat list of strings on the
 * user, checked by one middleware. Anything more would be machinery nobody has
 * asked for yet.
 */

export const PERMISSION = {
  /** Register a new shop and its first owner account. */
  BUSINESS_CREATE: 'BUSINESS_CREATE',
  /** See shops, and the details of one. */
  BUSINESS_VIEW: 'BUSINESS_VIEW',
  /** Edit a shop's own details after onboarding. */
  BUSINESS_EDIT: 'BUSINESS_EDIT',
  /** Sell a subscription, or renew one. */
  SUBSCRIPTION_CREATE: 'SUBSCRIPTION_CREATE',
  SUBSCRIPTION_VIEW: 'SUBSCRIPTION_VIEW',
  /** Cancel a subscription. Deliberately separate from creating one. */
  SUBSCRIPTION_CANCEL: 'SUBSCRIPTION_CANCEL',
  /**
   * Grant or recharge a subscription by hand, with no money or with money
   * collected offline.
   *
   * THE MOST DANGEROUS PERMISSION HERE, which is why it is its own. Somebody
   * holding it can give any shop free access indefinitely - so it is absent from
   * the sales-staff defaults, and an operator has to hand it out deliberately.
   * A PLATFORM_ADMIN has it implicitly, like everything else.
   */
  SUBSCRIPTION_GRANT: 'SUBSCRIPTION_GRANT',
  /** Take money for a subscription. */
  PAYMENT_CREATE: 'PAYMENT_CREATE',
  PAYMENT_VIEW: 'PAYMENT_VIEW',
  /** Read the plan catalogue. Managing plans is PLATFORM_ADMIN only. */
  PLAN_VIEW: 'PLAN_VIEW',
};

export const ALL_PERMISSIONS = Object.values(PERMISSION);

/**
 * What a new field sales rep gets unless someone chooses otherwise.
 *
 * Enough to walk into a shop, sign it up, sell it a plan and take the cash -
 * and nothing else. Notably absent: cancelling a subscription, editing a shop
 * after the fact, and above all GRANTING a subscription, which would let a rep
 * hand out free access.
 */
export const DEFAULT_SALES_STAFF_PERMISSIONS = [
  PERMISSION.BUSINESS_CREATE,
  PERMISSION.BUSINESS_VIEW,
  PERMISSION.SUBSCRIPTION_CREATE,
  PERMISSION.SUBSCRIPTION_VIEW,
  PERMISSION.PAYMENT_CREATE,
  PERMISSION.PAYMENT_VIEW,
  PERMISSION.PLAN_VIEW,
];

/** Is this one of the SaaS operator's own people, rather than a shop's? */
export function isPlatformRole(role) {
  return role === 'PLATFORM_ADMIN' || role === 'SALES_STAFF';
}

/**
 * Whether a user may do something on the platform.
 *
 * A PLATFORM_ADMIN may do everything. Anyone else needs the permission in their
 * own list - including a shop's ADMIN, who has none of these and is not supposed
 * to: running a shop and running the SaaS are different jobs.
 */
export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'PLATFORM_ADMIN') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

/** Rejects anything that is not a permission this system defines. */
export function assertValidPermissions(permissions) {
  const unknown = (permissions ?? []).filter((item) => !ALL_PERMISSIONS.includes(item));
  return unknown;
}
