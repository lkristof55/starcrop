# Starcrop app

The site and backend behind [starcrop.netlify.app](https://starcrop.netlify.app). Paste a pump.fun mint, a GitHub URL or `owner/repo`. The backend finds the repo, runs the [starcrop library](../README.md) (at the repo root), and answers with a crop report: `PLANTED`, `MIXED`, `GROWN`, `SEEDLING` or `UNSURVEYED`, with the nine signals and their evidence. A report is a pattern, not an accusation: anyone can have a farm star their repo without asking.

- `netlify/functions/`: Netlify Functions v2, one file per endpoint, plus a scheduled survey.
- `lib/`: the service around the library (caching, the field index, lists, upstream feeds, the store).
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
| schedule | `survey` (`*/20 * * * *`) | surveys up to 3 new candidates per run and refreshes known planters | - |

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

## Tests

- `npm test` runs offline:
  - `test/service.test.mjs` covers caching, the 60 s partial window, `fresh=1` and its 429, `cache-control` per report kind, renamed-repo aliases, the field index, lists, error bodies and the handler. It also checks that `lib/reference-report.mjs` is exactly `analyze()` on the recorded farm fixture.
  - `test/names.test.mjs` checks that the shipped data (`lib/reference-report.mjs`, `site/src/data/*.json`, the Try buttons) names only the recorded farm or `sample-user-NN` / `sample-owner-NN` placeholders. It also checks that `site/src/data/oss.js` is copied verbatim from the library, and that no file in `app/` holds a key or a token.
- The library's own tests run at the repo root (`npm test` there).
- `test/smoke.mjs <base>` makes real requests against a running server: a GitHub repo created in the last 72 h (picked live), `tinygrad/tinygrad` (the star-event door), a big old repo as a URL and a random one (never a 502), `facebook/react` twice (the rename; the second request must be a cache hit) and with `fresh=1`, a pump.fun mint, today's newest DexScreener-boosted mint, a bad input, `/api/fields`, `/api/recent` and `/api/health`. It checks shape, timing, `cache-control` and `resurveyAt`.
- `node test/record.mjs --offline` regenerates `lib/reference-report.mjs` from `test/fixtures/raw.planted.clashdesk.json`. `GITHUB_TOKEN=... node test/record.mjs` re-records the live fixtures at the repo root; every live fixture goes through `anonymize()` before it is written.
- Site data is generated, never typed: `node site/tools/featured.mjs` (from `lib/reference-report.mjs`), `node site/tools/excerpts.mjs` (code and benchmarks from the library), `node site/tools/gone.mjs` (re-checks that the farm still answers 404; uses `gh`).

## The recorded farm

The featured report and the site's drawings come from one recording: the star farm around `AutocratGirder/ClashDesk`, surveyed on 2026-09-25 at 12:49-12:58Z. GitHub removed its repos and accounts later that day; every name in `site/src/data/gone.json` answered 404. It is the only party the site names, and it is labelled RECORDED. A pattern, not an accusation.

## Licenses

Code: MIT ([LICENSE](../LICENSE)). Site assets (textures CC0, fonts SIL OFL 1.1, models original): see [`site/public/CREDITS.md`](site/public/CREDITS.md). The OFL texts are in `site/public/fonts/`. GitHub is a trademark of GitHub, Inc.; Starcrop is not affiliated with GitHub.
