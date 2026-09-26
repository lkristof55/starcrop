// collect(): all network I/O for one crop report, returned as a RawSurvey (recordable, replayable).
// survey():  collect() + analyze().
import { githubClient, wireError } from './http.js';
import { resolveRepo } from './resolve.js';
import { analyze, SEEDLING_STARS } from './analyze.js';
import { StarcropError, BudgetError } from './errors.js';
import { iso, t, DAY } from './stats.js';

const STAR_JSON = 'application/vnd.github.star+json';
const RAW = 'application/vnd.github.raw';
const README_MAX = 64 * 1024;
const STEPS = ['resolve', 'repo', 'siblings', 'cohort', 'seeds', 'starred', 'profiles', 'soil', 'twins', 'score'];

const q = (s) => encodeURIComponent(s).replace(/%20/g, '+');
const ENGAGED = new Set(['IssuesEvent', 'PullRequestEvent', 'IssueCommentEvent', 'PullRequestReviewEvent', 'PullRequestReviewCommentEvent']);
const isBot = (login) => !login || /\[bot\]$/i.test(login);
/** A repo older than this is "mature": its oldest forks are long dormant, so recent star events lead the sample. */
export const MATURE_DAYS = 30;
/** Seed plan per door, in priority order: [via, max seeds, starred pages]. Pages for 'fork' etc. follow the target's age. */
export function seedPlan(mature) {
  return mature
    ? [['star-event', 12, 1], ['fork', 4, 2], ['engaged', 3, 1], ['cohort', 4, 2], ['sibling-owner', 4, 2], ['known-planter', 4, 2]]
    : [['fork', 10, 1], ['cohort', 4, 1], ['sibling-owner', 4, 1], ['known-planter', 4, 1], ['star-event', 4, 1], ['engaged', 2, 1]];
}

/** Pure: the public events feed -> recent stargazers (WatchEvent actors) and engaged accounts (issue/PR authors, commenters, reviewers). */
export function eventDoors(events, ownerLogin = '') {
  const own = String(ownerLogin).toLowerCase();
  const stars = [], engaged = [], seen = new Set(), seenE = new Set();
  let n = 0;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e?.actor?.login) continue;
    n++;
    const l = e.actor.login, k = l.toLowerCase();
    if (isBot(l) || k === own) continue;
    if (e.type === 'WatchEvent') { if (!seen.has(k)) { seen.add(k); stars.push({ login: l, id: e.actor.id ?? null, at: e.created_at ?? null }); } }
    else if (ENGAGED.has(e.type) && !seenE.has(k)) { seenE.add(k); engaged.push({ login: l, id: e.actor.id ?? null, at: e.created_at ?? null }); }
  }
  return { events: n, stars, engaged: engaged.filter((x) => !seen.has(x.login.toLowerCase())) };
}
const lastPage = (link) => { const m = link && link.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/); return m ? Number(m[1]) : null; };

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/**
 * @param {string} target mint, GitHub URL or owner/repo
 * @param {import('./index.js').SurveyOptions} [opts]
 * @returns {Promise<import('./index.js').RawSurvey>}
 */
export async function collect(target, opts = {}) {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 20000;
  const deadline = started + budgetMs;
  const maxSeeds = opts.maxSeeds ?? 20;
  const maxStarredCalls = opts.maxStarredCalls ?? 28;
  const gh = githubClient({ token: opts.token, fetch: opts.fetch, deadline });
  const trace = [];
  const limits = [];
  let partial = false;
  let rateLimited = null;
  const BUDGET_LIMIT = 'PARTIAL: the time budget ran out; unfinished signals are null (not measured).';
  const budgetRanOut = () => { partial = true; if (!limits.includes(BUDGET_LIMIT)) limits.push(BUDGET_LIMIT); };
  /** A failure that means "out of time", not "GitHub said no": the survey returns what it has instead of failing. */
  const outOfTime = (e) => e instanceof BudgetError || (e instanceof StarcropError && e.timeout === true);
  /** Timeouts/aborts that escaped the client (a custom fetch, a stalled stream) become the library's own errors. */
  const own = (e) => (e?.name === 'TimeoutError' || e?.name === 'AbortError' ? wireError(e, { host: 'GitHub', deadline, budgetBound: false, phase: 'body' }) : e);

  /** Run a step, timing it and counting its GitHub calls. Budget, timeout, rate-limit and upstream failures inside `soft` steps become null. */
  async function step(name, fn, { soft = true } = {}) {
    const t0 = Date.now();
    let calls = 0;
    const g = { get: (path, o) => { calls++; return gh.get(path, o); } };
    try { return await fn(g); }
    catch (e0) {
      const e = own(e0);
      if (!soft) throw e;
      if (e instanceof BudgetError) budgetRanOut();
      else if (e instanceof StarcropError && e.code === 'RATE_LIMITED') { partial = true; rateLimited = e; }
      else if (e instanceof StarcropError && e.code === 'UPSTREAM') { partial = true; }
      else if (!(e instanceof StarcropError)) throw e;
      return null;
    } finally {
      const prev = trace.find((x) => x.step === name);
      if (prev) { prev.calls += calls; prev.ms += Date.now() - t0; } else trace.push({ step: name, calls, ms: Date.now() - t0 });
    }
  }

  // 1) resolve
  let resolveCalls = 0, heliusCredits = 0;
  const t0 = Date.now();
  const resolved = await resolveRepo(target, { rpcUrl: opts.rpcUrl, fetch: opts.fetch, deadline });
  resolveCalls = resolved.calls; heliusCredits = resolved.heliusCredits;
  trace.push({ step: 'resolve', calls: resolveCalls, ms: Date.now() - t0 });
  if (!resolved.fullName) {
    const tk = resolved.token || { name: '', symbol: '' };
    throw new StarcropError('NO_REPO', `${tk.symbol ? '$' + tk.symbol : 'This token'} links no GitHub repository (checked metadata, DexScreener and pump.fun).`, { token: { mint: resolved.mint, name: tk.name, symbol: tk.symbol } });
  }
  const input = { q: String(target).trim(), kind: resolved.kind, mint: resolved.mint, token: resolved.token, note: resolved.note };
  /** @type {import('./index.js').RawSurvey} */
  let raw;

  // 2) repo + owner (hard requirements: a 404, a rate limit or a GitHub error fails the survey). Running out of
  // time does not: without the repo the report is UNSURVEYED with nothing measured; without the owner it goes on.
  let repoJ;
  try {
    repoJ = await step('repo', async (g) => (await g.get(`/repos/${resolved.fullName}`)).body, { soft: false });
  } catch (e) {
    if (!outOfTime(e)) throw e;
    partial = true;
    limits.push('PARTIAL: the time budget ran out before GitHub returned the repository; no signal was measured.');
    raw = {
      v: 1, checkedAt: iso(opts.now ?? started), source: 'live', partial: true, input, cutShort: 'repo',
      repo: { fullName: resolved.fullName, description: null, createdAt: null, pushedAt: null, stars: null, forks: null, sizeKb: null, language: null },
      owner: null, commits: null, siblings: null, cohort: { computed: false }, seeds: [], doors: null, starred: {}, profiles: {}, readmes: {}, known: null, trace, cost: null, limits,
    };
    return finish();
  }
  const fullName = repoJ.full_name;
  const repo = {
    fullName, description: repoJ.description ?? null, createdAt: repoJ.created_at, pushedAt: repoJ.pushed_at ?? null,
    stars: repoJ.stargazers_count, forks: repoJ.forks_count, sizeKb: repoJ.size, language: repoJ.language ?? null,
  };
  const createdMs = t(repo.createdAt);
  const ownerP = step('repo', async (g) => {
    const u = (await g.get(`/users/${repoJ.owner.login}`)).body;
    return { login: u.login, id: u.id, createdAt: u.created_at, followers: u.followers, publicRepos: u.public_repos, type: u.type };
  }, { soft: false }).catch((e) => { if (!outOfTime(e)) throw e; budgetRanOut(); return null; });
  const knownP = opts.knownPlanters ? Promise.resolve(opts.knownPlanters(fullName)).catch(() => null) : Promise.resolve(null);

  raw = {
    v: 1, checkedAt: iso(opts.now ?? started), source: 'live', partial: false, input, repo, owner: null, commits: null,
    siblings: null, cohort: { computed: false }, seeds: [], doors: null, starred: {}, profiles: {}, readmes: {}, known: null, trace, cost: null, limits,
  };

  if (repo.stars < SEEDLING_STARS) {
    raw.owner = await ownerP;
    raw.known = await knownP;
    return finish();
  }

  // 3) siblings (+ control), cohort (+ control), forks, commit count, READMEs: all in parallel
  const minStars = Math.max(10, Math.floor(repo.stars / 2));
  const win = (ms, pad) => `${iso(ms - pad)}..${iso(ms + pad)}`;
  const siblingsP = step('siblings', async (g) => {
    const [a, b] = await Promise.all([
      g.get(`/search/repositories?q=${q(`created:${win(createdMs, 30e3)} stars:>=${minStars}`)}&per_page=50`, { search: true }),
      g.get(`/search/repositories?q=${q(`created:${win(createdMs - DAY, 30e3)} stars:>=${minStars}`)}&per_page=1`, { search: true }),
    ]);
    return {
      from: iso(createdMs - 30e3), to: iso(createdMs + 30e3), minStars, total: a.body.total_count, controlCount: b.body.total_count,
      items: a.body.items.map((x) => ({ fullName: x.full_name, createdAt: x.created_at, stars: x.stargazers_count, forks: x.forks_count, ownerLogin: x.owner.login, ownerId: x.owner.id, description: x.description ?? null })),
    };
  });
  const cohortP = ownerP.then((owner) => {
    if (!owner || owner.followers > 2) return { computed: false };
    return step('cohort', async (g) => {
      const bornMs = t(owner.createdAt);
      const minRepos = Math.max(5, Math.floor(owner.publicRepos / 2));
      const query = `created:${win(bornMs, 6 * 60e3)} repos:>=${minRepos} followers:0`;
      const [a, b] = await Promise.all([
        g.get(`/search/users?q=${q(query)}&per_page=100`, { search: true }),
        g.get(`/search/users?q=${q(`created:${win(bornMs - DAY, 6 * 60e3)} repos:>=${minRepos} followers:0`)}&per_page=1`, { search: true }),
      ]);
      return { computed: true, from: iso(bornMs - 6 * 60e3), to: iso(bornMs + 6 * 60e3), query, minRepos, total: a.body.total_count, controlCount: b.body.total_count, items: a.body.items.map((x) => ({ login: x.login, id: x.id })) };
    }).then((r) => r || { computed: false });
  });
  const forksP = step('seeds', async (g) => (await g.get(`/repos/${fullName}/forks?sort=oldest&per_page=100`)).body.map((f) => ({ login: f.owner.login, id: f.owner.id })));
  // DOOR 5/6: the public events feed (last 90 days, max 300 events): WatchEvent actors are recent stargazers,
  // issue/PR/comment actors are engaged accounts. 2 pages for a mature repo, 1 otherwise.
  const mature = (opts.now ?? started) - createdMs > MATURE_DAYS * DAY;
  const evPages = mature ? 2 : 1;
  const eventsP = step('seeds', async (g) => {
    const res = await Promise.all(Array.from({ length: evPages }, (_, i) => g.get(`/repos/${fullName}/events?per_page=100&page=${i + 1}`, { allow404: true }).catch((e) => {
      if (i > 0 && e instanceof StarcropError && e.code === 'UPSTREAM') return null; // page 2 past the end answers 422
      throw e;
    })));
    const all = res.flatMap((r) => (Array.isArray(r?.body) ? r.body : []));
    return { pages: evPages, ...eventDoors(all, repoJ.owner.login) };
  });
  const commitsP = step('soil', async (g) => {
    const r = await g.get(`/repos/${fullName}/commits?per_page=1`, { allow409: true });
    if (!r) return 0;
    return lastPage(r.headers.get('link')) ?? r.body.length;
  });
  const readmesP = siblingsP.then((sib) => {
    const targets = [{ fullName, description: repo.description }];
    for (const x of (sib?.items || []).filter((x) => x.fullName !== fullName).sort((a, b) => Math.abs(t(a.createdAt) - createdMs) - Math.abs(t(b.createdAt) - createdMs)).slice(0, 4)) targets.push(x);
    return step('twins', async (g) => {
      const out = {};
      await Promise.all(targets.map(async (x) => {
        try {
          const r = await g.get(`/repos/${x.fullName}/readme`, { accept: RAW, text: true, allow404: true });
          out[x.fullName] = r ? { text: r.body.slice(0, README_MAX) } : null;
        } catch (e) { if (e instanceof BudgetError || e instanceof StarcropError) out[x.fullName] = null; else throw e; }
      }));
      return out;
    }).then((r) => r || {});
  });

  const [owner, siblings, cohort, forks, known, events] = await Promise.all([ownerP, siblingsP, cohortP, forksP, knownP, eventsP]);
  raw.owner = owner; raw.siblings = siblings; raw.cohort = cohort; raw.known = known;

  // 4) seeds, door by door in the plan's order (mature repos lead with recent star events), capped at maxSeeds
  const lists = {
    fork: forks || [],
    cohort: cohort?.computed ? [...cohort.items].sort((a, b) => Math.abs(a.id - owner.id) - Math.abs(b.id - owner.id)) : [],
    'sibling-owner': siblings ? siblings.items.filter((x) => x.fullName !== fullName).sort((a, b) => Math.abs(t(a.createdAt) - createdMs) - Math.abs(t(b.createdAt) - createdMs)).map((x) => ({ login: x.ownerLogin, id: x.ownerId })) : [],
    'known-planter': known?.seeds?.length ? known.seeds.map((s) => (typeof s === 'string' ? { login: s, id: null } : s)) : [],
    'star-event': events?.stars || [],
    engaged: events?.engaged || [],
  };
  const seen = new Set([(owner?.login ?? repoJ.owner.login).toLowerCase()]);
  const seeds = [];
  const pagesOf = {};
  const plan = seedPlan(mature);
  let starredCalls = 0;
  for (const [via, max, pages] of plan) {
    let n = 0;
    for (const s of lists[via]) {
      if (seeds.length >= maxSeeds || n >= max || starredCalls + pages > maxStarredCalls) break;
      if (!s?.login || isBot(s.login) || seen.has(s.login.toLowerCase())) continue;
      seen.add(s.login.toLowerCase()); seeds.push({ login: s.login, id: s.id ?? null, via }); pagesOf[s.login] = pages; starredCalls += pages; n++;
    }
  }
  raw.seeds = seeds;
  raw.doors = {
    mature, maxSeeds, maxStarredCalls, plan: plan.map(([via, max, pages]) => ({ via, max, pages, available: lists[via].length })),
    events: events ? { pages: events.pages, events: events.events, starActors: events.stars.length, engagedActors: events.engaged.length } : null,
  };

  // 5) reverse stargazing: /users/{u}/starred with starred_at (pages per door: see seedPlan)
  await step('starred', async (g) => {
    await pool(seeds, Math.max(1, maxSeeds), async (s) => {
      const items = [];
      const pages = pagesOf[s.login] ?? 1;
      try {
        const res = await Promise.all(Array.from({ length: pages }, (_, i) => g.get(`/users/${s.login}/starred?per_page=100&page=${i + 1}`, { accept: STAR_JSON, allow404: true })));
        if (res.some((r) => r === null)) { raw.starred[s.login] = null; return; }
        for (const r of res) for (const x of r.body) {
          if (!x?.repo) continue;
          items.push({ repo: x.repo.full_name, at: x.starred_at, stars: x.repo.stargazers_count, createdAt: x.repo.created_at });
          if (s.id == null && x.repo.owner?.login === s.login) s.id = x.repo.owner.id;
        }
        raw.starred[s.login] = { pages, items };
      } catch (e) {
        if (e instanceof BudgetError || (e instanceof StarcropError && e.code !== 'NOT_FOUND')) { partial = true; raw.starred[s.login] = null; if (e.code === 'RATE_LIMITED') rateLimited = e; return; }
        throw e;
      }
    });
  });

  // 6) profiles of the first 8 confirmed stargazers (seed order); they also anchor the id clock
  const key = fullName.toLowerCase();
  const confirmed = seeds.filter((s) => raw.starred[s.login]?.items.some((x) => x.repo.toLowerCase() === key));
  const [, commits, readmes] = await Promise.all([
    step('profiles', async (g) => {
      await pool(confirmed.slice(0, 8), 8, async (s) => {
        try {
          const r = await g.get(`/users/${s.login}`, { allow404: true });
          if (r) { raw.profiles[s.login] = { id: r.body.id, createdAt: r.body.created_at, followers: r.body.followers, publicRepos: r.body.public_repos }; s.id ??= r.body.id; }
        } catch (e) { if (e instanceof BudgetError || e instanceof StarcropError) { partial = true; return; } throw e; }
      });
    }),
    commitsP, readmesP,
  ]);
  raw.commits = commits;
  raw.readmes = readmes || {};
  // seeds whose id we never learned (known planters without a star on their own repo): fill from profiles
  for (const s of seeds) if (s.id == null && raw.profiles[s.login]) s.id = raw.profiles[s.login].id;
  return finish();

  function finish() {
    if (rateLimited) limits.push(`PARTIAL: GitHub rate limit hit (retry in ${rateLimited.retryAfter} s); unfinished signals are null.`);
    raw.partial = partial;
    raw.seeds = raw.seeds.filter((s) => s.id != null);
    trace.push({ step: 'score', calls: 0, ms: 0 });
    trace.sort((a, b) => STEPS.indexOf(a.step) - STEPS.indexOf(b.step));
    raw.cost = { githubCore: gh.cost.core, githubSearch: gh.cost.search, heliusCredits };
    raw.elapsedMs = Date.now() - started;
    return raw;
  }
}

/**
 * Survey a repo (or the repo a mint links) and return its crop report.
 * @param {string} target
 * @param {import('./index.js').SurveyOptions} [opts]
 */
export async function survey(target, opts = {}) {
  const raw = await collect(target, opts);
  const t0 = Date.now();
  const report = analyze(raw);
  const s = report.trace.find((x) => x.step === 'score');
  if (s) s.ms = Date.now() - t0;
  return report;
}
