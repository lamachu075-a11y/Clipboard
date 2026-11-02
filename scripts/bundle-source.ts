// Packs the project's source into public/clipboard-extractor-source.zip so the
// app's "Download → App source code (.zip)" works on any static host.
// Runs automatically before `npm run dev` and `npm run build`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from '../lib/zip.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'public/clipboard-extractor-source.zip';
const INCLUDE = ['app', 'components', 'lib', 'scripts', 'test', 'public', 'deploy', '.github', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'next-env.d.ts', 'README.md', '.gitignore'];

function walk(rel: string): string[] {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return rel === OUT ? [] : [rel];
  return fs
    .readdirSync(abs)
    .sort()
    .flatMap((name) => walk(path.posix.join(rel, name)));
}

const files = INCLUDE.flatMap(walk).map((rel) => ({ name: 'clipboard-extractor/' + rel, data: fs.readFileSync(path.join(root, rel)) }));
fs.writeFileSync(path.join(root, OUT), create(files));
console.log(`Packed ${files.length} source files into ${OUT}`);
