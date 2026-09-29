// Unit tests for pure business rules. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBeforeDmCutoff, dmReleaseAction, candidateSeats, validateNewCap, assertOccurrenceBookable,
  assertTableClaimable, assertTableSeatable, isActiveClaim,
} from '../src/backend/lib/rules.js';
import { CLAIM_STATUS, TABLE_STATUS, OCCURRENCE_STATUS } from '../src/backend/data/constants.js';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-10-01T18:00:00Z');
const occAt = (hoursFromNow, extra = {}) => ({
  startsAt: new Date(now.getTime() + hoursFromNow * HOUR), status: OCCURRENCE_STATUS.SCHEDULED, ...extra,
});
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('DM cutoff is 24 hours before start', () => {
  assert.equal(isBeforeDmCutoff(occAt(24.01), now), true);
  assert.equal(isBeforeDmCutoff(occAt(24), now), false);
  assert.equal(isBeforeDmCutoff(occAt(2), now), false);
});

test('pending claims can always be withdrawn', () => {
  assert.equal(dmReleaseAction({ status: CLAIM_STATUS.PENDING }, occAt(1), now), 'withdraw');
});

test('approved claims release directly before the cutoff and need approval inside it', () => {
  assert.equal(dmReleaseAction({ status: CLAIM_STATUS.APPROVED }, occAt(48), now), 'release');
  assert.equal(dmReleaseAction({ status: CLAIM_STATUS.APPROVED }, occAt(23), now), 'request_release');
});

test('repeat release requests and inactive claims are rejected', () => {
  assert.equal(codeOf(() => dmReleaseAction({ status: CLAIM_STATUS.RELEASE_REQUESTED }, occAt(5), now)), 'CONFLICT');
  assert.equal(codeOf(() => dmReleaseAction({ status: CLAIM_STATUS.DENIED }, occAt(5), now)), 'NOT_OPEN');
});

test('candidate seats skip taken ones and stop at the cap', () => {
  assert.deepEqual(candidateSeats(5, [1, 3]), [2, 4, 5]);
  assert.deepEqual(candidateSeats(3, [1, 2, 3]), []);
  assert.deepEqual(candidateSeats(2, []), [1, 2]);
});

test('player cap cannot go below seated players or above table seats', () => {
  assert.equal(validateNewCap(4, 6, 3), 4);
  assert.equal(codeOf(() => validateNewCap(2, 6, 3)), 'INVALID_INPUT');
  assert.equal(codeOf(() => validateNewCap(7, 6, 0)), 'INVALID_INPUT');
});

test('cancelled or started occurrences are not bookable', () => {
  assert.doesNotThrow(() => assertOccurrenceBookable(occAt(2), now));
  assert.equal(codeOf(() => assertOccurrenceBookable(occAt(2, { status: OCCURRENCE_STATUS.CANCELLED }), now)), 'NOT_OPEN');
  assert.equal(codeOf(() => assertOccurrenceBookable(occAt(-1), now)), 'PAST_EVENT');
  assert.equal(codeOf(() => assertOccurrenceBookable(null, now)), 'NOT_FOUND');
});

test('only open tables are claimable and only claimed tables are seatable', () => {
  assert.doesNotThrow(() => assertTableClaimable({ status: TABLE_STATUS.OPEN }));
  assert.equal(codeOf(() => assertTableClaimable({ status: TABLE_STATUS.HELD })), 'CONFLICT');
  assert.doesNotThrow(() => assertTableSeatable({ status: TABLE_STATUS.CLAIMED }));
  assert.equal(codeOf(() => assertTableSeatable({ status: TABLE_STATUS.HELD })), 'NOT_OPEN');
});

test('active claim statuses', () => {
  assert.equal(isActiveClaim(CLAIM_STATUS.PENDING), true);
  assert.equal(isActiveClaim(CLAIM_STATUS.RELEASE_REQUESTED), true);
  assert.equal(isActiveClaim(CLAIM_STATUS.RELEASED), false);
  assert.equal(isActiveClaim(CLAIM_STATUS.OCCURRENCE_CANCELLED), false);
});
