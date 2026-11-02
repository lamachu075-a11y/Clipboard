import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, numericColumns, numericValue, resolveGroupBy, resolveSumBy, summarize } from '../lib/summary.ts';
import type { Row } from '../lib/types.ts';

let n = 0;
const row = (data: Record<string, string>): Row => ({ id: String(++n), clipId: 'c', capturedAt: n, data, source: '' });

const ROWS = [
  row({ Date: 'March 9, 2026', Platform: 'os', Credit: '5555' }),
  row({ Date: 'March 10, 2026', Platform: 'android', Credit: '1,200' }),
  row({ Date: 'March 11, 2026', Platform: 'OS', Credit: '300.5' }),
  row({ Date: 'March 12, 2026', Credit: '45' }),
];

test('numericValue reads plain, formatted and currency numbers', () => {
  assert.equal(numericValue('5555'), 5555);
  assert.equal(numericValue('5,555'), 5555);
  assert.equal(numericValue('$1,250.50'), 1250.5);
  assert.equal(numericValue('Rs. 300'), 300);
  assert.equal(numericValue('-12.5 %'), -12.5);
  assert.equal(numericValue('500 USD'), 500);
  assert.equal(numericValue('os'), null);
  assert.equal(numericValue('March 9, 2026'), null);
  assert.equal(numericValue(''), null);
});

test('numericColumns finds the number columns', () => {
  assert.deepEqual(numericColumns(ROWS), ['Credit']);
});

test('auto group-by picks Platform, auto total picks Credit', () => {
  assert.equal(resolveGroupBy(ROWS, 'auto'), 'Platform');
  assert.equal(resolveSumBy(ROWS, 'auto'), 'Credit');
  assert.equal(resolveGroupBy(ROWS, ''), '');
  assert.equal(resolveGroupBy(ROWS, 'date'), 'Date');
  assert.equal(resolveSumBy(ROWS, 'Date'), '', 'a text column cannot be totalled');
  assert.equal(resolveGroupBy([row({ Email: 'a@b.c' })], 'auto'), '');
});

test('summarize groups by platform (case-insensitive), sorts groups, totals each', () => {
  const s = summarize(ROWS, 'Platform', 'Credit');
  assert.deepEqual(
    s.groups.map((g) => [g.label, g.rows.length, g.total]),
    [
      ['android', 1, 1200],
      ['os', 2, 5855.5],
      ['(no value)', 1, 45],
    ]
  );
  assert.equal(s.total, 7100.5);
  assert.equal(s.count, 4);
});

test('summarize without grouping still totals', () => {
  const s = summarize(ROWS, '', 'Credit');
  assert.equal(s.groups.length, 0);
  assert.equal(s.total, 7100.5);
});

test('formatNumber', () => {
  assert.equal(formatNumber(7100.5), '7,100.5');
  assert.equal(formatNumber(1234567), '1,234,567');
});
