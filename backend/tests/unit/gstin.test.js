import { describe, it, expect } from 'vitest';
import {
  inspectGstin,
  isValidGstin,
  hasValidGstinFormat,
  gstinCheckCharacter,
  stateCodeFromGstin,
  panFromGstin,
} from '../../src/modules/tax/gstin.js';
import { isValidStateCode, stateName, listStates } from '../../src/modules/tax/state-codes.js';

// GSTIN structure and the modulus-36 checksum, with no database and no network.
//
// The fixtures below are checksum-consistent numbers used as examples in GST
// documentation. A valid checksum proves the number is internally consistent -
// never that it is registered with anyone.

const VALID = [
  '27AAPFU0939F1ZV', // Maharashtra
  '24AAACC1206D1ZM', // Gujarat
  '09AAACH7409R1ZZ', // Uttar Pradesh
  '36AAACH7409R1Z2', // Telangana - same PAN, different state
];

describe('GSTIN checksum', () => {
  it('accepts well-formed numbers with a correct check character', () => {
    for (const gstin of VALID) {
      expect(`${gstin}:${isValidGstin(gstin)}`).toBe(`${gstin}:true`);
    }
  });

  it('computes the check character the specification requires', () => {
    for (const gstin of VALID) {
      expect(gstinCheckCharacter(gstin)).toBe(gstin[14]);
    }
  });

  it('rejects a number whose last character has been altered', () => {
    // Every other character is untouched, so only the checksum can catch this.
    const tampered = '27AAPFU0939F1ZX';
    expect(isValidGstin(tampered)).toBe(false);
    expect(inspectGstin(tampered).reason).toMatch(/checksum/i);
  });

  it('rejects a transcription error in the middle of the PAN', () => {
    expect(isValidGstin('27AAPFU0939G1ZV')).toBe(false);
  });

  it('needs at least 14 characters to compute anything', () => {
    expect(gstinCheckCharacter('27AAPFU0939')).toBeNull();
    expect(gstinCheckCharacter(null)).toBeNull();
  });
});

describe('GSTIN structure', () => {
  it('rejects the wrong length, and says so', () => {
    expect(inspectGstin('27AAPFU0939F1Z').reason).toMatch(/15 characters/);
    expect(inspectGstin('27AAPFU0939F1ZVV').reason).toMatch(/15 characters/);
    expect(inspectGstin('').reason).toMatch(/15 characters/);
  });

  it('rejects characters that are neither digits nor capital letters', () => {
    expect(inspectGstin('27AAPFU0939F1Z-').reason).toMatch(/digits and capital letters/);
    expect(inspectGstin('27AAPFU0939F1Z ').reason).toMatch(/15 characters|digits/);
  });

  it('rejects a structure that does not follow state + PAN + entity + Z + check', () => {
    // The 14th character must be a literal 'Z'.
    expect(inspectGstin('27AAPFU0939F1AV').reason).toMatch(/structure/);
    // The PAN section must be 5 letters then 4 digits then a letter.
    expect(inspectGstin('27AAPF00939F1ZV').reason).toMatch(/structure/);
  });

  it('rejects a state code that does not exist', () => {
    expect(inspectGstin('55AAPFU0939F1ZV').reason).toMatch(/not a valid GST state code/);
    expect(inspectGstin('00AAPFU0939F1ZV').reason).toMatch(/not a valid GST state code/);
  });

  it('accepts lowercase input, because a form should not punish shift keys', () => {
    expect(isValidGstin('27aapfu0939f1zv')).toBe(true);
    expect(isValidGstin('  27AAPFU0939F1ZV  ')).toBe(true);
  });

  it('rejects a non-string without throwing', () => {
    expect(isValidGstin(null)).toBe(false);
    expect(isValidGstin(27)).toBe(false);
    expect(isValidGstin(undefined)).toBe(false);
  });
});

describe('reading a GSTIN', () => {
  it('extracts the state code and the PAN', () => {
    const result = inspectGstin('27AAPFU0939F1ZV');
    expect(result.stateCode).toBe('27');
    expect(result.pan).toBe('AAPFU0939F');
    expect(stateCodeFromGstin('24AAACC1206D1ZM')).toBe('24');
    expect(panFromGstin('24AAACC1206D1ZM')).toBe('AAACC1206D');
  });

  it('extracts nothing from an unusable GSTIN', () => {
    expect(stateCodeFromGstin('nonsense')).toBeNull();
    expect(panFromGstin('nonsense')).toBeNull();
  });

  it('separates "well formed" from "valid"', () => {
    // A number can look right and still be wrong. Callers that only need the
    // shape - like the pre-existing supplier and customer fields - use this.
    const badChecksum = '29AAGCB1286Q1ZP';
    expect(hasValidGstinFormat(badChecksum)).toBe(true);
    expect(isValidGstin(badChecksum)).toBe(false);
  });
});

describe('GST state codes', () => {
  it('knows the real ones and rejects the rest', () => {
    expect(isValidStateCode('27')).toBe(true);
    expect(isValidStateCode('07')).toBe(true);
    expect(isValidStateCode('38')).toBe(true);
    expect(isValidStateCode('55')).toBe(false);
    expect(isValidStateCode('7')).toBe(false);
    expect(isValidStateCode(27)).toBe(false);
  });

  it('names them', () => {
    expect(stateName('27')).toBe('Maharashtra');
    expect(stateName('29')).toBe('Karnataka');
    expect(stateName('99')).toBe('Centre Jurisdiction');
    expect(stateName('55')).toBeNull();
  });

  it('lists every code as a two-digit string', () => {
    const states = listStates();
    expect(states.length).toBeGreaterThan(35);
    expect(states.every((state) => /^\d{2}$/.test(state.code))).toBe(true);
    expect(states.every((state) => typeof state.name === 'string' && state.name.length > 0)).toBe(true);
  });
});
