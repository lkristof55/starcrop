# starcrop

**Tell grown GitHub stars from planted ones, after GitHub hid the stargazers.**

Since the [2026-06-30 GitHub changelog](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/), `GET /repos/{o}/{r}/stargazers` returns 404 for anyone who doesn't admin the repo, and the GraphQL `stargazers` connection comes back empty (`totalCount: 0` next to `stargazerCount: 224`). Every fake-star checker that starts from the stargazer list stopped working that day. The other end of each star edge is still public: `GET /users/{u}/starred`, with a `starred_at` timestamp on every star. starcrop finds candidate stargazers through doors a farm can't close cheaply (fork owners, the repo's public star events, the owner's birth cohort, sibling owners), reads the stars from their side, and scores the pattern with nine fixed signals. Input can be `owner/repo`, a GitHub URL or a Solana (pump.fun) mint whose metadata links a repo. The output is a verdict: `PLANTED`, `MIXED`, `GROWN`, `SEEDLING` or `UNSURVEYED`.

Zero runtime dependencies. Node >= 20 (global `fetch`). The analysis is pure, so it runs the same in the browser.

```
$ node examples/replay-offline.js     # AutocratGirder/ClashDesk, recorded 2026-09-25; GitHub removed the farm hours later
VERDICT  PLANTED  14/17
13 of 13 sampled stargazers were born within 9.3 minutes of each other and starred the same 9
repos in the same order, 4 s apart.

account               born                  via           order
Behemothlyaoscillate  2026-07-21 23:50:36   fork          A * B C D E F G H I
BricklayerSurmount    2026-07-21 23:50:36   fork          A * B C D E F G H I
BridgeDruidCompress   2026-07-21 23:51:50   fork          A * B C D E F G H I
centralcashierboost   2026-07-21 23:53:19   fork          A * B C D E F G H I
...                                                        (13 rows, all identical)
Lengthbriexemplify    2026-07-21 23:59:00~  cohort        A * B C D E F G H I
QuantumSkinkCry       2026-07-21 23:59:52~  cohort        A * B C D E F G H I
```

Real stars grow slowly and unevenly, planted by strangers over years. That field came up overnight, in rows.

## How it works

```
  input: mint | github.com/o/r | o/r
        |
        |  mint: Helius DAS getAsset -> json_uri -> metadata JSON (pump.mypinata.cloud)
        |        fallbacks: DexScreener tokens/v1 info.websites/socials -> pump.fun coins/<mint>
        v
  GET /repos/o/r , GET /users/o                                  stars S, created t, owner id + born
        |
        +-- DOOR 1  forks?sort=oldest ---------------------------- fork owners            (<= 10 young | <= 4 mature)
        +-- DOOR 2  search/users created:born+-6min followers:0 -- owner's birth cohort   (<= 4, closest id)
        +-- DOOR 3  search/repositories created:t+-30s stars:>=S/2  sibling owners        (<= 4)
        +-- DOOR 4  earlier PLANTED fields (your index) ---------- known planters         (<= 4)
        +-- DOOR 5  repos/o/r/events  WatchEvent actors ---------- recent stargazers      (<= 12 mature | <= 4 young)
        +-- DOOR 6  repos/o/r/events  issue/PR/comment actors ---- engaged accounts       (<= 3 mature | <= 2 young)
        |           (each search is repeated 24 h earlier as a control)
        |           mature = created > 30 days ago: doors 5, 1, 6 lead; young: doors 1-4 lead
        v
  for each seed u (<= 20, <= 28 pages):  GET /users/u/starred   Accept: application/vnd.github.star+json
        |                   -> [{ repo, starred_at }]      seed is CONFIRMED if the target is in it
        v
  account x repo x time matrix  (<= 20 x 200)
        |
        +-- id clock:  user id -> signup time        (birthSpread, hollowAccounts)
        +-- star order + gaps per account           (plantingRows)
        +-- repos co-starred by >= half             (field)
        +-- README skeleton hash across siblings    (templateTwins)
        v
  9 signals, fixed weights, max 17  ->  PLANTED | MIXED | GROWN | SEEDLING | UNSURVEYED
```

### The id clock

GitHub assigns user ids in signup order, so an id is a timestamp in disguise. `idToDate(id, localAnchors)` interpolates piecewise-linearly between anchors `(id_i, t_i)`:

```
t(id) = t_lo + (id - id_lo) * (t_hi - t_lo) / (id_hi - id_lo)      for id_lo <= id < id_hi
```

Anchors come in two tiers:

1. **Local anchors**: every `/users/{u}` record this report fetched anyway (the owner always, plus up to 8 confirmed stargazers). Signup rate changes by the minute, and a local bracket is a few hundred ids wide. Up to 5,000 ids outside the local range are extrapolated from the two nearest local anchors.
2. **Global anchors**: 45 `(id, created_at)` pairs recorded from `GET /user/{id}` on 2026-09-25 (`src/anchors.js`; 2.5M ids apart from id 250M, December 2025, onward). Re-record with `scripts/record-anchors.js`.

Measured leave-one-out error (`npm run bench`): **3 s median, 7 s max** on the 8 local anchors of the recorded farm; **5.6 h median, 63.8 h max** on the global table since id 250M. So a stargazer's birth minute is known without fetching its profile, and `birthSpread` costs no extra calls.

### The nine signals

| id | weight | fires when | door it needs |
|---|---|---|---|
| `siblings` | 2 | >= 3 other repos created within +-30 s with >= max(10, S/2) stars, and >= 3 x (control + 1), control = the same window 24 h earlier | search/repositories |
| `ownerCohort` | 1 | owner has <= 2 followers, and >= 10 accounts born within +-6 min with 0 followers and >= max(5, repos/2) repos, >= 3 x (control + 1) | search/users |
| `birthSpread` | 3 | >= 4 confirmed stargazers and IQR(signup time) <= 60 min | starred + id clock |
| `plantingRows` | 3 | rowAgreement >= 0.8 and median gap <= 30 s | starred |
| `field` | 2 | >= 3 other repos starred by >= max(2, ceil(c/2)) of the c confirmed stargazers | starred |
| `hollowAccounts` | 1 | >= 4 checked and >= 75% have 0 followers and were < 180 days old when they starred | /users |
| `thinSoil` | 1 | S >= 50, size <= 64 KB, commits <= 10 | repo + commits |
| `templateTwins` | 1 | >= 2 siblings share the README skeleton hash | readme |
| `knownField` | 3 | >= 3 accounts from an earlier PLANTED field starred it | your index |

**rowAgreement.** Let F be the target plus the field repos. For each confirmed account a, sort its stars on F by `starred_at` into a sequence. For every pair (a, b) that shares >= 3 repos of F, compare the order of the shared repos; the pair agrees if the order is identical. rowAgreement = agreeing pairs / pairs. A farm bot walks a list, so every row is the same; people star in their own order. The median gap is taken between consecutive stars of F within each account.

**README skeleton.** Replace the description with `{desc}`, the repo name with `{name}` and the owner with `{owner}` (case-insensitive), drop non-ASCII (emoji), turn `v1.2` / `1.2.3` into `{v}`, lowercase, collapse whitespace, then take the first 12 hex chars of SHA-1. Farms stamp one template over many repos; on the recorded farm all 9 repos share `b9ae6852e01d`.

### Seeds for big, old repos (the star-event door)

On a repo that is years old, `forks?sort=oldest` returns accounts that forked it in 2021 and have starred hundreds of repos since, so the target is no longer in the first 200 stars of their list. The repo's public events feed (`GET /repos/{o}/{r}/events`, the last 300 events or 90 days) still names the accounts that starred it recently: every `WatchEvent` actor is a stargazer, and its star is new, so one page of its starred list is enough to confirm it. For a repo created more than 30 days ago, starcrop reads 2 pages of events and leads the sample with up to 12 of those actors, then 4 oldest fork owners (2 pages each) and 3 issue/PR authors. Young repos keep the fork-first plan, because a farm forks on day 0.

Measured on 2026-09-26 08:14Z (`npm run bench:live`, door yield = seeds that had the target in their stars / seeds sampled):

```
tinygrad/tinygrad  (33,661 stars) -> GROWN:      star-event 7/9,   fork 0/4, engaged 1/3
sharkdp/hyperfine  (28,907 stars) -> GROWN:      star-event 10/12, fork 1/4, engaged 1/3
sindresorhus/np     (7,713 stars) -> UNSURVEYED: star-event 2/3,   fork 1/4, engaged 0/2
pmndrs/zustand     (58,752 stars) -> GROWN:      star-event 12/12, fork 1/4, engaged 0/3
all 4:  star-event 31/36 (86 %), fork 3/16 (19 %), engaged 2/11 (18 %)
2026-09-25 17:25Z, same 4 repos: star-event 36/39 (92 %), fork 3/16 (19 %), engaged 3/11 (27 %); np GROWN
```

Before this door the first three came back `UNSURVEYED`. The events feed is a moving window: np gets few stars a day, so on 2026-09-26 its feed held only 3 star events and it came back `UNSURVEYED` with a measured `reason` rather than `GROWN`. Star events are a sample of *recent* stars, which is also where a farm bought for an old repo shows up. Issue and PR authors are engaged by selection (a farm rarely opens issues), so they count toward the signals but can never carry `GROWN` alone.

**Verdict.**

```
SEEDLING    if S < 20                                    (nothing to farm-check)
PLANTED     if score >= 7, or birthSpread AND plantingRows fired, or knownField >= 5
MIXED       if score >= 3
GROWN       if >= 4 confirmed, >= 4 of them from a sampling door (not issue/PR authors),
            and birthSpread IQR >= 30 days
UNSURVEYED  otherwise                                    (too few stargazers visible to say)
```

A signal that could not be measured (budget ran out, rate limit, no siblings) has `fired: null` and never counts. Running out of time is never an error: every GitHub call (connect, headers and the body download) shares one 8 s timeout capped at the survey deadline, and a survey that hits the deadline comes back with `partial: true` and what it measured so far. If the deadline passes before GitHub even returns the repository, the report is `UNSURVEYED` with every repo field `null` and a `reason` that says so. That is not a verdict; rerun it. `UNSURVEYED` is the honest answer when the public doors show fewer than 4 stargazers; starcrop never calls a repo `GROWN` by default. An `UNSURVEYED` report carries a `reason` in measured words, for example `Only 2 of 12 sampled accounts (8 fork owners, 4 recent star events) have this repo in their public stars; a verdict needs 4 confirmed stargazers.`, and `stargazers.doors` lists every door's `seeds`, `confirmed` and `available`.

**Cost.** At most 51 GitHub calls per report: 47 core REST calls (repo + owner 2, forks 1, events 2, commits 1, READMEs 5, starred pages 28, profiles 8) and 4 search calls; at most 38 core when the repo is younger than 30 days (1 events page, 1 starred page per seed). A mint adds 1 Helius DAS call (10 credits). Measured: 35 core + 2 search on tinygrad, 28 + 2 on openai/NavierStokesAndEuler (created 2026-09-08). Analysis is O(S x R) for S <= 20 seeds and R <= 200 stars each.

## Install

```sh
npm i starcrop          # PLANNED: not published yet. Until then: git clone, then npm link
```

## Usage

```js
import { survey, renderPlat } from 'starcrop';

const report = await survey('openai/NavierStokesAndEuler', {
  token: process.env.GITHUB_TOKEN,          // strongly recommended: 5,000 calls/h instead of 60
  rpcUrl: process.env.STARCROP_RPC_URL,     // optional, for mint inputs (Helius or any DAS RPC)
});
console.log(report.verdict, `${report.score}/${report.maxScore}`); // GROWN 0/17 (on 2026-09-26)
console.log(report.headline);
for (const s of report.signals) console.log(s.id, s.fired, s.value, s.evidence);
console.log(renderPlat(report));            // the ASCII plat the CLI prints
```

## CLI

```sh
GITHUB_TOKEN=$(gh auth token) node bin/starcrop.js sharkdp/hyperfine   # or `starcrop ...` after `npm link`
starcrop https://github.com/owner/repo --json          # the CropReport as JSON
starcrop <pump.fun mint> --rpc "$STARCROP_RPC_URL"     # resolve the repo the coin links, then survey it
starcrop owner/repo --raw > raw.json                   # every upstream answer, replayable offline with analyze()
                                                       # (it names real accounts: anonymize() it before you share it)
starcrop owner/repo --budget 8000                      # time budget in ms; unfinished signals come back null
```

Exit code 2 on `BAD_INPUT`, `NOT_FOUND`, `NO_REPO`, `RATE_LIMITED` or `UPSTREAM`.

## API

| export | what it does |
|---|---|
| `survey(target, opts?) -> Promise<CropReport>` | `collect()` then `analyze()`. `opts`: `token`, `rpcUrl`, `fetch`, `budgetMs` (default 20000), `maxSeeds` (20), `maxStarredCalls` (28), `knownPlanters(fullName)`. |
| `collect(target, opts?) -> Promise<RawSurvey>` | All network I/O for one report, as a plain JSON object you can record and replay. |
| `analyze(raw) -> CropReport` | Pure scoring. No I/O, no clock reads. `reason` explains an `UNSURVEYED` verdict; `stargazers.doors` gives the yield per door. |
| `seedPlan(mature)`, `eventDoors(events, owner)` | The seed plan per door, and the pure events-feed parser (WatchEvent actors, engaged accounts; bots and the owner dropped). |
| `resolveRepo(input, opts?)` | mint / URL / slug -> `{ fullName, kind, mint, token }`. |
| `idToDate(id, localAnchors?)` | `{ at: Date, exact, source: 'local' \| 'global', extrapolated }` |
| `readmeSkeleton(text, { owner, name, description })` | 12-hex skeleton hash. |
| `anonymize(raw \| raw[], { keep?, map? })` | A RawSurvey with every login replaced by a stable placeholder (`sample-user-NN` for accounts seen as stargazers, `sample-owner-NN` for repo owners, including inside `owner/repo`, profile repos like `alice/alice`, github.com links and @mentions). Ids, dates, counts and README skeletons are kept, so `analyze()` returns the same report with the names swapped (tested on every fixture). `map` (lowercase login -> placeholder) is reused and extended across calls; it holds the real logins, so never commit it. |
| `renderPlat(report)` | The ASCII plat. |
| `parseTarget(input)`, `findGithubRepo(text)` | Input parsing. |
| `StarcropError` | `code` is one of `BAD_INPUT` 400, `NOT_FOUND` 404, `NO_REPO` 422, `RATE_LIMITED` 429 (with `retryAfter`), `UPSTREAM` 502. `toJSON()` gives `{ error, code, ... }`. |

Types are in `src/index.d.ts`.

## Benchmarks

Measured on this machine, not estimated. Reproduce with `npm run bench` (offline) and `GITHUB_TOKEN=$(gh auth token) STARCROP_RPC_URL=... npm run bench:live`.

```
machine: Apple M5, 10 cores, darwin 25.5.0, Node v26.8.1
date: 2026-09-26T08:13:55Z

analyze() ClashDesk (recorded, 13 accounts, 130 stars): 3,685 reports/s
analyze() GROWN fixture (live, young repo, 10 accounts, 445 stars): 5,302 reports/s
idToDate() global table (45 anchors): 207,545 conversions/s
idToDate() with 8 local anchors: 148,162 conversions/s
idToDate() leave-one-out, global anchors since id 250M (33, 2.5M ids apart): median 5.6 h, max 63.8 h
idToDate() leave-one-out, ClashDesk local anchors (8 farm accounts): median 3 s, max 7 s
readmeSkeleton() on a 10,385 B README: 11,676 READMEs/s = 121.3 MB/s

survey() live openai/NavierStokesAndEuler (GROWN), 5 runs: median 4,128 ms (min 3,278, max 4,539); 28 core + 2 search calls per report

survey() live 64S9QFTFhrcLWsXWjTBkaWPS4asdcrQGwvVQWxUjpump (SEEDLING), 5 runs: median 628 ms (min 607, max 921); 2 core + 0 search calls per report

survey() live tinygrad/tinygrad (GROWN), 5 runs: median 4,868 ms (min 4,437, max 5,304); 35 core + 2 search calls per report

door yield tinygrad/tinygrad (33,661 stars) -> GROWN: star-event 7/9, fork 0/4, engaged 1/3; 35 core + 2 search
door yield sharkdp/hyperfine (28,907 stars) -> GROWN: star-event 10/12, fork 1/4, engaged 1/3; 38 core + 2 search
door yield sindresorhus/np (7,713 stars) -> UNSURVEYED: star-event 2/3, fork 1/4, engaged 0/2; 23 core + 2 search
door yield pmndrs/zustand (58,752 stars) -> GROWN: star-event 12/12, fork 1/4, engaged 0/3; 38 core + 2 search
door yield, 4 repos: star-event 31/36 (86 %), fork 3/16 (19 %), engaged 2/11 (18 %)
```

End-to-end time is almost all GitHub latency; the scoring itself takes under 0.3 ms. The mint run includes Helius DAS `getAsset` and the metadata fetch. The recorded farm (ClashDesk) cannot be benchmarked live: GitHub removed its repos and accounts at about 15:40Z on 2026-09-25, a few hours after it was recorded, so it is only replayed from `test/fixtures/`.

## Tests

```sh
npm test      # node --test, offline, on recorded fixtures (no network, no token)
```

Fixtures in `test/fixtures/`:

- `raw.planted.clashdesk.json`: the star farm, rebuilt from calls recorded on 2026-09-25 12:49-12:58Z. Starred lists hold only the stars on the target and its field, and READMEs are stored as their recorded skeleton hashes.
- `raw.grown.riso-windowseat.json`: a live `collect()` of a young organic repo (an individual's, so its owner is a placeholder).
- `raw.seedling.bmc.json`: a live `collect()` from a pump.fun mint whose repo has 3 stars.
- `raw.grown.tinygrad.json`: a live `collect()` of tinygrad/tinygrad (33k stars, created 2020), seeded through the star-event door.

No fixture names a real person. Every login in the live fixtures was replaced with `anonymize()` (stargazers are `sample-user-NN`, repo owners `sample-owner-NNNN`; the organization `tinygrad`, the input of its fixture, is kept). Ids, dates, counts and star lists are the recorded ones, and READMEs carry the skeleton hash of their original text, so every test and benchmark gives the recorded result. The only real names are the RECORDED farm's (AutocratGirder/ClashDesk, 14 accounts), all removed by GitHub (404 on 2026-09-25 and again on 2026-09-26). `test/anonymize.test.js` fails if any other fixture login is not a placeholder.

The tests also cover malformed input, an unknown mint, a mint with no GitHub link, a repo that doesn't exist, an exhausted rate limit, a budget that runs out mid-survey, a response body that stalls mid-download (before the repo arrives, on the owner, on the events feed; `test/timeout.test.js`), empty doors, 16 seeds x 200 stars, the events-feed parser (bots, the owner, duplicates), a big repo seen only through dormant forks (`UNSURVEYED` with a reason), an issue/PR-author-only sample (never `GROWN`), and the worst-case call budget (every 2-page door full, no star events: 27 starred pages, <= 51 calls).

## Limits

- **Only public doors.** starcrop sees stargazers that forked, starred recently enough to be in the events feed, opened an issue or PR, were born next to the owner or own a sibling repo. A farm that stars from aged, unrelated accounts, never forks and starred before the events window can leave few visible stargazers; the answer is then `UNSURVEYED` with a `reason`, not `GROWN`.
- **Star events are recent stars.** The events feed keeps the last 300 events (90 days at most) and can lag by minutes to hours. On a busy repo, pushes and PRs push stars out of it (tinygrad: 11 star actors in 179 events). `GROWN` on a big repo means the recent, visible stargazers look organic, not that every one of its stars is.
- **Birth times are approximate** when they come from the id clock (marked `bornExact: false`, `~` in the plat).
- **A pattern, not an accusation.** Anyone can buy stars for someone else's repo. The report states measured facts and thresholds, never intent.
- **Depends on `/users/{u}/starred` staying public.** If GitHub closes it too, four signals still work: `siblings`, `ownerCohort`, `thinSoil`, `templateTwins`.
- **Evasion.** Randomizing star order and gaps defeats `plantingRows`. Defeating `birthSpread` needs aged accounts with spread-out ids, which is the expensive part of a farm.
- **Rate limits.** Without a token GitHub allows 60 core calls per hour, about 2 reports. Search is limited to 30 calls per minute with a token.

### PLANNED (not built)

- A Memo-program attestation that posts the report hash for a mint on Solana, so launchpads and bots can read it on-chain.
- A browser extension that stamps GROWN / PLANTED next to GitHub links on pump.fun and DexScreener.
- A public planter index others can query.
- An npm release (the package name `starcrop` was free on 2026-09-25).

## Prior art

| tool | how it gets stargazers | difference |
|---|---|---|
| [StarGuard](https://github.com/m-ahmed-elbeskeri/StarGuard) | the repo's stargazer list (REST/GraphQL), burst detection | that list is 404/empty for non-admins since 2026-06-30 |
| [dagster-io/fake-star-detector](https://github.com/dagster-io/fake-star-detector) | GH Archive `WatchEvent` via BigQuery | archive WatchEvents fell from ~2.03M (March 2026) to ~69k (August) on the ClickHouse mirror; the recorded farm shows 2-5 of its 222-224 stars there |
| [CMU StarScout](https://github.com/hehao98/StarScout) | GH Archive | same |
| real-stars / realstars extensions | StarGuard / StarScout | inherit the above |

starcrop reads the star edges from the stargazer's side, finds the stargazers by birth-time clustering and the id clock, and can start from a Solana mint.

## License

MIT. See [LICENSE](LICENSE).

---

Project site: Starcrop ($STCROP), where the live crop report runs on this library.
