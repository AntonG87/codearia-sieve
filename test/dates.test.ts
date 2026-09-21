import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate } from '../src/normalize/dates.ts';

const NOW = new Date('2026-09-21T12:00:00Z');

test('ISO dates pass through', () => {
  assert.equal(parseDate('2026-09-15'), '2026-09-15');
  assert.equal(parseDate('2026-09-15T10:11:12Z'), '2026-09-15');
});

test('English month names', () => {
  assert.equal(parseDate('September 15, 2026'), '2026-09-15');
  assert.equal(parseDate('Sep 15, 2026'), '2026-09-15');
  assert.equal(parseDate('15 September 2026'), '2026-09-15');
});

test('Russian month names, including the genitive case', () => {
  assert.equal(parseDate('15 сентября 2026'), '2026-09-15');
  assert.equal(parseDate('15 сентября 2026 г.'), '2026-09-15');
  assert.equal(parseDate('1 мая 2026'), '2026-05-01');
});

test('dotted and slashed numeric dates', () => {
  assert.equal(parseDate('15.09.2026'), '2026-09-15');
  assert.equal(parseDate('15/09/2026'), '2026-09-15');
});

test('an unambiguous numeric date needs no hint', () => {
  // 15 cannot be a month, so the order is settled by the value itself.
  assert.equal(parseDate('09/15/2026'), '2026-09-15');
});

test('an ambiguous numeric date follows the hint', () => {
  assert.equal(parseDate('09/10/2026', { prefer: 'DMY' }), '2026-10-09');
  assert.equal(parseDate('09/10/2026', { prefer: 'MDY' }), '2026-09-10');
});

test('relative wording resolves against the reference point', () => {
  assert.equal(parseDate('вчера', { now: NOW }), '2026-09-20');
  assert.equal(parseDate('сегодня', { now: NOW }), '2026-09-21');
  assert.equal(parseDate('2 days ago', { now: NOW }), '2026-09-19');
});

test('prose around the date does not hide it', () => {
  assert.equal(
    parseDate('Опубликовано 15 сентября 2026 года в 10:30'),
    '2026-09-15',
  );
});

test('abstains rather than guesses', () => {
  assert.equal(parseDate('скоро'), undefined);
  assert.equal(parseDate(''), undefined);
  assert.equal(parseDate('version 15.09'), undefined);
  // A real date that never existed is not a date.
  assert.equal(parseDate('31.02.2026'), undefined);
});
