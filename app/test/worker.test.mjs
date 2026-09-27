// worker.mjs (Cloudflare Workers entry): every /api path reaches its Netlify handler, anything else goes to the static
// site (env.ASSETS), env.DB is the store before a handler runs, and scheduled() runs the survey job. Offline: D1 is
// test/d1-fake.mjs, upstreams are test/upstream-stub.mjs.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { routes, scheduledFunctions, compile, netlifyContext, FUNCTIONS } from '../worker.mjs';
import { useD1 } from '../lib/store.mjs';
import { clearMemo } from '../lib/service.mjs';
import { createD1, hasSqlite } from './d1-fake.mjs';
import { createUpstream, TARGET } from './upstream-stub.mjs';

const skip = hasSqlite ? false : 'node:sqlite needs Node >= 22.5';
const realFetch = globalThis.fetch;
const savedPlan = process.env.CF_FREE_PLAN;
let keepAlive;
before(() => { keepAlive = setInterval(() => {}, 1000); });
after(() => { clearInterval(keepAlive); globalThis.fetch = realFetch; useD1(null); if (savedPlan === undefined) delete process.env.CF_FREE_PLAN; else process.env.CF_FREE_PLAN = savedPlan; });
beforeEach(() => { clearMemo(); globalThis.fetch = realFetch; });

function harness() {
  const assets = [];
  const waits = [];
  const env = { DB: createD1(), ASSETS: { fetch: async (req) => { assets.push(new URL(req.url).pathname); return new Response('<!doctype html>asset', { status: 200, headers: { 'content-type': 'text/html' } }); } } };
  const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} };
  const get = (path, init) => worker.fetch(new Request(`https://starcrop.example${path}`, init), env, ctx);
  return { env, ctx, assets, waits, get };
}

test('routes: one per Netlify function path, the survey is the one scheduled function', () => {
  assert.deepEqual(routes.map((r) => `${r.path} ${r.name}`).sort(), ['/api/fields fields', '/api/health health', '/api/recent recent', '/api/report report']);
  assert.deepEqual(scheduledFunctions.map((f) => `${f.name} ${f.schedule}`), ['survey */20 * * * *']);
  for (const [name, mod] of Object.entries(FUNCTIONS)) assert.equal(typeof mod.default, 'function', name);
});

test('each /api path reaches its handler with the D1 store registered first', { skip }, async () => {
  const h = harness();
  const health = await h.get('/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).project, 'starcrop');
  const fields = await (await h.get('/api/fields')).json();
  assert.equal(fields.featured.source, 'fixture');
  // seed recent/list straight into D1: /api/recent must read it back, so the binding was registered before the handler
  await h.env.DB.prepare('INSERT INTO kv (store, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)').bind('starcrop', 'recent/list', JSON.stringify([{ fullName: TARGET, verdict: 'GROWN' }]), 1).run();
  assert.deepEqual(await (await h.get('/api/recent')).json(), { reports: [{ fullName: TARGET, verdict: 'GROWN' }] });
  const bad = await h.get('/api/report');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'BAD_INPUT');
  assert.deepEqual(h.assets, []);
});

test('/api/report surveys through the free-plan budget and stores the report in D1', { skip }, async () => {
  process.env.CF_FREE_PLAN = '1';
  try {
    const up = createUpstream();
    globalThis.fetch = up.fetch;
    const h = harness();
    const res = await h.get(`/api/report?q=${encodeURIComponent(TARGET)}`);
    assert.equal(res.status, 200);
    const r = await res.json();
    assert.equal(r.repo.fullName, TARGET);
    assert.equal(r.verdict, 'PLANTED');
    assert.ok(up.calls.length <= 45, `${up.calls.length} upstream requests`);
    assert.ok(r.limits.some((l) => l.includes('not an accusation')));
    assert.ok(h.env.DB.rows().some((row) => row.key === `report/${TARGET}`));
    clearMemo();
    const again = await (await h.get(`/api/report?q=${encodeURIComponent('https://github.com/' + TARGET)}`)).json();
    assert.equal(again.source, 'cache');
  } finally { delete process.env.CF_FREE_PLAN; }
});

test('everything that is not an /api route goes to the static site', { skip }, async () => {
  const h = harness();
  for (const p of ['/', '/index.html', '/404', '/site.css', '/api/nope', '/api', '/apix/report', '/api/report/extra']) {
    const res = await h.get(p);
    assert.equal(res.status, 200, p);
    assert.equal(await res.text(), '<!doctype html>asset', p);
  }
  assert.deepEqual(h.assets, ['/', '/index.html', '/404', '/site.css', '/api/nope', '/api', '/apix/report', '/api/report/extra']);
});

test('a handler that throws answers 500 JSON instead of crashing the worker', { skip }, async () => {
  const h = harness();
  const r = routes.find((x) => x.name === 'health');
  const orig = r.handler;
  r.handler = () => { throw new Error('boom'); };
  try {
    const res = await h.get('/api/health');
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'function crashed' });
  } finally { r.handler = orig; }
});

test('scheduled() runs the survey job against D1 (free plan: a cursor, at most 45 upstream requests)', { skip }, async () => {
  process.env.CF_FREE_PLAN = '1';
  try {
    const up = createUpstream();
    globalThis.fetch = up.fetch;
    const h = harness();
    await worker.scheduled({ cron: '*/20 * * * *', scheduledTime: Date.now() }, h.env, h.ctx);
    const rows = Object.fromEntries(h.env.DB.rows().map((r) => [r.key, JSON.parse(r.value)]));
    assert.ok(rows['survey/last'], Object.keys(rows).join());
    assert.match(rows['survey/last'].log[0], /^candidates: dexscreener 2, pumpfun 0, github 1$/);
    assert.ok(rows['survey/last'].log.some((l) => l.startsWith(`dexscreener ${TARGET}: PLANTED`)), rows['survey/last'].log.join('\n'));
    assert.ok(rows['survey/cursor'].queue.length >= 1);
    assert.ok(up.calls.length <= 45, `${up.calls.length} upstream requests`);
    assert.equal(rows['survey/last'].upstream.used, up.calls.length);
    assert.ok(rows[`report/${TARGET}`]);
  } finally { delete process.env.CF_FREE_PLAN; }
});

test('netlifyContext: params, ip from cf-connecting-ip, waitUntil on the Workers context, site origin', async () => {
  const waits = [];
  const req = new Request('https://starcrop.example/api/x', { headers: { 'cf-connecting-ip': '203.0.113.7', 'cf-ray': 'abc-AMS' } });
  const c = netlifyContext(req, { waitUntil: (p) => waits.push(p) }, { id: '7' });
  assert.deepEqual(c.params, { id: '7' });
  assert.equal(c.ip, '203.0.113.7');
  assert.equal(c.site.url, 'https://starcrop.example');
  assert.equal(c.requestId, 'abc-AMS');
  const p = Promise.resolve(1);
  c.waitUntil(p);
  assert.deepEqual(waits, [p]);
});

test('compile: Netlify path patterns with :params and *', () => {
  assert.deepEqual(compile('/api/report')('/api/report'), {});
  assert.equal(compile('/api/report')('/api/report/'), null);
  assert.deepEqual(compile('/api/thing/:id')('/api/thing/a%20b'), { id: 'a b' });
  assert.deepEqual(compile('/api/*')('/api/x/y'), { 0: 'x/y' });
  assert.equal(compile('/api/thing/:id')('/api/thing/%E0%A4%A'), null);
});
