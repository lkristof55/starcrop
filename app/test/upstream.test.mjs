// The counting fetch for the Cloudflare free plan (lib/upstream.mjs) and the plan's notes in a report (lib/service.mjs).
// Offline: every upstream is test/upstream-stub.mjs (placeholders only).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { slimStarred, slimForks, slimKind, upstreamBudget } from '../lib/upstream.mjs';
import { plan, FULL_STARRED_PAGES } from '../lib/plan.mjs';
import { planNotes, planOptions, budgetFor, LIB_BUDGET_LIMIT } from '../lib/service.mjs';
import { survey, BudgetError } from '../../src/index.js';
import { createUpstream, repoObject, TARGET, NOW, FARM } from './upstream-stub.mjs';

// the library's timeouts are unref'd timers; keep Node 22 from exiting while a stubbed fetch is pending
let keepAlive;
before(() => { keepAlive = setInterval(() => {}, 1000); });
after(() => clearInterval(keepAlive));

const readStarred = (items) => items.filter((x) => x?.repo).map((x) => ({
  starred_at: x.starred_at, repo: { full_name: x.repo.full_name, stargazers_count: x.repo.stargazers_count, created_at: x.repo.created_at, owner: { login: x.repo.owner.login, id: x.repo.owner.id } },
}));
const readForks = (items) => items.map((f) => ({ owner: { login: f.owner.login, id: f.owner.id } }));
const withoutTimes = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'ms' || k === 'elapsedMs' ? undefined : v)));

test('plan: Netlify and Workers Paid get the full survey; CF_FREE_PLAN=1 the free-plan budgets; env overrides', () => {
  const full = plan({});
  assert.equal(full.free, false);
  assert.equal(full.maxFetches, Infinity);
  assert.equal(full.starredPages, FULL_STARRED_PAGES);
  assert.equal(budgetFor(full), null);
  assert.deepEqual(planOptions(full, null), {});
  assert.deepEqual(full.job, { surveys: 3, planters: 10, feedsEveryMs: 0, plantersEveryMs: 0, onePhase: false, keepCursor: false });
  const free = plan({ CF_FREE_PLAN: '1' });
  assert.equal(free.free, true);
  assert.equal(free.maxFetches, 45);
  assert.equal(free.starredPages, 12);
  assert.equal(free.slim, true);
  assert.equal(free.job.surveys, 1);
  assert.equal(plan({ CF_FREE_PLAN: '0' }).free, false);
  const tuned = plan({ CF_FREE_PLAN: 'true', SURVEY_FETCH_BUDGET: '40', SURVEY_STARRED_PAGES: '8' });
  assert.equal(tuned.maxFetches, 40);
  assert.equal(tuned.starredPages, 8);
  assert.equal(plan({ CF_FREE_PLAN: '1', SURVEY_FETCH_BUDGET: 'lots' }).maxFetches, 45);
  const b = budgetFor(free);
  assert.equal(typeof b.fetch, 'function');
  assert.deepEqual(Object.keys(planOptions(free, b)).sort(), ['fetch', 'maxStarredCalls']);
});

test('slimKind: starred pages (star+json only) and forks on api.github.com', () => {
  assert.equal(slimKind('https://api.github.com/users/sample-user-01/starred?per_page=100&page=2', 'application/vnd.github.star+json'), 'starred');
  assert.equal(slimKind('https://api.github.com/users/sample-user-01/starred?per_page=100', 'application/vnd.github+json'), null);
  assert.equal(slimKind('https://api.github.com/repos/sample-owner-01/crop/forks?sort=oldest&per_page=100'), 'forks');
  assert.equal(slimKind('https://api.github.com/repos/sample-owner-01/crop'), null);
  assert.equal(slimKind('https://example.com/users/x/starred', 'application/vnd.github.star+json'), null);
});

test('slimStarred gives exactly what JSON.parse gives for the fields read, through quotes, backslashes, key-like text and emoji', async () => {
  const up = createUpstream();
  for (const f of FARM.slice(0, 4)) {
    const text = await (await up.fetch(`https://api.github.com/users/${f.login}/starred?per_page=100`)).text();
    assert.ok(text.includes('\\"created_at\\":\\"2001'), 'the fixture carries key-like text inside a description');
    assert.deepEqual(slimStarred(text), readStarred(JSON.parse(text)));
  }
  assert.deepEqual(slimStarred('[]'), []);
  assert.deepEqual(slimStarred(' [ ]\n'), []);
});

test('slimStarred refuses any shape it does not know (null: the page is then passed on untouched)', () => {
  const r = repoObject({ owner: 'sample-owner-05', ownerId: 1005, name: 'x', id: 2 });
  const item = { starred_at: '2026-09-18T11:00:00Z', repo: r };
  assert.equal(slimStarred(JSON.stringify([item])).length, 1);
  const { owner, ...rest } = r;
  const cases = {
    'owner before full_name': [{ ...item, repo: { owner, ...rest } }],
    'id before login': [{ ...item, repo: { ...r, owner: { id: 1005, login: 'sample-owner-05' } } }],
    'an item without starred_at': [item, { repo: r }],
    'full_name of another owner': [{ ...item, repo: { ...r, full_name: 'sample-owner-06/x' } }],
    'no stargazers_count': [{ ...item, repo: (({ stargazers_count, ...x }) => x)(r) }],
    'a nested repo object': [{ ...item, repo: { ...r, parent: repoObject({ owner: 'sample-owner-07', ownerId: 7, name: 'p', id: 3 }) } }],
    'starred_at not a timestamp': [{ ...item, starred_at: 'yesterday' }],
    'an escaped login': [{ ...item, repo: { ...r, full_name: 'sample-owner-05\\/x' } }],
  };
  for (const [name, page] of Object.entries(cases)) assert.equal(slimStarred(JSON.stringify(page)), null, name);
  assert.equal(slimStarred(JSON.stringify([item], null, 2)), null, 'pretty-printed');
  assert.equal(slimStarred('{"message":"Not Found"}'), null, 'not an array');
  assert.equal(slimStarred('[{"starred_at":"2026-09-18T11:00:00Z"'), null, 'truncated');
});

test('slimForks gives the owners JSON.parse gives, and refuses unknown shapes', async () => {
  const up = createUpstream();
  const text = await (await up.fetch(`https://api.github.com/repos/${TARGET}/forks?sort=oldest&per_page=100`)).text();
  assert.equal(JSON.parse(text).length, 12);
  assert.deepEqual(slimForks(text), readForks(JSON.parse(text)));
  assert.deepEqual(slimForks('[]'), []);
  const r = repoObject({ owner: 'sample-user-01', ownerId: 1, name: 'crop', id: 2 });
  assert.equal(slimForks(JSON.stringify([{ ...r, owner: { id: 1, login: 'sample-user-01' } }])), null);
  assert.equal(slimForks(JSON.stringify([{ ...r, full_name: 'sample-user-02/crop' }])), null);
  assert.equal(slimForks(JSON.stringify([r, { ...r, owner: undefined }])), null);
});

test('budget: counts every request and refuses the one past the cap with BudgetError', async () => {
  const up = createUpstream();
  const b = upstreamBudget({ maxFetches: 3, fetch: up.fetch });
  for (let i = 0; i < 3; i++) assert.equal((await b.fetch('https://api.dexscreener.com/tokens/v1/solana/x')).status, 200);
  await assert.rejects(b.fetch('https://api.dexscreener.com/tokens/v1/solana/x'), (e) => e instanceof BudgetError);
  assert.equal(up.calls.length, 3);
  assert.deepEqual([b.used, b.refused], [3, 1]);
});

test('budget: a redirect hop is a request of its own; authorization survives a same-origin hop, not a cross-origin one', async () => {
  const up = createUpstream();
  const b = upstreamBudget({ maxFetches: 45, fetch: up.fetch });
  const res = await b.fetch('https://api.github.com/repos/sample-owner-01/crop-old', { headers: { authorization: 'Bearer test' } });
  assert.equal((await res.json()).full_name, TARGET);
  assert.equal(b.used, 2);
  assert.deepEqual(up.calls.map((c) => c.auth), ['Bearer test', 'Bearer test']);
  const seen = [];
  const cross = upstreamBudget({ maxFetches: 45, fetch: async (url, init) => {
    seen.push([url, new Headers(init.headers).get('authorization'), init.redirect]);
    return url.includes('api.github.com') ? new Response(null, { status: 302, headers: { location: 'https://objects.example.com/blob' } }) : new Response('ok');
  } });
  assert.equal(await (await cross.fetch('https://api.github.com/x', { headers: { authorization: 'Bearer test' } })).text(), 'ok');
  assert.deepEqual(seen, [['https://api.github.com/x', 'Bearer test', 'manual'], ['https://objects.example.com/blob', null, 'manual']]);
  assert.equal(cross.used, 2);
});

test('budget: after GitHub says the rate limit is used up, later GitHub requests in the invocation are answered without being sent', async () => {
  const up = createUpstream({ rateLimitAfter: 1 });
  const b = upstreamBudget({ maxFetches: 45, fetch: up.fetch });
  assert.equal((await b.fetch(`https://api.github.com/repos/${TARGET}`)).status, 200);
  const first = await b.fetch(`https://api.github.com/users/sample-owner-01`);
  assert.equal(first.status, 403);
  const held = await b.fetch(`https://api.github.com/repos/${TARGET}/forks`);
  assert.equal(held.status, 403);
  assert.equal(held.headers.get('x-ratelimit-remaining'), '0');
  assert.ok(Number(held.headers.get('x-ratelimit-reset')) > Date.now() / 1000);
  assert.equal(up.github, 2);
  assert.equal((await b.fetch('https://frontend-api-v3.pump.fun/coins/x')).status, 200, 'other hosts still answer');
  assert.deepEqual([b.used, b.held], [3, 1]);
});

test('budget: slim pages reach the caller as the slim JSON; an unknown shape reaches it untouched', async () => {
  const up = createUpstream();
  const b = upstreamBudget({ slim: true, fetch: up.fetch });
  const url = `https://api.github.com/users/${FARM[0].login}/starred?per_page=100`;
  const accept = { accept: 'application/vnd.github.star+json' };
  const full = await (await up.fetch(url)).text();
  const slim = await (await b.fetch(url, { headers: accept, signal: AbortSignal.timeout(5000) })).text();
  assert.ok(slim.length * 5 < full.length, `${slim.length} vs ${full.length} bytes`);
  assert.deepEqual(JSON.parse(slim), readStarred(JSON.parse(full)));
  const odd = upstreamBudget({ slim: true, fetch: async () => new Response('[{"starred_at": "2026-09-18T11:00:00Z"}]', { status: 200 }) });
  assert.equal(await (await odd.fetch(url, { headers: accept })).text(), '[{"starred_at": "2026-09-18T11:00:00Z"}]');
  assert.deepEqual([b.slimmed, odd.unslimmed], [1, 1]);
});

test('a survey through the slim budget fetch gives the same report as one without it', async () => {
  const plain = await survey(TARGET, { fetch: createUpstream().fetch, now: NOW, budgetMs: 20000 });
  const b = upstreamBudget({ maxFetches: 45, slim: true, fetch: createUpstream().fetch });
  const slim = await survey(TARGET, { fetch: b.fetch, now: NOW, budgetMs: 20000 });
  assert.equal(plain.verdict, 'PLANTED');
  assert.ok(b.slimmed >= 13, `slimmed ${b.slimmed}`);
  assert.deepEqual(withoutTimes(slim), withoutTimes(plain));
});

test('worst case (every request needs a retry): the survey stops at 45 requests, partial, and the report says why', async () => {
  const p = plan({ CF_FREE_PLAN: '1' });
  const up = createUpstream({ flaky: true });
  const b = upstreamBudget({ maxFetches: p.maxFetches, slim: p.slim, fetch: up.fetch });
  const r = planNotes(await survey(TARGET, { fetch: b.fetch, now: NOW, budgetMs: 30000, token: 'test', ...{ maxStarredCalls: p.starredPages } }), p, b);
  assert.equal(up.calls.length, 45);
  assert.equal(b.used, 45);
  assert.ok(b.refused > 0);
  assert.equal(r.partial, true);
  assert.ok(!r.limits.includes(LIB_BUDGET_LIMIT));
  assert.ok(r.limits.some((l) => /cap of 45 upstream requests per invocation \(Cloudflare Workers Free plan\)/.test(l)), r.limits.join('\n'));
  assert.ok(r.limits.some((l) => l.includes('not an accusation')));
});

test('planNotes: the sample line appears when the starred-page cap was reached, never on the full plan', () => {
  const report = { limits: ['a'], trace: [{ step: 'starred', calls: 12, ms: 1 }] };
  const free = plan({ CF_FREE_PLAN: '1' });
  const noted = planNotes(report, free, { refused: 0, maxFetches: 45 });
  assert.equal(noted.limits.length, 2);
  assert.equal(noted.limits[1], 'Sample: this copy runs on the Cloudflare Workers Free plan and reads at most 12 starred-list pages per survey (the full survey reads up to 28). This survey used all 12; the full survey may sample more stargazers.');
  assert.deepEqual(planNotes({ ...report, trace: [{ step: 'starred', calls: 7, ms: 1 }] }, free, null).limits, ['a']);
  assert.deepEqual(planNotes({ ...report, trace: [{ step: 'starred', calls: 28, ms: 1 }] }, plan({}), null).limits, ['a']);
  assert.deepEqual(report.limits, ['a'], 'the input is not mutated');
  // the cap line only on a partial report, and only for refusals during this survey
  const cut = { limits: ['x', LIB_BUDGET_LIMIT], trace: [], partial: true };
  assert.match(planNotes(cut, free, { refused: 2, maxFetches: 45 }).limits[1], /^PARTIAL: the time budget or the cap of 45 upstream requests per invocation/);
  assert.deepEqual(planNotes(cut, free, { refused: 2, maxFetches: 45 }, 2).limits, cut.limits);
  assert.deepEqual(planNotes({ ...cut, partial: false }, free, { refused: 2, maxFetches: 45 }).limits, cut.limits);
});
