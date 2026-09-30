// How we decide two parties MIGHT be the same person or business.
//
// Pure functions, no database: the rules are the part worth testing on their own.
//
// A match is only ever a suggestion. Nothing here merges anything - the shop
// sees "a similar party already exists" and chooses. That matters most for the
// name: two shops called "Sharma Traders" in one town are common, so a name
// match is shown, never acted on.

/** The last ten digits of a phone number, or '' when there are fewer than ten. */
export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D+/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/** A GSTIN compared without case or spaces. Only a full 15-character one counts. */
export function normalizeGstin(value) {
  const gstin = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  return gstin.length === 15 ? gstin : '';
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * A name reduced to its letters and digits: "M/s. XYZ  Traders" -> "ms xyz traders".
 *
 * Deliberately conservative. It does not drop words like "traders" or "& co",
 * because that turns "Sharma Traders" and "Sharma Stores" into the same party.
 */
export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Why a candidate looks like the party being entered.
 *
 * @param {{ name?: string, phone?: string, alternatePhone?: string, gstin?: string, email?: string }} wanted
 * @param {{ name: string, phone?: string|null, alternatePhone?: string|null, gstin?: string|null, email?: string|null }} candidate
 * @returns {Array<'gstin'|'phone'|'email'|'name'>} empty when nothing matches
 */
export function matchReasons(wanted, candidate) {
  const reasons = [];

  const gstin = normalizeGstin(wanted.gstin);
  if (gstin && normalizeGstin(candidate.gstin) === gstin) reasons.push('gstin');

  const wantedPhones = [wanted.phone, wanted.alternatePhone].map(normalizePhone).filter(Boolean);
  const candidatePhones = [candidate.phone, candidate.alternatePhone]
    .map(normalizePhone)
    .filter(Boolean);
  if (wantedPhones.some((phone) => candidatePhones.includes(phone))) reasons.push('phone');

  const email = normalizeEmail(wanted.email);
  if (email && normalizeEmail(candidate.email) === email) reasons.push('email');

  const name = normalizeName(wanted.name);
  if (name && normalizeName(candidate.name) === name) reasons.push('name');

  return reasons;
}

/** Strongest evidence first: a GSTIN is a legal identity, a name is a coincidence. */
const REASON_WEIGHT = { gstin: 8, phone: 4, email: 2, name: 1 };

/**
 * Every candidate that matches, strongest first. Ties keep the input order, so
 * the result is deterministic for the same data.
 */
export function findPossibleMatches(wanted, candidates, { excludeId = null, limit = 5 } = {}) {
  return candidates
    .filter((candidate) => candidate.id !== excludeId)
    .map((candidate, order) => ({ candidate, order, reasons: matchReasons(wanted, candidate) }))
    .filter((row) => row.reasons.length > 0)
    .map((row) => ({
      ...row,
      score: row.reasons.reduce((sum, reason) => sum + REASON_WEIGHT[reason], 0),
    }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ candidate, reasons }) => ({ candidate, reasons }));
}
