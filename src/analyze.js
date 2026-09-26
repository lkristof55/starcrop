// analyze(raw): RawSurvey -> CropReport. Pure and offline: no I/O, no clock reads (checkedAt comes from raw).
import { idToDate } from './idclock.js';
import { readmeSkeleton } from './skeleton.js';
import { quantile, median, round, DAY, iso, t } from './stats.js';

export const MAX_SCORE = 17;
export const SIGNAL_ORDER = ['siblings', 'ownerCohort', 'birthSpread', 'plantingRows', 'field', 'hollowAccounts', 'thinSoil', 'templateTwins', 'knownField'];
export const WEIGHTS = { siblings: 2, ownerCohort: 1, birthSpread: 3, plantingRows: 3, field: 2, hollowAccounts: 1, thinSoil: 1, templateTwins: 1, knownField: 3 };
export const LABELS = {
  siblings: 'Sibling crop', ownerCohort: 'Owner birth cohort', birthSpread: 'Stargazer birth spread', plantingRows: 'Planting rows',
  field: 'The field', hollowAccounts: 'Hollow accounts', thinSoil: 'Thin soil', templateTwins: 'Template twins', knownField: 'Known field',
};
const UNITS = {
  siblings: 'repos', ownerCohort: 'accounts', birthSpread: 'minutes (IQR)', plantingRows: 'row agreement', field: 'repos',
  hollowAccounts: 'share', thinSoil: 'stars per KB', templateTwins: 'repos', knownField: 'known planters',
};
export const SEEDLING_STARS = 20;
/** Confirmed stargazers a verdict needs; GROWN needs them from sampling doors (not only issue/PR authors). */
export const MIN_CONFIRMED = 4;
/** Doors in report order, with the words the reason and headline use. 'engaged' accounts are organic by selection. */
export const DOORS = {
  'star-event': 'recent star events', fork: 'fork owners', engaged: 'issue/PR authors', cohort: 'owner birth cohort',
  'sibling-owner': 'sibling owners', 'known-planter': 'known planters',
};
export const LIMITS = [
  'Stargazers are seen only through public doors: recent star events, fork owners, issue/PR authors, birth cohorts and sibling owners. GitHub hides the full stargazer list since 2026-06-30.',
  'Birth times are approximate: account ids are converted with the id clock (piecewise-linear anchors).',
  'A pattern, not an accusation: a repo owner can be starred by a farm without asking for it.',
];

const fmtN = (n) => Number(n).toLocaleString('en-US');
const hm = (ms) => iso(ms).slice(11, 16);
const hms = (ms) => iso(ms).slice(11, 19);
const ymd = (ms) => iso(ms).slice(0, 10);
const ym = (ms) => iso(ms).slice(0, 7);
const range = (xs) => (xs.length ? (Math.min(...xs) === Math.max(...xs) ? `${Math.min(...xs)}` : `${Math.min(...xs)}-${Math.max(...xs)}`) : '');

/** Human duration: "9.3 minutes", "8 h 40 min", "12 days", "7.7 years". */
export function humanSpan(ms) {
  const min = ms / 60e3;
  if (min < 1) return `${Math.round(ms / 1000)} s`;
  if (min < 120) return `${round(min, 1)} minutes`;
  if (min < 48 * 60) { const h = Math.floor(min / 60), m = Math.round(min % 60); return m ? `${h} h ${m} min` : `${h} h`; }
  const d = ms / DAY;
  if (d < 90) return `${Math.round(d)} days`;
  return `${round(d / 365.25, 1)} years`;
}

function signal(id, fields) {
  return { id, label: LABELS[id], fired: null, weight: WEIGHTS[id], value: null, unit: UNITS[id], control: null, threshold: '', evidence: '', ...fields };
}

/**
 * @param {import('./index.js').RawSurvey} raw
 * @returns {import('./index.js').CropReport}
 */
export function analyze(raw) {
  if (raw.repo.stars == null) return cutShortReport(raw);
  const target = raw.repo.fullName;
  const targetKey = target.toLowerCase();
  const S = raw.repo.stars;
  const seedling = S < SEEDLING_STARS;
  const owner = raw.owner;

  // ---- local anchors for the id clock: the owner, then every /users profile this survey fetched
  const localAnchors = [];
  if (owner?.id && owner?.createdAt) localAnchors.push({ id: owner.id, createdAt: owner.createdAt });
  for (const p of Object.values(raw.profiles || {})) if (p?.id && p?.createdAt) localAnchors.push({ id: p.id, createdAt: p.createdAt });
  const born = (id, login) => {
    const p = login && raw.profiles?.[login];
    if (p?.createdAt) return { ms: t(p.createdAt), exact: true };
    if (owner && (login === owner.login || id === owner.id) && owner.createdAt) return { ms: t(owner.createdAt), exact: true };
    return { ms: idToDate(id, localAnchors).at.getTime(), exact: false };
  };

  // ---- stargazers: seeds whose starred list contains the target
  const starredMeasured = raw.starred && Object.keys(raw.starred).length > 0;
  const lists = {}; // login -> [{repo, at(ms), idx}]
  for (const s of raw.seeds || []) {
    const l = raw.starred?.[s.login];
    if (!l) continue;
    lists[s.login] = l.items.map((x, idx) => ({ repo: x.repo, key: x.repo.toLowerCase(), at: t(x.at), idx, stars: x.stars, createdAt: x.createdAt }));
  }
  const confirmed = [];
  for (const s of raw.seeds || []) {
    const l = lists[s.login];
    if (!l) continue;
    const hit = l.find((x) => x.key === targetKey);
    if (!hit) continue;
    const b = born(s.id, s.login);
    const p = raw.profiles?.[s.login] || null;
    confirmed.push({ login: s.login, id: s.id, bornMs: b.ms, bornExact: b.exact, via: s.via, starredMs: hit.at, followers: p ? p.followers : null, publicRepos: p ? p.publicRepos : null });
  }
  const c = confirmed.length;
  // confirmed stargazers from sampling doors: issue/PR authors are engaged by selection, so they can't carry GROWN alone
  const sampled = confirmed.filter((a) => a.via !== 'engaged').length;
  const doorOrder = [...new Set([...(raw.doors?.plan || []).map((d) => d.via), ...(raw.seeds || []).map((x) => x.via)])];
  const doors = doorOrder.map((via) => ({
    via, seeds: (raw.seeds || []).filter((x) => x.via === via).length, confirmed: confirmed.filter((a) => a.via === via).length,
    available: raw.doors?.plan?.find((d) => d.via === via)?.available ?? null,
  })).filter((d) => d.seeds || d.available);
  const signals = {};
  const notMeasured = (id, why, extra = {}) => signal(id, { fired: null, value: null, threshold: THRESHOLDS[id](raw), evidence: why, ...extra });

  // ---- siblings
  const sib = raw.siblings;
  const minStars = sib?.minStars ?? Math.max(10, Math.floor(S / 2));
  const sibItems = (sib?.items || []).filter((x) => x.fullName.toLowerCase() !== targetKey && x.stars >= minStars);
  if (seedling) signals.siblings = notMeasured('siblings', `Not measured: under ${SEEDLING_STARS} stars.`);
  else if (!sib) signals.siblings = notMeasured('siblings', 'Not measured: the sibling search did not finish (budget or rate limit).');
  else {
    const inItems = (sib.items || []).some((x) => x.fullName.toLowerCase() === targetKey);
    const count = Math.max(sibItems.length, sib.total != null ? sib.total - (inItems ? 1 : 0) : 0);
    const control = sib.controlCount;
    const fired = count >= 3 ? (control == null ? null : count >= 3 * (control + 1)) : false;
    let evidence;
    if (count > 0) {
      const ts = sibItems.map((x) => t(x.createdAt));
      const lo = Math.min(...ts), hi = Math.max(...ts);
      const when = lo === hi ? `${ymd(lo)} ${hms(lo)}Z` : `${ymd(lo)} ${hms(lo)}-${hms(hi)}Z`;
      evidence = `${count} other repo${count === 1 ? ' was' : 's were'} created ${when} with ${range(sibItems.map((x) => x.stars))} stars${count === 1 ? '' : ' each'}; the same window a day earlier has ${control ?? 'not measured'}.`;
    } else evidence = `No other repo created within 30 s of it has ${minStars}+ stars.`;
    signals.siblings = signal('siblings', { fired, value: count, control: control ?? null, threshold: THRESHOLDS.siblings(raw), evidence });
  }

  // ---- ownerCohort
  const coh = raw.cohort;
  if (seedling) signals.ownerCohort = notMeasured('ownerCohort', `Not measured: under ${SEEDLING_STARS} stars.`);
  else if (owner && owner.followers > 2) signals.ownerCohort = signal('ownerCohort', { fired: false, threshold: 'computed only when the owner has <= 2 followers', evidence: `Owner has ${owner.followers} followers; cohort not searched.` });
  else if (!coh?.computed) signals.ownerCohort = notMeasured('ownerCohort', 'Not measured: the cohort search did not finish (budget or rate limit).');
  else {
    const ownerIn = (coh.items || []).some((x) => x.login === owner.login);
    const count = Math.max(0, (coh.total ?? 0) - (ownerIn ? 1 : 0));
    const control = coh.controlCount;
    const fired = count >= 10 ? (control == null ? null : count >= 3 * (control + 1)) : false;
    const f = t(coh.from), to = t(coh.to);
    signals.ownerCohort = signal('ownerCohort', {
      fired, value: count, control: control ?? null, threshold: THRESHOLDS.ownerCohort(raw),
      evidence: `${count} account${count === 1 ? '' : 's'} born ${ymd(f)} ${hm(f)}-${hm(to)}Z match the owner profile (0 followers, >= ${coh.minRepos} repos); ${control ?? 'not measured'} match a day earlier.`,
    });
  }

  // ---- birthSpread
  const bornSorted = confirmed.map((x) => x.bornMs).sort((a, b) => a - b);
  let iqrMin = null;
  if (seedling) signals.birthSpread = notMeasured('birthSpread', `Not measured: under ${SEEDLING_STARS} stars.`);
  else if (!starredMeasured) signals.birthSpread = notMeasured('birthSpread', 'Not measured: no starred list was read (budget or rate limit).');
  else if (c < 4) signals.birthSpread = signal('birthSpread', { fired: false, threshold: THRESHOLDS.birthSpread(), evidence: `Only ${c} confirmed stargazer${c === 1 ? '' : 's'} visible; the spread needs 4.` });
  else {
    const q1 = quantile(bornSorted, 0.25), q3 = quantile(bornSorted, 0.75);
    const iqr = (q3 - q1) / 60e3;
    iqrMin = iqr < 100 ? round(iqr, 1) : Math.round(iqr);
    const fired = iqr <= 60;
    const byBorn = [...confirmed].sort((a, b) => a.bornMs - b.bornMs);
    let evidence;
    if (fired) {
      const lo = byBorn[0], hi = byBorn[byBorn.length - 1];
      const allSpan = (hi.bornMs - lo.bornMs) / 60e3;
      evidence = `The middle half of the ${c} confirmed stargazers were born within ${iqrMin} minutes, and all ${c} within ${humanSpan(hi.bornMs - lo.bornMs)}, on ${ymd(lo.bornMs)} ${hm(lo.bornMs)}-${hm(hi.bornMs)}Z (ids ${fmtN(Math.min(...confirmed.map((x) => x.id)))}-${fmtN(Math.max(...confirmed.map((x) => x.id)))}).`;
      void allSpan;
    } else {
      const i1 = Math.round((c - 1) * 0.25), i3 = Math.round((c - 1) * 0.75);
      evidence = `The middle half of the ${c} confirmed stargazers were born ${ym(q1)} to ${ym(q3)} (ids ${fmtN(byBorn[i1].id)}-${fmtN(byBorn[i3].id)}).`;
    }
    signals.birthSpread = signal('birthSpread', { fired, value: iqrMin, threshold: THRESHOLDS.birthSpread(), evidence });
  }

  // ---- field: other repos starred by >= max(2, ceil(c/2)) confirmed stargazers
  const counts = new Map(); // key -> { fullName, n }
  for (const a of confirmed) {
    const seen = new Set();
    for (const x of lists[a.login]) {
      if (x.key === targetKey || seen.has(x.key)) continue;
      seen.add(x.key);
      const e = counts.get(x.key) || { fullName: x.repo, n: 0 };
      e.n++;
      counts.set(x.key, e);
    }
  }
  const minBy = Math.max(2, Math.ceil(c / 2));
  const fieldRepos = c >= 3 ? [...counts.values()].filter((e) => e.n >= minBy).sort((a, b) => b.n - a.n || a.fullName.localeCompare(b.fullName)) : [];
  const sibKeys = new Set(sibItems.map((x) => x.fullName.toLowerCase()));
  if (seedling) signals.field = notMeasured('field', `Not measured: under ${SEEDLING_STARS} stars.`);
  else if (!starredMeasured) signals.field = notMeasured('field', 'Not measured: no starred list was read (budget or rate limit).');
  else if (c < 3) signals.field = signal('field', { fired: false, threshold: THRESHOLDS.field(), evidence: `Only ${c} confirmed stargazer${c === 1 ? '' : 's'} visible; the field needs 3.` });
  else {
    const k = fieldRepos.length;
    let evidence;
    if (k) {
      const allOf = fieldRepos.every((e) => e.n === c);
      const nSib = fieldRepos.filter((e) => sibKeys.has(e.fullName.toLowerCase())).length;
      evidence = allOf
        ? `The ${c} accounts all starred the same ${k} other repo${k === 1 ? '' : 's'}`
        : `${k} other repo${k === 1 ? ' is' : 's are'} each starred by at least ${minBy} of the ${c} confirmed stargazers`;
      evidence += nSib ? `; ${nSib} ${nSib === 1 ? 'is a sibling' : 'are its siblings'} (created within 30 s of it).` : '.';
    } else {
      const top = [...counts.values()].sort((a, b) => b.n - a.n || a.fullName.localeCompare(b.fullName)).slice(0, 2);
      evidence = top.length && top[0].n > 1
        ? `No other repo is starred by ${minBy} or more of the ${c} (the most shared: ${top.map((e) => e.fullName).join(' and ')}, ${top.map((e) => e.n).join(' and ')}).`
        : `No other repo is starred by ${minBy} or more of the ${c}; their other stars do not overlap.`;
    }
    signals.field = signal('field', { fired: k >= 3, value: k, threshold: THRESHOLDS.field(), evidence });
  }

  // ---- plantingRows: identical star order over shared field repos, and the gap between stars
  const fieldSet = new Set([targetKey, ...fieldRepos.map((e) => e.fullName.toLowerCase())]);
  const seqs = confirmed.map((a) => lists[a.login].filter((x) => fieldSet.has(x.key)).sort((p, q) => p.at - q.at || q.idx - p.idx));
  let pairs = 0, agree = 0;
  for (let i = 0; i < seqs.length; i++) {
    const si = new Set(seqs[i].map((x) => x.key));
    for (let j = i + 1; j < seqs.length; j++) {
      const shared = new Set(seqs[j].map((x) => x.key).filter((k) => si.has(k)));
      if (shared.size < 3) continue;
      pairs++;
      const oi = seqs[i].filter((x) => shared.has(x.key)).map((x) => x.key).join('\n');
      const oj = seqs[j].filter((x) => shared.has(x.key)).map((x) => x.key).join('\n');
      if (oi === oj) agree++;
    }
  }
  const gaps = [];
  for (const s of seqs) for (let i = 1; i < s.length; i++) gaps.push((s[i].at - s[i - 1].at) / 1000);
  const rowAgreement = pairs ? round(agree / pairs, 2) : null;
  const medianGap = gaps.length ? round(median(gaps), 1) : null;
  if (seedling) signals.plantingRows = notMeasured('plantingRows', `Not measured: under ${SEEDLING_STARS} stars.`);
  else if (!starredMeasured) signals.plantingRows = notMeasured('plantingRows', 'Not measured: no starred list was read (budget or rate limit).');
  else if (!pairs) signals.plantingRows = signal('plantingRows', { fired: false, threshold: THRESHOLDS.plantingRows(), evidence: 'No two confirmed stargazers share 3+ starred repos, so there are no rows to compare.' });
  else {
    const fired = rowAgreement >= 0.8 && medianGap != null && medianGap <= 30;
    const lead = agree === pairs ? `All ${pairs} pair${pairs === 1 ? '' : 's'} of confirmed stargazers starred the shared repos in the identical order` : `${agree} of ${pairs} pairs of confirmed stargazers starred their shared repos in the identical order`;
    signals.plantingRows = signal('plantingRows', { fired, value: rowAgreement, threshold: THRESHOLDS.plantingRows(), evidence: `${lead}; median ${medianGap} s between stars.` });
  }

  // ---- hollowAccounts: 0 followers and < 180 days old when they starred (profiles fetched only)
  const checked = confirmed.filter((a) => raw.profiles?.[a.login]).slice(0, 8);
  if (seedling) signals.hollowAccounts = notMeasured('hollowAccounts', `Not measured: under ${SEEDLING_STARS} stars.`);
  else if (!checked.length) signals.hollowAccounts = c ? notMeasured('hollowAccounts', 'Not measured: no stargazer profile was read (budget or rate limit).') : signal('hollowAccounts', { fired: false, threshold: THRESHOLDS.hollowAccounts(), evidence: 'No confirmed stargazer to check.' });
  else {
    const ages = checked.map((a) => (a.starredMs - a.bornMs) / DAY);
    const hollow = checked.filter((a, i) => a.followers === 0 && ages[i] < 180);
    const share = round(hollow.length / checked.length, 2);
    const fired = checked.length >= 4 && share >= 0.75;
    let evidence;
    if (hollow.length) {
      const hAges = hollow.map((a) => Math.floor((a.starredMs - a.bornMs) / DAY));
      evidence = `${hollow.length} of ${checked.length} checked stargazers have 0 followers and were ${range([Math.min(...hAges), Math.max(...hAges)].filter((v, i, arr) => arr.indexOf(v) === i))} days old when they starred.`;
    } else {
      const fl = checked.map((a) => a.followers ?? 0);
      const yrs = ages.map((d) => Math.floor(d / 365.25));
      evidence = `0 of ${checked.length} checked stargazers are hollow (${range([Math.min(...fl), Math.max(...fl)].filter((v, i, arr) => arr.indexOf(v) === i))} followers, accounts ${range([Math.min(...yrs), Math.max(...yrs)].filter((v, i, arr) => arr.indexOf(v) === i))} years old).`;
    }
    signals.hollowAccounts = signal('hollowAccounts', { fired, value: share, threshold: THRESHOLDS.hollowAccounts(), evidence });
  }

  // ---- thinSoil
  {
    const size = raw.repo.sizeKb, commits = raw.commits;
    const value = round(S / Math.max(1, size), 3);
    let fired = false;
    if (S >= 50 && size <= 64) fired = commits == null ? null : commits <= 10;
    const evidence = size <= 64
      ? `${fmtN(S)} stars on a ${fmtN(size)} KB repo with ${commits ?? 'an unknown number of'} commit${commits === 1 ? '' : 's'}.`
      : `${fmtN(S)} stars on ${fmtN(size)} KB with ${commits ?? 'an unknown number of'} commit${commits === 1 ? '' : 's'}.`;
    signals.thinSoil = signal('thinSoil', { fired, value, threshold: THRESHOLDS.thinSoil(), evidence });
  }

  // ---- templateTwins
  const skeletonOf = (fullName, desc) => {
    const r = raw.readmes?.[fullName];
    if (!r) return null;
    if (r.skeleton) return r.skeleton;
    if (r.text == null) return null;
    const [o, n] = fullName.split('/');
    return readmeSkeleton(r.text, { owner: o, name: n, description: desc });
  };
  const targetSk = skeletonOf(target, raw.repo.description);
  const sibSk = new Map(sibItems.map((x) => [x.fullName, skeletonOf(x.fullName, x.description ?? null)]));
  if (seedling) signals.templateTwins = notMeasured('templateTwins', `Not measured: under ${SEEDLING_STARS} stars.`);
  else if (!sibItems.length) signals.templateTwins = notMeasured('templateTwins', sib ? 'No siblings to compare.' : 'Not measured: no sibling search.');
  else if (!targetSk) signals.templateTwins = notMeasured('templateTwins', 'The repo has no README to compare (or it was not read).');
  else {
    const checkedSibs = [...sibSk.values()].filter(Boolean);
    const n = checkedSibs.filter((s) => s === targetSk).length;
    const evidence = n
      ? `${n} of ${checkedSibs.length} checked sibling${checkedSibs.length === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} README skeleton ${targetSk}, identical to this one after names and descriptions are removed.`
      : `None of the ${checkedSibs.length} checked siblings share its README skeleton ${targetSk}.`;
    signals.templateTwins = signal('templateTwins', { fired: n >= 2, value: n, threshold: THRESHOLDS.templateTwins(), evidence });
  }

  // ---- knownField
  const known = raw.known;
  if (!known || !known.indexed) signals.knownField = notMeasured('knownField', 'No surveyed field in the index yet.');
  else {
    const planters = new Set((known.planters || []).map((x) => x.toLowerCase()));
    const hits = new Set((known.starredThis || []).map((x) => x.toLowerCase()));
    for (const a of confirmed) if (planters.has(a.login.toLowerCase())) hits.add(a.login.toLowerCase());
    const v = hits.size;
    signals.knownField = signal('knownField', {
      fired: v >= 3, value: v, threshold: THRESHOLDS.knownField(),
      evidence: v ? `${v} account${v === 1 ? '' : 's'} from earlier PLANTED fields starred this repo.` : 'No known planter starred it.',
    });
  }

  const list = SIGNAL_ORDER.map((id) => signals[id]);
  const score = list.reduce((s, x) => s + (x.fired === true ? x.weight : 0), 0);

  // ---- verdict
  let verdict;
  if (seedling) verdict = 'SEEDLING';
  else if (score >= 7 || (signals.birthSpread.fired === true && signals.plantingRows.fired === true) || (signals.knownField.value ?? 0) >= 5) verdict = 'PLANTED';
  else if (score >= 3) verdict = 'MIXED';
  else if (c >= MIN_CONFIRMED && sampled >= MIN_CONFIRMED && (signals.birthSpread.value ?? 0) >= 43200) verdict = 'GROWN';
  else verdict = 'UNSURVEYED';

  // ---- report pieces
  const targetCreated = t(raw.repo.createdAt);
  const sibRepos = [
    { fullName: target, createdAt: raw.repo.createdAt, stars: S, forks: raw.repo.forks, ownerLogin: owner?.login ?? target.split('/')[0], ownerId: owner?.id ?? null, description: raw.repo.description },
    ...sibItems,
  ].map((x) => {
    const b = x.ownerId ? born(x.ownerId, x.ownerLogin) : null;
    return {
      fullName: x.fullName, createdAt: x.createdAt, offsetSeconds: Math.round((t(x.createdAt) - targetCreated) / 1000), stars: x.stars, forks: x.forks,
      ownerLogin: x.ownerLogin, ownerId: x.ownerId, ownerBornAt: b ? iso(b.ms) : null,
      skeleton: x.fullName === target ? targetSk : sibSk.get(x.fullName) ?? null,
    };
  }).sort((a, b) => t(a.createdAt) - t(b.createdAt) || a.fullName.localeCompare(b.fullName));

  const plantings = [];
  for (const a of confirmed) for (const x of lists[a.login]) if (fieldSet.has(x.key)) plantings.push({ login: a.login, repo: x.repo, at: iso(x.at) });
  plantings.sort((p, q) => (p.login < q.login ? -1 : p.login > q.login ? 1 : t(p.at) - t(q.at)));

  const accounts = [...confirmed].sort((a, b) => a.id - b.id).map((a) => ({
    login: a.login, id: a.id, bornAt: iso(a.bornMs), bornExact: a.bornExact, via: a.via, starredAt: iso(a.starredMs), followers: a.followers, publicRepos: a.publicRepos,
  }));

  const report = {
    v: 1,
    checkedAt: raw.checkedAt,
    source: raw.source || 'live',
    partial: !!raw.partial,
    input: raw.input,
    repo: {
      fullName: target, url: `https://github.com/${target}`, description: raw.repo.description ?? null, createdAt: raw.repo.createdAt, pushedAt: raw.repo.pushedAt ?? null,
      stars: S, forks: raw.repo.forks, sizeKb: raw.repo.sizeKb, commits: raw.commits ?? null, language: raw.repo.language ?? null,
      owner: owner ? { login: owner.login, id: owner.id, createdAt: owner.createdAt, followers: owner.followers, publicRepos: owner.publicRepos } : null,
    },
    verdict, score, maxScore: MAX_SCORE,
    headline: '',
    reason: null,
    signals: list,
    siblings: { from: sib?.from ?? iso(targetCreated - 30e3), to: sib?.to ?? iso(targetCreated + 30e3), minStars, controlCount: sib?.controlCount ?? null, repos: sibRepos },
    cohort: coh?.computed
      ? { from: coh.from, to: coh.to, query: coh.query, count: signals.ownerCohort.value, controlCount: coh.controlCount ?? null, computed: true }
      : { from: null, to: null, query: null, count: null, controlCount: null, computed: false },
    stargazers: { seeds: (raw.seeds || []).length, confirmed: c, accounts, birthSpreadMinutes: iqrMin, rowAgreement, medianGapSeconds: medianGap, doors },
    field: {
      id: raw.fieldId ?? null,
      repos: fieldRepos.slice(0, 24).map((e) => ({ fullName: e.fullName, starredBy: e.n, share: round(e.n / c, 2) })),
      plantings: plantings.slice(0, 400),
    },
    trace: raw.trace || [],
    cost: raw.cost || { githubCore: 0, githubSearch: 0, heliusCredits: 0 },
    limits: [...LIMITS, ...(raw.limits || [])],
  };
  report.reason = verdict === 'UNSURVEYED' ? unsurveyedReason(report, signals, c, sampled, doors, raw) : null;
  report.headline = headline(report, signals, confirmed, fieldRepos, doors);
  return report;
}

/** The time budget ran out before GitHub returned the repository itself: UNSURVEYED, nothing measured, and why. */
export function cutShortReport(raw) {
  const target = raw.repo.fullName;
  const why = 'Not measured: the time budget ran out before GitHub returned the repository.';
  return {
    v: 1, checkedAt: raw.checkedAt, source: raw.source || 'live', partial: true, input: raw.input,
    repo: { fullName: target, url: `https://github.com/${target}`, description: null, createdAt: null, pushedAt: null, stars: null, forks: null, sizeKb: null, commits: null, language: null, owner: null },
    verdict: 'UNSURVEYED', score: 0, maxScore: MAX_SCORE,
    headline: `Cut short: GitHub did not return ${target} within the time budget, so nothing was measured.`,
    reason: 'The time budget ran out before GitHub returned the repository itself, so no signal was measured. This is not a verdict; a retry in a minute usually finishes.',
    signals: SIGNAL_ORDER.map((id) => signal(id, { fired: null, threshold: THRESHOLDS[id](raw), evidence: why })),
    siblings: { from: null, to: null, minStars: null, controlCount: null, repos: [] },
    cohort: { from: null, to: null, query: null, count: null, controlCount: null, computed: false },
    stargazers: { seeds: 0, confirmed: 0, accounts: [], birthSpreadMinutes: null, rowAgreement: null, medianGapSeconds: null, doors: [] },
    field: { id: null, repos: [], plantings: [] },
    trace: raw.trace || [],
    cost: raw.cost || { githubCore: 0, githubSearch: 0, heliusCredits: 0 },
    limits: [...LIMITS, ...(raw.limits || [])],
  };
}

const doorList = (doors) => doors.filter((d) => d.seeds).map((d) => `${d.seeds} ${DOORS[d.via] || d.via}`).join(', ');

/** Why a report is UNSURVEYED, in one or two measured sentences. */
export function unsurveyedReason(r, s, c, sampled, doors, raw = {}) {
  const n = r.stargazers.seeds;
  const cut = r.partial ? ' The survey was cut short (time budget or rate limit), so a retry may see more.' : '';
  const ev = raw.doors?.events;
  const noEvents = ev && ev.starActors === 0 ? ' The public events feed shows no recent stars on it.' : '';
  if (!n && r.partial) return `The survey was cut short (time budget or rate limit) before any stargazer was sampled, so the public doors were not all read; a verdict needs ${MIN_CONFIRMED} confirmed stargazers, and a retry may see more.${noEvents}`;
  if (!n) return `No stargazer is visible through the public doors (no forks, no recent star events, no cohort or siblings); a verdict needs ${MIN_CONFIRMED} confirmed stargazers.${noEvents}${cut}`;
  if (c < MIN_CONFIRMED) return `Only ${c} of ${n} sampled accounts (${doorList(doors)}) have this repo in their public stars; a verdict needs ${MIN_CONFIRMED} confirmed stargazers.${noEvents}${cut}`;
  if (sampled < MIN_CONFIRMED) return `${c} confirmed stargazers, but ${c - sampled} are issue/PR authors, who are engaged by selection; GROWN needs ${MIN_CONFIRMED} from the star-event, fork, cohort or sibling doors (${sampled} found).${cut}`;
  const v = s.birthSpread.value;
  if (v != null && v < 43200) return `${c} confirmed stargazers were born ${humanSpan(v * 60e3)} apart (IQR): too close together to call it grown (needs 30 days) and too few planted signals fired (${r.score}/${r.maxScore}, MIXED needs 3).${cut}`;
  return `${c} confirmed stargazers, but the signals could not be measured.${cut}`;
}

const THRESHOLDS = {
  siblings: (raw) => `>= 3 repos with >= ${raw.siblings?.minStars ?? Math.max(10, Math.floor(raw.repo.stars / 2))} stars created within +-30 s, and >= 3x the same window 24 h earlier`,
  ownerCohort: (raw) => `>= 10 accounts born within +-6 min of the owner with 0 followers and >= ${raw.cohort?.minRepos ?? Math.max(5, Math.floor((raw.owner?.publicRepos ?? 0) / 2))} repos, and >= 3x the window 24 h earlier`,
  birthSpread: () => '<= 60 min between the 25th and 75th percentile birth of >= 4 confirmed stargazers',
  plantingRows: () => '>= 0.8 of stargazer pairs star their shared repos in the same order, median gap <= 30 s',
  field: () => '>= 3 other repos starred by >= 50% of confirmed stargazers',
  hollowAccounts: () => '>= 0.75 of up to 8 checked stargazers have 0 followers and were < 180 days old when they starred',
  thinSoil: () => '>= 50 stars on <= 64 KB of repo and <= 10 commits',
  templateTwins: () => '>= 2 siblings share the README skeleton hash',
  knownField: () => '>= 3 accounts from an earlier PLANTED field starred this repo',
};

function headline(r, s, confirmed, fieldRepos, doors = []) {
  const c = confirmed.length;
  if (r.verdict === 'SEEDLING') return `${r.repo.stars} star${r.repo.stars === 1 ? '' : 's'}: a seedling. Nothing to check; stars aren't the claim here, the code is.`;
  if (r.verdict === 'PLANTED' && s.birthSpread.fired && s.plantingRows.fired) {
    const b = confirmed.map((a) => a.bornMs);
    const span = humanSpan(Math.max(...b) - Math.min(...b));
    const k = fieldRepos.length;
    const order = s.plantingRows.value === 1 ? 'in the same order' : `in the same order (${Math.round(s.plantingRows.value * 100)}% of pairs)`;
    return `${c} of ${r.stargazers.seeds} sampled stargazers were born within ${span} of each other and starred the same ${k} repo${k === 1 ? '' : 's'} ${order}, ${r.stargazers.medianGapSeconds} s apart.`;
  }
  const fired = SIGNAL_ORDER.filter((id) => s[id].fired === true);
  if (r.verdict === 'PLANTED' || r.verdict === 'MIXED') {
    const parts = fired.slice(0, 3).map((id) => s[id].evidence.replace(/\.$/, ''));
    return `${r.verdict === 'PLANTED' ? 'Planted pattern' : 'Mixed'}, ${r.score}/${r.maxScore}: ${parts.join('; ')}.`;
  }
  if (r.verdict === 'GROWN') {
    const b = confirmed.map((a) => a.bornMs), st = confirmed.map((a) => a.starredMs);
    const y0 = iso(Math.min(...b)).slice(0, 4), y1 = iso(Math.max(...b)).slice(0, 4);
    const own = s.field.value === 0 ? ', each on their own path' : '';
    return `${c} confirmed stargazers were born between ${y0} and ${y1} and starred it over ${humanSpan(Math.max(...st) - Math.min(...st))}${own}.`;
  }
  if (!r.stargazers.seeds && r.partial) return 'Cut short before any stargazer was sampled (time budget or rate limit); too few to call it grown or planted.';
  const tried = doors.filter((d) => d.seeds).map((d) => DOORS[d.via] || d.via).join(', ') || 'forks, star events, cohort, siblings';
  if (c >= MIN_CONFIRMED) return `${c} stargazers confirmed through public doors (${tried}), but not enough to call it grown or planted.`;
  return c
    ? `Only ${c} stargazer${c === 1 ? ' is' : 's are'} visible through public doors (${tried}); too few to call it grown or planted.`
    : `No stargazer is visible through public doors (${tried}); too few to call it grown or planted.`;
}

/** Short summary used in lists (ReportSummary). */
export function summarize(report) {
  return {
    fullName: report.repo.fullName, verdict: report.verdict, score: report.score, maxScore: report.maxScore, stars: report.repo.stars,
    createdAt: report.repo.createdAt, checkedAt: report.checkedAt, headline: report.headline,
    mint: report.input?.mint ?? null, symbol: report.input?.token?.symbol ?? null, fieldId: report.field?.id ?? null,
  };
}
