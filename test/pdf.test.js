import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Pdf from '../lib/pdf.js';

function pdfText(bytes, t) {
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
    if (/No module named/.test(String(e.stderr))) return t.skip('pypdf not available');
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
  assert.equal(out.match(/Email/g).length, pages);
  assert.ok(out.includes('Person 199'));
});

test('unsupported() lists characters the PDF fonts cannot show', () => {
  assert.deepEqual(Pdf.unsupported('Hello € é'), []);
  assert.deepEqual(Pdf.unsupported('Mei 上海'), ['上', '海']);
});
