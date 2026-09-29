// Unit tests for input validation. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../src/backend/lib/validate.js';

const errorOf = (fn) => { try { fn(); } catch (e) { return e; } return null; };

test('emails are trimmed and lowercased so identity is consistent', () => {
  assert.equal(v.normalizeEmail('  Player@Example.COM '), 'player@example.com');
  assert.equal(errorOf(() => v.normalizeEmail('not-an-email')).code, 'INVALID_INPUT');
  assert.equal(errorOf(() => v.normalizeEmail('')).code, 'INVALID_INPUT');
});

test('text enforces required and max length with readable messages', () => {
  assert.equal(v.text('  hi  ', 'Name'), 'hi');
  assert.equal(errorOf(() => v.text('   ', 'Name', { required: true })).message, 'Name is required.');
  assert.match(errorOf(() => v.text('x'.repeat(11), 'Name', { max: 10 })).message, /10 characters/);
  assert.equal(errorOf(() => v.text(42, 'Name')).code, 'INVALID_INPUT');
});

test('integers accept numeric strings and enforce bounds', () => {
  assert.equal(v.integer('4', 'Cap', { min: 1, max: 6 }), 4);
  assert.equal(errorOf(() => v.integer(2.5, 'Cap')).code, 'INVALID_INPUT');
  assert.equal(errorOf(() => v.integer(7, 'Cap', { max: 6 })).code, 'INVALID_INPUT');
});

test('ids reject anything that is not a plain key', () => {
  assert.equal(v.id('abc_2026-10-06_t3'), 'abc_2026-10-06_t3');
  assert.equal(errorOf(() => v.id('a b')).code, 'INVALID_INPUT');
  assert.equal(errorOf(() => v.id('$where')).code, 'INVALID_INPUT');
});

test('id lists are de-duplicated and capped', () => {
  assert.deepEqual(v.idList(['a', 'a', 'b'], 'tables'), ['a', 'b']);
  assert.equal(errorOf(() => v.idList([], 'tables')).code, 'INVALID_INPUT');
  assert.equal(errorOf(() => v.idList(Array.from({ length: 13 }, (_, i) => `t${i}`), 'tables')).code, 'INVALID_INPUT');
});

test('game details cap the player count at the table size', () => {
  const ok = v.gameDetails({ gameTitle: 'Lost Mine', system: '5e', playerCap: 5 }, 6);
  assert.equal(ok.playerCap, 5);
  assert.equal(ok.description, '');
  assert.equal(errorOf(() => v.gameDetails({ gameTitle: 'Lost Mine', system: '5e', playerCap: 7 }, 6)).code, 'INVALID_INPUT');
  assert.equal(errorOf(() => v.gameDetails({ system: '5e', playerCap: 4 }, 6)).message, 'Game title is required.');
});

test('player details require a name and a valid email', () => {
  assert.deepEqual(v.playerDetails({ playerName: ' Ada ', email: 'ADA@x.io' }), { playerName: 'Ada', email: 'ada@x.io' });
  assert.equal(errorOf(() => v.playerDetails({ email: 'ada@x.io' })).code, 'INVALID_INPUT');
});
