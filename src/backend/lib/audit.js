// Append-only record of anything an Admin may need to reconstruct later.
// Failures are logged but never block the action being audited.

import { COLLECTIONS } from '../data/constants.js';
import { insert } from './db.js';

export async function audit(action, { actorType, actorId = null, entityType, entityId, details = {} }) {
  try {
    await insert(COLLECTIONS.AUDIT_LOG, { action, actorType, actorId, entityType, entityId, details });
  } catch (err) {
    console.error(`audit(${action}) failed`, err);
  }
}

export function actorOf(caller) {
  if (!caller) return { actorType: 'system', actorId: null };
  if (caller.isAdmin) return { actorType: 'admin', actorId: caller.memberId };
  if (caller.isDM) return { actorType: 'dm', actorId: caller.memberId };
  return { actorType: 'player', actorId: caller.memberId || null };
}
