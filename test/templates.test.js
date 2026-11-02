const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/extractor.js');
const T = require('../js/templates.js');

// Only the template's rule, so built-in rules don't interfere.
const onlyRule = (rule) => ({
  splitMode: 'whole',
  matchMode: 'zip',
  fields: Object.fromEntries(Object.keys(E.DEFAULT_SETTINGS.fields).map((k) => [k, { enabled: false }])),
  customFields: [Object.assign({ id: 't', enabled: true }, rule)],
});

for (const t of T.TEMPLATES) {
  test(`template "${t.name}" extracts its example`, () => {
    const rule = T.resolve(t);
    assert.ok(rule.name, 'has a column name');
    assert.equal(E.compileCustom(rule).error, undefined);
    const values = E.extract(t.example, onlyRule(rule)).map((r) => r[rule.name]);
    assert.deepEqual(values, t.expect);
  });
}

test('fill-in examples follow the typed values', () => {
  for (const t of T.TEMPLATES.filter((x) => x.params)) {
    assert.equal(T.exampleOf(t), t.example, t.id);
    const values = Object.fromEntries(t.params.map((p) => [p.key, p.key === 'end' ? '>>' : 'My Field']));
    const rule = T.resolve(t, values);
    const got = E.extract(T.exampleOf(t, values), onlyRule(rule)).map((r) => r[rule.name]);
    // Same values as the default example, with the default label swapped for the typed one.
    const swap = (v) => t.params.reduce((acc, p) => acc.split(p.default).join(values[p.key]), v);
    assert.deepEqual(got, t.expect.map(swap), t.id);
  }
});

test('fill-in templates escape the typed label', () => {
  const t = T.TEMPLATES.find((x) => x.id === 'after-label');
  const rule = T.resolve(t, { label: 'Total ($)' });
  assert.equal(rule.name, 'Total ($)');
  assert.deepEqual(E.extract('Total ($): 45.00', onlyRule(rule)), [{ 'Total ($)': '45.00' }]);
});

test('template ids are unique', () => {
  const ids = T.TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
