import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import Pdf from '../lib/pdf.ts';

/** Text of a PDF read by pypdf (strict), or undefined when pypdf is not installed. */
function pdfText(bytes: Uint8Array, t: TestContext): string | undefined {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-'));
  const file = path.join(dir, 'out.pdf');
  fs.writeFileSync(file, bytes);
  try {
    // pypdf is strict about xref offsets and object structure
    return execFileSync('python3', ['-I', '-c', `
import sys, pypdf
r = pypdf.PdfReader(sys.argv[1], strict=True)
print(len(r.pages))
print(r.metadata.title)
for p in r.pages: print(p.extract_text())
`, file]).toString();
  } catch (e) {
    if (/No module named/.test(String((e as { stderr?: unknown }).stderr))) {
      t.skip('pypdf not available');
      return undefined;
    }
    throw e;
  }
}

test('table PDF is valid and contains the data', (t) => {
  const bytes = Pdf.table({
    title: 'Leads (October)',
    subtitle: '2 rows',
    columns: ['Name', 'Email', 'Amount'],
    rows: [['José Müller', 'jose@acme.com', '€ 1.250,50'], ['Back\\slash', 'a@b.com', '$5']],
  });
  const out = pdfText(bytes, t);
  if (!out) return;
  const lines = out.split('\n');
  assert.equal(lines[0], '1');
  assert.equal(lines[1], 'Leads (October)');
  for (const s of ['José Müller', 'jose@acme.com', '€ 1.250,50', 'Back\\slash', 'Page 1 of 1']) assert.ok(out.includes(s), s);
});

test('long tables flow over several pages with repeated headers', (t) => {
  const rows = Array.from({ length: 200 }, (_, i) => ['Person ' + i, `p${i}@example.com`, 'x '.repeat(i % 40)]);
  const out = pdfText(Pdf.table({ title: 'Big', columns: ['Name', 'Email', 'Notes'], rows }), t);
  if (!out) return;
  const pages = Number(out.split('\n')[0]);
  assert.ok(pages > 3, `pages: ${pages}`);
  assert.equal(out.match(/Email/g)?.length, pages);
  assert.ok(out.includes('Person 199'));
});

test('unsupported() lists characters the PDF fonts cannot show', () => {
  assert.deepEqual(Pdf.unsupported('Hello € é'), []);
  assert.deepEqual(Pdf.unsupported('Mei 上海'), ['上', '海']);
});

test('grouped report: summary, all platforms, then each platform with its total', async (t) => {
  const { pdfOf } = await import('../lib/projectio.ts');
  let n = 0;
  const row = (Platform: string, Credit: string) => ({ id: String(++n), clipId: 'c', capturedAt: Date.UTC(2026, 2, 9, 12, n), data: { Date: `March ${n}, 2026`, Platform, Credit }, source: '' });
  const rows = [row('os', '5555'), row('android', '1,200'), row('os', '300.5'), row('ios', '45')];
  const { bytes, unsupported } = pdfOf('Recharges', rows, { groupBy: 'Platform', sumBy: 'Credit' });
  assert.deepEqual(unsupported, []);
  const out = pdfText(bytes, t);
  if (!out) return;
  const text = out.replace(/\s+/g, ' ');
  const order = ['Summary by Platform', 'All platforms', 'Platform: android', 'Platform: ios', 'Platform: os'];
  let at = -1;
  for (const s of order) {
    const i = text.indexOf(s);
    assert.ok(i > at, `"${s}" comes after the previous section`);
    at = i;
  }
  for (const s of ['Total Credit', '7,100.5', 'Total os', '5,855.5', 'Total android', '1,200', 'Total ios', '4 rows', '3 platforms']) {
    assert.ok(text.includes(s), s);
  }
});

test('report without grouping: one table with a total row', async (t) => {
  const { pdfOf } = await import('../lib/projectio.ts');
  const rows = [1, 2].map((i) => ({ id: String(i), clipId: 'c', capturedAt: i, data: { Item: `x${i}`, Credit: String(i * 10) }, source: '' }));
  const out = pdfText(pdfOf('Plain', rows, { sumBy: 'Credit' }).bytes, t);
  if (!out) return;
  assert.ok(out.includes('Total (2 rows)') && out.includes('30'));
  assert.ok(!out.includes('Summary by'));
});

test('report shows remarks in their own column', async (t) => {
  const { pdfOf } = await import('../lib/projectio.ts');
  const rows = [
    { id: '1', clipId: 'c', capturedAt: 1, data: { Platform: 'os', Credit: '10' }, source: '', remark: 'paid in cash' },
    { id: '2', clipId: 'c', capturedAt: 2, data: { Platform: 'ios', Credit: '5' }, source: '' },
  ];
  const out = pdfText(pdfOf('R', rows, { groupBy: 'Platform', sumBy: 'Credit' }).bytes, t);
  if (!out) return;
  assert.ok(out.includes('Remarks'));
  assert.ok(out.includes('paid in cash'));
});
