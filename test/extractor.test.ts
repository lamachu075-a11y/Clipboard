import test from 'node:test';
import assert from 'node:assert/strict';
import E from '../lib/extractor.ts';

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
  assert.deepEqual(E.extract('x@y.com', { customFields: [{ id: 'bad', name: 'Bad', pattern: '(' }] }), [{ Email: 'x@y.com' }]);
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

test('explain() reports how records were split and why matches were skipped', () => {
  const text = 'Name: John\nEmail: john@acme.com\n\nName: Jane\nEmail: jane@x.io';
  const r = E.explain(text);
  assert.equal(r.kind, 'text');
  assert.equal(r.mode, 'blank');
  assert.equal(r.records.length, 2);
  assert.equal(r.records[1].offset, text.indexOf('Name: Jane'));
  const email = r.records[0].matches.filter((m) => m.label === 'Email');
  assert.deepEqual(email.map((m) => m.status), ['skipped', 'used']); // "Email:" label is left to the Email rule
  for (const rec of r.records) for (const m of rec.matches) assert.equal(text.slice(m.start, m.end), m.value);
});

test('explain() reports rejected matches and rows dropped by required fields', () => {
  const r = E.explain('IP 192.168 and a@b.com', { fields: { phone: { enabled: true, required: true } } });
  const phone = r.records[0].matches.find((m) => m.ruleId === 'phone');
  assert.equal(phone?.status, 'rejected');
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.records[0].dropped[0].missing, ['Phone']);
});

test('explain() describes spreadsheet copies', () => {
  const r = E.explain('A\tB\n1\t2');
  assert.equal(r.kind, 'table');
  assert.match(r.reason, /Spreadsheet/);
});

test('built-in rules can be overridden: pattern, flags and column name', () => {
  const settings = { fields: { email: { enabled: true, label: 'Work email', pattern: '[a-z]+@acme\\.com', flags: 'g' } } };
  assert.deepEqual(E.extract('john@acme.com jane@other.org', settings), [{ 'Work email': 'john@acme.com' }]);
});

test('an invalid override falls back to the default pattern and reports an error', () => {
  const r = E.explain('x@y.com', { fields: { email: { enabled: true, pattern: '(' } } });
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.rows, [{ Email: 'x@y.com' }]);
});

test('sameRules ignores non-rule settings', () => {
  assert.ok(E.sameRules({ enabled: false, pollInterval: 5000 }, {}));
  assert.ok(!E.sameRules({ matchMode: 'join' }, {}));
});

test('times are not mistaken for "Key: Value" labels', () => {
  assert.deepEqual(E.extract('Meeting at 9:30 AM\nRoom: B12'), [{ Room: 'B12' }]);
});

test('"Label: value" lines defer to a custom rule with the same name', () => {
  const rows = E.extract('Bill to: Acme Corp', {
    customFields: [{ id: '1', name: 'Bill to', pattern: 'Bill\\s+to\\s*:\\s*([^\\n]+)', flags: 'i', group: 1 }],
  });
  assert.deepEqual(rows, [{ 'Bill to': 'Acme Corp' }]);
});

// ---------- chat messages ----------

const RECHARGE = (date: string, user: string, platform: string, credit: string, head = '[02/11, 16:58] K: ') =>
  `${head}${date}\nUsername: ${user}\nPlatform: ${platform}\nCredit: ${credit}\nRecharged ✅️`;

test('WhatsApp copy: each message is a record, identical messages give one row', () => {
  const text = RECHARGE('March 9, 2026', 'mike777', 'os', '5555') + '\n' + RECHARGE('March 9, 2026', 'mike777', 'os', '5555');
  const r = E.explain(text);
  assert.equal(r.mode, 'messages');
  assert.equal(r.records.length, 2);
  assert.deepEqual(r.rows, [{ Username: 'mike777', Platform: 'os', Credit: '5555', Date: 'March 9, 2026' }]);
});

test('different messages stay aligned even when values repeat', () => {
  const text = [
    RECHARGE('March 9, 2026', 'mike777', 'os', '5555'),
    RECHARGE('March 10, 2026', 'anna01', 'android', '5555', '[02/11, 17:02] K: '),
    RECHARGE('March 11, 2026', 'raj', 'os', '1200', '[02/11, 17:05] K: '),
  ].join('\n');
  assert.deepEqual(E.extract(text, { keepColumns: 'Date, Platform, Credit' }), [
    { Date: 'March 9, 2026', Platform: 'os', Credit: '5555' },
    { Date: 'March 10, 2026', Platform: 'android', Credit: '5555' },
    { Date: 'March 11, 2026', Platform: 'os', Credit: '1200' },
  ]);
});

test('WhatsApp Web and chat-export headers are recognised and ignored', () => {
  const web = RECHARGE('March 9, 2026', 'a', 'os', '1', '[16:58, 02/11/2026] K: ') + '\n' + RECHARGE('March 10, 2026', 'b', 'ios', '2', '[17:01, 02/11/2026] K: ');
  const exp = RECHARGE('March 9, 2026', 'a', 'os', '1', '02/11/2026, 4:58 PM - K: ') + '\n' + RECHARGE('March 10, 2026', 'b', 'ios', '2', '02/11/2026, 5:01 PM - K: ');
  for (const text of [web, exp]) {
    const rows = E.extract(text, { keepColumns: 'date,platform,credit' });
    // The header's own date (02/11/2026) must not appear as a second date.
    assert.deepEqual(rows, [
      { Date: 'March 9, 2026', Platform: 'os', Credit: '1' },
      { Date: 'March 10, 2026', Platform: 'ios', Credit: '2' },
    ]);
  }
});

test('a single copied message works too', () => {
  assert.deepEqual(E.extract(RECHARGE('March 9, 2026', 'mike777', 'os', '5555'), { keepColumns: 'Date, Platform, Credit' }), [
    { Date: 'March 9, 2026', Platform: 'os', Credit: '5555' },
  ]);
});

test('without chat headers, a repeated first label starts a new record', () => {
  const text = 'Username: a\nPlatform: os\nCredit: 1\nUsername: b\nPlatform: android\nCredit: 1\nUsername: c\nPlatform: os\nCredit: 3';
  const r = E.explain(text);
  assert.equal(r.mode, 'labels');
  assert.deepEqual(r.rows, [
    { Username: 'a', Platform: 'os', Credit: '1' },
    { Username: 'b', Platform: 'android', Credit: '1' },
    { Username: 'c', Platform: 'os', Credit: '3' },
  ]);
});

test('keepColumns keeps only the named columns, in that order, and drops empty rows', () => {
  const r = E.explain('Name: A\nEmail: a@x.com\nCity: Rome', { keepColumns: 'City, Name, Missing' });
  assert.deepEqual(r.rows, [{ City: 'Rome', Name: 'A' }]);
  assert.deepEqual(r.keptColumns, ['City', 'Name', 'Missing']);
  assert.deepEqual(E.extract('a@x.com', { keepColumns: 'Phone' }), []);
});

test('the "messages" split mode can be chosen explicitly', () => {
  const r = E.explain('just text, no chat headers', { splitMode: 'messages' });
  assert.equal(r.mode, 'whole');
  assert.match(r.reason, /no headers/);
});
