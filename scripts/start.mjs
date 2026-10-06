#!/usr/bin/env node
// Serves the built app from dist/ on localhost and opens it in the browser.
// No dependencies, so it also runs from an installed copy without node_modules.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../../dist');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const basePort = Number(process.env.GENSTRIO_PORT) || 4173;
const IDLE_MS = 20_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/ is missing. Run "npm install && npm run build" first, or start with ./genstrio.');
  process.exit(1);
}

function open(url) {
  if (flag('--no-open')) return;
  const app = ['chromium-browser', 'chromium', 'google-chrome', 'google-chrome-stable', 'brave-browser'];
  const candidates = flag('--window') ? [...app.map((bin) => [bin, `--app=${url}`]), ['xdg-open', url]] : [['xdg-open', url]];
  const tryNext = () => {
    const next = candidates.shift();
    if (!next) return console.log(`Open ${url} in your browser.`);
    spawn(next[0], [next[1]], { stdio: 'ignore', detached: true }).on('error', tryNext).unref();
  };
  tryNext();
}

/** True if a Genstrio server already answers on this port. */
async function isGenstrio(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__genstrio/ping`, { signal: AbortSignal.timeout(800) });
    return res.headers.get('x-genstrio') === '1';
  } catch {
    return false;
  }
}

// With --auto-exit (desktop launcher, no terminal to press Ctrl+C in) the
// server stops once the last tab has been closed for a while.
const tabs = new Set();
let idleTimer;
function watchIdle() {
  if (!flag('--auto-exit')) return;
  clearTimeout(idleTimer);
  if (tabs.size === 0) idleTimer = setTimeout(() => process.exit(0), IDLE_MS);
}

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/__genstrio/ping') {
    res.writeHead(200, { 'x-genstrio': '1', 'cache-control': 'no-store' }).end('ok');
    return;
  }
  if (path === '/__genstrio/alive') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    res.write(': connected\n\n');
    tabs.add(res);
    watchIdle();
    req.on('close', () => {
      tabs.delete(res);
      watchIdle();
    });
    return;
  }
  const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  const hashed = path.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

async function listen(port, attempts = 20) {
  if (await isGenstrio(port)) {
    console.log(`Genstrio is already running at http://localhost:${port}/`);
    open(`http://localhost:${port}/`);
    return;
  }
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 1) listen(port + 1, attempts - 1);
    else throw err;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`Genstrio is running at ${url}  (Ctrl+C to stop)`);
    open(url);
    watchIdle();
  });
}

listen(basePort);
