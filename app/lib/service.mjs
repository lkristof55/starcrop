// The service around the starcrop library (repo root src/): caching, the field index, recent/surveyed lists, the featured report.
// Functions in netlify/functions/ are thin HTTP wrappers over these.
import { survey, parseTarget, summarize, StarcropError } from '../../src/index.js';
import { getStore } from './store.mjs';
import reference from './reference-report.mjs';
import { repoKey, plantsField, assignField, mergeField, fieldSummary, prepend, upsertFieldList } from './fields.mjs';
import { surveyOptions } from './sources.mjs';
import { plan as currentPlan, needsBudget, FULL_STARRED_PAGES } from './plan.mjs';
import { upstreamBudget } from './upstream.mjs';

export const REPORT_TTL_MS = 6 * 3600e3;   // contract cacheSeconds 21600
export const PARTIAL_TTL_MS = 15 * 60e3;   // a partial record stays in the store 15 min: the scheduled survey skips it that long
export const PARTIAL_SERVE_MS = 60e3;      // /api/report answers a partial from cache for 60 s after it was saved (or a re-survey began), then surveys again
export const ALIAS_TTL_MS = 24 * 3600e3;   // renamed repo: requested name -> resolved full name (facebook/react -> react/react)
export const RESOLVE_TTL_MS = 3600e3;
export const REQUEST_BUDGET_MS = 8500;
/** Bump when oss analyze()/collect() change what a report means; cached reports from another version are misses. 2 = star-event door + reason. */
export const REPORT_ALGO = 2;

const mem = new Map();
const memGet = (k) => { const e = mem.get(k); if (!e) return undefined; if (e.exp < Date.now()) { mem.delete(k); return undefined; } return e.v; };
const memSet = (k, v, ttl) => { if (mem.size > 500) mem.delete(mem.keys().next().value); mem.set(k, { v, exp: Date.now() + ttl }); };
export const clearMemo = () => mem.clear();

const store = () => getStore('starcrop');
/** A report cut short before GitHub returned the repo measured nothing: serve it, but never cache, index or list it. */
export const measured = (report) => report?.repo?.stars != null;
const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The library's own line when its time budget ran out (src/survey.js collect()). */
export const LIB_BUDGET_LIMIT = 'PARTIAL: the time budget ran out; unfinished signals are null (not measured).';

/** The counting fetch for one invocation when the plan caps or slims (lib/plan.mjs), else null. */
export const budgetFor = (p) => (needsBudget(p) ? upstreamBudget({ maxFetches: p.maxFetches, slim: p.slim }) : null);

/** Survey options for a plan: the counting fetch and, below the library default, the starred-page cap. */
export function planOptions(p, budget) {
  return {
    ...(budget ? { fetch: budget.fetch } : {}),
    ...(p.starredPages !== FULL_STARRED_PAGES ? { maxStarredCalls: p.starredPages } : {}),
  };
}

/**
 * Say in the report what the plan did to it (lib/plan.mjs): a request cap that cut the survey short, a smaller sample.
 * Unchanged on Netlify and Workers Paid (no cap, the full sample).
 * @param {number} [refusedBefore] requests the budget had refused before this survey began (the job shares one budget)
 */
export function planNotes(report, p, budget, refusedBefore = 0) {
  if (!report || !Array.isArray(report.limits)) return report;
  const limits = [...report.limits];
  const where = p.free ? 'this copy runs on the Cloudflare Workers Free plan and' : 'this deployment';
  if (report.partial && budget && budget.refused > refusedBefore) {
    const line = `PARTIAL: the time budget or the cap of ${budget.maxFetches} upstream requests per invocation (${p.free ? 'Cloudflare Workers Free plan' : 'SURVEY_FETCH_BUDGET'}) ran out; unfinished signals are null (not measured).`;
    const i = limits.indexOf(LIB_BUDGET_LIMIT);
    if (i >= 0) limits[i] = line; else limits.push(line);
  }
  const starred = report.trace?.find((x) => x.step === 'starred')?.calls ?? 0;
  if (p.starredPages < FULL_STARRED_PAGES && starred >= p.starredPages) {
    limits.push(`Sample: ${where} reads at most ${p.starredPages} starred-list pages per survey (the full survey reads up to ${FULL_STARRED_PAGES}). This survey used all ${p.starredPages}; the full survey may sample more stargazers.`);
  }
  return { ...report, limits };
}

/** Best-effort store read/write for the report path: a store outage must not break a live survey. */
async function tryGet(k) { try { return await (await store()).get(k); } catch { return null; } }
async function trySet(k, v) { try { await (await store()).setJSON(k, v); } catch (e) { console.error(`[store] set ${k}: ${e.message}`); } }

/** knownPlanters(fullName) for oss survey(): planters of earlier fields (not the one this repo started) and which of them starred it. */
export async function knownPlanters(fullName) {
  const idx = (await tryGet('fields/index')) || [];
  const foreign = idx.filter((f) => repoKey(f.origin) !== repoKey(fullName));
  const byLogin = new Map();
  for (const f of foreign) for (const p of f.planters) byLogin.set(p.login.toLowerCase(), { login: p.login, id: p.id, fieldId: f.id });
  if (!byLogin.size) return { indexed: 0, planters: [], starredThis: [], seeds: [] };
  const byRepo = await tryGet(`by-repo/${repoKey(fullName)}`);
  const starredThis = (byRepo?.planters || []).filter((l) => byLogin.has(l.toLowerCase()));
  const newest = foreign[0]?.planters || [];
  const seeds = [];
  for (const p of [...starredThis.map((l) => byLogin.get(l.toLowerCase())), ...newest]) if (p && !seeds.some((s) => s.login === p.login) && seeds.length < 4) seeds.push({ login: p.login, id: p.id });
  return { indexed: byLogin.size, planters: [...byLogin.values()].map((p) => p.login), starredThis, seeds };
}

/** Index a PLANTED report into the field index. Returns the field id or null. */
export async function indexReport(report) {
  if (!plantsField(report)) return null;
  const s = await store();
  const idx = (await s.get('fields/index')) || [];
  const known = {};
  for (const f of idx) for (const p of f.planters) known[p.login.toLowerCase()] = { fieldId: f.id };
  const { fieldId } = assignField(report, known, idx.map((f) => f.id));
  const field = mergeField(await s.get(`field/${fieldId}`), report, fieldId, iso());
  await s.setJSON(`field/${fieldId}`, field);
  const entry = { id: fieldId, origin: field.origin, planters: field.planters.map((p) => ({ login: p.login, id: p.id })) };
  await s.setJSON('fields/index', [entry, ...idx.filter((f) => f.id !== fieldId)]);
  const logins = report.stargazers.accounts.map((a) => a.login);
  await Promise.all([report.repo.fullName, ...report.field.repos.map((r) => r.fullName)].slice(0, 25).map(async (fn) => {
    const k = `by-repo/${repoKey(fn)}`;
    const cur = (await s.get(k)) || { fieldIds: [], planters: [] };
    await s.setJSON(k, { fieldIds: [...new Set([...cur.fieldIds, fieldId])], planters: [...new Set([...cur.planters, ...logins])] });
  }));
  await s.setJSON('fields/list', upsertFieldList(await s.get('fields/list'), fieldSummary(field)));
  return fieldId;
}

/** Stored record { savedAt, algo, report, resurveyStartedAt? } under report/<key>, or null when missing, stale or from another algo version. */
async function readRecordAt(key) {
  const k = `report/${key}`;
  const rec = memGet(k) ?? (await tryGet(k));
  if (!rec?.report || rec.algo !== REPORT_ALGO) return null;
  const ttl = rec.report.partial ? PARTIAL_TTL_MS : REPORT_TTL_MS;
  const age = Date.now() - Date.parse(rec.savedAt);
  if (!(age <= ttl)) return null;
  memSet(k, rec, Math.max(1000, ttl - age));
  return rec;
}

/** Resolved full name for a requested one that GitHub redirected (renamed/transferred repo), or null. */
async function readAlias(fullName) {
  const k = `alias/${repoKey(fullName)}`;
  const a = memGet(k) ?? (await tryGet(k));
  if (!a?.fullName || !(Date.now() - Date.parse(a.at) <= ALIAS_TTL_MS)) return null;
  memSet(k, a, ALIAS_TTL_MS);
  return a.fullName;
}

async function rememberAlias(requested, resolved) {
  if (!requested || !resolved || repoKey(requested) === repoKey(resolved)) return;
  const k = `alias/${repoKey(requested)}`, a = { fullName: resolved, at: iso() };
  memSet(k, a, ALIAS_TTL_MS);
  await trySet(k, a);
}

/** The cached record for a repo: under the name as asked, else under the name GitHub resolved it to last time. */
async function readRecord(fullName) {
  const direct = await readRecordAt(repoKey(fullName));
  if (direct) return direct;
  const resolved = await readAlias(fullName);
  return resolved ? readRecordAt(repoKey(resolved)) : null;
}

/** When a partial record may be surveyed again: PARTIAL_SERVE_MS after it was saved or after the last re-survey began. */
const resurveyTime = (rec) => Math.max(Date.parse(rec.savedAt), rec.resurveyStartedAt ? Date.parse(rec.resurveyStartedAt) : 0) + PARTIAL_SERVE_MS;

async function remember(report) {
  const k = `report/${repoKey(report.repo.fullName)}`;
  const rec = { savedAt: iso(), algo: REPORT_ALGO, report };
  memSet(k, rec, report.partial ? PARTIAL_TTL_MS : REPORT_TTL_MS);
  await trySet(k, rec);
  return rec;
}

async function pushList(key, report, max) {
  const cur = (await tryGet(key)) || [];
  await trySet(key, prepend(cur, summarize(report), max));
}

/**
 * GET /api/report?q=[&fresh=1]
 * Cache: a full report answers from cache for 6 h. A partial report answers from cache for PARTIAL_SERVE_MS (60 s), then the
 * next request surveys again. fresh=1 asks for that re-survey explicitly: inside the 60 s window it is refused with
 * 429 RATE_LIMITED + retryAfter (one re-survey per repo per minute); on a full report it changes nothing.
 * Every response carries resurveyAt: ISO time a partial will be surveyed again, null for full and cut-short reports.
 * On the Cloudflare free plan (lib/plan.mjs) the survey makes at most 45 upstream requests and reads at most 12 starred
 * pages; the report's `limits` say so when it mattered (planNotes).
 * @param {string} q
 * @param {{ budgetMs?: number, surveyFn?: typeof survey, fresh?: boolean, plan?: ReturnType<typeof currentPlan> }} [o]
 */
export async function getReport(q, o = {}) {
  const started = Date.now();
  const target = parseTarget(q); // BAD_INPUT
  const inputFor = (tok) => ({ q: String(q).trim(), kind: target.kind, mint: target.mint, token: tok ?? null, note: null });

  let fullName = target.fullName, tokenInfo = null;
  if (target.kind === 'mint') {
    const r = memGet(`resolve/${target.mint}`) ?? (await tryGet(`resolve/${target.mint}`));
    if (r && Date.now() - Date.parse(r.at) < RESOLVE_TTL_MS) {
      memSet(`resolve/${target.mint}`, r, RESOLVE_TTL_MS);
      if (!r.fullName) throw new StarcropError('NO_REPO', `${r.token?.symbol ? '$' + r.token.symbol : 'This token'} links no GitHub repository (checked metadata, DexScreener and pump.fun).`, { token: { mint: target.mint, name: r.token?.name ?? '', symbol: r.token?.symbol ?? '' } });
      fullName = r.fullName; tokenInfo = r.token;
    }
  }
  let stamping = null;
  if (fullName) {
    const rec = await readRecord(fullName);
    if (rec) {
      const hit = rec.report;
      const serve = async (resurveyAt) => {
        const rep = { ...hit, source: 'cache', input: target.kind === 'mint' ? inputFor(tokenInfo) : inputFor(null), resurveyAt };
        await pushList('recent/list', rep, 20);
        return rep;
      };
      if (!hit.partial) return serve(null);
      const wait = resurveyTime(rec) - Date.now();
      if (wait > 0) {
        if (o.fresh) {
          const retryAfter = Math.ceil(wait / 1000);
          throw new StarcropError('RATE_LIMITED', `${hit.repo.fullName} was last surveyed ${Math.round((Date.now() - Date.parse(rec.resurveyStartedAt || rec.savedAt)) / 1000)} s ago. A partial report is surveyed again at most once a minute; try again in ${retryAfter} s.`, { retryAfter });
        }
        return serve(new Date(resurveyTime(rec)).toISOString());
      }
      // stale partial: stamp the record first, so requests during this re-survey get the cached partial (or 429 with fresh=1)
      const k = `report/${repoKey(hit.repo.fullName)}`, stamped = { ...rec, resurveyStartedAt: new Date().toISOString() };
      memSet(k, stamped, Math.max(1000, PARTIAL_TTL_MS - (Date.now() - Date.parse(rec.savedAt))));
      stamping = trySet(k, stamped);
    }
  }

  const p = o.plan || currentPlan();
  const budget = budgetFor(p);
  let report;
  try {
    report = await (o.surveyFn || survey)(q, surveyOptions({ budgetMs: (o.budgetMs ?? REQUEST_BUDGET_MS) - (Date.now() - started) - 300, knownPlanters, ...planOptions(p, budget) }));
  } catch (e) {
    await stamping;
    if (e instanceof StarcropError && e.code === 'NO_REPO' && target.mint) {
      const r = { fullName: null, token: { name: e.token?.name ?? '', symbol: e.token?.symbol ?? '' }, at: iso() };
      memSet(`resolve/${target.mint}`, r, RESOLVE_TTL_MS);
      await trySet(`resolve/${target.mint}`, r);
    }
    throw e;
  }
  await stamping;
  report = planNotes(report, p, budget);
  if (!measured(report)) return { ...report, resurveyAt: null };
  if (report.input.mint) {
    const r = { fullName: report.repo.fullName, token: report.input.token, at: iso() };
    memSet(`resolve/${report.input.mint}`, r, RESOLVE_TTL_MS);
    await trySet(`resolve/${report.input.mint}`, r);
  }
  try { report.field.id = await indexReport(report); } catch (e) { console.error(`[index] ${e.message}`); }
  const rec = await remember(report);
  await Promise.all([
    rememberAlias(target.fullName, report.repo.fullName),
    pushList('recent/list', report, 20),
    pushList('surveyed/list', report, 24),
    report.verdict === 'PLANTED' && !report.partial ? trySet('featured/planted', report) : null,
  ]);
  return { ...report, resurveyAt: report.partial ? new Date(resurveyTime(rec)).toISOString() : null };
}

/**
 * Survey for the scheduled job (no recent/list entry). `plan` and `budget` come from the job's run (lib/job.mjs), so the
 * survey shares that run's request cap.
 */
export async function surveyForJob(fullName, { budgetMs = 12000, mint = null, symbol = null, plan: p = currentPlan(), budget = null, surveyFn = survey } = {}) {
  const refusedBefore = budget?.refused ?? 0;
  const report = planNotes(await surveyFn(fullName, surveyOptions({ budgetMs, knownPlanters, ...planOptions(p, budget) })), p, budget, refusedBefore);
  if (mint) report.input = { ...report.input, mint, token: symbol ? { name: '', symbol, linkFoundIn: 'dexscreener' } : null };
  if (!measured(report)) return report;
  try { report.field.id = await indexReport(report); } catch (e) { console.error(`[index] ${e.message}`); }
  await remember(report);
  await rememberAlias(fullName, report.repo.fullName);
  await pushList('surveyed/list', report, 24);
  if (report.verdict === 'PLANTED' && !report.partial) await trySet('featured/planted', report);
  return report;
}

/** True when the store holds a report for this repo (or the repo it was renamed to): full < 6 h, partial < 15 min. */
export async function wasReportedRecently(fullName) { return !!(await readRecord(fullName)); }

/** GET /api/fields. Throws only if the store itself fails. */
export async function getFields() {
  const s = await store();
  const [fields, surveyed, featured] = await Promise.all([s.get('fields/list'), s.get('surveyed/list'), s.get('featured/planted')]);
  return {
    updatedAt: iso(),
    featured: featured ? { ...featured, source: 'cache' } : { ...reference, source: 'fixture' },
    fields: (fields || []).slice(0, 12),
    surveyed: [...(surveyed || [])].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt)).slice(0, 24),
  };
}

/** GET /api/recent. Throws only if the store itself fails. */
export async function getRecent() {
  const s = await store();
  return { reports: ((await s.get('recent/list')) || []).slice(0, 20) };
}

/** Map any error to { status, body } per the contract's ErrorBody. */
export function errorResponse(e) {
  if (e instanceof StarcropError) {
    const headers = { 'cache-control': 'no-store', ...(e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {}) };
    return Response.json(e.toJSON(), { status: e.status, headers });
  }
  console.error(e);
  return Response.json({ error: 'The survey failed upstream. Try again in a minute.', code: 'UPSTREAM' }, { status: 502, headers: { 'cache-control': 'no-store' } });
}
