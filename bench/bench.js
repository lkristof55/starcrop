// node bench/bench.js            offline: analyze(), idToDate(), readmeSkeleton() on recorded fixtures
// node bench/bench.js --live     also survey() end to end on GitHub, 5 runs per target (needs GITHUB_TOKEN;
//                                 STARCROP_RPC_URL adds Helius DAS to the mint target, else it resolves via DexScreener)
import os from 'node:os';
import { analyze, idToDate, readmeSkeleton, survey, GLOBAL_ANCHORS } from '../src/index.js';
import { load } from '../test/helpers.js';

const planted = load('raw.planted.clashdesk.json');
const grown = load('raw.grown.riso-windowseat.json');
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
function rate(fn, ms = 1500) {
  for (let i = 0; i < 200; i++) fn(); // warm-up
  let n = 0; const t0 = performance.now();
  while (performance.now() - t0 < ms) { fn(); n++; }
  return n / ((performance.now() - t0) / 1000);
}
const fmt = (x) => Math.round(x).toLocaleString('en-US');

console.log(`machine: ${os.cpus()[0].model}, ${os.cpus().length} cores, ${os.platform()} ${os.release()}, Node ${process.version}`);
console.log(`date: ${new Date().toISOString()}\n`);

const plantedStars = Object.values(planted.starred).reduce((n, l) => n + l.items.length, 0);
const grownStars = Object.values(grown.starred).filter(Boolean).reduce((n, l) => n + l.items.length, 0);
console.log(`analyze() ClashDesk (recorded, ${planted.seeds.length} accounts, ${plantedStars} stars): ${fmt(rate(() => analyze(planted)))} reports/s`);
console.log(`analyze() GROWN fixture (live, young repo, ${grown.seeds.length} accounts, ${grownStars} stars): ${fmt(rate(() => analyze(grown)))} reports/s`);

let k = 0;
const ids = Array.from({ length: 1000 }, (_, i) => 1_000_000 + i * 331_000);
console.log(`idToDate() global table (${GLOBAL_ANCHORS.length} anchors): ${fmt(rate(() => idToDate(ids[k++ % 1000])))} conversions/s`);
const local = Object.values(planted.profiles);
console.log(`idToDate() with ${local.length} local anchors: ${fmt(rate(() => idToDate(307794500 + (k++ % 800), local)))} conversions/s`);

const errs = [];
for (let i = 1; i < GLOBAL_ANCHORS.length - 1; i++) {
  const a = GLOBAL_ANCHORS[i];
  if (a.id < 250_000_000) continue;
  errs.push(Math.abs(idToDate(a.id, [], GLOBAL_ANCHORS.filter((_, j) => j !== i)).at - Date.parse(a.createdAt)) / 3600e3);
}
console.log(`idToDate() leave-one-out, global anchors since id 250M (${errs.length}, 2.5M ids apart): median ${med(errs).toFixed(1)} h, max ${Math.max(...errs).toFixed(1)} h`);
const lerr = local.map((p) => Math.abs(idToDate(p.id, local.filter((x) => x !== p)).at - Date.parse(p.createdAt)) / 1000);
console.log(`idToDate() leave-one-out, ClashDesk local anchors (${lerr.length} farm accounts): median ${med(lerr).toFixed(0)} s, max ${Math.max(...lerr).toFixed(0)} s`);

const [owner, name] = grown.repo.fullName.split('/');
const text = grown.readmes[grown.repo.fullName].text;
const bytes = new TextEncoder().encode(text).length;
const r = rate(() => readmeSkeleton(text, { owner, name }));
console.log(`readmeSkeleton() on a ${fmt(bytes)} B README: ${fmt(r)} READMEs/s = ${(r * bytes / 1e6).toFixed(1)} MB/s`);

if (process.argv.includes('--live')) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.error('\n--live needs GITHUB_TOKEN'); process.exit(1); }
  const rpcUrl = process.env.STARCROP_RPC_URL;
  // openai/NavierStokesAndEuler: a young (created 2026-09-08) organization repo, GROWN (the full young-repo pipeline).
  // The mint: pump.fun BMC, whose metadata links a 3-star repo (resolve + SEEDLING).
  // tinygrad: a big, 5-year-old repo whose oldest forks are dormant (the star-event door).
  // The recorded PLANTED farm (ClashDesk) returned 404 on 2026-09-25 ~15:40Z, so it can only be replayed offline.
  for (const target of ['openai/NavierStokesAndEuler', '64S9QFTFhrcLWsXWjTBkaWPS4asdcrQGwvVQWxUjpump', 'tinygrad/tinygrad']) {
    const walls = [], core = [], search = [];
    let verdict;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const rep = await survey(target, { token, rpcUrl, budgetMs: 20000 });
      walls.push(performance.now() - t0); core.push(rep.cost.githubCore); search.push(rep.cost.githubSearch); verdict = rep.verdict;
      await new Promise((r) => setTimeout(r, 2500)); // stay under 30 searches/min
    }
    console.log(`\nsurvey() live ${target} (${verdict}), 5 runs: median ${fmt(med(walls))} ms (min ${fmt(Math.min(...walls))}, max ${fmt(Math.max(...walls))}); ${med(core)} core + ${med(search)} search calls per report`);
  }

  // Door yield: of the seeds each public door gave, how many had the target in their stars (1 run per repo).
  const big = ['tinygrad/tinygrad', 'sharkdp/hyperfine', 'sindresorhus/np', 'pmndrs/zustand'];
  const agg = {};
  console.log('');
  for (const target of big) {
    const rep = await survey(target, { token, budgetMs: 20000 });
    for (const d of rep.stargazers.doors) { agg[d.via] ??= { seeds: 0, confirmed: 0 }; agg[d.via].seeds += d.seeds; agg[d.via].confirmed += d.confirmed; }
    console.log(`door yield ${target} (${fmt(rep.repo.stars)} stars) -> ${rep.verdict}: ${rep.stargazers.doors.filter((d) => d.seeds).map((d) => `${d.via} ${d.confirmed}/${d.seeds}`).join(', ')}; ${rep.cost.githubCore} core + ${rep.cost.githubSearch} search`);
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.log(`door yield, ${big.length} repos: ${Object.entries(agg).map(([v, a]) => `${v} ${a.confirmed}/${a.seeds} (${Math.round((100 * a.confirmed) / a.seeds)} %)`).join(', ')}`);
}
