import test from 'node:test';
import assert from 'node:assert/strict';
import { csvOf, fileOf, jsonOf, matrixOf, parseProject, tsvOf } from '../lib/projectio.ts';
import type { Row } from '../lib/types.ts';

const rows: Row[] = [
  { id: 'a', clipId: 'c1', capturedAt: Date.UTC(2026, 2, 9), data: { Date: 'March 9, 2026', Platform: 'os', Credit: '5555' }, cols: ['Date', 'Platform', 'Credit'], source: 'x', remark: 'paid' },
  { id: 'b', clipId: 'c1', capturedAt: Date.UTC(2026, 2, 10), data: { Date: 'March 10, 2026', Platform: 'android', Credit: '1200' }, cols: ['Date', 'Platform', 'Credit'], source: 'y' },
];

test('exports add a Remarks column only when a row has a remark', () => {
  assert.deepEqual(matrixOf(rows)[0], ['Captured', 'Date', 'Platform', 'Credit', 'Remarks']);
  assert.deepEqual(matrixOf(rows).slice(1).map((r) => r.at(-1)), ['paid', '']);
  assert.deepEqual(matrixOf([rows[1]])[0], ['Captured', 'Date', 'Platform', 'Credit']);
  assert.match(csvOf(rows), /,paid\r\n/);
  assert.match(tsvOf(rows).split('\n')[0], /\tRemarks$/);
});

test('JSON export and re-import keep remarks out of the data columns', () => {
  const json = JSON.parse(jsonOf(rows));
  assert.equal(json[0].remarks, 'paid');
  assert.equal('remarks' in json[1], false);
  const back = parseProject(json, 'table.json');
  assert.equal(back.rows[0].remark, 'paid');
  assert.deepEqual(Object.keys(back.rows[0].data), ['Date', 'Platform', 'Credit']);
});

test('project files keep remarks', () => {
  const file = fileOf({ id: 'p', name: 'March', createdAt: 1, savedAt: 2, rules: null, rows });
  const back = parseProject(JSON.parse(JSON.stringify(file)), 'March.json');
  assert.equal(back.rows[0].remark, 'paid');
  assert.equal(back.rows[1].remark, undefined);
});
