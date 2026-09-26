// HTTP clients with a shared deadline. GitHub REST (core + search counted separately), plus plain JSON fetches.
import { StarcropError, BudgetError } from './errors.js';

const UA = 'starcrop (+https://github.com/lkristof55/starcrop)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Per-call timeout: at most 8 s and never past the survey deadline. */
function signalFor(deadline, maxMs = 8000) {
  const left = deadline - Date.now();
  if (left <= 50) throw new BudgetError();
  return { signal: AbortSignal.timeout(Math.min(maxMs, left)), budgetBound: left < maxMs };
}

/** Discard a body we won't read; a stream that already errored (e.g. aborted) must not throw from here. */
async function drain(res) { try { await res.body?.cancel?.(); } catch { /* already errored or locked */ } }

const isAbort = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';

/**
 * Read a body as JSON or text under the same signal as the request. The read races the signal, so a stalled
 * stream can't outlive the deadline even when the fetch implementation does not abort body reads itself.
 * @param {Response} res @param {'json'|'text'} kind @param {AbortSignal} signal
 */
export async function readBody(res, kind, signal) {
  if (signal.aborted) throw signal.reason;
  let onAbort;
  const aborted = new Promise((_, rej) => { onAbort = () => rej(signal.reason); signal.addEventListener('abort', onAbort, { once: true }); });
  try {
    return await Promise.race([kind === 'text' ? res.text() : res.json(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Map any failure after the request left (connect, headers or body) to the library's own errors:
 * StarcropError/BudgetError pass through; a timeout or abort is BudgetError when the survey deadline caused it,
 * else StarcropError UPSTREAM with `timeout: true`; malformed JSON is UPSTREAM; anything else is a network error.
 */
export function wireError(e, { host, deadline, budgetBound, phase = 'answer' }) {
  if (e instanceof StarcropError || e instanceof BudgetError) return e;
  const timedOut = isAbort(e);
  if (timedOut && (budgetBound || Date.now() >= deadline - 50)) return new BudgetError(`time budget ran out while ${host} was still sending its ${phase}`);
  if (e instanceof SyntaxError) return new StarcropError('UPSTREAM', `${host} sent malformed JSON.`);
  const err = new StarcropError('UPSTREAM', phase === 'body'
    ? `${host} stopped sending the response (${timedOut ? 'timeout' : 'network error'}).`
    : `${host} did not answer in time (${timedOut ? 'timeout' : 'network error'}).`);
  if (timedOut) err.timeout = true;
  return err;
}

/**
 * @param {{ token?: string, fetch?: typeof fetch, deadline: number, baseUrl?: string, timeoutMs?: number }} o
 */
export function githubClient({ token, fetch: f = globalThis.fetch, deadline, baseUrl = 'https://api.github.com', timeoutMs = 8000 }) {
  const cost = { core: 0, search: 0 };
  let rateLimitedUntil = 0;

  /**
   * @param {string} path
   * @param {{ accept?: string, search?: boolean, text?: boolean, allow404?: boolean, allow409?: boolean }} [o]
   */
  async function get(path, o = {}) {
    for (let attempt = 0; ; attempt++) {
      const { signal, budgetBound } = signalFor(deadline, timeoutMs);
      o.search ? cost.search++ : cost.core++;
      const headers = { accept: o.accept || 'application/vnd.github+json', 'user-agent': UA, 'x-github-api-version': '2022-11-28' };
      if (token) headers.authorization = `Bearer ${token}`;
      let res;
      try {
        res = await f(baseUrl + path, { headers, signal });
      } catch (e) {
        throw wireError(e, { host: 'GitHub', deadline, budgetBound });
      }
      if (res.status === 404 || res.status === 451) { await drain(res); if (o.allow404) return null; throw new StarcropError('NOT_FOUND', `GitHub has no ${path.startsWith('/users/') ? 'account' : 'repository'} at ${path.split('/').slice(2, 4).join('/')}.`); }
      if (res.status === 409 && o.allow409) { await drain(res); return null; }
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const ra = Number(res.headers.get('retry-after'));
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        if (res.status === 429 || remaining === '0' || ra) {
          const retryAfter = ra || (reset ? Math.max(1, Math.ceil(reset - Date.now() / 1000)) : 60);
          await drain(res);
          // Short secondary-limit waits are retried once with backoff if the budget allows.
          if (attempt === 0 && retryAfter <= 2 && deadline - Date.now() > retryAfter * 1000 + 1500) { await sleep(retryAfter * 1000 + 250); continue; }
          rateLimitedUntil = Date.now() + retryAfter * 1000;
          throw new StarcropError('RATE_LIMITED', `GitHub ${o.search ? 'search' : 'API'} budget is used up; retry in ${retryAfter} s.`, { retryAfter });
        }
      }
      if (!res.ok) { await drain(res); throw new StarcropError('UPSTREAM', `GitHub answered HTTP ${res.status}.`); }
      // The body streams after the headers: the same signal still runs, so a slow download is a timeout too.
      try {
        return { body: await readBody(res, o.text ? 'text' : 'json', signal), headers: res.headers };
      } catch (e) {
        throw wireError(e, { host: 'GitHub', deadline, budgetBound, phase: 'body' });
      }
    }
  }
  return { get, cost, get rateLimitedUntil() { return rateLimitedUntil; } };
}

/** JSON GET/POST with timeout and one retry on 429. Returns null on 404 or when `soft` and anything fails. */
export async function fetchJson(url, { fetch: f = globalThis.fetch, deadline = Date.now() + 8000, method = 'GET', body, soft = false, headers = {} } = {}) {
  const host = new URL(url).host;
  for (let attempt = 0; attempt < 2; attempt++) {
    let budgetBound = false, phase = 'answer';
    try {
      const s = signalFor(deadline);
      budgetBound = s.budgetBound;
      const res = await f(url, { method, signal: s.signal, headers: { accept: 'application/json', 'user-agent': UA, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      if (res.status === 429 && attempt === 0) { await drain(res); await sleep(800); continue; }
      if (res.status === 404) { await drain(res); return null; }
      if (!res.ok) { await drain(res); if (soft) return null; throw new StarcropError('UPSTREAM', `${host} answered HTTP ${res.status}.`); }
      phase = 'body';
      const text = await readBody(res, 'text', s.signal);
      try { return JSON.parse(text); } catch { if (soft) return null; throw new StarcropError('UPSTREAM', `${host} did not return JSON.`); }
    } catch (e) {
      const err = wireError(e, { host, deadline, budgetBound, phase });
      if (soft || err instanceof BudgetError) return null;
      throw err;
    }
  }
  return null;
}
