// Public read-only endpoints for the events list and occurrence detail pages.
// Anyone can call these; they only return public fields (no player emails).

import { Permissions, webMethod } from 'wix-web-module';
import { COLLECTIONS, OCCURRENCE_STATUS, TABLE_STATUS, GENERATION_WINDOW_WEEKS } from './data/constants.js';
import { query, find } from './lib/db.js';
import { handled } from './lib/errors.js';
import * as v from './lib/validate.js';
import { getCaller, publicCaller } from './lib/auth.js';
import { getOccurrence, publicOccurrence, publicTable } from './lib/tables.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function tablesFor(occurrenceId) {
  return find(query(COLLECTIONS.TABLES).eq('occurrence', occurrenceId).ascending('tableNumber'), 100);
}

function summarize(tables) {
  const pub = tables.map(publicTable);
  return {
    tableCount: pub.length,
    openTables: pub.filter((t) => t.status === TABLE_STATUS.OPEN).length,
    runningTables: pub.filter((t) => t.status === TABLE_STATUS.CLAIMED).length,
    openSeats: pub.reduce((sum, t) => sum + t.seatsLeft, 0),
  };
}

// Upcoming occurrences (including cancelled ones, so players see the notice) with seat counts.
export const listUpcomingOccurrences = webMethod(Permissions.Anyone, handled(async (options = {}) => {
  const weeks = options.weeks === undefined ? GENERATION_WINDOW_WEEKS : v.integer(options.weeks, 'Weeks', { min: 1, max: 26 });
  const now = new Date();
  const until = new Date(now.getTime() + weeks * 7 * DAY_MS);

  const occurrences = await find(
    query(COLLECTIONS.OCCURRENCES).gt('endsAt', now).lt('startsAt', until).ascending('startsAt'),
    200,
  );

  // One query per occurrence keeps the reference filter simple; a 12-week window is ~12-24 queries.
  const tableLists = await Promise.all(occurrences.map((o) => tablesFor(o._id)));
  return occurrences.map((occ, i) => ({
    ...publicOccurrence(occ),
    ...summarize(occ.status === OCCURRENCE_STATUS.CANCELLED ? [] : tableLists[i]),
  }));
}));

// One occurrence with its tables and what the current viewer is allowed to do.
export const getOccurrenceDetail = webMethod(Permissions.Anyone, handled(async (occurrenceId) => {
  const occ = await getOccurrence(v.id(occurrenceId, 'Event'));
  const [tables, caller] = await Promise.all([tablesFor(occ._id), getCaller()]);

  const pubTables = tables.map(publicTable);
  const myTableIds = caller.isLoggedIn
    ? tables.filter((t) => t.dmMemberId === caller.memberId && t.status !== TABLE_STATUS.OPEN).map((t) => t._id)
    : [];

  return {
    occurrence: publicOccurrence(occ),
    tables: pubTables,
    viewer: {
      ...publicCaller(caller),
      // A DM runs at most one table per night, and can't claim another once they hold one.
      myTableIds,
      canClaim: caller.isDM && myTableIds.length === 0 && occ.status !== OCCURRENCE_STATUS.CANCELLED
        && new Date(occ.startsAt) > new Date(),
    },
  };
}));
