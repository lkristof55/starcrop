// The star-event and engaged doors: big, old repos whose oldest forks are long dormant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, collect, eventDoors, seedPlan, MIN_CONFIRMED } from '../src/index.js';
import { load, clone } from './helpers.js';

const tiny = load('raw.grown.tinygrad.json');
const byId = (r) => Object.fromEntries(r.signals.map((s) => [s.id, s]));
const json = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });

test('live big repo (tinygrad/tinygrad, 33k stars, 5 years old) is GROWN through the star-event door', () => {
  const r = analyze(tiny);
  assert.equal(r.verdict, 'GROWN');
  assert.equal(r.reason, null);
  assert.equal(r.score, 0);
  const d = Object.fromEntries(r.stargazers.doors.map((x) => [x.via, x]));
  assert.ok(d['star-event'].seeds >= 4, JSON.stringify(d));
  assert.ok(d['star-event'].confirmed >= MIN_CONFIRMED, JSON.stringify(d));
  assert.ok(r.stargazers.doors.every((x) => x.confirmed <= x.seeds));
  assert.ok(byId(r).birthSpread.value >= 43200);
  assert.equal(tiny.doors.mature, true);
  assert.equal(tiny.seeds[0].via, 'star-event');
  assert.ok(tiny.seeds.length <= 20);
  assert.ok(tiny.cost.githubCore + tiny.cost.githubSearch <= 51, JSON.stringify(tiny.cost));
});

test('the same repo seen only through its oldest forks is UNSURVEYED, with a reason', () => {
  const raw = clone(tiny);
  raw.seeds = raw.seeds.filter((s) => s.via === 'fork');
  const r = analyze(raw);
  assert.equal(r.verdict, 'UNSURVEYED');
  assert.match(r.reason, /^Only \d+ of \d+ sampled accounts \(\d+ fork owners\) have this repo in their public stars; a verdict needs 4 confirmed stargazers\./);
  assert.match(r.headline, /fork owners/);
});

test('issue/PR authors alone never carry GROWN', () => {
  const raw = clone(tiny);
  for (const s of raw.seeds) s.via = 'engaged';
  const r = analyze(raw);
  assert.ok(r.stargazers.confirmed >= MIN_CONFIRMED);
  assert.equal(r.verdict, 'UNSURVEYED');
  assert.match(r.reason, /issue\/PR authors, who are engaged by selection; GROWN needs 4 from the star-event, fork, cohort or sibling doors \(0 found\)/);
});

test('no seeds at all: the reason names every door and the 4-stargazer rule', () => {
  const raw = clone(tiny);
  raw.seeds = []; raw.starred = {}; raw.profiles = {};
  raw.doors.events.starActors = 0;
  const r = analyze(raw);
  assert.equal(r.verdict, 'UNSURVEYED');
  assert.match(r.reason, /No stargazer is visible/);
  assert.match(r.reason, /no recent stars/);
});

test('reports from before the events door (no raw.doors) still analyze, doors derived from seeds', () => {
  const r = analyze(load('raw.planted.clashdesk.json'));
  assert.equal(r.verdict, 'PLANTED');
  assert.equal(r.reason, null);
  assert.deepEqual(r.stargazers.doors.map((d) => [d.via, d.seeds, d.confirmed]), [['fork', 8, 8], ['cohort', 5, 5]]);
});

test('eventDoors: WatchEvent actors are stargazers; bots, the owner and duplicates are dropped', () => {
  const ev = [
    { type: 'WatchEvent', actor: { login: 'alice', id: 1 }, created_at: '2026-09-25T10:00:00Z' },
    { type: 'WatchEvent', actor: { login: 'alice', id: 1 }, created_at: '2026-09-24T10:00:00Z' },
    { type: 'WatchEvent', actor: { login: 'Owner', id: 2 } },
    { type: 'IssuesEvent', actor: { login: 'dependabot[bot]', id: 3 } },
    { type: 'PullRequestEvent', actor: { login: 'bob', id: 4 } },
    { type: 'IssueCommentEvent', actor: { login: 'alice', id: 1 } },
    { type: 'PushEvent', actor: { login: 'carol', id: 5 } },
    { type: 'WatchEvent', actor: null },
  ];
  const d = eventDoors(ev, 'owner');
  assert.deepEqual(d.stars.map((x) => x.login), ['alice']);
  assert.equal(d.stars[0].at, '2026-09-25T10:00:00Z');
  assert.deepEqual(d.engaged.map((x) => x.login), ['bob']);
  assert.equal(d.events, 7);
  assert.deepEqual(eventDoors(null), { events: 0, stars: [], engaged: [] });
});

test('seedPlan: mature repos lead with star events, young repos with forks; young repos read 1 page per seed', () => {
  const m = seedPlan(true), y = seedPlan(false);
  assert.equal(m[0][0], 'star-event');
  assert.equal(y[0][0], 'fork');
  assert.ok(y.every(([, , pages]) => pages === 1));
  assert.deepEqual(new Set(m.map((d) => d[0])), new Set(y.map((d) => d[0])));
});

test('worst case: no star events on a mature repo, every 2-page door full -> starred calls stay <= 28, total <= 51', async () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const many = (p, n) => Array.from({ length: n }, (_, i) => ({ login: `${p}${i}`, id: 300_000_000 + i }));
  let starred = 0;
  const fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/repos/o/r') return json({ full_name: 'o/r', description: null, created_at: '2025-01-01T00:00:00Z', pushed_at: null, stargazers_count: 400, forks_count: 200, size: 10, language: null, owner: { login: 'o', id: 300_000_000 } });
    if (u.pathname === '/users/o') return json({ login: 'o', id: 300_000_000, created_at: '2026-07-05T03:48:56Z', followers: 0, public_repos: 10, type: 'User' });
    if (u.pathname === '/search/users') return json({ total_count: 50, items: many('c', 50) });
    if (u.pathname === '/search/repositories') return json({ total_count: 9, items: many('s', 9).map((x, i) => ({ full_name: `${x.login}/r${i}`, created_at: '2025-01-01T00:00:10Z', stargazers_count: 400, forks_count: 1, owner: x })) });
    if (u.pathname === '/repos/o/r/forks') return json(many('f', 100).map((x) => ({ owner: x })));
    if (u.pathname === '/repos/o/r/events') return json([{ type: 'IssuesEvent', actor: { login: 'e0', id: 9 } }]);
    if (u.pathname.endsWith('/starred')) { starred++; return json([]); }
    return json({ message: 'Not Found' }, 404);
  };
  const raw = await collect('o/r', { fetch, now, budgetMs: 5000, knownPlanters: async () => ({ indexed: 4, planters: [], starredThis: [], seeds: many('k', 4) }) });
  assert.equal(starred, 27); // fork 4x2 + engaged 1 + cohort 4x2 + sibling 4x2 + 1 known x2; the next 2-page seed would pass 28
  assert.ok(raw.cost.githubCore + raw.cost.githubSearch <= 51, JSON.stringify(raw.cost));
  assert.equal(analyze(raw).verdict, 'UNSURVEYED');
});

test('collect() on a mature repo: dormant oldest forks, recent WatchEvents -> GROWN from star events (stubbed GitHub)', async () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const target = 'big/lib';
  const users = Array.from({ length: 30 }, (_, i) => ({ login: `u${i}`, id: 1_000_000 + i * 9_000_000 }));
  const paths = [];
  const fetch = async (url) => {
    const u = new URL(url);
    const p = u.pathname + u.search;
    paths.push(p);
    if (u.pathname === '/repos/big/lib') return json({ full_name: target, description: 'x', created_at: '2020-01-01T00:00:00Z', pushed_at: null, stargazers_count: 30000, forks_count: 4000, size: 90000, language: 'Python', owner: { login: 'big', id: 7 } });
    if (u.pathname === '/users/big') return json({ login: 'big', id: 7, created_at: '2010-01-01T00:00:00Z', followers: 900, public_repos: 40, type: 'User' });
    if (u.pathname.startsWith('/search/')) return json({ total_count: 0, items: [] });
    if (u.pathname === '/repos/big/lib/forks') return json(users.slice(20, 30).map((x) => ({ owner: x })));
    if (u.pathname === '/repos/big/lib/events') {
      if (u.searchParams.get('page') !== '1') return json([]);
      return json([
        ...users.slice(0, 14).map((x, i) => ({ type: 'WatchEvent', actor: x, created_at: new Date(now - i * 3600e3).toISOString() })),
        { type: 'IssuesEvent', actor: users[15] }, { type: 'PushEvent', actor: { login: 'big', id: 7 } },
      ]);
    }
    if (u.pathname === '/repos/big/lib/commits') return json([{}], 200, { link: '<https://api.github.com/x?page=9000>; rel="last"' });
    if (u.pathname === '/repos/big/lib/readme') return new Response('# lib', { status: 200 });
    const star = u.pathname.match(/^\/users\/(u\d+)\/starred$/);
    if (star) {
      const i = Number(star[1].slice(1));
      if (i >= 20 || u.searchParams.get('page') !== '1') return json([]); // forks: dormant, never starred it recently
      return json([
        { starred_at: new Date(now - i * 3600e3).toISOString(), repo: { full_name: target, stargazers_count: 30000, created_at: '2020-01-01T00:00:00Z', owner: { login: 'big', id: 7 } } },
        { starred_at: '2025-01-01T00:00:00Z', repo: { full_name: `own/r${i}`, stargazers_count: 5, created_at: '2024-01-01T00:00:00Z', owner: { login: 'own', id: 9 } } },
      ]);
    }
    const prof = u.pathname.match(/^\/users\/(u\d+)$/);
    if (prof) { const x = users[Number(prof[1].slice(1))]; return json({ login: x.login, id: x.id, created_at: new Date(Date.parse('2011-01-01T00:00:00Z') + Number(prof[1].slice(1)) * 180 * 86400e3).toISOString(), followers: 12, public_repos: 30 }); }
    return json({ message: 'Not Found' }, 404);
  };
  const raw = await collect(target, { fetch, now, budgetMs: 5000 });
  assert.equal(raw.doors.mature, true);
  assert.deepEqual(raw.doors.events, { pages: 2, events: 16, starActors: 14, engagedActors: 1 });
  assert.equal(raw.seeds.filter((s) => s.via === 'star-event').length, 12);
  assert.equal(raw.seeds.filter((s) => s.via === 'fork').length, 4);
  assert.equal(raw.seeds.filter((s) => s.via === 'engaged').length, 1);
  // star-event seeds read 1 page of stars, fork seeds 2 (mature)
  assert.equal(paths.filter((p) => p.startsWith('/users/u0/starred')).length, 1);
  assert.equal(paths.filter((p) => p.startsWith('/users/u20/starred')).length, 2);
  assert.ok(raw.cost.githubCore + raw.cost.githubSearch <= 51, JSON.stringify(raw.cost));
  const r = analyze(raw);
  assert.equal(r.verdict, 'GROWN');
  assert.equal(r.stargazers.confirmed, 13); // 12 star events + the issue author u15; the 4 dormant fork owners never show it
  assert.equal(r.stargazers.accounts.filter((a) => a.via === 'star-event').length, 12);
  assert.deepEqual(r.stargazers.doors.map((d) => [d.via, d.seeds, d.confirmed]), [['star-event', 12, 12], ['fork', 4, 0], ['engaged', 1, 1]]);
});
