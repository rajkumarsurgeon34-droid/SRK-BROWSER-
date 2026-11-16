import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime } from './time.js';

const now = new Date(2026, 0, 15, 12, 0, 0); // Jan 15 2026, 12:00 local

test('12-hour clock times', () => {
  assert.deepEqual(parseTime('5:00 PM', now), new Date(2026, 0, 15, 17, 0));
  assert.deepEqual(parseTime('5pm', now), new Date(2026, 0, 15, 17, 0));
  assert.deepEqual(parseTime('12:30 pm', now), new Date(2026, 0, 15, 12, 30));
});

test('past times roll over to tomorrow', () => {
  assert.deepEqual(parseTime('9:00 AM', now), new Date(2026, 0, 16, 9, 0));
  assert.deepEqual(parseTime('12 am', now), new Date(2026, 0, 16, 0, 0));
});

test('24-hour clock times', () => {
  assert.deepEqual(parseTime('17:30', now), new Date(2026, 0, 15, 17, 30));
});

test('relative times', () => {
  assert.deepEqual(parseTime('in 10 min', now), new Date(2026, 0, 15, 12, 10));
  assert.deepEqual(parseTime('in 2 hours', now), new Date(2026, 0, 15, 14, 0));
  assert.deepEqual(parseTime('in 30 s', now), new Date(2026, 0, 15, 12, 0, 30));
});

test('invalid input', () => {
  for (const bad of ['', 'soon', '5', '13pm', '25:00', '10:75']) {
    assert.equal(parseTime(bad, now), null, bad);
  }
});
