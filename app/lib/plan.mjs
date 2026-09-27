// What one invocation (an HTTP request or one run of the scheduled survey) may spend upstream.
//
// Netlify and Cloudflare Workers Paid: no cap; a survey reads up to 28 starred-list pages (the library default) and the
// scheduled survey does everything each run (fresh candidates, 10 planters, up to 3 surveys).
//
// Cloudflare Workers Free (CF_FREE_PLAN=1, set in wrangler.jsonc): an invocation gets at most 50 subrequests and 10 ms
// of CPU. So on that plan:
//   - every external fetch is counted (redirect hops and retries included) and the one past SURVEY_FETCH_BUDGET (45)
//     is refused, which the survey treats like a spent time budget (a partial report, never a crash);
//   - a survey reads at most SURVEY_STARRED_PAGES (12) starred-list pages, and the report says so in `limits`;
//   - big GitHub lists (starred pages, forks) are cut down to the fields the library reads before JSON.parse;
//   - the scheduled survey keeps a cursor in the store and does one heavy step per run: the planter refresh
//     (at most once an hour) or one survey from the queue (candidate feeds refresh at most once an hour).
export const FULL_STARRED_PAGES = 28; // the library's default maxStarredCalls
export const FREE_FETCH_BUDGET = 45;  // Cloudflare's free plan allows 50 subrequests per invocation; keep 5 spare
export const FREE_STARRED_PAGES = 12;

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
function num(env, k, d) {
  const raw = env[k];
  if (raw == null || String(raw).trim() === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : d;
}

/**
 * @param {Record<string, string|undefined>} [env] process.env by default
 * @returns {{ free: boolean, maxFetches: number, starredPages: number, slim: boolean,
 *   job: { surveys: number, planters: number, feedsEveryMs: number, plantersEveryMs: number, onePhase: boolean, keepCursor: boolean } }}
 */
export function plan(env = process.env) {
  const free = truthy(env.CF_FREE_PLAN);
  return {
    free,
    maxFetches: num(env, 'SURVEY_FETCH_BUDGET', free ? FREE_FETCH_BUDGET : Infinity),
    starredPages: num(env, 'SURVEY_STARRED_PAGES', free ? FREE_STARRED_PAGES : FULL_STARRED_PAGES),
    slim: free,
    job: free
      ? { surveys: 1, planters: 10, feedsEveryMs: 3600e3, plantersEveryMs: 3600e3, onePhase: true, keepCursor: true }
      : { surveys: 3, planters: 10, feedsEveryMs: 0, plantersEveryMs: 0, onePhase: false, keepCursor: false },
  };
}

/** True when this plan needs the counting fetch (lib/upstream.mjs): a fetch cap or slim parsing. */
export const needsBudget = (p) => Number.isFinite(p.maxFetches) || p.slim;
