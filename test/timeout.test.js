// Timeouts during the body download (QA round 2: a big, old Rust repo came back 502 after 8.2 s).
// The per-call signal still runs after the headers arrive; a stalled body must become the library's own error,
// and a survey that runs out of time must come back as a partial report, never as a thrown DOMException.
import test from 'node:test';
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { githubClient, fetchJson } from '../src/http.js';
import { survey, collect, analyze, renderPlat, StarcropError, BudgetError } from '../src/index.js';

// Fake fetches hold no socket, and Node 22 lets the process exit while only unref'd
// timeout timers are pending; keep the event loop alive while this file's tests run.
let keepAlive;
before(() => { keepAlive = setInterval(() => {}, 1000); });
after(() => clearInterval(keepAlive));


const json = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });

/**
 * 200 + headers at once, then the body sends a few bytes and stalls.
 * honorAbort: like Node's fetch (undici), the stream errors with the signal's reason (a DOMException TimeoutError).
 * Without it the stream ignores the signal and never ends.
 */
function stalled(signal, { honorAbort = true, prefix = '[{"type":"WatchEvent","actor":' } = {}) {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(prefix));
      if (honorAbort) signal.addEventListener('abort', () => c.error(signal.reason), { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

const isDom = (e) => e?.constructor?.name === 'DOMException';

test('githubClient: body stalls past the deadline (stream errors with the TimeoutError) -> BudgetError, not a DOMException', async () => {
  const t0 = Date.now();
  const gh = githubClient({ deadline: t0 + 300, fetch: async (_u, init) => stalled(init.signal) });
  await assert.rejects(gh.get('/repos/big/rg/events?per_page=100&page=1'), (e) => {
    assert.ok(e instanceof BudgetError, `${e?.name}: ${e?.message}`);
    assert.ok(!isDom(e));
    assert.match(e.message, /still sending its body/);
    return true;
  });
  const ms = Date.now() - t0;
  assert.ok(ms >= 250 && ms < 1500, `${ms} ms`);
});

test('githubClient: a body stream that ignores the signal still ends at the deadline', async () => {
  const t0 = Date.now();
  const gh = githubClient({ deadline: t0 + 250, fetch: async (_u, init) => stalled(init.signal, { honorAbort: false }) });
  await assert.rejects(gh.get('/repos/a/b/readme', { text: true }), (e) => e instanceof BudgetError);
  assert.ok(Date.now() - t0 < 1500);
});

test('githubClient: per-call timeout during the body, budget left -> StarcropError UPSTREAM with timeout: true', async () => {
  const gh = githubClient({ deadline: Date.now() + 10_000, timeoutMs: 150, fetch: async (_u, init) => stalled(init.signal) });
  await assert.rejects(gh.get('/repos/a/b'), (e) => {
    assert.ok(e instanceof StarcropError, `${e?.name}: ${e?.message}`);
    assert.equal(e.code, 'UPSTREAM');
    assert.equal(e.status, 502);
    assert.equal(e.timeout, true);
    assert.match(e.message, /GitHub stopped sending the response \(timeout\)/);
    assert.deepEqual(Object.keys(e.toJSON()).sort(), ['code', 'error']); // the flag stays internal
    return true;
  });
});

test('githubClient: malformed JSON body -> StarcropError UPSTREAM', async () => {
  const gh = githubClient({ deadline: Date.now() + 2000, fetch: async () => new Response('{"full_name": "a/b", ', { status: 200 }) });
  await assert.rejects(gh.get('/repos/a/b'), (e) => e instanceof StarcropError && e.code === 'UPSTREAM' && /malformed JSON/.test(e.message) && !e.timeout);
});

test('fetchJson: a stalled body is null for soft calls and for budget-bound calls', async () => {
  const fetch = async (_u, init) => stalled(init.signal, { prefix: '{"result":' });
  assert.equal(await fetchJson('https://rpc.test/', { fetch, deadline: Date.now() + 200, soft: true }), null);
  assert.equal(await fetchJson('https://rpc.test/', { fetch, deadline: Date.now() + 200 }), null); // deadline < 8 s: out of budget
});

// A mature repo like that one: the events feed (the biggest body) is still downloading when the budget runs out.
const REPO = { full_name: 'big/rg', description: 'x', created_at: '2016-03-11T00:00:00Z', pushed_at: null, stargazers_count: 60000, forks_count: 2300, size: 9000, language: 'Rust', owner: { login: 'big', id: 7 } };
const OWNER = { login: 'big', id: 7, created_at: '2010-01-01T00:00:00Z', followers: 9000, public_repos: 90, type: 'User' };
function github({ stall }) {
  return async (url, init) => {
    const u = new URL(url);
    if (stall(u)) return stalled(init.signal);
    if (u.pathname === '/repos/big/rg') return json(REPO);
    if (u.pathname === '/users/big') return json(OWNER);
    if (u.pathname.startsWith('/search/')) return json({ total_count: 0, items: [] });
    if (u.pathname === '/repos/big/rg/forks') return json([]);
    if (u.pathname === '/repos/big/rg/events') return json([]);
    if (u.pathname === '/repos/big/rg/commits') return json([{}], 200, { link: '<https://api.github.com/x?page=2000>; rel="last"' });
    return json({ message: 'Not Found' }, 404);
  };
}

test('survey(): events body stalls until the budget ends -> partial UNSURVEYED report with a reason (was a 502)', async () => {
  const t0 = Date.now();
  const r = await survey('https://github.com/big/rg', { fetch: github({ stall: (u) => u.pathname.endsWith('/events') }), budgetMs: 500 });
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
  assert.equal(r.partial, true);
  assert.equal(r.verdict, 'UNSURVEYED');
  assert.match(r.reason, /cut short \(time budget or rate limit\) before any stargazer was sampled/);
  assert.doesNotMatch(r.reason + r.headline, /No stargazer is visible|no forks/); // the doors weren't read: don't claim they're empty
  assert.equal(r.repo.stars, 60000);
  assert.equal(r.repo.commits, 2000); // steps that finished are kept
  assert.ok(r.limits.some((l) => /PARTIAL: the time budget ran out/.test(l)));
  assert.equal(r.signals.length, 9);
});

test('survey(): the repo body itself stalls -> UNSURVEYED, nothing measured, repo fields null, reason says why', async () => {
  const r = await survey('big/rg', { fetch: github({ stall: (u) => u.pathname === '/repos/big/rg' }), budgetMs: 400 });
  assert.equal(r.verdict, 'UNSURVEYED');
  assert.equal(r.partial, true);
  assert.equal(r.score, 0);
  assert.equal(r.repo.fullName, 'big/rg');
  assert.equal(r.repo.stars, null);
  assert.equal(r.repo.owner, null);
  assert.match(r.reason, /time budget ran out before GitHub returned the repository itself/);
  assert.match(r.headline, /^Cut short/);
  assert.equal(r.signals.length, 9);
  assert.ok(r.signals.every((s) => s.fired === null && s.value === null));
  assert.ok(r.trace.some((x) => x.step === 'repo' && x.calls === 1));
  assert.ok(r.limits.some((l) => /before GitHub returned the repository/.test(l)));
  assert.match(renderPlat(r), /repository not returned in time/);
});

test('collect(): the owner body stalls -> the survey goes on without the owner, partial', async () => {
  const raw = await collect('big/rg', { fetch: github({ stall: (u) => u.pathname === '/users/big' }), budgetMs: 400 });
  assert.equal(raw.partial, true);
  assert.equal(raw.owner, null);
  const r = analyze(raw);
  assert.equal(r.repo.owner, null);
  assert.equal(r.signals.find((s) => s.id === 'ownerCohort').fired, null);
  assert.equal(r.verdict, 'UNSURVEYED');
});

test('hard failures stay hard: a network error on the repo call is UPSTREAM, a 404 is NOT_FOUND', async () => {
  const boom = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(collect('big/rg', { fetch: boom, budgetMs: 2000 }), (e) => e instanceof StarcropError && e.code === 'UPSTREAM' && !e.timeout);
  await assert.rejects(collect('big/none', { fetch: github({ stall: () => false }), budgetMs: 2000 }), (e) => e.code === 'NOT_FOUND');
});
