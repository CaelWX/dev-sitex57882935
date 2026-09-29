// Manage-link tokens for players without accounts.
// The raw token goes in the player's email link; only its SHA-256 hash is stored,
// so a leaked database export can't be used to cancel someone's seat.

import crypto from 'crypto';

export function newManageToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function isWellFormedToken(token) {
  return typeof token === 'string' && /^[a-f0-9]{48}$/.test(token);
}
