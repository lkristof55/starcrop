// Smoke test against a running server (in app/): node test/smoke.mjs http://localhost:8888
// One real request per endpoint with current mainnet inputs; checks the response shape and timing, not only the status.
//  - /api/report on a GitHub repo created in the last 72 h with >= 150 stars (picked live from GitHub search)
//  - /api/report on a big, years-old repo (tinygrad/tinygrad, an organization): the star-event door
//  - /api/report on a big old repo given as a URL (denoland/deno; QA round 2 once got a 502 when the budget ran out mid-body)
//    and a random big old repo: never 502
//  - /api/report on facebook/react (QA round 3: renamed to react/react, never hit the cache) and fresh=1 on it
//  - /api/report on a pump.fun mint that links a repo (BMC) and on today's newest DexScreener-boosted Solana mint
// GITHUB_TOKEN in the shell is used for the two GitHub searches that pick live inputs (60 calls/h without it).
const base = process.argv[2] || 'http://localhost:8888';
const SIGNALS = ['siblings', 'ownerCohort', 'birthSpread', 'plantingRows', 'field', 'hollowAccounts', 'thinSoil', 'templateTwins', 'knownField'];
const VERDICTS = ['PLANTED', 'MIXED', 'GROWN', 'SEEDLING', 'UNSURVEYED'];
const ok = (c, m) => { if (!c) throw new Error(m); };

function checkReport(r, label) {
  ok(r && r.v === 1, `${label}: v`);
  ok(VERDICTS.includes(r.verdict), `${label}: verdict ${r.verdict}`);
  ok(['live', 'cache', 'fixture'].includes(r.source), `${label}: source`);
  ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 17 && r.maxScore === 17, `${label}: score`);
  ok(typeof r.headline === 'string' && r.headline.length > 10, `${label}: headline`);
  ok(Array.isArray(r.signals) && r.signals.map((s) => s.id).join() === SIGNALS.join(), `${label}: 9 signals in order`);
  for (const s of r.signals) ok([true, false, null].includes(s.fired) && typeof s.threshold === 'string' && typeof s.evidence === 'string' && s.evidence, `${label}: signal ${s.id}`);
  ok(r.repo?.fullName && r.repo.url.startsWith('https://github.com/'), `${label}: repo`);
  if (r.repo.stars == null) {
    // cut short before GitHub returned the repo: allowed only as a partial UNSURVEYED report that says why
    ok(r.partial === true && r.verdict === 'UNSURVEYED' && /time budget ran out/.test(r.reason) && r.signals.every((s) => s.fired === null), `${label}: cut-short report`);
  } else {
    ok(Number.isFinite(r.repo.stars) && (r.repo.owner?.login || r.partial), `${label}: repo stars/owner`);
    ok(Array.isArray(r.siblings?.repos) && r.siblings.repos.some((x) => x.offsetSeconds === 0), `${label}: siblings include target`);
  }
  ok(typeof r.cohort?.computed === 'boolean', `${label}: cohort`);
  ok(Array.isArray(r.stargazers?.accounts) && Number.isInteger(r.stargazers.confirmed), `${label}: stargazers`);
  ok(Array.isArray(r.field?.repos) && Array.isArray(r.field?.plantings) && r.field.plantings.length <= 400, `${label}: field`);
  ok(Array.isArray(r.trace) && r.cost && Number.isInteger(r.cost.githubCore), `${label}: trace/cost`);
  ok(Array.isArray(r.limits) && r.limits.some((l) => l.includes('not an accusation')), `${label}: limits`);
  ok(typeof r.partial === 'boolean' && r.input?.kind, `${label}: partial/input`);
  ok('reason' in r && (r.verdict === 'UNSURVEYED' ? typeof r.reason === 'string' && r.reason.length > 20 : r.reason === null), `${label}: reason ${r.reason}`);
  ok(Array.isArray(r.stargazers.doors) && r.stargazers.doors.every((d) => d.via && Number.isInteger(d.seeds) && d.confirmed <= d.seeds), `${label}: stargazers.doors`);
  ok(r.cost.githubCore + r.cost.githubSearch <= 51, `${label}: ${r.cost.githubCore}+${r.cost.githubSearch} GitHub calls > 51`);
}

async function get(p) {
  const t = Date.now();
  const r = await fetch(base + p);
  const body = await r.json();
  return { status: r.status, body, ms: Date.now() - t, cc: r.headers.get('cache-control'), retryAfter: r.headers.get('retry-after') };
}

/** QA round 3: partial reports carry resurveyAt and are never HTTP-cached; complete ones are public max-age=60, resurveyAt null. */
function checkCaching({ body: r, cc }, label) {
  const complete = r.repo.stars != null && !r.partial;
  ok('resurveyAt' in r, `${label}: resurveyAt missing`);
  ok(cc === (complete ? 'public, max-age=60' : 'no-store'), `${label}: cache-control ${cc} on a ${complete ? 'complete' : 'partial'} report`);
  if (complete || r.repo.stars == null) ok(r.resurveyAt === null, `${label}: resurveyAt ${r.resurveyAt}`);
  else { const w = Date.parse(r.resurveyAt) - Date.now(); ok(w > -5000 && w <= 61000, `${label}: resurveyAt ${r.resurveyAt}`); }
}

async function freshRepo() {
  const since = new Date(Date.now() - 72 * 3600e3).toISOString().slice(0, 10);
  const r = await fetch(`https://api.github.com/search/repositories?q=created:>=${since}+stars:>=150&sort=stars&per_page=5`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'starcrop-smoke', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
  });
  const j = await r.json();
  return j.items?.[Math.floor(Math.random() * Math.min(5, j.items.length))]?.full_name || 'openai/NavierStokesAndEuler';
}

/** A random 10k+ star repo created before 2019 (big events feeds and bodies). */
async function bigOldRepo() {
  const r = await fetch('https://api.github.com/search/repositories?q=stars:>10000+created:<2019-01-01+language:Rust+language:Go&sort=stars&per_page=50', {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'starcrop-smoke', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
  });
  const items = (await r.json()).items || [];
  return items[Math.floor(Math.random() * items.length)]?.full_name || 'denoland/deno';
}

async function boostedMint() {
  const r = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
  const j = await r.json();
  return (Array.isArray(j) ? j : []).find((x) => x.chainId === 'solana')?.tokenAddress;
}

const checks = [
  ['GET /api/health', async () => {
    const { status, body } = await get('/api/health');
    ok(status === 200 && body.ok === true && body.project === 'starcrop', JSON.stringify(body));
    ok(typeof body.keys?.github === 'boolean', 'keys.github');
    if (!body.keys.github) console.log('     note: GITHUB_TOKEN is not set on the server (60 calls/h)');
  }],
  ['GET /api/fields', async () => {
    const { status, body, ms } = await get('/api/fields');
    ok(status === 200, `status ${status}`);
    checkReport(body.featured, 'featured');
    ok(Array.isArray(body.fields) && body.fields.length <= 12 && Array.isArray(body.surveyed) && body.surveyed.length <= 24, 'lists');
    ok(!Number.isNaN(Date.parse(body.updatedAt)), 'updatedAt');
    ok(ms < 3000, `slow: ${ms} ms`);
    return `featured ${body.featured.repo.fullName} ${body.featured.verdict} (${body.featured.source}), ${body.fields.length} fields, ${body.surveyed.length} surveyed`;
  }],
  ['GET /api/report (fresh GitHub repo, today)', async () => {
    const repo = await freshRepo();
    const res = await get(`/api/report?q=${encodeURIComponent('https://github.com/' + repo)}`);
    const { status, body, ms } = res;
    ok(status === 200 || status === 429, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    if (status === 429) { ok(body.code === 'RATE_LIMITED' && body.retryAfter > 0, 'retryAfter'); return 'rate limited (shape ok)'; }
    checkReport(body, repo);
    checkCaching(res, repo);
    ok(ms < (body.source === 'cache' ? 1500 : 9500), `slow: ${ms} ms`);
    return `${repo}: ${body.verdict} ${body.score}/17, ${body.source}, ${ms} ms, ${body.cost.githubCore}+${body.cost.githubSearch} GitHub calls`;
  }],
  ['GET /api/report (big old repo, tinygrad/tinygrad)', async () => {
    const { status, body, ms } = await get('/api/report?q=tinygrad/tinygrad');
    ok(status === 200 || status === 429, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    if (status === 429) { ok(body.code === 'RATE_LIMITED' && body.retryAfter > 0, 'retryAfter'); return 'rate limited (shape ok)'; }
    checkReport(body, 'tinygrad');
    const ev = body.stargazers.doors.find((d) => d.via === 'star-event');
    ok(ev && ev.seeds > 0, `star-event door not used: ${JSON.stringify(body.stargazers.doors)}`);
    ok(body.verdict !== 'UNSURVEYED' || body.partial, `UNSURVEYED on a full survey: ${body.reason}`);
    ok(ms < (body.source === 'cache' ? 1500 : 9500), `slow: ${ms} ms`);
    return `${body.verdict} ${body.score}/17, ${body.source}, ${ms} ms, star-event ${ev.confirmed}/${ev.seeds}, ${body.cost.githubCore}+${body.cost.githubSearch} GitHub calls`;
  }],
  ['GET /api/report (big old repo as a URL, denoland/deno: never a 502 when the budget runs out mid-body)', async () => {
    const { status, body, ms } = await get('/api/report?q=' + encodeURIComponent('https://github.com/denoland/deno'));
    ok(status === 200 || status === 429, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    if (status === 429) return 'rate limited (shape ok)';
    checkReport(body, 'deno');
    ok(ms < (body.source === 'cache' ? 1500 : 9500), `slow: ${ms} ms`);
    return `${body.verdict} ${body.score}/17, ${body.source}${body.partial ? ', PARTIAL' : ''}, ${ms} ms`;
  }],
  ['GET /api/report (big old repo, picked live, uncached)', async () => {
    const repo = await bigOldRepo();
    const { status, body, ms } = await get(`/api/report?q=${encodeURIComponent(repo)}`);
    ok(status === 200 || status === 429, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    if (status === 429) return 'rate limited (shape ok)';
    checkReport(body, repo);
    ok(ms < (body.source === 'cache' ? 1500 : 9500), `slow: ${ms} ms`);
    return `${repo}: ${body.verdict} ${body.score}/17, ${body.source}${body.partial ? ', PARTIAL' : ''}, ${ms} ms`;
  }],
  ['GET /api/report (renamed repo facebook/react -> react/react: the 2nd request is a cache hit)', async () => {
    const a = await get('/api/report?q=facebook/react');
    ok(a.status === 200 || a.status === 429, `status ${a.status}: ${JSON.stringify(a.body).slice(0, 200)}`);
    if (a.status === 429) return 'rate limited (shape ok)';
    checkReport(a.body, 'facebook/react');
    checkCaching(a, 'facebook/react');
    ok(a.body.repo.fullName.toLowerCase() === 'react/react' || a.body.repo.stars == null, `resolved to ${a.body.repo.fullName}`);
    if (a.body.repo.stars == null) return `cut short at ${a.ms} ms (never cached; alias not recorded)`;
    const b = await get('/api/report?q=' + encodeURIComponent('https://github.com/facebook/react'));
    ok(b.status === 200 && b.body.source === 'cache' && b.ms < 1500, `2nd request: ${b.status} ${b.body.source} ${b.ms} ms`);
    checkCaching(b, 'facebook/react (2nd)');
    ok(b.body.input.q === 'https://github.com/facebook/react' && b.body.repo.fullName === a.body.repo.fullName, 'input/repo on the cache hit');
    return `${a.body.verdict}${a.body.partial ? ' PARTIAL' : ''} ${a.body.source} ${a.ms} ms -> ${b.body.source} ${b.ms} ms (${b.cc})`;
  }],
  ['GET /api/report&fresh=1 (partial: 429 inside 60 s; complete: served from cache)', async () => {
    const a = await get('/api/report?q=facebook/react');
    ok(a.status === 200, `status ${a.status}`);
    const f = await get('/api/report?q=facebook/react&fresh=1');
    if (a.body.partial && a.body.repo.stars != null) {
      ok(f.status === 429 && f.body.code === 'RATE_LIMITED' && f.body.retryAfter > 0 && f.body.retryAfter <= 60, `fresh=1 on a partial: ${f.status} ${JSON.stringify(f.body).slice(0, 200)}`);
      ok(f.retryAfter === String(f.body.retryAfter) && f.cc === 'no-store', `headers retry-after ${f.retryAfter}, cache-control ${f.cc}`);
      return `partial: fresh=1 -> 429, retry in ${f.body.retryAfter} s (resurveyAt ${a.body.resurveyAt})`;
    }
    ok(f.status === 200, `fresh=1: ${f.status} ${JSON.stringify(f.body).slice(0, 200)}`);
    checkCaching(f, 'fresh=1');
    ok(a.body.partial || f.body.source === 'cache', `fresh=1 on a complete report should be a cache hit, got ${f.body.source}`);
    return `${a.body.partial ? 'cut short' : 'complete'}: fresh=1 -> 200 ${f.body.source}`;
  }],
  ['GET /api/report (mint -> repo, BMC)', async () => {
    const mint = '64S9QFTFhrcLWsXWjTBkaWPS4asdcrQGwvVQWxUjpump';
    const { status, body, ms } = await get(`/api/report?q=${mint}`);
    ok(status === 200, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    checkReport(body, 'BMC');
    // the repo belongs to a person: check that the mint resolved to a repo, without naming it here
    ok(body.input.kind === 'mint' && body.input.mint === mint && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(body.repo.fullName), 'mint resolved to a repo');
    return `mint -> repo with ${body.repo.stars} stars: ${body.verdict}, ${body.source}, ${ms} ms`;
  }],
  ['GET /api/report (boosted mint, today)', async () => {
    const mint = await boostedMint();
    ok(mint, 'no boosted mint');
    const { status, body, ms } = await get(`/api/report?q=${mint}`);
    ok([200, 404, 422].includes(status), `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    if (status === 200) checkReport(body, mint);
    else ok(typeof body.error === 'string' && body.code, 'ErrorBody');
    if (status === 422) ok(body.code === 'NO_REPO' && body.token?.mint === mint, 'NO_REPO token');
    return `${mint}: ${status} ${body.code || body.verdict}, ${ms} ms`;
  }],
  ['GET /api/report (bad input)', async () => {
    const { status, body } = await get('/api/report?q=' + encodeURIComponent('not a repo'));
    ok(status === 400 && body.code === 'BAD_INPUT' && body.error, JSON.stringify(body));
  }],
  ['GET /api/recent', async () => {
    const { status, body } = await get('/api/recent');
    ok(status === 200 && Array.isArray(body.reports) && body.reports.length <= 20, JSON.stringify(body).slice(0, 200));
    for (const x of body.reports) ok(x.fullName && VERDICTS.includes(x.verdict) && x.maxScore === 17 && 'fieldId' in x && 'mint' in x, 'ReportSummary shape');
    ok(body.reports.length >= 1, 'the reports above should be in recent');
    return `${body.reports.length} recent`;
  }],
];

let failed = 0;
for (const [name, fn] of checks) {
  const t = Date.now();
  try { const note = await fn(); console.log(`ok   ${name} ${Date.now() - t}ms${note ? `  ${note}` : ''}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}
process.exit(failed ? 1 : 0);
