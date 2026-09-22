import { isValidStateCode } from './state-codes.js';

// GSTIN structure and checksum. Pure functions, no database, no network.
//
// A GSTIN is 15 characters:
//
//   27   AAPFU0939F   1    Z    V
//   |    |            |    |    |
//   |    |            |    |    checksum
//   |    |            |    fixed 'Z'
//   |    |            entity number for this PAN in this state (1-9, A-Z)
//   |    the holder's 10-character PAN
//   two-digit state code
//
// WHAT THIS CAN AND CANNOT TELL YOU
//   It can prove a GSTIN is well formed and internally consistent.
//   It CANNOT tell you the number is registered, active, or belongs to the party
//   claiming it. Only the GST portal knows that, and this project deliberately
//   makes no external calls. Never present a valid checksum as "verified".

/** Structure only: length, character classes, the fixed 'Z'. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/** The alphabet GSTIN check digits are computed over: 0-9 then A-Z. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MODULUS = ALPHABET.length; // 36

/**
 * The GSTIN check character, computed from the first 14 characters.
 *
 * Modulus-36 with alternating weights 1 and 2. For each character the weighted
 * product is folded back into a single digit-pair sum (quotient + remainder)
 * before being accumulated - the same scheme as a Luhn check, in base 36.
 *
 * @param {string} first14
 * @returns {string|null} the expected 15th character, or null if unusable
 */
export function gstinCheckCharacter(first14) {
  if (typeof first14 !== 'string' || first14.length < 14) return null;

  let sum = 0;

  for (let index = 0; index < 14; index += 1) {
    const value = ALPHABET.indexOf(first14[index]);
    if (value === -1) return null;

    // Positions are 1-indexed in the specification: odd -> 1, even -> 2.
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / MODULUS) + (product % MODULUS);
  }

  return ALPHABET[(MODULUS - (sum % MODULUS)) % MODULUS];
}

/**
 * Full validation with a reason, so a caller can say WHY a GSTIN was rejected
 * rather than just refusing it.
 *
 * @returns {{ valid: boolean, reason: string|null, stateCode: string|null, pan: string|null }}
 */
export function inspectGstin(value) {
  const fail = (reason) => ({ valid: false, reason, stateCode: null, pan: null });

  if (typeof value !== 'string') return fail('GSTIN must be a string');

  const gstin = value.trim().toUpperCase();

  if (gstin.length !== 15) return fail('GSTIN must be exactly 15 characters');
  if (!/^[0-9A-Z]+$/.test(gstin)) return fail('GSTIN may contain only digits and capital letters');
  if (!GSTIN_PATTERN.test(gstin)) return fail('GSTIN does not follow the required structure');

  const stateCode = gstin.slice(0, 2);
  if (!isValidStateCode(stateCode)) {
    return fail(`"${stateCode}" is not a valid GST state code`);
  }

  if (gstinCheckCharacter(gstin) !== gstin[14]) {
    return fail('GSTIN checksum does not match');
  }

  return { valid: true, reason: null, stateCode, pan: gstin.slice(2, 12) };
}

/** True only when structure, state code AND checksum all hold. */
export function isValidGstin(value) {
  return inspectGstin(value).valid;
}

/** True when the structure is right, ignoring the checksum. */
export function hasValidGstinFormat(value) {
  return typeof value === 'string' && GSTIN_PATTERN.test(value.trim().toUpperCase());
}

/** The state a GSTIN was issued in, or null when the GSTIN is unusable. */
export function stateCodeFromGstin(value) {
  return inspectGstin(value).stateCode;
}

/** The PAN embedded in a GSTIN, or null. */
export function panFromGstin(value) {
  return inspectGstin(value).pan;
}
