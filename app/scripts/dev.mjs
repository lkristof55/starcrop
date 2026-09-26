// Local server: the built site plus every Netlify function, like production.
//
//   npm run dev                                  (= node scripts/dev.mjs; port 8888 or $PORT)
//   node scripts/dev.mjs --port 8101 [--watch] [--cron]
//
// - Static files come from site/dist (run `npm run build` first; --watch rebuilds on change). Unknown paths get site/404.html.
// - Each netlify/functions/*.mjs (or <name>/index.mjs) is a Netlify Functions v2 module:
//     export default async (req, context) => Response
//     export const config = { path: '/api/thing/:id' }     (string or array; default /.netlify/functions/<name>)
//   context has { params, ip, geo, site, waitUntil, cookies }.
// - Env: app/.env (KEY=VALUE lines; the shell wins). LOCAL_STORE_DIR=app/.data, which lib/store.mjs uses instead of
//   Netlify Blobs.
// - --cron runs the functions that export config.schedule once at start, then once a minute.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, APP } from './build.mjs';

const argv = process.argv.slice(2);
const port = Number((argv.includes('--port') && argv[argv.indexOf('--port') + 1]) || process.env.PORT || 8888);
const watch = argv.includes('--watch');
const cron = argv.includes('--cron');
const dist = path.join(APP, 'site', 'dist');

/** Load KEY=VALUE lines into process.env without overriding what is already set. */
async function loadEnv(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

await loadEnv(path.join(APP, '.env'));
process.env.LOCAL_STORE_DIR ||= path.join(APP, '.data');
process.env.URL ||= `http://localhost:${port}`;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm',
};

/** '/api/thing/:id' or '/api/*' -> matcher returning { params } or null (the subset of URLPattern Netlify paths use). */
function compile(pattern) {
  const names = [];
  const src = pattern.split('/').map((seg) => {
    if (seg === '*') { names.push('0'); return '(.*)'; }
    if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  const re = new RegExp(`^${src}$`);
  return (pathname) => {
    const m = re.exec(pathname);
    return m ? { params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) } : null;
  };
}

async function loadFunctions() {
  const fdir = path.join(APP, 'netlify', 'functions');
  const out = [];
  let names = [];
  try { names = await fs.readdir(fdir); } catch { return out; }
  for (const n of names) {
    let file = path.join(fdir, n);
    const st = await fs.stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.mjs');
    else if (!/\.(mjs|js)$/.test(n)) continue;
    const name = path.basename(n).replace(/\.(mjs|js)$/, '');
    try {
      const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
      const cfg = mod.config || {};
      const paths = cfg.path ? [].concat(cfg.path) : [`/.netlify/functions/${name}`];
      out.push({ name, handler: mod.default, schedule: cfg.schedule, paths, matchers: paths.map(compile) });
    } catch (e) {
      console.error(`function ${name} failed to load: ${e.stack || e.message}`);
    }
  }
  return out;
}

let fns = await loadFunctions();
if (watch) {
  await build({ watch: true, log: (m) => console.log(`[build] ${m}`) });
  let t;
  const reload = () => { clearTimeout(t); t = setTimeout(async () => { fns = await loadFunctions(); console.log('[functions] reloaded'); }, 200); };
  for (const d of ['netlify/functions', 'lib']) fs.watch(path.join(APP, d), { recursive: true }, reload);
}

async function readBody(req) {
  if (['GET', 'HEAD'].includes(req.method)) return undefined;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function staticFile(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  const f = path.resolve(dist, '.' + path.sep + rel);
  if (f !== dist && !f.startsWith(dist + path.sep)) return null; // no ../ escapes
  const candidates = pathname.endsWith('/') ? [path.join(f, 'index.html')] : [f, ...(path.extname(f) ? [] : [f + '.html', path.join(f, 'index.html')])];
  for (const c of candidates) { try { if ((await fs.stat(c)).isFile()) return c; } catch {} }
  return null;
}

async function runFunction(f, params, req, res, url) {
  const started = Date.now();
  const request = new Request(url, { method: req.method, headers: req.headers, body: await readBody(req), duplex: 'half' });
  const waits = [];
  const context = {
    params, ip: req.socket.remoteAddress, geo: {}, site: { url: process.env.URL },
    waitUntil: (p) => waits.push(p), cookies: { get: () => undefined, set() {}, delete() {} },
  };
  let r;
  try {
    r = await f.handler(request, context);
    if (!(r instanceof Response)) r = Response.json(r ?? null);
  } catch (e) {
    console.error(`[${f.name}] ${e.stack || e.message}`);
    r = Response.json({ error: 'function crashed' }, { status: 500 });
  }
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
  Promise.allSettled(waits);
  console.log(`${req.method} ${url.pathname}${url.search} → ${r.status} ${Date.now() - started}ms [${f.name}]`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    for (const f of fns) for (const match of f.matchers) {
      const m = match(url.pathname);
      if (m) return await runFunction(f, m.params, req, res, url);
    }
    const file = await staticFile(url.pathname);
    if (file) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(await fs.readFile(file));
    }
    const notFound = await staticFile('/404.html');
    res.writeHead(404, { 'content-type': notFound ? TYPES['.html'] : 'text/plain' });
    res.end(notFound ? await fs.readFile(notFound) : 'not found: ' + url.pathname);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('server error: ' + e.message);
  }
});

server.listen(port, '127.0.0.1', async () => {
  try { await fs.access(path.join(dist, 'index.html')); } catch { console.warn('site/dist is empty: run `npm run build` first (or use --watch)'); }
  const routes = fns.flatMap((f) => f.paths.map((p) => `${p} [${f.name}]${f.schedule ? ` (schedule ${f.schedule}; --cron runs it)` : ''}`));
  console.log(`starcrop on http://localhost:${port}${routes.length ? '\n  ' + routes.join('\n  ') : ''}`);
});

if (cron) {
  const tick = async () => {
    for (const f of fns.filter((f) => f.schedule)) {
      try { await f.handler(new Request(`${process.env.URL}/.netlify/functions/${f.name}`, { method: 'POST', body: JSON.stringify({ next_run: null }) }), {}); console.log(`[cron] ${f.name} ok`); }
      catch (e) { console.error(`[cron] ${f.name}: ${e.message}`); }
    }
  };
  tick();
  setInterval(tick, 60_000);
}

