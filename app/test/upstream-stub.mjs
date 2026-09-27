// A synthetic upstream for offline tests: GitHub REST (repos, users, search, forks, events, commits, readme, starred),
// DexScreener token profiles and pump.fun coins. Bodies are compact JSON with GitHub's key order, big repo objects
// included, so the slim extractors meet what they meet in production. Every account is a sample-owner-NN /
// sample-user-NN placeholder; no real person or project is named.
export const NOW = Date.parse('2026-09-20T12:00:00Z');
export const TARGET = 'sample-owner-01/crop';
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const CREATED = Date.parse('2026-09-18T10:00:00Z');
const BORN = Date.parse('2026-07-21T23:50:00Z');
const n2 = (i) => String(i).padStart(2, '0');

/** A repo object in the order GitHub sends its keys (owner first login, then id). */
export function repoObject({ owner, ownerId, name, id, stars = 30, createdAt = '2026-09-10T08:00:00Z', description = null, size = 120, forks = 0 }) {
  return {
    id, node_id: `R_kgDO${id}`, name, full_name: `${owner}/${name}`, private: false,
    owner: {
      login: owner, id: ownerId, node_id: `U_kgDO${ownerId}`, avatar_url: `https://avatars.githubusercontent.com/u/${ownerId}?v=4`, gravatar_id: '',
      url: `https://api.github.com/users/${owner}`, html_url: `https://github.com/${owner}`, followers_url: `https://api.github.com/users/${owner}/followers`,
      starred_url: `https://api.github.com/users/${owner}/starred{/owner}{/repo}`, repos_url: `https://api.github.com/users/${owner}/repos`, type: 'User', user_view_type: 'public', site_admin: false,
    },
    html_url: `https://github.com/${owner}/${name}`, description, fork: false, url: `https://api.github.com/repos/${owner}/${name}`,
    forks_url: `https://api.github.com/repos/${owner}/${name}/forks`, stargazers_url: `https://api.github.com/repos/${owner}/${name}/stargazers`,
    created_at: createdAt, updated_at: createdAt, pushed_at: createdAt, git_url: `git://github.com/${owner}/${name}.git`, homepage: null,
    size, stargazers_count: stars, watchers_count: stars, language: 'TypeScript', has_issues: true, has_projects: true, forks_count: forks,
    archived: false, disabled: false, open_issues_count: 0,
    license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT', url: 'https://api.github.com/licenses/mit', node_id: 'MDc6TGljZW5zZTEz' },
    allow_forking: true, is_template: false, topics: ['sample', 'crop'], visibility: 'public', forks, open_issues: 0, watchers: stars, default_branch: 'main',
  };
}

// descriptions that would trip a careless extractor: quotes, backslashes, key-like text, non-ASCII
const TRICKY = ['He said "hi" \\ C:\\path', 'not a key: "created_at":"2001-01-01T00:00:00Z", "stargazers_count":7', 'naïve 🌾 field', null, '{"starred_at":"x"}'];
const FIELD = Array.from({ length: 5 }, (_, i) => ({ owner: `sample-owner-${n2(20 + i)}`, ownerId: 950020 + i, name: `seed-${i}`, id: 7000 + i, description: TRICKY[i] }));
// ids near the id clock's 2026-07-21 anchor, so accounts without a fetched profile still date to that evening
export const OWNER_ID = 307725700;
export const FARM = Array.from({ length: 12 }, (_, i) => ({ login: `sample-user-${n2(i + 1)}`, id: 307725801 + i * 90 }));

function starredOf(u, i) {
  const t0 = CREATED + 3600e3 + i * 7e3;
  const items = [
    { starred_at: iso(t0), repo: repoObject({ owner: 'sample-owner-01', ownerId: OWNER_ID, name: 'crop', id: 4242, stars: 60, createdAt: iso(CREATED), size: 20, description: 'a "sample" crop' }) },
    ...FIELD.map((f, k) => ({ starred_at: iso(t0 + (k + 1) * 11e3), repo: repoObject({ ...f, stars: 40 + k }) })),
    { starred_at: iso(t0 - 86400e3), repo: repoObject({ owner: `sample-owner-${n2(40 + i)}`, ownerId: 960000 + i, name: 'own-path', id: 8000 + i }) },
  ];
  return items.sort((a, b) => Date.parse(b.starred_at) - Date.parse(a.starred_at));
}

const json = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '4000', ...headers } });

/**
 * @param {{ rateLimitAfter?: number, always429?: boolean, flaky?: boolean }} [o]
 *   rateLimitAfter: GitHub answers 403 + x-ratelimit-remaining 0 after that many GitHub requests;
 *   always429: every upstream answers 429 (retry-after 1);
 *   flaky: the first request to each GitHub URL gets a secondary rate limit (403, retry-after 1), the retry succeeds,
 *   and the first request to each other URL gets a 429: every call costs two requests (the retry worst case)
 */
export function createUpstream({ rateLimitAfter = Infinity, always429 = false, flaky = false } = {}) {
  const calls = [];
  const tried = new Set();
  let gh = 0;
  function answer(url, init = {}) {
    const u = new URL(url);
    if (always429) return json({ message: 'slow down' }, 429, { 'retry-after': '1', 'x-ratelimit-remaining': '10' });
    if (flaky && !tried.has(url)) {
      tried.add(url);
      if (u.host === 'api.github.com') { gh++; return json({ message: 'You have exceeded a secondary rate limit.' }, 403, { 'retry-after': '1', 'x-ratelimit-remaining': '10' }); }
      return json({ message: 'slow down' }, 429);
    }
    if (u.host === 'api.dexscreener.com' && u.pathname === '/token-profiles/latest/v1') {
      return json([
        { chainId: 'solana', tokenAddress: 'Samp1eMint1111111111111111111111111111111pump', links: [{ type: 'github', url: `https://github.com/${TARGET}` }] },
        { chainId: 'solana', tokenAddress: 'Samp1eMint2222222222222222222222222222222pump', description: 'code at github.com/sample-owner-02/tool' },
        { chainId: 'base', tokenAddress: '0xsample', links: [{ url: 'https://github.com/sample-owner-09/other' }] },
      ]);
    }
    if (u.host === 'api.dexscreener.com') return json([]);
    if (u.host === 'frontend-api-v3.pump.fun') return json([]);
    if (u.host !== 'api.github.com') return json({ error: 'unknown host' }, 404);
    gh++;
    if (gh > rateLimitAfter) return json({ message: 'API rate limit exceeded for 203.0.113.9.' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 900) });
    const p = u.pathname;
    let m;
    if (p === '/repos/sample-owner-01/crop-old') return new Response(null, { status: 301, headers: { location: 'https://api.github.com/repositories/4242' } });
    if (p === '/repos/sample-owner-01/crop' || p === '/repositories/4242') return json(repoObject({ owner: 'sample-owner-01', ownerId: OWNER_ID, name: 'crop', id: 4242, stars: 60, createdAt: iso(CREATED), size: 20, forks: 12, description: 'a "sample" crop' }));
    if (p === '/repos/sample-owner-01/crop/forks') return json(FARM.map((f, i) => repoObject({ owner: f.login, ownerId: f.id, name: 'crop', id: 5000 + i, createdAt: iso(CREATED + 600e3 + i * 1e3), description: TRICKY[i % TRICKY.length] })));
    if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/events$/))) return json([]);
    if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/commits$/))) return json([{ sha: 'a1' }], 200, { link: `<https://api.github.com${p}?per_page=1&page=2>; rel="next", <https://api.github.com${p}?per_page=1&page=3>; rel="last"` });
    if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/readme$/))) return new Response('# crop\n\nA sample readme.\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    if ((m = p.match(/^\/repos\/([^/]+)\/([^/]+)\/forks$/))) return json([]);
    if ((m = p.match(/^\/repos\/([^/]+)\/([^/]+)$/))) return json(repoObject({ owner: m[1], ownerId: 990000 + m[1].length, name: m[2], id: 9000 + m[2].length, stars: 30 }));
    if (p === '/search/repositories') {
      const q = u.searchParams.get('q') || '';
      if (q.includes('..')) return json({ total_count: 0, incomplete_results: false, items: [] });
      return json({ total_count: 1, incomplete_results: false, items: [repoObject({ owner: 'sample-owner-03', ownerId: 900003, name: 'fresh', id: 6003, stars: 400 })] });
    }
    if (p === '/search/users') {
      const q = u.searchParams.get('q') || '';
      const control = u.searchParams.get('per_page') === '1';
      return json(control ? { total_count: 0, items: [] } : { total_count: FARM.length, items: FARM.map((f) => ({ login: f.login, id: f.id, type: 'User' })) });
    }
    if ((m = p.match(/^\/users\/([^/]+)\/starred$/))) {
      const i = FARM.findIndex((f) => f.login === m[1]);
      if (i < 0) return json([]);
      return json(starredOf(FARM[i], i));
    }
    if ((m = p.match(/^\/users\/([^/]+)$/))) {
      const login = m[1];
      if (login === 'sample-owner-01') return json({ login, id: OWNER_ID, type: 'User', created_at: iso(BORN), followers: 0, public_repos: 12 });
      const i = FARM.findIndex((f) => f.login === login);
      if (i >= 0) return json({ login, id: FARM[i].id, type: 'User', created_at: iso(BORN + (i + 1) * 20e3), followers: 0, public_repos: 3 });
      return json({ login, id: 990000 + login.length, type: 'User', created_at: '2015-01-01T00:00:00Z', followers: 50, public_repos: 40 });
    }
    return json({ message: 'Not Found' }, 404);
  }
  /** fetch(): follows redirects unless init.redirect === 'manual' (like the platform fetch). */
  async function fetch(input, init = {}) {
    let url = typeof input === 'string' ? input : input.url;
    for (let hop = 0; hop < 5; hop++) {
      calls.push({ url, method: init.method || 'GET', auth: new Headers(init.headers).get('authorization') });
      const res = answer(url, init);
      const loc = res.status >= 300 && res.status < 400 && res.headers.get('location');
      if (!loc || init.redirect === 'manual') return res;
      url = new URL(loc, url).href;
    }
    throw new TypeError('too many redirects');
  }
  return { fetch, calls, get github() { return gh; } };
}
