// Player endpoints. Players don't need accounts: they book with a name and email,
// and manage their bookings with the private token from their confirmation link.

import { Permissions, webMethod } from 'wix-web-module';
import { COLLECTIONS, BOOKING_STATUS } from './data/constants.js';
import { getOrFail, query, find } from './lib/db.js';
import { ERR, fail, handled } from './lib/errors.js';
import * as v from './lib/validate.js';
import { audit } from './lib/audit.js';
import { hashToken, isWellFormedToken } from './lib/tokens.js';
import { assertOccurrenceBookable, assertTableSeatable } from './lib/rules.js';
import {
  getTable, getOccurrence, seatPlayer, endBooking, recountSeats, onSeatFreed,
  publicOccurrence, publicTable,
} from './lib/tables.js';

// Resolves a manage-link token to the email it belongs to.
async function ownerEmailFromToken(token) {
  if (!isWellFormedToken(token)) fail(ERR.FORBIDDEN, 'This link is not valid. Use the link from your most recent confirmation email.');
  const hash = hashToken(token);
  const [booking] = await find(query(COLLECTIONS.BOOKINGS).eq('manageTokenHash', hash), 1);
  if (booking) return booking.email;
  const [waiting] = await find(query(COLLECTIONS.WAITLIST).eq('manageTokenHash', hash), 1);
  if (waiting) return waiting.email;
  return fail(ERR.FORBIDDEN, 'This link is not valid. Use the link from your most recent confirmation email.');
}

// Book a seat. `player`: { playerName, email }.
export const bookSeat = webMethod(Permissions.Anyone, handled(async (tableId, player) => {
  const details = v.playerDetails(player);
  const table = await getTable(v.id(tableId, 'Table'));
  const occ = await getOccurrence(table.occurrence);
  assertOccurrenceBookable(occ);
  assertTableSeatable(table);

  const { booking, manageToken } = await seatPlayer(table, occ, details);
  await audit('booking.created', {
    actorType: 'player', entityType: 'Bookings', entityId: booking._id, details: { tableId: table._id, seatNumber: booking.seatNumber },
  });
  // Stage 5 emails the confirmation with the manage link.
  return {
    bookingId: booking._id,
    seatNumber: booking.seatNumber,
    manageToken,
    occurrence: publicOccurrence(occ),
    table: publicTable(await getTable(table._id)),
  };
}));

// Everything upcoming for the email that owns this token.
export const getMyBookings = webMethod(Permissions.Anyone, handled(async (token) => {
  const email = await ownerEmailFromToken(token);
  const bookings = await find(
    query(COLLECTIONS.BOOKINGS).eq('email', email).eq('status', BOOKING_STATUS.CONFIRMED).descending('_createdDate'),
    100,
  );
  const now = new Date();
  const rows = await Promise.all(bookings.map(async (b) => {
    const [occ, table] = await Promise.all([getOccurrence(b.occurrence).catch(() => null), getTable(b.table).catch(() => null)]);
    return {
      bookingId: b._id,
      seatNumber: b.seatNumber,
      playerName: b.playerName,
      occurrence: occ ? publicOccurrence(occ) : null,
      table: table ? publicTable(table) : null,
    };
  }));
  return {
    email,
    bookings: rows.filter((r) => r.occurrence && new Date(r.occurrence.endsAt) > now)
      .sort((a, b) => new Date(a.occurrence.startsAt) - new Date(b.occurrence.startsAt)),
    waitlist: [], // stage 5
  };
}));

// Players can cancel at any time.
export const cancelMyBooking = webMethod(Permissions.Anyone, handled(async (token, bookingId) => {
  const email = await ownerEmailFromToken(token);
  const booking = await getOrFail(COLLECTIONS.BOOKINGS, v.id(bookingId, 'Booking'), 'That booking could not be found.');
  if (booking.email !== email) fail(ERR.FORBIDDEN, 'That booking belongs to a different email address.');
  if (booking.status !== BOOKING_STATUS.CONFIRMED) fail(ERR.NOT_OPEN, 'That booking is already cancelled.');

  await endBooking(booking, BOOKING_STATUS.CANCELLED); // guarded by beginTransition inside
  await recountSeats(booking.table);
  await onSeatFreed(booking.table);
  await audit('booking.cancelled', {
    actorType: 'player', entityType: 'Bookings', entityId: booking._id, details: { tableId: booking.table },
  });
  return { cancelled: true };
}));
