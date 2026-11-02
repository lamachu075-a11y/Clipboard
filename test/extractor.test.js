const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../extension/lib/extractor.js');

test('one line with several fields becomes one row', () => {
  const rows = E.extract('Contact John at john@acme.com or +1 (555) 123-4567');
  assert.deepEqual(rows, [{ Email: 'john@acme.com', Phone: '+1 (555) 123-4567' }]);
});

test('a list copied as lines yields one row per line', () => {
  const rows = E.extract('John john@acme.com 555-123-4567\nJane jane@globex.io 555-987-6543\nBob bob@x.org');
  assert.deepEqual(rows, [
    { Email: 'john@acme.com', Phone: '555-123-4567' },
    { Email: 'jane@globex.io', Phone: '555-987-6543' },
    { Email: 'bob@x.org' },
  ]);
});

test('blank-line separated "Key: Value" blocks yield one row per block', () => {
  const text = 'Name: John Smith\nEmail: john@acme.com\nCity: Paris\n\nName: Jane Doe\nEmail: jane@globex.io\nCity: Rome';
  assert.deepEqual(E.extract(text), [
    { Name: 'John Smith', City: 'Paris', Email: 'john@acme.com' },
    { Name: 'Jane Doe', City: 'Rome', Email: 'jane@globex.io' },
  ]);
});

test('repeated labels without blank lines are zipped into rows', () => {
  const rows = E.extract('Name: A\nEmail: a@x.com\nName: B\nEmail: b@x.com');
  assert.deepEqual(rows, [
    { Name: 'A', Email: 'a@x.com' },
    { Name: 'B', Email: 'b@x.com' },
  ]);
});

test('multiple matches spread across rows, single values repeated', () => {
  const rows = E.extract('Invoice 2026-11-02 total $1,250.50 — billing@shop.com, sales@shop.com');
  assert.deepEqual(rows, [
    { Email: 'billing@shop.com', Date: '2026-11-02', Amount: '$1,250.50' },
    { Email: 'sales@shop.com', Date: '2026-11-02', Amount: '$1,250.50' },
  ]);
});

test('join mode keeps one row per record', () => {
  const rows = E.extract('a@x.com b@x.com', { matchMode: 'join' });
  assert.deepEqual(rows, [{ Email: 'a@x.com, b@x.com' }]);
});

test('spreadsheet (TSV) copies use the header row as columns', () => {
  const rows = E.extract('Name\tEmail\tCity\nJohn\tj@x.com\tParis\nJane\tja@x.com\tRome');
  assert.deepEqual(rows, [
    { Name: 'John', Email: 'j@x.com', City: 'Paris' },
    { Name: 'Jane', Email: 'ja@x.com', City: 'Rome' },
  ]);
});

test('TSV without a header gets generic column names', () => {
  const rows = E.extract('John\t42\nJane\t37');
  assert.deepEqual(rows, [
    { 'Column 1': 'John', 'Column 2': '42' },
    { 'Column 1': 'Jane', 'Column 2': '37' },
  ]);
});

test('digits inside URLs, dates and IPs are not phone numbers', () => {
  const rows = E.extract('See https://example.com/item/1234567890 since 12 Jan 2026 on 192.168.100.200');
  assert.deepEqual(rows, [{ URL: 'https://example.com/item/1234567890', Date: '12 Jan 2026' }]);
});

test('IP field can be enabled', () => {
  const rows = E.extract('Server 10.0.0.15 down', { fields: { ip: { enabled: true } } });
  assert.deepEqual(rows, [{ 'IP Address': '10.0.0.15' }]);
});

test('URLs drop trailing punctuation', () => {
  assert.deepEqual(E.extract('Visit https://example.com/a?b=1).'), [{ URL: 'https://example.com/a?b=1' }]);
});

test('required fields drop rows without them', () => {
  const rows = E.extract('a@x.com 555-123-4567\nb@x.com', { fields: { phone: { enabled: true, required: true } } });
  assert.deepEqual(rows, [{ Email: 'a@x.com', Phone: '555-123-4567' }]);
});

test('custom regex fields with capture groups', () => {
  const rows = E.extract('Orders #A1234 and #B5678 shipped', {
    customFields: [{ id: '1', name: 'Order', pattern: '#([A-Z]\\d+)', group: 1, enabled: true }],
  });
  assert.deepEqual(rows, [{ Order: 'A1234' }, { Order: 'B5678' }]);
});

test('invalid custom regex is ignored, not thrown', () => {
  assert.ok(E.compileCustom({ pattern: '(' }).error);
  assert.deepEqual(E.extract('x@y.com', { customFields: [{ name: 'Bad', pattern: '(' }] }), [{ Email: 'x@y.com' }]);
});

test('custom delimiter splitting', () => {
  const rows = E.extract('a@x.com ; b@x.com', { splitMode: 'custom', delimiter: ';' });
  assert.deepEqual(rows, [{ Email: 'a@x.com' }, { Email: 'b@x.com' }]);
});

test('text without any data yields no rows', () => {
  assert.deepEqual(E.extract('just some ordinary words here'), []);
  assert.deepEqual(E.extract(''), []);
});

test('scheme-like keys are not treated as labels', () => {
  assert.deepEqual(E.extract('https://example.com'), [{ URL: 'https://example.com' }]);
});

test('rowKey ignores key order and case', () => {
  assert.equal(E.rowKey({ A: 'x', B: 'Y' }), E.rowKey({ b: 'y', a: 'X' }));
});
