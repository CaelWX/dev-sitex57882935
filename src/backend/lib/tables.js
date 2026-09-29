// State transitions shared by the claim, booking and admin web modules.
// Keeping them here means "release a table" or "free a seat" behaves the same
// whoever triggers it (DM, Admin or a cancelled occurrence).

import {
  COLLECTIONS, TABLE_STATUS, BOOKING_STATUS, BOOKING_SOURCE, LOCK_KIND, lockKeys,
} from '../data/constants.js';
import {
  get, getOrFail, insert, patch, query, find, count, acquireLock, releaseLock, newId,
} from './db.js';
import { candidateSeats } from './rules.js';
import { newManageToken, hashToken } from './tokens.js';
import { ERR, fail } from './errors.js';

export function getTable(tableId) {
  return getOrFail(COLLECTIONS.TABLES, tableId, 'That table could not be found.');
}

export function getOccurrence(occurrenceId) {
  return getOrFail(COLLECTIONS.OCCURRENCES, occurrenceId, 'That event could not be found.');
}

export async function markOccurrenceActive(occurrenceId) {
  const occ = await get(COLLECTIONS.OCCURRENCES, occurrenceId);
  if (occ && !occ.hasActivity) await patch(COLLECTIONS.OCCURRENCES, occurrenceId, { hasActivity: true });
}

export function confirmedBookingsQuery(tableId) {
  return query(COLLECTIONS.BOOKINGS).eq('table', tableId).eq('status', BOOKING_STATUS.CONFIRMED);
}

// Recount instead of incrementing, so concurrent bookings can't leave the counter wrong.
export async function recountSeats(tableId) {
  const seatsTaken = await count(confirmedBookingsQuery(tableId));
  await patch(COLLECTIONS.TABLES, tableId, { seatsTaken });
  return seatsTaken;
}

// Waitlist promotion hook. Stage 5 fills this in; until then freed seats simply become open.
export async function onSeatFreed(tableId) {
  return { tableId, promoted: [] };
}

// Seats a player at a table. Enforces one seat per person per night and the table's cap
// using lock inserts, so two simultaneous requests can't both succeed.
export async function seatPlayer(table, occurrence, { playerName, email }, { source = BOOKING_SOURCE.DIRECT, allowOverCap = false } = {}) {
  const bookingId = newId();
  const nightKey = lockKeys.night(occurrence._id, email);

  if (!(await acquireLock(nightKey, LOCK_KIND.NIGHT, bookingId))) {
    fail(ERR.ALREADY_BOOKED, 'That email already has a seat (or is running a table) at this event. Each person can hold one seat per night.');
  }

  let seatNumber = null;
  try {
    const current = await find(confirmedBookingsQuery(table._id));
    const taken = current.map((b) => b.seatNumber);
    const cap = allowOverCap ? Math.max(table.playerCap, ...taken, 0) + 1 : table.playerCap;
    for (const n of candidateSeats(cap, taken)) {
      if (await acquireLock(lockKeys.seat(table._id, n), LOCK_KIND.SEAT, bookingId)) {
        seatNumber = n;
        break;
      }
    }
    if (seatNumber === null) fail(ERR.TABLE_FULL, 'Sorry, that table just filled up. You can join its waitlist instead.');

    const token = newManageToken();
    const booking = await insert(COLLECTIONS.BOOKINGS, {
      _id: bookingId,
      table: table._id,
      occurrence: occurrence._id,
      seatNumber,
      playerName,
      email,
      status: BOOKING_STATUS.CONFIRMED,
      source,
      manageTokenHash: hashToken(token),
    });

    await recountSeats(table._id);
    await markOccurrenceActive(occurrence._id);
    return { booking, manageToken: token };
  } catch (err) {
    // Undo whatever we grabbed so the player can try again.
    if (seatNumber !== null) await releaseLock(lockKeys.seat(table._id, seatNumber));
    await releaseLock(nightKey);
    throw err;
  }
}

// Claims a one-time right to change `record` from the version we read.
// Two actors acting on the same stale view (e.g. a DM withdrawing while an Admin approves)
// produce the same key, so only one proceeds; the other gets CONFLICT and should refresh.
export async function beginTransition(collection, record) {
  const version = new Date(record._updatedDate || record._createdDate || 0).getTime();
  const key = lockKeys.transition(collection, record._id, version);
  if (!(await acquireLock(key, LOCK_KIND.TRANSITION, record._id))) {
    fail(ERR.CONFLICT, 'This was just changed by someone else. Refresh the page and try again.');
  }
}

// Frees a single booking's seat and night locks and records why.
// With skipIfBusy, a booking that's mid-change elsewhere is skipped (returns null) instead of failing.
export async function endBooking(booking, status, { skipIfBusy = false } = {}) {
  try {
    await beginTransition(COLLECTIONS.BOOKINGS, booking);
  } catch (err) {
    if (skipIfBusy && err.code === ERR.CONFLICT) return null;
    throw err;
  }
  const updated = await patch(COLLECTIONS.BOOKINGS, booking._id, { status, cancelledAt: new Date() });
  await releaseLock(lockKeys.seat(booking.table, booking.seatNumber));
  await releaseLock(lockKeys.night(booking.occurrence, booking.email));
  return updated;
}

// Ends a claim: removes seated players (with `bookingStatus`), frees the DM's locks,
// and returns the table to open. Returns the bookings that were removed so callers can notify them.
// Callers must have called beginTransition() on the claim first.
export async function endClaim(claim, claimStatus, { reason = '', bookingStatus = BOOKING_STATUS.TABLE_RELEASED } = {}) {
  const removed = [];
  const seated = await find(confirmedBookingsQuery(claim.table));
  for (const booking of seated) {
    const ended = await endBooking(booking, bookingStatus, { skipIfBusy: true });
    if (ended) removed.push(ended);
  }

  await patch(COLLECTIONS.TABLE_CLAIMS, claim._id, {
    status: claimStatus,
    decisionReason: reason || claim.decisionReason || '',
    decidedAt: new Date(),
  });

  const table = await get(COLLECTIONS.TABLES, claim.table);
  if (table && table.currentClaimId === claim._id) {
    await patch(COLLECTIONS.TABLES, claim.table, {
      status: TABLE_STATUS.OPEN,
      currentClaimId: null,
      dmMemberId: null,
      dmDisplayName: null,
      gameTitle: null,
      system: null,
      playerCap: null,
      description: null,
      contentNotes: null,
      seatsTaken: 0,
    });
  }

  await releaseLock(lockKeys.claim(claim.table));
  await releaseLock(lockKeys.night(claim.occurrence, claim.dmEmail));
  return removed;
}

// Public view of a table: never includes emails or member IDs of players.
export function publicTable(table) {
  const claimed = table.status === TABLE_STATUS.CLAIMED;
  const seatsLeft = claimed ? Math.max(0, (table.playerCap || 0) - (table.seatsTaken || 0)) : 0;
  return {
    _id: table._id,
    tableNumber: table.tableNumber,
    name: table.name,
    status: table.status,
    maxSeats: table.maxSeats,
    dmMemberId: claimed ? table.dmMemberId : null,
    dmDisplayName: claimed ? table.dmDisplayName : null,
    gameTitle: claimed ? table.gameTitle : null,
    system: claimed ? table.system : null,
    description: claimed ? table.description : null,
    contentNotes: claimed ? table.contentNotes : null,
    playerCap: claimed ? table.playerCap : null,
    seatsTaken: claimed ? table.seatsTaken || 0 : 0,
    seatsLeft,
    waitlistCount: table.waitlistCount || 0,
  };
}

export function publicOccurrence(occ) {
  return {
    _id: occ._id,
    seriesId: occ.series,
    localDate: occ.localDate,
    startsAt: occ.startsAt,
    endsAt: occ.endsAt,
    title: occ.title,
    venue: occ.venue,
    description: occ.description,
    status: occ.status,
    cancelReason: occ.cancelReason || '',
  };
}
