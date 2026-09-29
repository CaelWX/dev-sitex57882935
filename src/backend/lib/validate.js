// Pure input validators. No Wix imports, so they can be unit tested in Node.
// Each returns the cleaned value or throws an AppError with a message the UI can show.

import { ERR, fail } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function text(value, label, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail(ERR.INVALID_INPUT, `${label} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(ERR.INVALID_INPUT, `${label} is required.`);
  if (trimmed.length > max) fail(ERR.INVALID_INPUT, `${label} must be ${max} characters or fewer.`);
  return trimmed;
}

export function integer(value, label, { min, max } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) fail(ERR.INVALID_INPUT, `${label} must be a whole number.`);
  if (min !== undefined && n < min) fail(ERR.INVALID_INPUT, `${label} must be at least ${min}.`);
  if (max !== undefined && n > max) fail(ERR.INVALID_INPUT, `${label} must be at most ${max}.`);
  return n;
}

// Lowercased and trimmed. Used as the player's identity, so it must be consistent everywhere.
export function normalizeEmail(value) {
  const email = text(value, 'Email', { required: true, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(email)) fail(ERR.INVALID_INPUT, 'Please enter a valid email address.');
  return email;
}

// Wix item IDs are GUIDs or our deterministic keys (e.g. "<seriesId>_2026-10-06_t3").
export function id(value, label = 'ID') {
  const v = text(value, label, { required: true, max: 200 });
  if (!/^[A-Za-z0-9_:\-]+$/.test(v)) fail(ERR.INVALID_INPUT, `${label} is not valid.`);
  return v;
}

export function idList(values, label = 'IDs', { max = 12 } = {}) {
  if (!Array.isArray(values) || values.length === 0) fail(ERR.INVALID_INPUT, `Choose at least one ${label}.`);
  if (values.length > max) fail(ERR.INVALID_INPUT, `You can choose at most ${max} ${label} at once.`);
  return [...new Set(values.map((v) => id(v, label)))];
}

// Claim/table details a DM submits.
export function gameDetails(input, maxSeats) {
  const src = input || {};
  return {
    gameTitle: text(src.gameTitle, 'Game title', { required: true, max: 120 }),
    system: text(src.system, 'System / edition', { required: true, max: 80 }),
    description: text(src.description, 'Description', { max: 2000 }),
    contentNotes: text(src.contentNotes, 'Content notes', { max: 1000 }),
    playerCap: integer(src.playerCap, 'Player cap', { min: 1, max: maxSeats }),
  };
}

export function playerDetails(input) {
  const src = input || {};
  return {
    playerName: text(src.playerName, 'Name', { required: true, max: 80 }),
    email: normalizeEmail(src.email),
  };
}
