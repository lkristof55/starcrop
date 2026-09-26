// Offline tests for the service layer: caching, the field index, lists, error mapping. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { useStoreDir } from '../lib/store.mjs';
import { getReport, getFields, getRecent, knownPlanters, errorResponse, clearMemo, wasReportedRecently, PARTIAL_SERVE_MS, REPORT_ALGO } from '../lib/service.mjs';
import { assignField, mergeField, fieldSummary, prepend } from '../lib/fields.mjs';
import reference from '../lib/reference-report.mjs';
import { StarcropError } from '../../src/index.js';

async function freshStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starcrop-test-'));
  useStoreDir(dir);
  clearMemo();
  return dir;
}
const live = (over = {}) => ({ ...structuredClone(reference), source: 'live', checkedAt: new Date().toISOString(), ...over });

test('empty store: /api/fields serves the recorded report as featured, empty lists', async () => {
  await freshStore();
  const f = await getFields();
  assert.equal(f.featured.source, 'fixture');
  assert.equal(f.featured.verdict, 'PLANTED');
  assert.equal(f.featured.signals.length, 9);
  assert.deepEqual(f.fields, []);
  assert.deepEqual(f.surveyed, []);
  assert.deepEqual(await getRecent(), { reports: [] });
});

test('malformed input never reaches the survey', async () => {
  await freshStore();
  let called = false;
  await assert.rejects(getReport('not a repo', { surveyFn: async () => { called = true; } }), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(getReport('', { surveyFn: async () => { called = true; } }), (e) => e.code === 'BAD_INPUT');
  assert.equal(called, false);
});

test('PLANTED report: field F001 indexed, featured set, lists filled, second call is a cache hit', async () => {
  await freshStore();
  let calls = 0;
  const surveyFn = async () => { calls++; return live(); };
  const r1 = await getReport('AutocratGirder/ClashDesk', { surveyFn });
  assert.equal(r1.field.id, 'F001');
  const r2 = await getReport('https://github.com/AutocratGirder/ClashDesk', { surveyFn });
  assert.equal(calls, 1);
  assert.equal(r2.source, 'cache');
  assert.equal(r2.checkedAt, r1.checkedAt);
  assert.equal(r2.input.kind, 'url');
  const f = await getFields();
  assert.equal(f.featured.source, 'cache');
  assert.equal(f.fields.length, 1);
  assert.equal(f.fields[0].id, 'F001');
  assert.equal(f.fields[0].planters, 13);
  assert.equal(f.fields[0].repos, 10);
  assert.equal(f.surveyed.length, 1);
  assert.equal((await getRecent()).reports.length, 1); // deduped by fullName
});

test('known planters: another repo sees the field; the origin repo does not count itself', async () => {
  await freshStore();
  await getReport('AutocratGirder/ClashDesk', { surveyFn: async () => live() });
  const other = await knownPlanters('BufferHerald/WarpLite');
  assert.equal(other.indexed, 13);
  assert.equal(other.starredThis.length, 13);
  assert.equal(other.seeds.length, 4);
  assert.ok(other.seeds.every((s) => s.login && s.id));
  const self = await knownPlanters('AutocratGirder/ClashDesk');
  assert.equal(self.indexed, 0);
});

test('assignField merges when >= 50% of stargazers are known, else opens the next id', () => {
  const known = Object.fromEntries(reference.stargazers.accounts.slice(0, 7).map((a) => [a.login.toLowerCase(), { fieldId: 'F004' }]));
  assert.deepEqual(assignField(reference, known, ['F004']), { fieldId: 'F004', isNew: false });
  assert.deepEqual(assignField(reference, {}, ['F001', 'F002']), { fieldId: 'F003', isNew: true });
  const f = mergeField(null, reference, 'F001', '2026-09-25T13:00:00Z');
  const s = fieldSummary(f);
  assert.equal(s.lastPlanting, '2026-09-24T22:22:08Z');
  assert.equal(s.bornFrom, '2026-07-21T23:50:36Z');
  assert.ok(s.reposSample.length <= 12);
});

test('prepend dedupes and caps', () => {
  const list = Array.from({ length: 25 }, (_, i) => ({ fullName: `a/r${i}` }));
  const out = prepend(list, { fullName: 'A/R3' }, 20);
  assert.equal(out.length, 20);
  assert.equal(out[0].fullName, 'A/R3');
  assert.equal(out.filter((x) => x.fullName.toLowerCase() === 'a/r3').length, 1);
});

test('errors map to the contract ErrorBody and status', async () => {
  const r429 = errorResponse(new StarcropError('RATE_LIMITED', 'busy', { retryAfter: 42 }));
  assert.equal(r429.status, 429);
  assert.equal(r429.headers.get('retry-after'), '42');
  assert.deepEqual(await r429.json(), { error: 'busy', code: 'RATE_LIMITED', retryAfter: 42 });
  const r422 = errorResponse(new StarcropError('NO_REPO', 'none', { token: { mint: 'm', name: 'n', symbol: 's' } }));
  assert.equal(r422.status, 422);
  assert.equal((await r422.json()).token.symbol, 's');
  const r502 = errorResponse(new Error('boom\n at secret stack'));
  assert.equal(r502.status, 502);
  assert.ok(!JSON.stringify(await r502.json()).includes('stack'));
});

test('handler: /api/report without q is 400 JSON', async () => {
  await freshStore();
  const { default: handler, config } = await import('../netlify/functions/report.mjs');
  assert.equal(config.path, '/api/report');
  const res = await handler(new Request('http://x/api/report'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'BAD_INPUT');
});

test('lib/reference-report.mjs is exactly analyze() on the recorded fixture (the site generates site/src/data from it)', async () => {
  const ref = await import('../lib/reference-report.mjs');
  const { analyze, summarize, GLOBAL_ANCHORS } = await import('../../src/index.js');
  const raw = JSON.parse(await fs.readFile(new URL('../../test/fixtures/raw.planted.clashdesk.json', import.meta.url), 'utf8'));
  assert.deepEqual(ref.report, analyze(raw), 'stale: run `node test/record.mjs --offline`');
  assert.equal(ref.default, ref.report);
  assert.deepEqual(ref.summary, summarize(ref.report));
  assert.equal(ref.report.stargazers.birthSpreadMinutes, 5.9);
  assert.equal(ref.report.reason, null);
  assert.deepEqual(ref.idclock.anchors, GLOBAL_ANCHORS.map((a) => ({ id: a.id, created_at: a.createdAt })));
  assert.ok(ref.idclock.local.some((a) => a.login === ref.report.repo.owner.login && a.created_at === ref.report.repo.owner.createdAt));
  assert.equal(ref.provenance.label, 'RECORDED');
});

test('an UNSURVEYED report keeps its reason through the service and the cache', async () => {
  await freshStore();
  const { analyze } = await import('../../src/index.js');
  const raw = JSON.parse(await fs.readFile(new URL('../../test/fixtures/raw.grown.tinygrad.json', import.meta.url), 'utf8'));
  raw.seeds = raw.seeds.filter((s) => s.via === 'fork');
  const thin = analyze(raw);
  assert.equal(thin.verdict, 'UNSURVEYED');
  const r1 = await getReport('tinygrad/tinygrad', { surveyFn: async () => structuredClone(thin) });
  const r2 = await getReport('tinygrad/tinygrad', { surveyFn: async () => { throw new Error('should be cached'); } });
  assert.equal(r2.source, 'cache');
  assert.match(r1.reason, /a verdict needs 4 confirmed stargazers/);
  assert.equal(r2.reason, r1.reason);
});

test('a cached report from an older algorithm version is a miss (re-surveyed)', async () => {
  const dir = await freshStore();
  const { getStore } = await import('../lib/store.mjs');
  const s = await getStore('starcrop');
  await s.setJSON('report/big/old', { savedAt: new Date().toISOString(), report: { ...live(), repo: { ...reference.repo, fullName: 'big/old' }, verdict: 'UNSURVEYED' } });
  let calls = 0;
  const r = await getReport('big/old', { surveyFn: async () => { calls++; return live({ repo: { ...reference.repo, fullName: 'big/old' }, verdict: 'GROWN' }); } });
  assert.equal(calls, 1);
  assert.equal(r.verdict, 'GROWN');
  assert.ok(dir);
});

// QA round 2: a big old repo answered 502 after 8.2 s when the budget ran out while a body was still downloading.
const stalledBody = (signal) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('[{"type":')); signal.addEventListener('abort', () => c.error(signal.reason), { once: true }); } }), { status: 200 });
const ghStub = (stall) => async (url, init) => {
  const u = new URL(url);
  if (stall(u)) return stalledBody(init.signal);
  if (u.pathname === '/repos/big/rg') return Response.json({ full_name: 'big/rg', description: null, created_at: '2016-03-11T00:00:00Z', pushed_at: null, stargazers_count: 60000, forks_count: 2300, size: 9000, language: 'Rust', owner: { login: 'big', id: 7 } });
  if (u.pathname === '/users/big') return Response.json({ login: 'big', id: 7, created_at: '2010-01-01T00:00:00Z', followers: 9000, public_repos: 90 });
  if (u.pathname.startsWith('/search/')) return Response.json({ total_count: 0, items: [] });
  if (u.pathname.endsWith('/forks') || u.pathname.endsWith('/events') || u.pathname.endsWith('/commits')) return Response.json([]);
  return Response.json({ message: 'Not Found' }, { status: 404 });
};

test('budget runs out during a body download: /api/report returns a partial UNSURVEYED report, not a 502', async () => {
  await freshStore();
  const { survey } = await import('../../src/index.js');
  const surveyFn = (q, opts) => survey(q, { ...opts, token: undefined, rpcUrl: undefined, fetch: ghStub((u) => u.pathname.endsWith('/events')) });
  const r = await getReport('https://github.com/big/rg', { surveyFn, budgetMs: 900 });
  assert.equal(r.partial, true);
  assert.equal(r.verdict, 'UNSURVEYED');
  assert.match(r.reason, /cut short/);
  assert.equal(r.repo.stars, 60000);
  assert.equal((await getRecent()).reports.length, 1); // a partial report with repo data is listed (and cached for 15 min)
});

test('budget runs out before the repo arrives: UNSURVEYED with a reason, never cached or listed', async () => {
  await freshStore();
  const { survey } = await import('../../src/index.js');
  let calls = 0;
  const surveyFn = (q, opts) => { calls++; return survey(q, { ...opts, token: undefined, rpcUrl: undefined, fetch: ghStub((u) => u.pathname === '/repos/big/rg') }); };
  const r1 = await getReport('big/rg', { surveyFn, budgetMs: 800 });
  assert.equal(r1.verdict, 'UNSURVEYED');
  assert.equal(r1.repo.stars, null);
  assert.match(r1.reason, /time budget ran out before GitHub returned the repository/);
  const r2 = await getReport('big/rg', { surveyFn, budgetMs: 800 });
  assert.equal(calls, 2); // not served from cache
  assert.equal(r2.source, 'live');
  assert.deepEqual(await getRecent(), { reports: [] });
  assert.deepEqual((await getFields()).surveyed, []);
});

test('an escaped DOMException still maps to a clean 502 body (defence in depth)', async () => {
  const res = errorResponse(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  assert.equal(res.status, 502);
  assert.deepEqual(Object.keys(await res.json()).sort(), ['code', 'error']);
});

// QA round 3, fix 1: "Survey again" on a partial report returned the same report (kept 15 min, sent public max-age=60).
const partialOf = (fullName, over = {}) => live({ repo: { ...reference.repo, fullName }, verdict: 'UNSURVEYED', score: 0, partial: true, reason: 'The 8.5 s time budget ran out: cut short.', ...over });
const ago = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
async function seedRecord(key, report, savedAgoMs, extra = {}) {
  const { getStore } = await import('../lib/store.mjs');
  await (await getStore('starcrop')).setJSON(`report/${key}`, { savedAt: ago(savedAgoMs), algo: REPORT_ALGO, report, ...extra });
  clearMemo();
}

test('partial report: served from cache for 60 s with resurveyAt, surveyed again after that without any new parameter', async () => {
  await freshStore();
  let calls = 0;
  const r1 = await getReport('big/rg', { surveyFn: async () => { calls++; return partialOf('big/rg'); } });
  assert.equal(r1.partial, true);
  assert.equal(r1.source, 'live');
  const at = Date.parse(r1.resurveyAt) - Date.now();
  assert.ok(at > 55e3 && at <= 61e3, `resurveyAt ${r1.resurveyAt}`);
  const r2 = await getReport('big/rg', { surveyFn: async () => { calls++; return partialOf('big/rg'); } });
  assert.equal(calls, 1);
  assert.equal(r2.source, 'cache');
  assert.equal(r2.resurveyAt, r1.resurveyAt);
  // the same partial, saved 61 s ago: the plain request (the site's current "Survey again") walks the field again
  await seedRecord('big/rg', partialOf('big/rg'), PARTIAL_SERVE_MS + 1000);
  const r3 = await getReport('big/rg', { surveyFn: async () => { calls++; return live({ repo: { ...reference.repo, fullName: 'big/rg' }, verdict: 'GROWN' }); } });
  assert.equal(calls, 2);
  assert.equal(r3.source, 'live');
  assert.equal(r3.partial, false);
  assert.equal(r3.resurveyAt, null);
  const r4 = await getReport('big/rg', { surveyFn: async () => { throw new Error('the full report is cached 6 h'); } });
  assert.equal(r4.source, 'cache');
  assert.equal(r4.verdict, 'GROWN');
  assert.equal(r4.resurveyAt, null);
});

test('fresh=1: 429 RATE_LIMITED with retryAfter inside the 60 s window, a live re-survey after it, no effect on a full report', async () => {
  await freshStore();
  await seedRecord('big/rg', partialOf('big/rg'), 20e3);
  let calls = 0;
  const surveyFn = async () => { calls++; return partialOf('big/rg'); };
  await assert.rejects(getReport('big/rg', { surveyFn, fresh: true }), (e) => e.code === 'RATE_LIMITED' && e.status === 429 && e.retryAfter >= 39 && e.retryAfter <= 41 && /once a minute/.test(e.message));
  assert.equal(calls, 0);
  await seedRecord('big/rg', partialOf('big/rg'), PARTIAL_SERVE_MS + 1000);
  const r = await getReport('big/rg', { surveyFn, fresh: true });
  assert.equal(calls, 1);
  assert.equal(r.source, 'live');
  // right after it: one re-survey per repo per minute
  await assert.rejects(getReport('https://github.com/big/rg', { surveyFn, fresh: true }), (e) => e.code === 'RATE_LIMITED' && e.retryAfter >= 59);
  // a full cached report is not re-surveyed by fresh=1
  await seedRecord('big/full', live({ repo: { ...reference.repo, fullName: 'big/full' }, verdict: 'GROWN' }), 3600e3);
  const f = await getReport('big/full', { surveyFn: async () => { throw new Error('should be cached'); }, fresh: true });
  assert.equal(f.source, 'cache');
});

test('a re-survey in flight or cut short: other requests get the old partial, fresh=1 waits 60 s from when it began', async () => {
  await freshStore();
  await seedRecord('big/rg', partialOf('big/rg', { score: 3 }), 5 * 60e3);
  const { survey } = await import('../../src/index.js');
  // the re-survey is cut short before GitHub returns the repo (measured nothing: not cached)
  const cut = (q, opts) => survey(q, { ...opts, token: undefined, rpcUrl: undefined, fetch: ghStub((u) => u.pathname === '/repos/big/rg') });
  const r1 = await getReport('big/rg', { surveyFn: cut, budgetMs: 800 });
  assert.equal(r1.repo.stars, null);
  assert.equal(r1.resurveyAt, null);
  const r2 = await getReport('big/rg', { surveyFn: async () => { throw new Error('inside the window'); } });
  assert.equal(r2.source, 'cache');
  assert.equal(r2.score, 3); // the stored partial survives a cut-short re-survey
  await assert.rejects(getReport('big/rg', { surveyFn: async () => { throw new Error('rate limited'); }, fresh: true }), (e) => e.code === 'RATE_LIMITED' && e.retryAfter >= 58);
});

test('handler: partial and error responses are no-store, full reports public max-age=60, fresh=1 reaches the service', async () => {
  await freshStore();
  const { default: handler } = await import('../netlify/functions/report.mjs');
  await seedRecord('big/rg', partialOf('big/rg'), 10e3);
  const p = await handler(new Request('http://x/api/report?q=big/rg'));
  assert.equal(p.status, 200);
  assert.equal(p.headers.get('cache-control'), 'no-store');
  assert.equal((await p.json()).partial, true);
  const rl = await handler(new Request('http://x/api/report?q=big/rg&fresh=1'));
  assert.equal(rl.status, 429);
  assert.equal(rl.headers.get('cache-control'), 'no-store');
  const body = await rl.json();
  assert.equal(body.code, 'RATE_LIMITED');
  assert.equal(rl.headers.get('retry-after'), String(body.retryAfter));
  await seedRecord('big/full', live({ repo: { ...reference.repo, fullName: 'big/full' }, verdict: 'GROWN' }), 60e3);
  const f = await handler(new Request('http://x/api/report?q=big/full&fresh=1'));
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('cache-control'), 'public, max-age=60');
  const bad = await handler(new Request('http://x/api/report?q=nope'));
  assert.equal(bad.headers.get('cache-control'), 'no-store');
});

// QA round 3, fix 2: facebook/react resolves to react/react; the cache was read under the requested name and written under
// the resolved one, so it never hit.
test('renamed repo: cached under the requested and the resolved name (facebook/react -> react/react)', async () => {
  await freshStore();
  let calls = 0;
  const surveyFn = async (q) => { calls++; return live({ repo: { ...reference.repo, fullName: 'react/react', url: 'https://github.com/react/react' }, verdict: 'GROWN', input: { q, kind: 'slug', mint: null, token: null, note: null } }); };
  const r1 = await getReport('facebook/react', { surveyFn });
  assert.equal(r1.repo.fullName, 'react/react');
  for (const q of ['facebook/react', 'https://github.com/Facebook/React', 'react/react']) {
    const r = await getReport(q, { surveyFn });
    assert.equal(r.source, 'cache', q);
    assert.equal(r.repo.fullName, 'react/react');
    assert.equal(r.input.q, q);
  }
  assert.equal(calls, 1);
  assert.equal(await wasReportedRecently('facebook/react'), true);
  // the alias survives a cold instance (read back from the store)
  clearMemo();
  assert.equal((await getReport('facebook/react', { surveyFn })).source, 'cache');
  assert.equal(calls, 1);
  assert.equal((await getRecent()).reports.length, 1);
});

test('renamed repo with a partial report: the 60 s window and fresh=1 follow the alias', async () => {
  await freshStore();
  let calls = 0;
  const surveyFn = async () => { calls++; return partialOf('react/react'); };
  await getReport('facebook/react', { surveyFn });
  await assert.rejects(getReport('facebook/react', { surveyFn, fresh: true }), (e) => e.code === 'RATE_LIMITED');
  assert.equal((await getReport('facebook/react', { surveyFn })).source, 'cache');
  assert.equal(calls, 1);
  await seedRecord('react/react', partialOf('react/react'), PARTIAL_SERVE_MS + 1000);
  assert.equal((await getReport('facebook/react', { surveyFn })).source, 'live');
  assert.equal(calls, 2);
});
