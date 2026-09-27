# Starcrop app

The site and backend behind [starcrop.anyfee.workers.dev](https://starcrop.anyfee.workers.dev) (Cloudflare Workers; the Netlify copy is paused). Paste a pump.fun mint, a GitHub URL or `owner/repo`. The backend finds the repo, runs the [starcrop library](../README.md) (at the repo root), and answers with a crop report: `PLANTED`, `MIXED`, `GROWN`, `SEEDLING` or `UNSURVEYED`, with the nine signals and their evidence. A report is a pattern, not an accusation: anyone can have a farm star their repo without asking.

- `netlify/functions/`: Netlify Functions v2, one file per endpoint, plus a scheduled survey. The same files run on both hosts.
- `worker.mjs`, `wrangler.jsonc`, `migrations/`: the Cloudflare Workers entry (routes `/api/*` to those functions by their `config.path`, runs the survey from its cron), its config and the D1 table.
- `lib/`: the service around the library (caching, the field index, lists, upstream feeds, the store: Netlify Blobs, D1 or local files), the scheduled job (`job.mjs`) and the per-invocation budgets of the Cloudflare free plan (`plan.mjs`, `upstream.mjs`).
- `site/`: the static site (three.js, GSAP, Lenis), bundled with esbuild by `scripts/build.mjs`.
- `test/`: offline unit tests, the live smoke test and the fixture recorder.
- `scripts/`: `build.mjs` (site -> `site/dist`) and `dev.mjs` (site + every function on one local port).

## Run locally

Node 20 or newer (CI runs 22 and 24).

```sh
cd app
npm ci
npm test                                        # offline: service, data and names tests (no network, no token)
npm run build                                   # site -> site/dist
GITHUB_TOKEN=$(gh auth token) npm run dev       # site + functions on http://localhost:8888 (--port N to change)
GITHUB_TOKEN=$(gh auth token) npm run smoke -- http://localhost:8888   # real requests against the running server
npm run dev -- --cron                           # also runs the scheduled survey now and once a minute
npm run watch                                   # dev server that rebuilds the site and reloads functions on change
```

`npm run dev` reads `app/.env` (copy [`.env.example`](.env.example)); variables already set in the shell win. You can also pass the token on the command line as above so it is never written to a file. The local store is a folder of JSON files in `app/.data/` instead of Netlify Blobs; delete it to start empty.

## Endpoints

| method | path | returns | cache |
|---|---|---|---|
| GET | `/api/report?q=<mint \| github url \| owner/repo>[&fresh=1]` | `CropReport`: verdict, score /17, 9 signals with value, threshold and evidence, siblings, cohort, stargazers (with `doors`), field, trace, cost, limits, `reason` (why, when UNSURVEYED) and `resurveyAt` (when a partial report is surveyed again) | full report 6 h per repo; partial report 60 s; mint -> repo 1 h |
| GET | `/api/fields` | `{ updatedAt, featured, fields[], surveyed[] }`, the hero's first load. `featured` is the newest live PLANTED report, else the recorded ClashDesk farm with `source: 'fixture'` | 300 s |
| GET | `/api/recent` | `{ reports: ReportSummary[] }`, at most 20 user-run reports | 30 s |
| GET | `/api/health` | `{ ok, project, time, keys: { helius, birdeye, github }, tokenMint }` (booleans, never values) | none |
| schedule | `survey` (`*/20 * * * *`) | surveys up to 3 new candidates per run and refreshes known planters (Cloudflare free plan: one survey or one planter refresh per run, see below) | - |

```sh
curl 'http://localhost:8888/api/report?q=openai/NavierStokesAndEuler'
curl 'http://localhost:8888/api/report?q=https://github.com/tinygrad/tinygrad'
curl 'http://localhost:8888/api/report?q=64S9QFTFhrcLWsXWjTBkaWPS4asdcrQGwvVQWxUjpump'   # pump.fun mint -> repo
curl 'http://localhost:8888/api/report?q=facebook/react'          # renamed: answers as react/react, cached under both names
curl 'http://localhost:8888/api/report?q=python/cpython&fresh=1'  # re-survey a partial report (429 + retryAfter inside its 60 s)
curl 'http://localhost:8888/api/fields'
curl 'http://localhost:8888/api/recent'
curl 'http://localhost:8888/api/health'
```

Errors are `{ error, code }` JSON: 400 `BAD_INPUT`, 404 `NOT_FOUND`, 422 `NO_REPO` (the mint links no repo; the body includes `token`), 429 `RATE_LIMITED` (with `retryAfter` and a `Retry-After` header), 502 `UPSTREAM`. A request has an 8.5 s budget. Anything unfinished comes back as `partial: true`, with `fired: null` on the signals it could not measure. Running out of time is never a 502. A partial report is sent with `cache-control: no-store` and is served from the store for 60 s, then surveyed again; `fresh=1` asks for that re-survey (429 inside the 60 s window). Renamed repos are stored under the resolved name and aliased from the requested one for 24 h.

## Environment variables

See [`.env.example`](.env.example).

| var | needed | used for |
|---|---|---|
| `GITHUB_TOKEN` | yes, for real use | every GitHub REST and search call. Without it GitHub allows 60 calls/hour per IP, about 2 reports. With it: 5,000/hour and 30 searches/minute. A fine-grained token with no scopes (public read) is enough. |
| `HELIUS_API_KEY` | recommended | DAS `getAsset` to read a mint's metadata. Without it, mints resolve through DexScreener, then pump.fun. |
| `TOKEN_MINT` | after launch | the $STCROP mint; `/api/health` returns it as `tokenMint` (null before launch). The crop report never depends on it. |
| `BIRDEYE_API_KEY` | no | not called; `/api/health` only reports whether it is set. |
| `LOCAL_STORE_DIR` | local only | the file store folder; `npm run dev` sets `app/.data`. Never set it on Netlify (it would bypass Blobs). |
| `CF_FREE_PLAN` | Cloudflare only | `1` (set in `wrangler.jsonc`): the Workers Free plan budgets below. `0` on Workers Paid: the full survey, as on Netlify. |
| `SURVEY_FETCH_BUDGET` | no | upstream requests one invocation may make, redirects and retries included. Default 45 with `CF_FREE_PLAN=1`, no cap otherwise. |
| `SURVEY_STARRED_PAGES` | no | starred-list pages one survey reads. Default 12 with `CF_FREE_PLAN=1`, 28 (the library default) otherwise. |

## Data sources and limits

| source | calls | limit |
|---|---|---|
| GitHub REST: `/repos`, `/users`, `/forks`, `/repos/{o}/{r}/events`, `/users/{u}/starred` (star+json), `/commits`, `/readme` | <= 47 per uncached report | 5,000/h with a token, 60/h without |
| GitHub search: `/search/repositories`, `/search/users` | <= 4 per report | 30/min with a token |
| Helius DAS `getAsset` + the metadata JSON | 1 per mint (cached 1 h) | 10 credits per call |
| DexScreener `tokens/v1/solana/<mint>`, `token-profiles/latest/v1` | fallback link lookup; survey job feed | ~300/min, free |
| pump.fun `frontend-api-v3` `/coins/<mint>`, `/coins?complete=true` | fallback; survey job feed | unofficial, fails soft |

## Costs and credits

- **Page view (first load):** `/api/fields` and `/api/recent` read the store only: 0 Helius credits, 0 GitHub calls.
- **A report a visitor runs:** GitHub input: 0 Helius credits. Mint input: 10 Helius credits (1 DAS call), then cached 1 h per mint. GitHub: at most 47 core + 4 search calls, then cached 6 h per repo. Measured with `npm run bench:live` at the repo root: 28 core + 2 search for `openai/NavierStokesAndEuler`, 35 + 2 for `tinygrad/tinygrad`.
- **Partial reports:** at most one re-survey per repo per minute.
- **Scheduled survey (every 20 min):** 0 Helius credits. At most 3 reports + 10 planter refreshes + 1 search = 164 GitHub calls per run, 492 per hour, under the 5,000/h token limit. It stops itself at 24 s (Netlify's scheduled-function limit is 30 s).
- Birdeye: 0.

## Deploy your own copy to Netlify

1. Create a Netlify site from this repository. The root [`netlify.toml`](../netlify.toml) sets `base = "app"`, runs `npm run build`, publishes `site/dist` and bundles `netlify/functions` with esbuild. The functions import the library from `../../../src/` and `@netlify/blobs` (in `dependencies`); the build needs only the `devDependencies`.
2. Set `GITHUB_TOKEN` (required) and `HELIUS_API_KEY` (recommended) in the site's environment variables. Leave `TOKEN_MINT` empty until the coin exists.
3. The scheduled survey: `netlify/functions/survey.mjs` exports `config.schedule = '*/20 * * * *'`. Netlify picks it up on deploy; check Functions -> survey after the first deploy.
4. Storage is Netlify Blobs (store `starcrop`): `report/*`, `alias/*`, `resolve/*`, `recent/list`, `surveyed/list`, `featured/planted`, `field/*`, `fields/index`, `fields/list`, `by-repo/*`, `survey/last`. Nothing to create by hand.
5. No webhooks are needed.
6. **Pre-launch to live:** set `TOKEN_MINT=<mint>` and redeploy; `/api/health` then returns `tokenMint`.

## Deploy to Cloudflare Workers

The live copy runs as the Worker `starcrop` at [starcrop.anyfee.workers.dev](https://starcrop.anyfee.workers.dev): the static site from `site/dist` (Workers static assets, `404.html` for unknown paths), `/api/*` through [`worker.mjs`](worker.mjs) to the same `netlify/functions/*` handlers, the store in D1, and the survey on a cron trigger. The Netlify setup above keeps working unchanged; `wrangler.jsonc` only adds a second target.

```sh
cd app
npm ci && npm run build                                   # site -> site/dist (the assets directory)
npx wrangler d1 create starcrop-store                     # once; put its database_id into wrangler.jsonc
npx wrangler d1 migrations apply starcrop-store --remote  # creates the kv table (migrations/0001_kv.sql)
npx wrangler secret put GITHUB_TOKEN                      # strongly recommended (see below)
npx wrangler secret put HELIUS_API_KEY                    # recommended
npx wrangler secret put TOKEN_MINT                        # after launch
npx wrangler secret put BIRDEYE_API_KEY                   # optional; only reported by /api/health
npx wrangler deploy
```

- Secrets and vars reach the handlers as `process.env` (the `nodejs_compat` flag populates it), exactly as on Netlify. `CF_FREE_PLAN=1` is a plain var in `wrangler.jsonc`.
- The cron (`*/20 * * * *`, the only one) runs `netlify/functions/survey.mjs` through `worker.mjs` `scheduled()`.
- Storage: one D1 table `kv (store, key, value, updated_at)`, one row per key, with the same keys as on Netlify Blobs plus `survey/cursor`. A value may be at most 1.9 MB (a D1 row holds 2 MB); `lib/store.mjs` refuses a bigger one with a clear error. A stored report is capped by the library (400 plantings, 50 siblings, 24 field repos) and stays under 100 KB; `field/*`, `fields/index` and `by-repo/*` grow by at most 20-25 entries per PLANTED report, so they would need thousands of PLANTED reports before they got near the limit.
- Run it locally without any Cloudflare account: `npx wrangler d1 migrations apply starcrop-store --local`, put the keys in `app/.dev.vars` (gitignored, `KEY=value` lines), then `npx wrangler dev --local --test-scheduled`. Trigger the cron with `curl 'http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/20+*+*+*+*'` (`/__scheduled` is answered by the static site, because only `/api/*` runs the Worker first). `npm run smoke -- http://localhost:8787` works against it.

### The Workers Free plan: budgets and what degrades

An invocation on the free plan gets 10 ms of CPU and 50 subrequests (every fetch, retry and redirect hop counts); the account gets 100,000 requests and 100,000 D1 rows written a day. With `CF_FREE_PLAN=1` ([`lib/plan.mjs`](lib/plan.mjs)):

- **Every invocation makes at most 45 upstream requests.** [`lib/upstream.mjs`](lib/upstream.mjs) counts each request and redirect hop and refuses the 46th; the survey marks what it could not read as not measured (a partial report), never an error. When GitHub says its rate limit is used up, later GitHub requests in the same invocation get that answer without being sent.
- **A survey reads at most 12 starred-list pages** (28 on Netlify and Workers Paid), so it samples at most 12 accounts instead of up to 20. When the cap was reached, the report says so in `limits` ("Sample: ... reads at most 12 starred-list pages per survey"). An uncached `/api/report` makes at most 36 GitHub requests (repo, owner, 4 searches, forks, 2 events pages, commits, 5 READMEs, 12 starred pages, 8 profiles, 1 redirect hop) plus up to 5 for a mint (Helius, the metadata JSON and its fallback URL, DexScreener, pump.fun): 41. Retries come out of the same 45.
- **Big GitHub lists are read for the fields the survey uses.** A starred page of 100 full repo objects is roughly 500 KB of JSON (`curl -sH 'accept: application/vnd.github.star+json' 'https://api.github.com/users/<login>/starred?per_page=100' | wc -c` on any busy account); the extractor in `lib/upstream.mjs` takes the six fields the library reads before anything parses it, checks every value, and hands the page on untouched (to `JSON.parse`) when anything looks unexpected. The report is the same either way (`test/upstream.test.mjs`).
- **The scheduled survey does one heavy step per run** ([`lib/job.mjs`](lib/job.mjs)), with its queue in `survey/cursor`: the candidate feeds at most once an hour (or when the queue is empty), then either the planter refresh (at most once an hour) or one survey. That is up to 3 surveys an hour (2 while there are planters to refresh) instead of up to 9. The cursor moves past a step before the step runs, so a run the platform stops does not repeat forever.
- **CPU is the tight limit.** An uncached survey still parses several MB of GitHub data and runs the analysis; it sits around the 10 ms mark and can go over it. Cloudflare tolerates short bursts; a request stopped for CPU gets Cloudflare's error page, which the site shows as "GitHub didn't answer in time ... Try again in a minute." Cached reports (6 h), `/api/fields`, `/api/recent` and `/api/health` only read D1 and stay far below the limit. On Workers Paid set `CF_FREE_PLAN=0` and everything runs in full.
- **Without `GITHUB_TOKEN`** GitHub allows 60 requests an hour per IP, and Cloudflare's outgoing IPs are shared, so surveys mostly answer `429 RATE_LIMITED` with `retryAfter` (the site shows the wait) and the scheduled survey logs the limit and keeps its candidate queued. Set the token.

## Tests

- `npm test` runs offline:
  - `test/service.test.mjs` covers caching, the 60 s partial window, `fresh=1` and its 429, `cache-control` per report kind, renamed-repo aliases, the field index, lists, error bodies and the handler. It also checks that `lib/reference-report.mjs` is exactly `analyze()` on the recorded farm fixture.
  - `test/names.test.mjs` checks that the shipped data (`lib/reference-report.mjs`, `site/src/data/*.json`, the Try buttons) names only the recorded farm or `sample-user-NN` / `sample-owner-NN` placeholders. It also checks that `site/src/data/oss.js` is copied verbatim from the library, and that no file in `app/` holds a key or a token.
  - `test/store.test.mjs` runs the D1 store against an in-memory D1 (`test/d1-fake.mjs`: node:sqlite with the migration applied; skipped below Node 22.5) and checks it behaves like the file store, prefixes included (`%` and `_` are not wildcards), and that the row limit holds.
  - `test/worker.test.mjs` checks that every `/api` path reaches its handler with D1 registered first, that everything else goes to the static site, and that `scheduled()` runs the survey job.
  - `test/upstream.test.mjs` and `test/job.test.mjs` cover the free-plan budgets: the request cap (redirects and retries included), the slim extractors against `JSON.parse`, the same report with and without them, the job's cursor, and that no run makes more than 45 requests even when every request needs a retry. Their upstream is `test/upstream-stub.mjs` (placeholders only).
- The library's own tests run at the repo root (`npm test` there).
- `test/smoke.mjs <base>` makes real requests against a running server: a GitHub repo created in the last 72 h (picked live), `tinygrad/tinygrad` (the star-event door), a big old repo as a URL and a random one (never a 502), `facebook/react` twice (the rename; the second request must be a cache hit) and with `fresh=1`, a pump.fun mint, today's newest DexScreener-boosted mint, a bad input, `/api/fields`, `/api/recent` and `/api/health`. It checks shape, timing, `cache-control` and `resurveyAt`.
- `node test/record.mjs --offline` regenerates `lib/reference-report.mjs` from `test/fixtures/raw.planted.clashdesk.json`. `GITHUB_TOKEN=... node test/record.mjs` re-records the live fixtures at the repo root; every live fixture goes through `anonymize()` before it is written.
- Site data is generated, never typed: `node site/tools/featured.mjs` (from `lib/reference-report.mjs`), `node site/tools/excerpts.mjs` (code and benchmarks from the library), `node site/tools/gone.mjs` (re-checks that the farm still answers 404; uses `gh`).

## The recorded farm

The featured report and the site's drawings come from one recording: the star farm around `AutocratGirder/ClashDesk`, surveyed on 2026-09-25 at 12:49-12:58Z. GitHub removed its repos and accounts later that day; every name in `site/src/data/gone.json` answered 404. It is the only party the site names, and it is labelled RECORDED. A pattern, not an accusation.

## Licenses

Code: MIT ([LICENSE](../LICENSE)). Site assets (textures CC0, fonts SIL OFL 1.1, models original): see [`site/public/CREDITS.md`](site/public/CREDITS.md). The OFL texts are in `site/public/fonts/`. GitHub is a trademark of GitHub, Inc.; Starcrop is not affiliated with GitHub.
