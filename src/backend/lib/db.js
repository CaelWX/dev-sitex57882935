// Thin wrappers around wix-data for the booking collections.
//
// Wix-specific notes:
// - Every call passes { suppressAuth: true }. The collections only allow Admin writes (and most
//   only Admin reads), so web modules must bypass collection permissions. That is safe only
//   because each web method checks the caller's role itself before getting here.
// - wixData.update() REPLACES the whole item, so `patch()` reads the current item and merges.
// - Wix Data has no transactions. For anything that must be exclusive we use `acquireLock()`:
//   inserting an item whose `_id` already exists fails with WDE0074, which makes the insert an
//   atomic check-and-set. (Verified against this site during stage 1.)

import wixData from 'wix-data';
import crypto from 'crypto';
import { COLLECTIONS, WIX_DATA_DUPLICATE_ID } from '../data/constants.js';
import { ERR, fail } from './errors.js';

const OPTS = Object.freeze({ suppressAuth: true });

export function newId() {
  return crypto.randomBytes(16).toString('hex');
}

export function get(collection, itemId) {
  return wixData.get(collection, itemId, OPTS);
}

export async function getOrFail(collection, itemId, message) {
  const item = await get(collection, itemId);
  if (!item) fail(ERR.NOT_FOUND, message);
  return item;
}

export function insert(collection, item) {
  return wixData.insert(collection, item, OPTS);
}

export async function patch(collection, itemId, changes) {
  const current = await get(collection, itemId);
  if (!current) fail(ERR.NOT_FOUND, 'That record no longer exists.');
  return wixData.update(collection, { ...current, ...changes }, OPTS);
}

export function remove(collection, itemId) {
  return wixData.remove(collection, itemId, OPTS);
}

// Build queries with query(...) and run them with find()/count() so suppressAuth is never forgotten.
export function query(collection) {
  return wixData.query(collection);
}

export async function find(q, limit = 1000) {
  const res = await q.limit(limit).find(OPTS);
  return res.items;
}

export async function findAll(q) {
  let res = await q.limit(1000).find(OPTS);
  const items = [...res.items];
  while (res.hasNext()) {
    res = await res.next();
    items.push(...res.items);
  }
  return items;
}

export function count(q) {
  return q.count(OPTS);
}

function isDuplicateIdError(err) {
  const text = `${err && err.code} ${err && err.message}`;
  return text.includes(WIX_DATA_DUPLICATE_ID) || /already exists/i.test(text);
}

// Returns true if we now hold the lock, false if someone else already does.
export async function acquireLock(key, kind, refId) {
  try {
    await insert(COLLECTIONS.LOCKS, { _id: key, kind, refId });
    return true;
  } catch (err) {
    if (isDuplicateIdError(err)) return false;
    throw err;
  }
}

// Removing a lock that's already gone is fine (idempotent cleanup).
export async function releaseLock(key) {
  try {
    await remove(COLLECTIONS.LOCKS, key);
  } catch (err) {
    console.warn(`releaseLock(${key}) failed`, err);
  }
}

export async function getLock(key) {
  return get(COLLECTIONS.LOCKS, key);
}
