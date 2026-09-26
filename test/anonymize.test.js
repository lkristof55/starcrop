// Fixtures name no real account: every login is a placeholder, except the recorded farm (all 404 on GitHub)
// and the organization used as a survey input. anonymize() renames without changing the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, anonymize, surveyLogins, renderPlat, PLACEHOLDER_RE } from '../src/index.js';
import { RESERVED } from '../src/parse.js';
import { load, clone } from './helpers.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const lc = (s) => s.toLowerCase();

// The RECORDED star farm: AutocratGirder/ClashDesk, its sibling owners and cohort, surveyed 2026-09-25 12:55Z.
// GitHub answered 404 for all 14 accounts at 2026-09-25 17:16Z and again at 2026-09-26 08:05Z.
const FARM_FIXTURE = 'raw.planted.clashdesk.json';
const FARM = new Set(['AutocratGirder', 'Behemothlyaoscillate', 'BricklayerSurmount', 'BridgeDruidCompress', 'centralcashierboost',
  'BufferHerald', 'CassowaryDevelop', 'BinaryDeliverer', 'AvenueSnowStep', 'Lengthbriexemplify', 'FiscalUpgrade',
  'ModernAnemoneStove', 'Emberbencontract', 'QuantumSkinkCry'].map(lc));
// Organizations used as a survey input (a famous public repo), kept by name in that fixture only.
const INPUT_ORGS = new Set(['tinygrad']);

/** Every login a fixture names, found without surveyLogins(): keys, login fields, owner/repo strings, links, mentions. */
function fixtureLogins(raw) {
  const out = [];
  const add = (l, where) => out.push({ login: l, where });
  const slug = (s, where) => { const m = /^([A-Za-z0-9-]{1,39})\/[A-Za-z0-9._-]+$/.exec(s); if (m) add(m[1], where); };
  const walk = (v, at) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...at, i])); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const parent = at[at.length - 1];
        if (parent === 'starred' || parent === 'profiles') add(k, `${parent} key`);
        if (parent === 'readmes') slug(k, 'readmes key');
        walk(x, [...at, k]);
      }
      return;
    }
    if (typeof v !== 'string') return;
    const key = at[at.length - 1], where = at.join('.');
    if (key === 'login' || key === 'ownerLogin') add(v, where);
    if (at.includes('known') && (at.includes('planters') || at.includes('starredThis') || at.includes('seeds'))) add(v, where);
    if (key === 'fullName' || key === 'repo' || key === 'q') slug(v, where);
    for (const m of v.matchAll(/github\.com\/([A-Za-z0-9-]{1,39})(?![A-Za-z0-9-])/gi)) if (!RESERVED.has(lc(m[1]))) add(m[1], `${where} (link)`);
    for (const m of v.matchAll(/(?:^|[^A-Za-z0-9._-])@([A-Za-z0-9][A-Za-z0-9-]{0,38})(?![A-Za-z0-9.-])/g)) add(m[1], `${where} (@mention)`);
  };
  walk(raw, []);
  return out;
}

const fixtures = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));

test('every fixture login outside the recorded farm is a placeholder (sample-user-NN / sample-owner-NN)', () => {
  assert.ok(fixtures.length >= 4);
  const bad = [];
  let checked = 0;
  for (const f of fixtures) {
    const raw = load(f);
    const found = fixtureLogins(raw);
    // the independent scan sees at least every login surveyLogins() knows about
    const seen = new Set(found.map((x) => lc(x.login)));
    for (const l of [...surveyLogins(raw).users, ...surveyLogins(raw).owners]) assert.ok(seen.has(lc(l)), `${f}: scan missed ${l}`);
    for (const { login, where } of found) {
      checked++;
      if (PLACEHOLDER_RE.test(login)) continue;
      if (f === FARM_FIXTURE && FARM.has(lc(login))) continue;
      if (INPUT_ORGS.has(lc(login)) && lc(raw.owner?.login ?? '') === lc(login) && raw.owner?.type === 'Organization') continue;
      bad.push(`${f}: ${login} at ${where}`);
    }
  }
  assert.ok(checked > 1000, `only ${checked} logins checked`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} real logins in fixtures`);
});

test('the scan catches a real login anywhere a survey can hold one', () => {
  const raw = clone(load('raw.grown.riso-windowseat.json'));
  const acct = 'someone-real';
  const cases = [
    (r) => { r.seeds[0].login = acct; }, (r) => { r.starred[acct] = { pages: 1, items: [] }; }, (r) => { r.profiles[acct] = {}; },
    (r) => { r.starred[r.seeds[0].login].items.push({ repo: `${acct}/x` }); }, (r) => { r.owner.login = acct; },
    (r) => { r.readmes[r.repo.fullName].text += ` see https://github.com/${acct}`; }, (r) => { r.repo.description = `by @${acct}`; },
    (r) => { r.known = { indexed: 1, planters: [acct], starredThis: [] }; }, (r) => { r.input.q = `${acct}/y`; },
  ];
  for (const edit of cases) {
    const r = clone(raw); edit(r);
    assert.ok(fixtureLogins(r).some((x) => x.login === acct), edit.toString());
  }
});

// A report renamed by the placeholder table, field by field (what anonymize() promises to preserve).
function renamed(report, map, keep = []) {
  const ks = new Set(keep.map(lc));
  const L = (l) => (ks.has(lc(l)) ? l : map.get(lc(l)) ?? l);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const R = (f) => { const i = f.indexOf('/'); if (i < 0) return f; const o = f.slice(0, i), p = L(o); return p === o ? f : `${p}/${f.slice(i + 1).replace(new RegExp(`(?<![A-Za-z0-9])${esc(o)}(?![A-Za-z0-9])`, 'gi'), p)}`; };
  const T = (s) => s.replace(/(github\.com\/)([A-Za-z0-9-]{1,39})(?![A-Za-z0-9-])/gi, (m, p, l) => p + L(l))
    .replace(/(^|[\s(\[<"'`])([A-Za-z0-9][A-Za-z0-9-]{0,38})(?=\/)/g, (m, p, l) => p + L(l));
  const walk = (v, k) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, k));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, walk(x, kk)]));
    if (typeof v !== 'string') return v;
    if (k === 'login' || k === 'ownerLogin') return L(v);
    if (k === 'fullName' || k === 'repo') return R(v);
    return T(v);
  };
  return walk(report);
}

test('anonymize() on the recorded farm: the same PLANTED report with the names swapped', () => {
  const raw = load(FARM_FIXTURE);
  const map = new Map();
  const anon = anonymize(raw, { map });
  assert.equal(map.size, 14);
  assert.deepEqual(analyze(anon), renamed(analyze(raw), map));
  assert.equal(renderPlat(analyze(anon)), renderPlat(renamed(analyze(raw), map)));
  assert.ok(fixtureLogins(anon).every((x) => PLACEHOLDER_RE.test(x.login)));
  assert.deepEqual(raw, load(FARM_FIXTURE), 'input not modified');
});

test('anonymize() on the live fixtures (renumbered as one table): the same reports, tinygrad kept', () => {
  const files = ['raw.grown.riso-windowseat.json', 'raw.grown.tinygrad.json', 'raw.seedling.bmc.json'];
  const raws = files.map(load);
  const map = new Map();
  const anon = anonymize(raws, { keep: ['tinygrad'], map });
  raws.forEach((raw, i) => assert.deepEqual(analyze(anon[i]), renamed(analyze(raw), map, ['tinygrad']), files[i]));
  assert.equal(anon[1].repo.fullName, 'tinygrad/tinygrad');
  assert.equal(new Set(map.values()).size, map.size, 'one placeholder per account');
});

test('anonymize(): profile repos, github.com links and @mentions are renamed; ids, dates and counts are not', () => {
  const raw = {
    v: 1, checkedAt: '2026-09-26T00:00:00Z', partial: false, input: { q: 'https://github.com/Alice/tool', kind: 'url' },
    repo: { fullName: 'Alice/tool', description: 'made with @bob', createdAt: '2026-09-01T00:00:00Z', stars: 40, forks: 2, sizeKb: 9 },
    owner: { login: 'Alice', id: 11, createdAt: '2020-01-01T00:00:00Z', followers: 3, publicRepos: 4, type: 'User' },
    seeds: [{ login: 'bob', id: 22, via: 'fork' }],
    starred: { bob: { pages: 1, items: [{ repo: 'Alice/tool', at: '2026-09-02T00:00:00Z', stars: 40 }, { repo: 'bob/bob', at: '2026-01-01T00:00:00Z' }, { repo: 'carol/carol.github.io', at: '2025-01-01T00:00:00Z' }] } },
    profiles: { bob: { id: 22, createdAt: '2019-01-01T00:00:00Z', followers: 1, publicRepos: 2 } },
    readmes: { 'Alice/tool': { text: '# tool\nsee https://github.com/dave/lib and github.com/sponsors/x' } },
  };
  const map = new Map();
  const a = anonymize(raw, { map });
  assert.equal(a.repo.fullName, 'sample-owner-01/tool');
  assert.equal(a.input.q, 'https://github.com/sample-owner-01/tool');
  assert.equal(a.repo.description, 'made with @sample-user-01');
  assert.deepEqual(a.seeds, [{ login: 'sample-user-01', id: 22, via: 'fork' }]);
  assert.deepEqual(a.starred['sample-user-01'].items.map((x) => x.repo), ['sample-owner-01/tool', 'sample-user-01/sample-user-01', 'sample-owner-02/sample-owner-02.github.io']);
  assert.deepEqual(a.profiles['sample-user-01'], raw.profiles.bob);
  assert.match(a.readmes['sample-owner-01/tool'].text, /github\.com\/sample-owner-03\/lib and github\.com\/sponsors\/x/);
  assert.match(a.readmes['sample-owner-01/tool'].skeleton, /^[0-9a-f]{12}$/);
  assert.equal(a.owner.id, 11);
  assert.deepEqual(anonymize(raw, { map }), a, 'stable: the same table gives the same placeholders');
});
