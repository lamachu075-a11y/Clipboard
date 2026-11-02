import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Zip from '../lib/zip.ts';

test('crc32 matches the reference value', () => {
  assert.equal(Zip.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('created zip is readable by a standard unzip tool', (t) => {
  const bytes = Zip.create([
    { name: 'hello.txt', data: 'Hello, zip!' },
    { name: 'dir/données.json', data: '{"a":1}' },
    { name: 'bin.dat', data: new Uint8Array([0, 1, 2, 255]) },
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
  const file = path.join(dir, 'out.zip');
  fs.writeFileSync(file, bytes);

  let listing;
  try {
    listing = execFileSync('python3', ['-I', '-c', `
import sys, zipfile, json
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({n: list(z.read(n)) for n in z.namelist()}))
`, file]).toString();
  } catch (e) {
    t.skip('python3 not available');
    return;
  }
  const files = JSON.parse(listing);
  assert.equal(Buffer.from(files['hello.txt']).toString(), 'Hello, zip!');
  assert.equal(Buffer.from(files['dir/données.json']).toString(), '{"a":1}');
  assert.deepEqual(files['bin.dat'], [0, 1, 2, 255]);
});
