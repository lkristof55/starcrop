// Scheduled survey, every 20 min. The job itself is lib/job.mjs (worker.mjs runs the same job from its cron on Cloudflare).
// Budget per run here (Netlify): <= 3 reports (<= 3 x (47 core + 4 search)) + 10 planter refreshes + 1 search
// = <= 164 GitHub calls, <= 13 search calls; 0 Helius (links come from DexScreener / pump.fun, not DAS).
//  1) candidates: DexScreener token profiles, pump.fun graduates (fail soft), fresh GitHub repos >= 150 stars (72 h)
//  2) refresh up to 10 known planters' starred lists -> by-repo index + new farm repos jump the queue
//  3) survey up to 3 candidates not reported in the last 6 h, one at a time, stop at 24 s
//  4) lists for /api/fields are written as each report lands
// On the Cloudflare Workers free plan (CF_FREE_PLAN=1) a run makes <= 45 upstream requests and does one heavy step,
// with a cursor in the store (lib/job.mjs, lib/plan.mjs).
import { runSurveyJob } from '../../lib/job.mjs';

export default async () => {
  await runSurveyJob();
  return new Response(null, { status: 204 });
};

export const config = { schedule: '*/20 * * * *' };
