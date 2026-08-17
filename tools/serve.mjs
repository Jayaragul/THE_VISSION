#!/usr/bin/env node
// A static file server for looking at the built site locally. Node built-ins only.
//
//   node tools/serve.mjs           → http://localhost:4173
//   node tools/serve.mjs 8080

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // normalize() collapses any ../ before it can escape the repo root.
  let path = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''));

  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) {
    const notFound = join(ROOT, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    if (existsSync(notFound)) createReadStream(notFound).pipe(res);
    else res.end('404');
    return;
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(path)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(res);
}).listen(PORT, () => {
  console.log(`\n  THE VISSION — local preview\n  http://localhost:${PORT}\n\n  Ctrl+C to stop.\n`);
});
