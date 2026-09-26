// Scheduled survey, every 20 min. Budget per run: <= 3 reports (<= 3 x (47 core + 4 search)) + 10 planter refreshes + 1 search
// = <= 164 GitHub calls, <= 13 search calls; 0 Helius (links come from DexScreener / pump.fun, not DAS).
//  1) candidates: DexScreener token profiles, pump.fun graduates (fail soft), fresh GitHub repos >= 150 stars (72 h)
//  2) refresh up to 10 known planters' starred lists -> by-repo index + new farm repos jump the queue
//  3) survey up to 3 candidates not reported in the last 6 h, one at a time, stop at 24 s
//  4) lists for /api/fields are written as each report lands
import { getStore } from '../../lib/store.mjs';
import { surveyForJob, wasReportedRecently } from '../../lib/service.mjs';
import { dexProfileCandidates, pumpGraduateCandidates, freshRepoCandidates, starredPage } from '../../lib/sources.mjs';
import { repoKey } from '../../lib/fields.mjs';

export default async () => {
  const started = Date.now();
  const stopAt = started + 24_000;
  const log = [];
  const s = await getStore('starcrop');

  const [dex, pump, fresh] = await Promise.all([
    dexProfileCandidates({ deadline: started + 6000 }).catch(() => []),
    pumpGraduateCandidates({ deadline: started + 6000 }).catch(() => []),
    freshRepoCandidates({ deadline: started + 6000 }).catch(() => []),
  ]);
  log.push(`candidates: dexscreener ${dex.length}, pumpfun ${pump.length}, github ${fresh.length}`);

  // 2) planter refresh
  const idx = (await s.get('fields/index')) || [];
  const planters = idx.flatMap((f) => f.planters.map((p) => ({ ...p, fieldId: f.id }))).slice(0, 10);
  const farmNew = new Map();
  await Promise.all(planters.map(async (p) => {
    const items = await starredPage(p.login, { deadline: started + 8000 });
    if (!items) return;
    for (const x of items) {
      const e = farmNew.get(repoKey(x.repo)) || { fullName: x.repo, planters: new Set(), fieldIds: new Set() };
      e.planters.add(p.login); e.fieldIds.add(p.fieldId);
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

  // 3) survey
  const queue = [...planted.map((e) => ({ fullName: e.fullName, from: 'planters' })), ...dex, ...pump, ...fresh];
  const seen = new Set();
  let done = 0;
  for (const c of queue) {
    if (done >= 3 || Date.now() > stopAt - 9000) break;
    const k = repoKey(c.fullName);
    if (seen.has(k)) continue;
    seen.add(k);
    if (await wasReportedRecently(c.fullName)) continue;
    try {
      const r = await surveyForJob(c.fullName, { budgetMs: Math.min(12000, stopAt - Date.now()), mint: c.mint, symbol: c.symbol });
      log.push(`${c.from} ${r.repo.fullName}: ${r.verdict} ${r.score}/17`);
      done++;
    } catch (e) {
      log.push(`${c.from} ${c.fullName}: ${e.code || 'ERR'} ${e.message}`);
      if (e.code === 'RATE_LIMITED') break;
    }
  }
  await s.setJSON('survey/last', { at: new Date().toISOString(), ms: Date.now() - started, log });
  console.log(`[survey] ${Date.now() - started} ms\n  ${log.join('\n  ')}`);
  return new Response(null, { status: 204 });
};

export const config = { schedule: '*/20 * * * *' };
