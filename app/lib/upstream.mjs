// A fetch for one invocation (lib/plan.mjs decides when it is used; on Netlify it is not):
//  - Counts every external request, redirect hops included (Cloudflare counts each hop as a subrequest), and refuses
//    the one past `maxFetches` with the library's BudgetError. The library treats that like a spent time budget: what
//    is left is marked not measured (partial report). fetchJson (resolve, feeds) returns null for it.
//  - slim: a starred-list page or a forks page from api.github.com is cut down to the fields the library reads before
//    anything JSON.parses it. A page of 100 starred repos is roughly 500 KB of JSON; the fields read are ~20 KB. The extractor
//    checks every value it takes and returns the page untouched when anything looks unexpected, so the library sees
//    the same values either way (test/upstream.test.mjs).
//  - After GitHub answers 403/429 with x-ratelimit-remaining: 0, later GitHub requests in the same invocation get that
//    answer back without being sent: they would be refused too, and each one would cost a subrequest.
import { BudgetError } from '../../src/index.js';
import { readBody } from '../../src/http.js';

const GITHUB = 'api.github.com';
const MAX_REDIRECTS = 3;
const STRIP = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
const headersOf = (res) => [...res.headers].filter(([k]) => !STRIP.has(k.toLowerCase()));
async function drain(res) { try { await res.body?.cancel?.(); } catch { /* already errored */ } }

/** Which slim extractor applies to a GitHub URL: 'starred' (star+json media type only), 'forks' or null. */
export function slimKind(url, accept = '') {
  const u = new URL(url);
  if (u.host !== GITHUB) return null;
  if (/^\/users\/[^/]+\/starred$/.test(u.pathname) && /star\+json/.test(accept)) return 'starred';
  if (/^\/repos\/[^/]+\/[^/]+\/forks$/.test(u.pathname)) return 'forks';
  return null;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const K_STARRED = '{"starred_at":"';
const K_FULL = '"full_name":"';
const K_OWNER = '"owner":{"login":"';
const K_CREATED = '"created_at":"';
const K_STARS = '"stargazers_count":';

/** The JSON string that starts at i (just after its opening quote); null if it holds an escape (not decoded here). */
function strAt(t, i) {
  const j = t.indexOf('"', i);
  if (j < 0) return null;
  const s = t.slice(i, j);
  return s.includes('\\') ? null : s;
}
/** A non-negative integer literal at i, or null. */
function intAt(t, i) {
  let v = 0, j = i;
  for (; j < t.length && j - i < 16; j++) { const c = t.charCodeAt(j) - 48; if (c < 0 || c > 9) break; v = v * 10 + c; }
  return j > i ? v : null;
}
function countOf(t, k) { let n = 0; for (let i = t.indexOf(k); i >= 0; i = t.indexOf(k, i + k.length)) n++; return n; }
/** "owner":{"login":"X","id":N at `ol` -> { login, id } or null. */
function ownerAt(t, ol) {
  const login = strAt(t, ol + K_OWNER.length);
  if (!login || !t.startsWith('","id":', ol + K_OWNER.length + login.length)) return null;
  const id = intAt(t, ol + K_OWNER.length + login.length + 7);
  return id == null ? null : { login, id };
}
const framed = (t) => t[0] === '[' && t[t.length - 1] === ']';
const empty = (t) => /^\[\s*\]$/.test(t);

/**
 * GET /users/{u}/starred (application/vnd.github.star+json) -> [{ starred_at, repo: { full_name, stargazers_count,
 * created_at, owner: { login, id } } }], exactly the values JSON.parse would give for those fields; null when the
 * page does not look as expected (the caller then passes the page on untouched).
 */
export function slimStarred(text) {
  const t = String(text).trim();
  if (!framed(t)) return null;
  const out = [];
  let p = t.indexOf(K_STARRED);
  if (p < 0) return empty(t) ? out : null;
  // Each search starts where the previous one ended (GitHub's key order), so the page is scanned about twice in all:
  // once here and once by the count below.
  while (p >= 0) {
    const at = strAt(t, p + K_STARRED.length);
    const fn = t.indexOf(K_FULL, p);
    const ol = fn < 0 ? -1 : t.indexOf(K_OWNER, fn);
    const ca = ol < 0 ? -1 : t.indexOf(K_CREATED, ol);
    const sc = ca < 0 ? -1 : t.indexOf(K_STARS, ca);
    if (sc < 0) return null;
    const fullName = strAt(t, fn + K_FULL.length);
    const owner = ownerAt(t, ol);
    const createdAt = strAt(t, ca + K_CREATED.length);
    const stars = intAt(t, sc + K_STARS.length);
    if (!at || !ISO.test(at) || !createdAt || !ISO.test(createdAt) || stars == null || !owner || !fullName || !fullName.startsWith(owner.login + '/')) return null;
    out.push({ starred_at: at, repo: { full_name: fullName, stargazers_count: stars, created_at: createdAt, owner } });
    p = t.indexOf(K_STARRED, sc);
  }
  // One full_name per item. If an item lacked a field, the search above took it from the next item and skipped that
  // one; a nested repo object would add one. Either way the counts differ and the page goes to JSON.parse instead.
  if (countOf(t, K_FULL) !== out.length) return null;
  return out;
}

/** GET /repos/{o}/{r}/forks -> [{ owner: { login, id } }] (what the library reads), or null as above. */
export function slimForks(text) {
  const t = String(text).trim();
  if (!framed(t)) return null;
  const out = [];
  let p = t.indexOf(K_FULL);
  if (p < 0) return empty(t) ? out : null;
  while (p >= 0) {
    const fullName = strAt(t, p + K_FULL.length);
    const ol = t.indexOf(K_OWNER, p);
    if (ol < 0) return null;
    const owner = ownerAt(t, ol);
    if (!owner || !fullName || !fullName.startsWith(owner.login + '/')) return null;
    out.push({ owner });
    p = t.indexOf(K_FULL, ol);
  }
  if (countOf(t, K_OWNER) !== out.length) return null;
  return out;
}

/**
 * @param {{ maxFetches?: number, slim?: boolean, fetch?: typeof fetch }} [o]
 * @returns {{ fetch: typeof fetch, maxFetches: number, used: number, refused: number, held: number, slimmed: number, unslimmed: number, hosts: Record<string, number> }}
 */
export function upstreamBudget({ maxFetches = Infinity, slim = false, fetch: f = (...a) => globalThis.fetch(...a) } = {}) {
  const b = { maxFetches, used: 0, refused: 0, held: 0, slimmed: 0, unslimmed: 0, hosts: {} };
  let limited = null; // GitHub's rate-limit answer, replayed for the rest of the invocation

  b.fetch = async function budgetFetch(input, init = {}) {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (limited && new URL(url).host === GITHUB) { b.held++; return new Response(limited.body, { status: limited.status, headers: limited.headers }); }
    const method = String(init.method || 'GET').toUpperCase();
    let headers = init.headers;
    let res;
    for (let hop = 0; ; hop++) {
      if (b.used >= maxFetches) { b.refused++; throw new BudgetError(`the budget of ${maxFetches} upstream requests per invocation is spent`); }
      b.used++;
      const host = new URL(url).host;
      b.hosts[host] = (b.hosts[host] || 0) + 1;
      res = await f(url, { ...init, headers, redirect: 'manual' });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc || hop >= MAX_REDIRECTS || (method !== 'GET' && method !== 'HEAD')) break;
      await drain(res);
      const next = new URL(loc, url);
      if (next.origin !== new URL(url).origin) { headers = new Headers(headers); headers.delete('authorization'); }
      url = next.href;
    }
    const host = new URL(url).host;
    if (host === GITHUB && (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      const body = await res.text().catch(() => '');
      limited = { status: res.status, headers: headersOf(res), body };
      return new Response(body, { status: limited.status, headers: limited.headers });
    }
    if (slim && res.status === 200) {
      const kind = slimKind(url, new Headers(init.headers).get('accept') || '');
      if (kind) {
        const text = init.signal ? await readBody(res, 'text', init.signal) : await res.text();
        const items = kind === 'starred' ? slimStarred(text) : slimForks(text);
        if (items) b.slimmed++; else b.unslimmed++;
        return new Response(items ? JSON.stringify(items) : text, { status: 200, headers: headersOf(res) });
      }
    }
    return res;
  };
  return b;
}
