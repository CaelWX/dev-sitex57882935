// Pure business rules. No Wix imports, so they can be unit tested in Node.

import { DM_RELEASE_CUTOFF_HOURS, OCCURRENCE_STATUS, TABLE_STATUS, CLAIM_STATUS } from '../data/constants.js';
import { ERR, fail } from './errors.js';

const HOUR_MS = 60 * 60 * 1000;

export function hasStarted(occurrence, now = new Date()) {
  return new Date(occurrence.startsAt).getTime() <= now.getTime();
}

// True while a DM may still release an approved table without Admin approval.
export function isBeforeDmCutoff(occurrence, now = new Date()) {
  const cutoff = new Date(occurrence.startsAt).getTime() - DM_RELEASE_CUTOFF_HOURS * HOUR_MS;
  return now.getTime() < cutoff;
}

export function assertOccurrenceBookable(occurrence, now = new Date()) {
  if (!occurrence) fail(ERR.NOT_FOUND, 'That event could not be found.');
  if (occurrence.status === OCCURRENCE_STATUS.CANCELLED) fail(ERR.NOT_OPEN, 'This event has been cancelled.');
  if (hasStarted(occurrence, now)) fail(ERR.PAST_EVENT, 'This event has already started.');
}

export function assertTableClaimable(table) {
  if (!table) fail(ERR.NOT_FOUND, 'That table could not be found.');
  if (table.status !== TABLE_STATUS.OPEN) fail(ERR.CONFLICT, 'That table has already been claimed or is awaiting approval.');
}

export function assertTableSeatable(table) {
  if (!table) fail(ERR.NOT_FOUND, 'That table could not be found.');
  if (table.status !== TABLE_STATUS.CLAIMED) fail(ERR.NOT_OPEN, 'That table is not open for players yet.');
}

// Seat numbers to try, lowest first, skipping ones already held.
export function candidateSeats(playerCap, takenSeatNumbers) {
  const taken = new Set(takenSeatNumbers);
  const seats = [];
  for (let n = 1; n <= playerCap; n += 1) {
    if (!taken.has(n)) seats.push(n);
  }
  return seats;
}

// A DM may lower the cap only down to the number already seated.
export function validateNewCap(newCap, maxSeats, seatsTaken) {
  if (newCap > maxSeats) fail(ERR.INVALID_INPUT, `Player cap can't be more than the table's ${maxSeats} seats.`);
  if (newCap < seatsTaken) {
    fail(ERR.INVALID_INPUT, `${seatsTaken} players are already seated, so the cap can't go below ${seatsTaken}.`);
  }
  return newCap;
}

// What happens when a DM asks to give up a claim.
//   'withdraw'        pending claim, no players yet: always allowed
//   'release'         approved, before the cutoff: DM can release directly
//   'request_release' approved, inside the cutoff: needs Admin approval
export function dmReleaseAction(claim, occurrence, now = new Date()) {
  switch (claim.status) {
    case CLAIM_STATUS.PENDING:
      return 'withdraw';
    case CLAIM_STATUS.APPROVED:
      return isBeforeDmCutoff(occurrence, now) ? 'release' : 'request_release';
    case CLAIM_STATUS.RELEASE_REQUESTED:
      return fail(ERR.CONFLICT, 'You have already asked to release this table. An Admin will review it.');
    default:
      return fail(ERR.NOT_OPEN, 'This claim is no longer active.');
  }
}

// Claims that still hold the table (and the DM's night).
export function isActiveClaim(status) {
  return status === CLAIM_STATUS.PENDING || status === CLAIM_STATUS.APPROVED || status === CLAIM_STATUS.RELEASE_REQUESTED;
}
