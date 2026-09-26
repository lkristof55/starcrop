import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, SIGNAL_ORDER, summarize, renderPlat } from '../src/index.js';
import { load, clone } from './helpers.js';

const planted = load('raw.planted.clashdesk.json');
const grown = load('raw.grown.riso-windowseat.json');
const seedling = load('raw.seedling.bmc.json');
const byId = (r) => Object.fromEntries(r.signals.map((s) => [s.id, s]));

test('recorded star farm (ClashDesk) is PLANTED 14/17 with the recorded measurements', () => {
  const r = analyze(planted);
  assert.equal(r.verdict, 'PLANTED');
  assert.equal(r.score, 14);
  assert.deepEqual(r.signals.map((s) => s.id), SIGNAL_ORDER);
  const s = byId(r);
  assert.equal(s.siblings.value, 8); assert.equal(s.siblings.control, 0);
  assert.equal(s.ownerCohort.value, 29); assert.equal(s.ownerCohort.control, 2);
  assert.ok(s.birthSpread.value > 5 && s.birthSpread.value < 7, String(s.birthSpread.value));
  assert.equal(s.plantingRows.value, 1); assert.equal(r.stargazers.medianGapSeconds, 4);
  assert.equal(s.field.value, 9);
  assert.equal(s.hollowAccounts.value, 1);
  assert.equal(s.thinSoil.value, 56);
  assert.equal(s.templateTwins.value, 8);
  assert.equal(s.knownField.fired, null);
  assert.equal(r.stargazers.confirmed, 13);
  assert.match(r.headline, /13 of 13 sampled stargazers were born within 9\.3 minutes/);
  assert.equal(r.siblings.repos[0].offsetSeconds, 0);
  assert.ok(r.field.plantings.length > 100 && r.field.plantings.length <= 400);
});

test('live organic repo (riso-windowseat) is GROWN', () => {
  const r = analyze(grown);
  assert.equal(r.verdict, 'GROWN');
  assert.equal(r.score, 0);
  const s = byId(r);
  assert.ok(s.birthSpread.value >= 43200);
  assert.equal(s.ownerCohort.fired, false); assert.equal(s.ownerCohort.value, null);
  assert.equal(s.templateTwins.fired, null);
});

test('brand-new mint whose repo has 3 stars is SEEDLING, with the token attached', () => {
  const r = analyze(seedling);
  assert.equal(r.verdict, 'SEEDLING');
  assert.equal(r.input.kind, 'mint');
  assert.equal(r.input.token.symbol, 'BMC');
  assert.equal(r.signals.length, 9);
  assert.equal(summarize(r).symbol, 'BMC');
});

test('no seeds at all (empty doors) is UNSURVEYED, never GROWN', () => {
  const raw = clone(grown);
  raw.seeds = []; raw.starred = {}; raw.profiles = {};
  const r = analyze(raw);
  assert.equal(r.verdict, 'UNSURVEYED');
  assert.equal(r.stargazers.confirmed, 0);
  assert.equal(byId(r).birthSpread.fired, null);
});

test('partial survey: unfinished signals are null and the report says partial', () => {
  const raw = clone(planted);
  raw.siblings = null; raw.cohort = { computed: false }; raw.partial = true;
  const r = analyze(raw);
  assert.equal(r.partial, true);
  assert.equal(byId(r).siblings.fired, null);
  assert.equal(byId(r).ownerCohort.fired, null);
  assert.equal(byId(r).templateTwins.fired, null);
  assert.equal(r.verdict, 'PLANTED'); // birthSpread + plantingRows still fire
});

test('known planters: >= 5 known accounts force PLANTED', () => {
  const raw = clone(grown);
  raw.known = { indexed: 13, planters: ['a1', 'a2', 'a3'], starredThis: ['p1', 'p2', 'p3', 'p4', 'p5'] };
  const r = analyze(raw);
  assert.equal(byId(r).knownField.value, 5);
  assert.equal(r.verdict, 'PLANTED');
});

test('huge starred lists: 16 seeds x 200 stars analyze in well under 50 ms', () => {
  const raw = clone(grown);
  raw.seeds = []; raw.starred = {};
  for (let i = 0; i < 16; i++) {
    const login = `acct${i}`;
    raw.seeds.push({ login, id: 1_000_000 + i * 10_000_000, via: 'fork' });
    const items = [{ repo: raw.repo.fullName, at: '2026-09-23T01:00:00Z' }];
    for (let k = 0; k < 199; k++) items.push({ repo: `other${(i * 7 + k) % 400}/r${k % 50}`, at: new Date(Date.parse('2026-09-01T00:00:00Z') + (i * 199 + k) * 1000).toISOString() });
    raw.starred[login] = { pages: 2, items };
  }
  const t0 = performance.now();
  const r = analyze(raw);
  assert.ok(performance.now() - t0 < 50);
  assert.equal(r.stargazers.confirmed, 16);
  assert.ok(r.field.plantings.length <= 400);
});

test('renderPlat prints the verdict, every signal and the planting rows', () => {
  const out = renderPlat(analyze(planted));
  assert.match(out, /VERDICT {2}PLANTED {2}14\/17/);
  for (const l of ['Sibling crop', 'Planting rows', 'Known field']) assert.ok(out.includes(l));
  assert.match(out, /PLANTING ROWS/);
  assert.match(out, /A pattern, not an accusation/);
});
