// Serves a build under a URL prefix, the way GitHub Pages serves a project site, so subpath bugs show up locally.
//
//   [HOST=0.0.0.0] node scripts/serve-subpath.mjs [dir] [prefix] [port]     defaults: dist /dushu/ 5243 on 127.0.0.1
//
// Only GET and HEAD, unknown paths get 404 (no single-page fallback), and /dushu redirects to /dushu/.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [, , dirArg = 'dist', prefixArg = '/dushu/', portArg = '5243'] = process.argv;
const root = resolve(dirArg);
const bindHost = process.env.HOST ?? '127.0.0.1';
const prefix = prefixArg.replace(/\/?$/, '/');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.gz': 'application/gzip', '.tsv': 'text/tab-separated-values',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (url.pathname === prefix.slice(0, -1)) { res.writeHead(301, { Location: prefix }).end(); return; }
  if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end('not found'); return; }
  let rel = normalize(decodeURIComponent(url.pathname.slice(prefix.length)));
  if (rel === '' || rel === '.' || rel.endsWith(sep)) rel = join(rel, 'index.html');
  const file = join(root, rel);
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'max-age=600' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  } catch { res.writeHead(404).end('not found'); }
}).listen(Number(portArg), bindHost, () => console.log(`serving ${root} at http://${bindHost}:${portArg}${prefix}`));
