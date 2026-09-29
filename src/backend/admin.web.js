// Admin endpoints (site owner and admin collaborators).
//
// Wix-specific: Permissions.Admin stops non-admins from calling these at all; requireAdmin()
// re-checks the caller's roles as a second line of defence and gives us their member ID for auditing.
// Series creation/editing and occurrence generation arrive in stage 4 (recurrence.web.js).

import { Permissions, webMethod } from 'wix-web-module';
import { authorization } from 'wix-members-backend';
import {
  COLLECTIONS, CLAIM_STATUS, TABLE_STATUS, BOOKING_STATUS, BOOKING_SOURCE, OCCURRENCE_STATUS,
  DM_APPLICATION_STATUS, DM_ROLE_ID,
} from './data/constants.js';
import {
  get, getOrFail, insert, patch, remove, query, find, count,
} from './lib/db.js';
import { ERR, fail, handled } from './lib/errors.js';
import * as v from './lib/validate.js';
import { requireAdmin } from './lib/auth.js';
import { audit } from './lib/audit.js';
import { assertOccurrenceBookable, assertTableSeatable, isActiveClaim } from './lib/rules.js';
import {
  getTable, getOccurrence, beginTransition, endClaim, endBooking, seatPlayer, recountSeats,
  onSeatFreed, confirmedBookingsQuery, publicOccurrence, publicTable,
} from './lib/tables.js';

const admin = (fn) => webMethod(Permissions.Admin, handled(async (...args) => fn(await requireAdmin(), ...args)));
const actor = (caller) => ({ actorType: 'admin', actorId: caller.memberId });

async function getClaim(claimId) {
  return getOrFail(COLLECTIONS.TABLE_CLAIMS, v.id(claimId, 'Claim'), 'That claim could not be found.');
}

async function claimRow(c) {
  const [occ, table] = await Promise.all([get(COLLECTIONS.OCCURRENCES, c.occurrence), get(COLLECTIONS.TABLES, c.table)]);
  return {
    claimId: c._id,
    status: c.status,
    dmMemberId: c.dmMemberId,
    dmDisplayName: c.dmDisplayName,
    gameTitle: c.gameTitle,
    system: c.system,
    playerCap: c.playerCap,
    description: c.description,
    contentNotes: c.contentNotes,
    releaseReason: c.releaseReason || '',
    batchId: c.batchId || null,
    submittedAt: c._createdDate,
    occurrence: occ ? publicOccurrence(occ) : null,
    table: table ? { _id: table._id, name: table.name, tableNumber: table.tableNumber, maxSeats: table.maxSeats, seatsTaken: table.seatsTaken || 0 } : null,
  };
}

// ---------- Queue ----------

export const getAdminQueue = admin(async () => {
  const [pendingClaims, releaseRequests, applications] = await Promise.all([
    find(query(COLLECTIONS.TABLE_CLAIMS).eq('status', CLAIM_STATUS.PENDING).ascending('_createdDate'), 200),
    find(query(COLLECTIONS.TABLE_CLAIMS).eq('status', CLAIM_STATUS.RELEASE_REQUESTED).ascending('_updatedDate'), 200),
    find(query(COLLECTIONS.DM_APPLICATIONS).eq('status', DM_APPLICATION_STATUS.PENDING).ascending('_createdDate'), 200),
  ]);
  return {
    pendingClaims: await Promise.all(pendingClaims.map(claimRow)),
    releaseRequests: await Promise.all(releaseRequests.map(claimRow)),
    dmApplications: applications.map((a) => ({
      _id: a._id, memberId: a.memberId, displayName: a.displayName, experience: a.experience,
      systems: a.systems, notes: a.notes, submittedAt: a._createdDate,
    })),
  };
});

// ---------- Claims ----------

export const approveClaim = admin(async (caller, claimId) => {
  const claim = await getClaim(claimId);
  if (claim.status !== CLAIM_STATUS.PENDING) fail(ERR.CONFLICT, 'This claim is no longer pending.');
  const occ = await getOccurrence(claim.occurrence);
  assertOccurrenceBookable(occ);
  await beginTransition(COLLECTIONS.TABLE_CLAIMS, claim);

  await patch(COLLECTIONS.TABLE_CLAIMS, claim._id, { status: CLAIM_STATUS.APPROVED, decidedAt: new Date(), decisionReason: '' });
  await patch(COLLECTIONS.TABLES, claim.table, {
    status: TABLE_STATUS.CLAIMED,
    currentClaimId: claim._id,
    dmMemberId: claim.dmMemberId,
    dmDisplayName: claim.dmDisplayName,
    gameTitle: claim.gameTitle,
    system: claim.system,
    playerCap: claim.playerCap,
    description: claim.description,
    contentNotes: claim.contentNotes,
    seatsTaken: 0,
  });
  await audit('claim.approved', { ...actor(caller), entityType: 'TableClaims', entityId: claim._id });
  return { approved: true };
});

export const denyClaim = admin(async (caller, claimId, reason) => {
  const claim = await getClaim(claimId);
  if (claim.status !== CLAIM_STATUS.PENDING) fail(ERR.CONFLICT, 'This claim is no longer pending.');
  const why = v.text(reason, 'Reason', { max: 500 });
  await beginTransition(COLLECTIONS.TABLE_CLAIMS, claim);
  await endClaim(claim, CLAIM_STATUS.DENIED, { reason: why });
  await audit('claim.denied', { ...actor(caller), entityType: 'TableClaims', entityId: claim._id, details: { reason: why } });
  return { denied: true };
});

// Decide a DM's request to release inside the 24h window.
export const decideReleaseRequest = admin(async (caller, claimId, approve, reason) => {
  const claim = await getClaim(claimId);
  if (claim.status !== CLAIM_STATUS.RELEASE_REQUESTED) fail(ERR.CONFLICT, 'There is no pending release request for this claim.');
  const why = v.text(reason, 'Reason', { max: 500 });
  await beginTransition(COLLECTIONS.TABLE_CLAIMS, claim);

  if (approve === true) {
    const removed = await endClaim(claim, CLAIM_STATUS.RELEASED, { reason: why });
    await audit('claim.release_approved', {
      ...actor(caller), entityType: 'TableClaims', entityId: claim._id, details: { reason: why, removedBookingIds: removed.map((b) => b._id) },
    });
    return { released: true, playersRemoved: removed.length };
  }
  await patch(COLLECTIONS.TABLE_CLAIMS, claim._id, { status: CLAIM_STATUS.APPROVED, decisionReason: why, decidedAt: new Date() });
  await audit('claim.release_denied', { ...actor(caller), entityType: 'TableClaims', entityId: claim._id, details: { reason: why } });
  return { released: false };
});

// Admin can release any active claim at any time.
export const adminReleaseClaim = admin(async (caller, claimId, reason) => {
  const claim = await getClaim(claimId);
  if (!isActiveClaim(claim.status)) fail(ERR.NOT_OPEN, 'This claim is no longer active.');
  const why = v.text(reason, 'Reason', { max: 500 });
  await beginTransition(COLLECTIONS.TABLE_CLAIMS, claim);
  const status = claim.status === CLAIM_STATUS.PENDING ? CLAIM_STATUS.DENIED : CLAIM_STATUS.RELEASED;
  const removed = await endClaim(claim, status, { reason: why });
  await audit('claim.admin_released', {
    ...actor(caller), entityType: 'TableClaims', entityId: claim._id, details: { reason: why, removedBookingIds: removed.map((b) => b._id) },
  });
  return { status, playersRemoved: removed.length };
});

// ---------- Occurrences & tables ----------

// Full view of one night for Admins, including player emails.
export const getOccurrenceAdminView = admin(async (caller, occurrenceId) => {
  const occ = await getOccurrence(v.id(occurrenceId, 'Event'));
  const tables = await find(query(COLLECTIONS.TABLES).eq('occurrence', occ._id).ascending('tableNumber'), 100);
  const rows = await Promise.all(tables.map(async (t) => {
    const [claim, bookings] = await Promise.all([
      t.currentClaimId ? get(COLLECTIONS.TABLE_CLAIMS, t.currentClaimId) : null,
      find(confirmedBookingsQuery(t._id).ascending('seatNumber'), 50),
    ]);
    return {
      ...publicTable(t),
      claim: claim ? await claimRow(claim) : null,
      roster: bookings.map((b) => ({ bookingId: b._id, seatNumber: b.seatNumber, playerName: b.playerName, email: b.email, source: b.source })),
    };
  }));
  return { occurrence: { ...publicOccurrence(occ), isCustomized: !!occ.isCustomized }, tables: rows };
});

// `changes`: { title, venue, description }. Marks the occurrence customized so series edits skip it.
export const editOccurrence = admin(async (caller, occurrenceId, changes) => {
  const occ = await getOccurrence(v.id(occurrenceId, 'Event'));
  const src = changes || {};
  const clean = {
    title: v.text(src.title === undefined ? occ.title : src.title, 'Title', { required: true, max: 120 }),
    venue: v.text(src.venue === undefined ? occ.venue : src.venue, 'Venue', { max: 200 }),
    description: v.text(src.description === undefined ? occ.description : src.description, 'Description', { max: 4000 }),
  };
  await patch(COLLECTIONS.OCCURRENCES, occ._id, { ...clean, isCustomized: true });
  await audit('occurrence.edited', { ...actor(caller), entityType: 'Occurrences', entityId: occ._id, details: clean });
  return { updated: true };
});

// Cancels one night without touching the rest of the series. Ends every claim and booking on it.
export const cancelOccurrence = admin(async (caller, occurrenceId, reason) => {
  const occ = await getOccurrence(v.id(occurrenceId, 'Event'));
  if (occ.status === OCCURRENCE_STATUS.CANCELLED) fail(ERR.CONFLICT, 'This event is already cancelled.');
  const why = v.text(reason, 'Reason', { required: true, max: 500 });
  await beginTransition(COLLECTIONS.OCCURRENCES, occ);
  await patch(COLLECTIONS.OCCURRENCES, occ._id, { status: OCCURRENCE_STATUS.CANCELLED, cancelReason: why, isCustomized: true });

  const claims = await find(query(COLLECTIONS.TABLE_CLAIMS).eq('occurrence', occ._id), 200);
  let playersRemoved = 0;
  let claimsEnded = 0;
  for (const claim of claims.filter((c) => isActiveClaim(c.status))) {
    try {
      await beginTransition(COLLECTIONS.TABLE_CLAIMS, claim);
    } catch (err) {
      continue; // someone else is ending it right now
    }
    const removed = await endClaim(claim, CLAIM_STATUS.OCCURRENCE_CANCELLED, {
      reason: why, bookingStatus: BOOKING_STATUS.OCCURRENCE_CANCELLED,
    });
    playersRemoved += removed.length;
    claimsEnded += 1;
  }
  await audit('occurrence.cancelled', {
    ...actor(caller), entityType: 'Occurrences', entityId: occ._id, details: { reason: why, claimsEnded, playersRemoved },
  });
  // Stage 5 emails affected DMs and players.
  return { cancelled: true, claimsEnded, playersRemoved };
});

// `input`: { name, maxSeats }
export const addTable = admin(async (caller, occurrenceId, input) => {
  const occ = await getOccurrence(v.id(occurrenceId, 'Event'));
  const src = input || {};
  const existing = await find(query(COLLECTIONS.TABLES).eq('occurrence', occ._id).descending('tableNumber'), 1);
  const tableNumber = existing.length ? existing[0].tableNumber + 1 : 1;
  const table = await insert(COLLECTIONS.TABLES, {
    _id: `${occ._id}_t${tableNumber}`,
    occurrence: occ._id,
    tableNumber,
    name: v.text(src.name, 'Table name', { max: 60 }) || `Table ${tableNumber}`,
    maxSeats: v.integer(src.maxSeats, 'Seats', { min: 1, max: 20 }),
    status: TABLE_STATUS.OPEN,
    seatsTaken: 0,
    waitlistCount: 0,
  });
  await patch(COLLECTIONS.OCCURRENCES, occ._id, { isCustomized: true });
  await audit('table.added', { ...actor(caller), entityType: 'Tables', entityId: table._id });
  return publicTable(table);
});

// `input`: { name, maxSeats }. maxSeats can't drop below the DM's current player cap.
export const editTable = admin(async (caller, tableId, input) => {
  const table = await getTable(v.id(tableId, 'Table'));
  const src = input || {};
  const maxSeats = src.maxSeats === undefined ? table.maxSeats : v.integer(src.maxSeats, 'Seats', { min: 1, max: 20 });
  if (table.playerCap && maxSeats < table.playerCap) {
    fail(ERR.INVALID_INPUT, `The DM's player cap is ${table.playerCap}. Lower it first, or release the claim.`);
  }
  const name = src.name === undefined ? table.name : (v.text(src.name, 'Table name', { max: 60 }) || table.name);
  await patch(COLLECTIONS.TABLES, table._id, { name, maxSeats });
  await patch(COLLECTIONS.OCCURRENCES, table.occurrence, { isCustomized: true });
  return { updated: true };
});

// Only open tables with nobody on them can be removed; release the claim first otherwise.
export const removeTable = admin(async (caller, tableId) => {
  const table = await getTable(v.id(tableId, 'Table'));
  if (table.status !== TABLE_STATUS.OPEN) fail(ERR.CONFLICT, 'Release or deny this table\'s claim before removing it.');
  if (await count(confirmedBookingsQuery(table._id))) fail(ERR.CONFLICT, 'This table still has players seated.');
  await remove(COLLECTIONS.TABLES, table._id);
  await patch(COLLECTIONS.OCCURRENCES, table.occurrence, { isCustomized: true });
  await audit('table.removed', { ...actor(caller), entityType: 'Tables', entityId: table._id });
  return { removed: true };
});

// ---------- Booking overrides ----------

// Seat a player directly. allowOverCap lets an Admin add a seat beyond the DM's cap.
export const adminAddBooking = admin(async (caller, tableId, player, options = {}) => {
  const details = v.playerDetails(player);
  const table = await getTable(v.id(tableId, 'Table'));
  const occ = await getOccurrence(table.occurrence);
  assertOccurrenceBookable(occ);
  assertTableSeatable(table);
  const { booking, manageToken } = await seatPlayer(table, occ, details, {
    source: BOOKING_SOURCE.ADMIN, allowOverCap: options.allowOverCap === true,
  });
  await audit('booking.admin_added', {
    ...actor(caller), entityType: 'Bookings', entityId: booking._id, details: { tableId: table._id, allowOverCap: options.allowOverCap === true },
  });
  return { bookingId: booking._id, seatNumber: booking.seatNumber, manageToken };
});

export const adminRemoveBooking = admin(async (caller, bookingId, reason) => {
  const booking = await getOrFail(COLLECTIONS.BOOKINGS, v.id(bookingId, 'Booking'), 'That booking could not be found.');
  if (booking.status !== BOOKING_STATUS.CONFIRMED) fail(ERR.NOT_OPEN, 'That booking is not active.');
  const why = v.text(reason, 'Reason', { max: 500 });
  await endBooking(booking, BOOKING_STATUS.REMOVED);
  await recountSeats(booking.table);
  await onSeatFreed(booking.table);
  await audit('booking.admin_removed', { ...actor(caller), entityType: 'Bookings', entityId: booking._id, details: { reason: why } });
  return { removed: true };
});

// ---------- DM role management ----------

function requireDmRoleId() {
  if (!DM_ROLE_ID) {
    fail(ERR.NOT_CONFIGURED, 'The DM role ID is not set yet. Add it to DM_ROLE_ID in backend/data/constants.js.');
  }
  return DM_ROLE_ID;
}

export const decideDmApplication = admin(async (caller, applicationId, approve, reason) => {
  const app = await getOrFail(COLLECTIONS.DM_APPLICATIONS, v.id(applicationId, 'Application'), 'That application could not be found.');
  if (app.status !== DM_APPLICATION_STATUS.PENDING) fail(ERR.CONFLICT, 'This application has already been decided.');
  const why = v.text(reason, 'Reason', { max: 500 });
  await beginTransition(COLLECTIONS.DM_APPLICATIONS, app);

  if (approve === true) {
    // Wix: assignRole can take a few seconds to resolve. suppressAuth lets backend code assign roles.
    await authorization.assignRole(requireDmRoleId(), app.memberId, { suppressAuth: true });
  }
  const status = approve === true ? DM_APPLICATION_STATUS.APPROVED : DM_APPLICATION_STATUS.DENIED;
  await patch(COLLECTIONS.DM_APPLICATIONS, app._id, { status, decisionReason: why, decidedAt: new Date() });
  await audit(`dm_application.${status}`, { ...actor(caller), entityType: 'DMApplications', entityId: app._id, details: { memberId: app.memberId } });
  return { status };
});

// DMs approved through this system. (Anyone given the DM role directly in the Wix dashboard
// can still claim tables, but won't appear here.)
export const listDms = admin(async () => {
  const apps = await find(query(COLLECTIONS.DM_APPLICATIONS).eq('status', DM_APPLICATION_STATUS.APPROVED).descending('decidedAt'), 500);
  const byMember = new Map();
  for (const a of apps) if (!byMember.has(a.memberId)) byMember.set(a.memberId, a);
  return [...byMember.values()].map((a) => ({ memberId: a.memberId, displayName: a.displayName, approvedAt: a.decidedAt, applicationId: a._id }));
});

// Removes the DM role. Blocked while they hold upcoming tables, so no players are silently orphaned.
export const revokeDm = admin(async (caller, memberId, reason) => {
  const id = v.id(memberId, 'Member');
  const why = v.text(reason, 'Reason', { max: 500 });
  const active = (await find(query(COLLECTIONS.TABLE_CLAIMS).eq('dmMemberId', id), 500)).filter((c) => isActiveClaim(c.status));
  const upcoming = [];
  for (const c of active) {
    const occ = await get(COLLECTIONS.OCCURRENCES, c.occurrence);
    if (occ && new Date(occ.startsAt) > new Date()) upcoming.push(c);
  }
  if (upcoming.length) {
    fail(ERR.CONFLICT, `This DM still holds ${upcoming.length} upcoming table(s). Release those claims first.`);
  }

  await authorization.removeRole(requireDmRoleId(), id, { suppressAuth: true });
  const apps = await find(query(COLLECTIONS.DM_APPLICATIONS).eq('memberId', id).eq('status', DM_APPLICATION_STATUS.APPROVED), 50);
  for (const a of apps) await patch(COLLECTIONS.DM_APPLICATIONS, a._id, { status: DM_APPLICATION_STATUS.REVOKED, decisionReason: why });
  await audit('dm.revoked', { ...actor(caller), entityType: 'Member', entityId: id, details: { reason: why } });
  return { revoked: true };
});
