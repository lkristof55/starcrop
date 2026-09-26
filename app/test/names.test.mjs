// What ships names no real person. The site's recorded data, the /api/fields fallback report and the Try buttons may
// name only the recorded star farm AutocratGirder/ClashDesk (all 14 accounts and its repos answered 404 on GitHub at
// 2026-09-25 17:16Z and 2026-09-26 08:05Z; a pattern, not an accusation) or anonymize() placeholders. The code excerpts
// and benchmark rows in site/src/data/oss.js must be copied verbatim from the library (src/, README.md), never new.
// Also: no key or token in any file of app/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLACEHOLDER_RE } from '../../src/index.js';
import * as reference from '../lib/reference-report.mjs';
import oss from '../site/src/data/oss.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(APP, '..');
const lc = (s) => String(s).toLowerCase();

const FARM = new Set(['AutocratGirder', 'Behemothlyaoscillate', 'BricklayerSurmount', 'BridgeDruidCompress', 'centralcashierboost',
  'BufferHerald', 'CassowaryDevelop', 'BinaryDeliverer', 'AvenueSnowStep', 'Lengthbriexemplify', 'FiscalUpgrade',
  'ModernAnemoneStove', 'Emberbencontract', 'QuantumSkinkCry'].map(lc));
// github.com path segments that are not accounts
const NOT_ACCOUNTS = new Set(['search', 'users', 'orgs', 'repos', 'settings', 'features', 'about', 'pricing', 'login', 'topics', 'blog', 'changelog']);

/** Every GitHub login a JSON value names: login fields, owner/repo strings, github.com links, @mentions, account keys. */
export function loginsIn(value) {
  const out = [];
  const slug = (s, where) => { const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]{1,39})\/[A-Za-z0-9._-]+\/?$/.exec(s); if (m) out.push({ login: m[1], where }); };
  const walk = (v, at) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...at, i])); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const parent = at[at.length - 1];
        if (parent === 'accounts' || parent === 'profiles' || parent === 'starred') out.push({ login: k, where: `${at.join('.')} key` });
        if (parent === 'repos' || parent === 'readmes') slug(k, `${at.join('.')} key`);
        walk(x, [...at, k]);
      }
      return;
    }
    if (typeof v !== 'string') return;
    const key = at[at.length - 1], where = at.join('.');
    if (['login', 'ownerLogin', 'owner'].includes(key) && /^[A-Za-z0-9-]{1,39}$/.test(v)) out.push({ login: v, where });
    if (['fullName', 'full_name', 'repo', 'q', 'origin', 'url'].includes(key)) slug(v, where);
    for (const m of v.matchAll(/github\.com\/([A-Za-z0-9-]{1,39})(?![A-Za-z0-9-])/gi)) if (!NOT_ACCOUNTS.has(lc(m[1]))) out.push({ login: m[1], where: `${where} (link)` });
    for (const m of v.matchAll(/(?:^|[^A-Za-z0-9._-])@([A-Za-z0-9][A-Za-z0-9-]{0,38})(?![A-Za-z0-9.-])/g)) out.push({ login: m[1], where: `${where} (@mention)` });
  };
  walk(value, []);
  return out;
}

const isAllowed = (login) => PLACEHOLDER_RE.test(login) || FARM.has(lc(login));

const DATA = path.join(APP, 'site/src/data');
const shipped = () => [
  ...Object.entries(reference).map(([k, v]) => [`lib/reference-report.mjs ${k}`, v]),
  ...fs.readdirSync(DATA).filter((f) => f.endsWith('.json')).map((f) => [`site/src/data/${f}`, JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'))]),
];

test('recorded data names only the recorded farm or placeholders (reference report, site/src/data/*.json)', () => {
  const bad = [];
  let checked = 0;
  for (const [file, v] of shipped()) {
    for (const { login, where } of loginsIn(v)) {
      checked++;
      if (!isAllowed(login)) bad.push(`${file}: ${login} at ${where}`);
    }
  }
  assert.ok(checked > 100, `only ${checked} logins checked`);
  assert.deepEqual(bad, []);
});

test('the scan catches a real login anywhere the data can hold one', () => {
  const acct = 'someone-real';
  const base = structuredClone(reference.report);
  const cases = [
    (r) => { r.repo.owner.login = acct; }, (r) => { r.stargazers.accounts[0].login = acct; },
    (r) => { r.siblings.repos[0].ownerLogin = acct; }, (r) => { r.field.repos[0].fullName = `${acct}/x`; },
    (r) => { r.headline += ` see https://github.com/${acct}`; }, (r) => { r.limits.push(`ask @${acct}`); },
    (r) => { r.input.q = `${acct}/repo`; }, (r) => { r.gone = { accounts: { [acct]: 404 } }; },
  ];
  for (const [i, mutate] of cases.entries()) {
    const r = structuredClone(base);
    mutate(r);
    assert.ok(loginsIn(r).some((x) => x.login === acct), `case ${i} not caught`);
  }
  assert.equal(loginsIn(base).filter((x) => !isAllowed(x.login)).length, 0);
});

test('the Try buttons pre-fill no person: only an organization or the recorded farm', () => {
  const html = fs.readFileSync(path.join(APP, 'site/index.html'), 'utf8');
  const tries = [...html.matchAll(/data-q="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tries.length >= 1);
  const ORGS = new Set(['tinygrad']); // a GitHub organization, kept by name in the library's fixtures too
  for (const q of tries) {
    const owner = q.replace(/^https?:\/\/github\.com\//, '').split('/')[0];
    assert.ok(ORGS.has(lc(owner)) || FARM.has(lc(owner)), `Try pre-fills ${q}`);
  }
});

test('site/src/data/oss.js is copied verbatim from the library: code from src/, benchmark rows from README.md', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const k of ['idclock', 'index', 'rows']) {
    const x = oss[k];
    assert.ok(x, k);
    const lines = fs.readFileSync(path.join(ROOT, x.file), 'utf8').split('\n');
    assert.equal(lines.slice(x.from - 1, x.to).join('\n'), x.code, `${k}: stale excerpt of ${x.file}, run node site/tools/excerpts.mjs`);
  }
  assert.ok(oss.bench.length > 5);
  for (const row of oss.bench) for (const cell of row) assert.ok(readme.includes(cell), `benchmark cell not in README.md: ${cell}`);
});

test('no key or token in any file of app/', () => {
  const SECRET = [
    /gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{20,}/, /api-key=[0-9a-f]{8}-[0-9a-f]{4}-/i, /apify_api_[A-Za-z0-9]{20,}/,
    /(HELIUS_API_KEY|BIRDEYE_API_KEY|GITHUB_TOKEN|DUNE_API_KEY|APIFY_TOKEN)\s*=\s*["']?[A-Za-z0-9_-]{8,}/,
  ];
  const skip = new Set(['node_modules', '.data', 'dist', '.env']);
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (/\.(png|webp|hdr|woff2|glb)$/.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      for (const re of SECRET) if (re.test(s)) hits.push(`${path.relative(APP, p)}: ${re}`);
    }
  };
  walk(APP);
  assert.deepEqual(hits, []);
});
