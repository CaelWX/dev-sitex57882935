// DM endpoints: claim tables, withdraw/release claims, edit an approved table, DM dashboard.
// Every method re-checks the DM role on the backend.

import { Permissions, webMethod } from 'wix-web-module';
import {
  COLLECTIONS, CLAIM_STATUS, TABLE_STATUS, LOCK_KIND, lockKeys,
} from './data/constants.js';
import {
  getOrFail, insert, patch, query, find, acquireLock, releaseLock, newId,
} from './lib/db.js';
import { ERR, fail, handled } from './lib/errors.js';
import * as v from './lib/validate.js';
import { requireDM } from './lib/auth.js';
import { audit } from './lib/audit.js';
import {
  assertOccurrenceBookable, assertTableClaimable, dmReleaseAction, isActiveClaim, validateNewCap,
} from './lib/rules.js';
import {
  getTable, getOccurrence, markOccurrenceActive, endClaim, recountSeats, onSeatFreed,
  confirmedBookingsQuery, publicOccurrence, beginTransition,
} from './lib/tables.js';

async function claimOneTable(caller, tableId, input, batchId = null) {
  const table = await getTable(tableId);
  const occ = await getOccurrence(table.occurrence);
  assertOccurrenceBookable(occ);
  assertTableClaimable(table);
  const details = v.gameDetails(input, table.maxSeats);

  const claimId = newId();
  const claimKey = lockKeys.claim(table._id);
  const nightKey = lockKeys.night(occ._id, caller.email);

  // Lock 1: the table. Whoever inserts first wins; everyone else gets CONFLICT.
  if (!(await acquireLock(claimKey, LOCK_KIND.CLAIM, claimId))) {
    fail(ERR.CONFLICT, 'Another DM claimed that table a moment ago.');
  }
  // Lock 2: the DM's night. Blocks running two tables, or claiming while seated as a player.
  if (!(await acquireLock(nightKey, LOCK_KIND.NIGHT, claimId))) {
    await releaseLock(claimKey);
    fail(ERR.ALREADY_BOOKED, 'You already have a table or a seat at this event. DMs can run one table per night and can\'t also play that night.');
  }

  try {
    const claim = await insert(COLLECTIONS.TABLE_CLAIMS, {
      _id: claimId,
      table: table._id,
      occurrence: occ._id,
      dmMemberId: caller.memberId,
      dmDisplayName: caller.displayName,
      dmEmail: caller.email,
      ...details,
      status: CLAIM_STATUS.PENDING,
      batchId,
    });
    await patch(COLLECTIONS.TABLES, table._id, {
      status: TABLE_STATUS.HELD,
      currentClaimId: claimId,
      dmMemberId: caller.memberId,
      dmDisplayName: caller.displayName,
    });
    await markOccurrenceActive(occ._id);
    await audit('claim.submitted', {
      actorType: 'dm', actorId: caller.memberId, entityType: 'TableClaims', entityId: claimId, details: { tableId: table._id, batchId },
    });
    return claim;
  } catch (err) {
    await releaseLock(claimKey);
    await releaseLock(nightKey);
    throw err;
  }
}

function ownClaimOrFail(claim, caller) {
  if (claim.dmMemberId !== caller.memberId) fail(ERR.FORBIDDEN, 'That claim belongs to another DM.');
  return claim;
}

// Claim one table. `details`: { gameTitle, system, playerCap, description, contentNotes }.
export const submitClaim = webMethod(Permissions.SiteMember, handled(async (tableId, details) => {
  const caller = await requireDM();
  const claim = await claimOneTable(caller, v.id(tableId, 'Table'), details);
  return { claimId: claim._id, status: claim.status };
}));

// Claim tables on several dates at once. Each date gets its own claim and its own approval;
// one failing (e.g. already taken) doesn't stop the others.
export const submitClaims = webMethod(Permissions.SiteMember, handled(async (tableIds, details) => {
  const caller = await requireDM();
  const ids = v.idList(tableIds, 'tables', { max: 12 });
  const batchId = newId();
  const results = [];
  for (const tableId of ids) {
    try {
      const claim = await claimOneTable(caller, tableId, details, batchId);
      results.push({ tableId, ok: true, claimId: claim._id });
    } catch (err) {
      results.push({ tableId, ok: false, error: { code: err.code || ERR.INTERNAL, message: err.code ? err.message : 'Could not claim this table.' } });
      if (!err.code) console.error('submitClaims item failed', err);
    }
  }
  return { batchId, results };
}));

// Withdraw a pending claim, release an approved one (24h+ before start),
// or ask an Admin to release it (inside 24h).
export const giveUpClaim = webMethod(Permissions.SiteMember, handled(async (claimId, reason) => {
  const caller = await requireDM();
  const claim = ownClaimOrFail(await getOrFail(COLLECTIONS.TABLE_CLAIMS, v.id(claimId, 'Claim'), 'That claim could not be found.'), caller);
  const occ = await getOccurrence(claim.occurrence);
  const why = v.text(reason, 'Reason', { max: 500 });
  const action = dmReleaseAction(claim, occ);
  await beginTransition(COLLECTIONS.TABLE_CLAIMS, claim);

  if (action === 'request_release') {
    await patch(COLLECTIONS.TABLE_CLAIMS, claim._id, { status: CLAIM_STATUS.RELEASE_REQUESTED, releaseReason: why });
    await audit('claim.release_requested', {
      actorType: 'dm', actorId: caller.memberId, entityType: 'TableClaims', entityId: claim._id, details: { reason: why },
    });
    return { outcome: 'release_requested', message: 'It\'s less than 24 hours before the event, so an Admin needs to approve this. Your players stay seated until then.' };
  }

  const newStatus = action === 'withdraw' ? CLAIM_STATUS.WITHDRAWN : CLAIM_STATUS.RELEASED;
  await patch(COLLECTIONS.TABLE_CLAIMS, claim._id, { releaseReason: why });
  const removedBookings = await endClaim(claim, newStatus);
  await audit(`claim.${newStatus}`, {
    actorType: 'dm', actorId: caller.memberId, entityType: 'TableClaims', entityId: claim._id,
    details: { reason: why, removedBookingIds: removedBookings.map((b) => b._id) },
  });
  // Stage 5 emails the removed players.
  return { outcome: newStatus, playersRemoved: removedBookings.length };
}));

// Edit game details. For approved claims this also updates the live table.
export const updateClaimDetails = webMethod(Permissions.SiteMember, handled(async (claimId, details) => {
  const caller = await requireDM();
  const claim = ownClaimOrFail(await getOrFail(COLLECTIONS.TABLE_CLAIMS, v.id(claimId, 'Claim'), 'That claim could not be found.'), caller);
  if (!isActiveClaim(claim.status)) fail(ERR.NOT_OPEN, 'This claim is no longer active.');
  const table = await getTable(claim.table);
  const clean = v.gameDetails(details, table.maxSeats);
  await beginTransition(COLLECTIONS.TABLE_CLAIMS, claim);

  if (claim.status === CLAIM_STATUS.PENDING) {
    await patch(COLLECTIONS.TABLE_CLAIMS, claim._id, clean);
    return { updated: 'claim' };
  }

  const seatsTaken = await recountSeats(table._id);
  validateNewCap(clean.playerCap, table.maxSeats, seatsTaken);
  await patch(COLLECTIONS.TABLE_CLAIMS, claim._id, clean);
  await patch(COLLECTIONS.TABLES, table._id, clean);
  if (clean.playerCap > (table.playerCap || 0)) await onSeatFreed(table._id);
  return { updated: 'table' };
}));

// Everything the DM dashboard shows: active and past claims, plus rosters (display names only).
export const getMyDmDashboard = webMethod(Permissions.SiteMember, handled(async () => {
  const caller = await requireDM();
  const claims = await find(query(COLLECTIONS.TABLE_CLAIMS).eq('dmMemberId', caller.memberId).descending('_createdDate'), 200);

  const rows = await Promise.all(claims.map(async (c) => {
    const [occ, table] = await Promise.all([getOccurrence(c.occurrence).catch(() => null), getTable(c.table).catch(() => null)]);
    let roster = [];
    if (c.status === CLAIM_STATUS.APPROVED || c.status === CLAIM_STATUS.RELEASE_REQUESTED) {
      const bookings = await find(confirmedBookingsQuery(c.table).ascending('seatNumber'), 50);
      roster = bookings.map((b) => ({ seatNumber: b.seatNumber, playerName: b.playerName }));
    }
    return {
      claimId: c._id,
      status: c.status,
      gameTitle: c.gameTitle,
      system: c.system,
      playerCap: c.playerCap,
      description: c.description,
      contentNotes: c.contentNotes,
      decisionReason: c.decisionReason || '',
      batchId: c.batchId || null,
      occurrence: occ ? publicOccurrence(occ) : null,
      table: table ? { _id: table._id, name: table.name, tableNumber: table.tableNumber, maxSeats: table.maxSeats, seatsTaken: table.seatsTaken || 0 } : null,
      roster,
    };
  }));

  const now = new Date();
  const upcoming = rows.filter((r) => r.occurrence && new Date(r.occurrence.startsAt) > now);
  return {
    pending: upcoming.filter((r) => r.status === CLAIM_STATUS.PENDING),
    active: upcoming.filter((r) => r.status === CLAIM_STATUS.APPROVED || r.status === CLAIM_STATUS.RELEASE_REQUESTED),
    history: rows.filter((r) => !upcoming.includes(r) || !isActiveClaim(r.status)),
  };
}));
