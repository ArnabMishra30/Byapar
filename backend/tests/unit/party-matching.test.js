import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  normalizeGstin,
  normalizeName,
  matchReasons,
  findPossibleMatches,
} from '../../src/modules/parties/party-matching.js';

// The rules for "these two parties might be the same". Suggestions only - the
// service never merges on any of them.

describe('normalisation', () => {
  it('compares phones by their last ten digits', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone('12345')).toBe('');
    expect(normalizePhone(null)).toBe('');
  });

  it('only treats a full 15-character GSTIN as a GSTIN', () => {
    expect(normalizeGstin(' 19abcde1234f1z5 ')).toBe('19ABCDE1234F1Z5');
    expect(normalizeGstin('19ABCDE')).toBe('');
  });

  it('ignores case, punctuation and spacing in names, but keeps every word', () => {
    expect(normalizeName('M/s. XYZ  Traders')).toBe('m s xyz traders');
    expect(normalizeName('A & B Stores')).toBe('a and b stores');
    // "Traders" and "Stores" stay different businesses.
    expect(normalizeName('Sharma Traders')).not.toBe(normalizeName('Sharma Stores'));
  });
});

describe('matchReasons', () => {
  const candidate = {
    name: 'XYZ Traders',
    phone: '9876543210',
    alternatePhone: '9000000000',
    gstin: '19ABCDE1234F1Z5',
    email: 'xyz@example.com',
  };

  it('reports every identifier that matches', () => {
    expect(
      matchReasons(
        { name: 'xyz traders', phone: '+91 98765 43210', gstin: '19abcde1234f1z5', email: 'XYZ@example.com' },
        candidate,
      ),
    ).toEqual(['gstin', 'phone', 'email', 'name']);
  });

  it('matches a phone against the alternate number too', () => {
    expect(matchReasons({ name: 'Other', phone: '9000000000' }, candidate)).toEqual(['phone']);
  });

  it('finds nothing when nothing matches, and never matches on empty values', () => {
    expect(matchReasons({ name: 'Someone Else' }, candidate)).toEqual([]);
    expect(matchReasons({ name: '' }, { name: '' })).toEqual([]);
  });
});

describe('findPossibleMatches', () => {
  const candidates = [
    { id: 'a', name: 'Rahul Store', phone: null },
    { id: 'b', name: 'Other Name', phone: '9876543210' },
    { id: 'c', name: 'Rahul Store', gstin: '19ABCDE1234F1Z5' },
  ];

  it('ranks a GSTIN above a phone above a name', () => {
    const matches = findPossibleMatches(
      { name: 'Rahul Store', phone: '9876543210', gstin: '19ABCDE1234F1Z5' },
      candidates,
    );
    expect(matches.map((m) => m.candidate.id)).toEqual(['c', 'b', 'a']);
  });

  it('leaves out the party being edited', () => {
    const matches = findPossibleMatches({ name: 'Rahul Store' }, candidates, { excludeId: 'a' });
    expect(matches.map((m) => m.candidate.id)).toEqual(['c']);
  });

  it('is deterministic for equal scores: input order wins', () => {
    const first = findPossibleMatches({ name: 'Rahul Store' }, candidates);
    const second = findPossibleMatches({ name: 'Rahul Store' }, candidates);
    expect(first).toEqual(second);
    expect(first.map((m) => m.candidate.id)).toEqual(['a', 'c']);
  });
});
