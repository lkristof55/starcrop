// The scheduled survey, every 20 min (netlify/functions/survey.mjs on Netlify, worker.mjs scheduled() on Cloudflare).
//  1) candidates: DexScreener token profiles, pump.fun graduates (fail soft), fresh GitHub repos >= 150 stars (72 h)
//  2) refresh up to 10 known planters' starred lists -> by-repo index + new farm repos jump the queue
//  3) survey candidates not reported in the last 6 h, one at a time, stop at 24 s
//  4) lists for /api/fields are written as each report lands
//
// Full plan (Netlify, Cloudflare Workers Paid): every step every run, up to 3 surveys. Per run: <= 3 reports
// (<= 3 x (47 core + 4 search)) + 10 planter refreshes + 1 search = <= 164 GitHub calls, <= 13 search calls; 0 Helius
// (links come from DexScreener / pump.fun, not DAS).
//
// Free plan (CF_FREE_PLAN=1, lib/plan.mjs): <= 45 external fetches per run, retries and redirects included; the counting
// fetch (lib/upstream.mjs) refuses the 46th. survey/cursor keeps the queue and when the feeds and planters last ran, so
// the work is split across runs:
//   - candidates when the queue is empty or an hour old: 3 fetches (<= 6 with 429 retries);
//   - then ONE heavy step: the planter refresh when it is an hour old (<= 10 pages, <= 20 fetches with retries), or
//     one survey from the queue: <= 24 + 12 starred pages = 36 fetches (repo, owner, 4 searches, forks, 2 events pages,
//     commits, 5 READMEs, 12 starred pages, 8 profiles, 1 redirect hop). A survey starts only if that much is left.
// So a run makes <= 6 + 36 = 42 fetches in the normal worst case and never more than 45.
import { getStore } from './store.mjs';
import { surveyForJob, wasReportedRecently, budgetFor } from './service.mjs';
import { dexProfileCandidates, pumpGraduateCandidates, freshRepoCandidates, starredPage } from './sources.mjs';
import { repoKey } from './fields.mjs';
import { plan as currentPlan } from './plan.mjs';

export const QUEUE_MAX = 60;
/** Upstream fetches one job survey can make besides its starred pages (see above). */
export const SURVEY_FIXED_FETCHES = 24;

/**
 * One run of the scheduled survey. Returns what it wrote to survey/last.
 * @param {{ plan?: ReturnType<typeof currentPlan>, surveyFn?: Function }} [o] surveyFn: tests only
 */
export async function runSurveyJob({ plan: p = currentPlan(), surveyFn } = {}) {
  const started = Date.now();
  const stopAt = started + 24_000;
  const log = [];
  const s = await getStore('starcrop');
  const job = p.job;
  const budget = budgetFor(p);
  const io = budget ? { fetch: budget.fetch } : {};
  const cursor = job.keepCursor ? ((await s.get('survey/cursor')) || {}) : {};
  const due = (at, everyMs) => !at || !(started - Date.parse(at) < everyMs);
  // With a cursor, it moves past a heavy step before the step runs: a run the platform cuts off (CPU limit) must not
  // make every later run repeat the same step.
  const saveCursor = (queueLeft) => (job.keepCursor ? s.setJSON('survey/cursor', { ...cursor, queue: queueLeft.slice(0, QUEUE_MAX) }) : null);

  // 1) candidates
  let queue = Array.isArray(cursor.queue) ? cursor.queue : [];
  if (!queue.length || due(cursor.feedsAt, job.feedsEveryMs)) {
    const [dex, pump, fresh] = await Promise.all([
      dexProfileCandidates({ deadline: started + 6000, ...io }).catch(() => []),
      pumpGraduateCandidates({ deadline: started + 6000, ...io }).catch(() => []),
      freshRepoCandidates({ deadline: started + 6000, ...io }).catch(() => []),
    ]);
    log.push(`candidates: dexscreener ${dex.length}, pumpfun ${pump.length}, github ${fresh.length}`);
    queue = [...dex, ...pump, ...fresh];
    cursor.feedsAt = new Date(started).toISOString();
  } else {
    log.push(`candidates: ${queue.length} queued since ${cursor.feedsAt}`);
  }

  // 2) planter refresh
  let heavy = false;
  if (due(cursor.plantersAt, job.plantersEveryMs)) {
    const idx = (await s.get('fields/index')) || [];
    const planters = idx.flatMap((f) => f.planters.map((pl) => ({ ...pl, fieldId: f.id }))).slice(0, job.planters);
    cursor.plantersAt = new Date(started).toISOString();
    if (planters.length) await saveCursor(queue);
    const farmNew = new Map();
    await Promise.all(planters.map(async (pl) => {
      const items = await starredPage(pl.login, { deadline: started + 8000, ...io });
      if (!items) return;
      for (const x of items) {
        const e = farmNew.get(repoKey(x.repo)) || { fullName: x.repo, planters: new Set(), fieldIds: new Set() };
        e.planters.add(pl.login); e.fieldIds.add(pl.fieldId);
        farmNew.set(repoKey(x.repo), e);
      }
    }));
    const planted = [...farmNew.values()].filter((e) => e.planters.size >= 2).slice(0, 50);
    for (const e of planted) {
      const k = `by-repo/${repoKey(e.fullName)}`;
      const cur = (await s.get(k)) || { fieldIds: [], planters: [] };
      await s.setJSON(k, { fieldIds: [...new Set([...cur.fieldIds, ...e.fieldIds])], planters: [...new Set([...cur.planters, ...e.planters])] });
    }
    log.push(`planters refreshed ${planters.length}, farm repos indexed ${planted.length}`);
    queue = [...planted.map((e) => ({ fullName: e.fullName, from: 'planters' })), ...queue];
    heavy = planters.length > 0;
  }

  // 3) survey
  const seen = new Set();
  const need = SURVEY_FIXED_FETCHES + p.starredPages;
  let done = 0, i = 0;
  if (heavy && job.onePhase) log.push('survey: next run (the planter refresh was this run\'s one heavy step)');
  else {
    for (; i < queue.length; i++) {
      const c = queue[i];
      if (done >= job.surveys || Date.now() > stopAt - 9000) break;
      if (budget && Number.isFinite(budget.maxFetches) && budget.maxFetches - budget.used < Math.min(need, budget.maxFetches)) {
        log.push(`survey: next run (${budget.maxFetches - budget.used} of ${budget.maxFetches} upstream requests left, a survey can take ${need})`);
        break;
      }
      const k = repoKey(c.fullName);
      if (seen.has(k)) continue;
      seen.add(k);
      if (await wasReportedRecently(c.fullName)) continue;
      await saveCursor(queue.slice(i + 1));
      try {
        const r = await surveyForJob(c.fullName, { budgetMs: Math.min(12000, stopAt - Date.now()), mint: c.mint, symbol: c.symbol, plan: p, budget, ...(surveyFn ? { surveyFn } : {}) });
        log.push(`${c.from} ${r.repo.fullName}: ${r.verdict} ${r.score}/17${r.partial ? ' (partial)' : ''}`);
        done++;
      } catch (e) {
        log.push(`${c.from} ${c.fullName}: ${e.code || 'ERR'} ${e.message}`);
        if (e.code === 'RATE_LIMITED') break; // with a cursor it stays at the head of the queue for the next run
      }
    }
  }

  await saveCursor(queue.slice(i));
  const last = { at: new Date().toISOString(), ms: Date.now() - started, log };
  if (budget) last.upstream = { used: budget.used, max: Number.isFinite(budget.maxFetches) ? budget.maxFetches : null, refused: budget.refused, held: budget.held, slimmed: budget.slimmed, hosts: budget.hosts };
  await s.setJSON('survey/last', last);
  console.log(`[survey] ${last.ms} ms${budget ? `, ${budget.used} upstream requests` : ''}\n  ${log.join('\n  ')}`);
  return last;
}
