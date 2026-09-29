// Shared names and enums for the D&D booking system.
// Collection schemas live in /schema/collections.json (created on the site via the Wix Data REST API).
// Every write to these collections goes through backend web modules using `suppressAuth`,
// because the collections themselves only allow Admin writes.

export const COLLECTIONS = Object.freeze({
  EVENT_SERIES: 'EventSeries',
  OCCURRENCES: 'Occurrences',
  TABLES: 'Tables',
  TABLE_CLAIMS: 'TableClaims',
  BOOKINGS: 'Bookings',
  WAITLIST: 'Waitlist',
  DM_APPLICATIONS: 'DMApplications',
  LOCKS: 'Locks',
  AUDIT_LOG: 'AuditLog',
});

export const VENUE_TIME_ZONE = 'America/Denver';

// How far ahead the scheduled job keeps occurrences generated.
export const GENERATION_WINDOW_WEEKS = 12;

// DMs can withdraw/release a claim themselves until this many hours before start.
// Inside the window, release becomes a request that an Admin must approve.
export const DM_RELEASE_CUTOFF_HOURS = 24;

// Roles. Checks match the role title returned by currentMember.getRoles().
// Site owners and admin collaborators get an extra role titled "Admin" with this fixed ID.
export const ADMIN_ROLE_ID = '00000000-0000-0000-0000-000000000001';
export const ADMIN_ROLE_TITLE = 'Admin';
export const DM_ROLE_TITLE = 'DM';
// Needed to assign/remove the DM role in code (authorization.assignRole/removeRole).
// Copy it from Dashboard > Settings > Member Permissions > Roles > DM (the ID in the role settings page URL).
export const DM_ROLE_ID = '56b073da-30eb-49db-963d-b9666cd3513a';

export const SERIES_STATUS = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  ENDED: 'ended',
});

export const OCCURRENCE_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  CANCELLED: 'cancelled',
});

export const TABLE_STATUS = Object.freeze({
  OPEN: 'open',       // no active claim
  HELD: 'held',       // pending claim; not open to players
  CLAIMED: 'claimed', // approved claim; open for seating
});

export const CLAIM_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  WITHDRAWN: 'withdrawn',                 // DM pulled a pending claim
  RELEASE_REQUESTED: 'release_requested', // DM asked to release inside the cutoff
  RELEASED: 'released',                   // approved claim given up
  OCCURRENCE_CANCELLED: 'occurrence_cancelled',
});

export const BOOKING_STATUS = Object.freeze({
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',                       // player cancelled (allowed any time)
  REMOVED: 'removed',                           // Admin override
  OCCURRENCE_CANCELLED: 'occurrence_cancelled', // the night was cancelled
  TABLE_RELEASED: 'table_released',             // the DM gave up the table
});

export const BOOKING_SOURCE = Object.freeze({
  DIRECT: 'direct',
  WAITLIST: 'waitlist',
  ADMIN: 'admin',
});

export const WAITLIST_STATUS = Object.freeze({
  WAITING: 'waiting',
  PROMOTED: 'promoted',
  LEFT: 'left',
  SKIPPED: 'skipped', // couldn't be promoted (e.g. already seated elsewhere that night)
});

export const DM_APPLICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  WITHDRAWN: 'withdrawn',
  REVOKED: 'revoked', // DM role later removed by an Admin
});

// Lock keys become the `_id` of a Locks item. Wix Data rejects a second insert with the same
// `_id` (WDE0074, verified against this site), which gives us an atomic check-and-set.
export const LOCK_KIND = Object.freeze({
  CLAIM: 'claim', // one active claim per table
  NIGHT: 'night', // one seat or DM table per person per occurrence
  SEAT: 'seat',   // one booking per seat number, so capacity can't be exceeded
  TRANSITION: 'transition', // one state change per record version (see lib/tables.js beginTransition)
});

export const lockKeys = Object.freeze({
  claim: (tableId) => `claim:${tableId}`,
  night: (occurrenceId, normalizedEmail) => `night:${occurrenceId}:${normalizedEmail}`,
  seat: (tableId, seatNumber) => `seat:${tableId}:${seatNumber}`,
  transition: (collection, itemId, version) => `tx:${collection}:${itemId}:${version}`,
});

export const WIX_DATA_DUPLICATE_ID = 'WDE0074';
