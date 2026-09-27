// The D1 backend of lib/store.mjs against an in-memory D1 (test/d1-fake.mjs: node:sqlite with migrations/0001_kv.sql),
// with the file store as the reference for identical semantics. Also: what the app stores stays far below D1's row limit.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getStore, useD1, useStoreDir, D1_MAX_VALUE_BYTES } from '../lib/store.mjs';
import { getReport, getFields, getRecent, clearMemo } from '../lib/service.mjs';
import reference from '../lib/reference-report.mjs';
import { createD1, hasSqlite } from './d1-fake.mjs';

const skip = hasSqlite ? false : 'node:sqlite needs Node >= 22.5';
let keepAlive;
before(() => { keepAlive = setInterval(() => {}, 1000); });
after(() => { clearInterval(keepAlive); useD1(null); });

const KEYS = ['a%b', 'a_c', 'abc', 'a/1', 'a/2/x', 'b', 'report/sample-owner-01/crop', 'ünï/κ', 'a%'];

/** The same script against any backend; returns everything it observed. */
async function exercise(s) {
  const seen = {};
  seen.missing = await s.get('nope');
  for (const [i, k] of KEYS.entries()) await s.setJSON(k, { i, k, list: [1, 'two', null, { deep: true }], text: 'quote " backslash \\ emoji 🌾' });
  await s.setJSON('b', ['overwritten', 2]);
  await s.setJSON('n', 42);
  await s.setJSON('s', 'plain string');
  seen.values = {};
  for (const k of [...KEYS, 'n', 's']) seen.values[k] = await s.get(k);
  await s.delete('abc');
  await s.delete('never-there');
  seen.afterDelete = await s.get('abc');
  const keys = async (prefix) => (await s.list(prefix == null ? undefined : { prefix })).blobs.map((b) => b.key).sort();
  seen.lists = { all: await keys(), empty: await keys(''), 'a%': await keys('a%'), 'a_': await keys('a_'), 'a/': await keys('a/'), 'report/': await keys('report/'), 'ü': await keys('ü'), zzz: await keys('zzz') };
  return seen;
}

test('D1 store: get / setJSON / delete / list({ prefix }) behave exactly like the file store', { skip }, async () => {
  useD1(createD1());
  const d1 = await exercise(await getStore('starcrop'));
  useStoreDir(await fs.mkdtemp(path.join(os.tmpdir(), 'starcrop-store-')));
  const file = await exercise(await getStore('starcrop'));
  assert.deepEqual(d1, file);
  assert.equal(d1.missing, null);
  assert.deepEqual(d1.values.b, ['overwritten', 2]);
  assert.equal(d1.afterDelete, null);
});

test('D1 store: a prefix is literal, % and _ are not wildcards', { skip }, async () => {
  useD1(createD1());
  const s = await getStore('starcrop');
  for (const k of KEYS) await s.setJSON(k, 1);
  const keys = async (prefix) => (await s.list({ prefix })).blobs.map((b) => b.key);
  assert.deepEqual(await keys('a%'), ['a%', 'a%b']);
  assert.deepEqual(await keys('a_'), ['a_c']);
  assert.deepEqual(await keys('a/'), ['a/1', 'a/2/x']);
  assert.deepEqual(await keys('%'), []);
  assert.deepEqual(await keys('_'), []);
});

test('D1 store: stores are separate namespaces in one table; a re-registered binding is used at once', { skip }, async () => {
  const db = createD1();
  useD1(db);
  await (await getStore('one')).setJSON('k', 1);
  await (await getStore('two')).setJSON('k', 2);
  assert.equal(await (await getStore('one')).get('k'), 1);
  assert.equal(await (await getStore('two')).get('k'), 2);
  assert.deepEqual((await (await getStore('one')).list()).blobs, [{ key: 'k' }]);
  assert.deepEqual(db.rows().map((r) => [r.store, r.key, r.value]), [['one', 'k', '1'], ['two', 'k', '2']]);
  useD1(createD1());
  assert.equal(await (await getStore('one')).get('k'), null);
});

test('D1 store: a value over the row limit fails with a clear error; 1.5 MB is fine', { skip }, async () => {
  useD1(createD1());
  const s = await getStore('starcrop');
  await s.setJSON('big', 'x'.repeat(1_500_000));
  assert.equal((await s.get('big')).length, 1_500_000);
  await assert.rejects(s.setJSON('huge', 'x'.repeat(D1_MAX_VALUE_BYTES)), /starcrop: huge is \d+ bytes, over the 1900000-byte limit of a D1 row/);
  await assert.rejects(s.setJSON('wide', '🌾'.repeat(500_000)), /over the 1900000-byte limit/); // 2 UTF-16 units, 4 bytes each
  assert.equal(await s.get('huge'), null);
});

test('the service runs unchanged on D1: PLANTED report indexed, cached, listed', { skip }, async () => {
  useD1(createD1());
  clearMemo();
  let calls = 0;
  const live = () => ({ ...structuredClone(reference), source: 'live', checkedAt: new Date().toISOString() });
  const r1 = await getReport('AutocratGirder/ClashDesk', { surveyFn: async () => { calls++; return live(); } });
  clearMemo(); // the second read comes from D1, not the in-memory memo
  const r2 = await getReport('https://github.com/AutocratGirder/ClashDesk', { surveyFn: async () => { calls++; return live(); } });
  assert.equal(calls, 1);
  assert.equal(r1.field.id, 'F001');
  assert.equal(r2.source, 'cache');
  const f = await getFields();
  assert.equal(f.featured.source, 'cache');
  assert.equal(f.fields[0].planters, 13);
  assert.equal((await getRecent()).reports.length, 1);
});

test('the biggest value the app writes stays far below the D1 row limit', () => {
  // A report is capped by the library: 400 plantings, 24 field repos, 50 siblings + the repo, 20 seeds, 9 signals.
  const r = structuredClone(reference);
  const long = (n) => 'x'.repeat(n);
  r.field.plantings = Array.from({ length: 400 }, (_, i) => ({ login: `sample-user-${String(i % 20).padStart(2, '0')}`, repo: `sample-owner-${String(i).padStart(3, '0')}/${long(90)}`, at: '2026-09-18T11:00:00Z' }));
  r.field.repos = Array.from({ length: 24 }, (_, i) => ({ fullName: `sample-owner-${String(i).padStart(2, '0')}/${long(90)}`, starredBy: 20, share: 1 }));
  r.siblings.repos = Array.from({ length: 51 }, (_, i) => ({ ...reference.siblings.repos[0], fullName: `sample-owner-${String(i).padStart(2, '0')}/${long(90)}` }));
  r.stargazers.accounts = Array.from({ length: 20 }, () => ({ ...reference.stargazers.accounts[0] }));
  r.repo.description = long(1000);
  const record = JSON.stringify({ savedAt: '2026-09-27T00:00:00Z', algo: 2, report: r });
  assert.ok(record.length < D1_MAX_VALUE_BYTES / 10, `${record.length} bytes`);
});
