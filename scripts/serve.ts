// Serves the static build in ./out (after `npm run build`): npm start
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const port = Number(process.env.PORT) || 8080;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.woff2': 'font/woff2',
};

if (!fs.existsSync(root)) {
  console.error('No build found. Run "npm run build" first.');
  process.exit(1);
}

http
  .createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let file = path.join(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) file = path.join(root, '404.html');
    const status = file.endsWith('404.html') && !rel.endsWith('404.html') ? 404 : 200;
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Clipboard Extractor: http://localhost:${port}`));
