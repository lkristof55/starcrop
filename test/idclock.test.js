import test from 'node:test';
import assert from 'node:assert/strict';
import { idToDate, GLOBAL_ANCHORS } from '../src/index.js';
import { load } from './helpers.js';

test('a local anchor is returned exactly', () => {
  const r = idToDate(307793903, [{ id: 307793903, createdAt: '2026-07-21T23:50:36Z' }]);
  assert.equal(r.at.toISOString(), '2026-07-21T23:50:36.000Z');
  assert.equal(r.exact, true);
});

test('interpolates between tight local anchors', () => {
  const local = [{ id: 1000, createdAt: '2026-01-01T00:00:00Z' }, { id: 2000, createdAt: '2026-01-01T00:10:00Z' }];
  const r = idToDate(1500, local, []);
  assert.equal(r.at.toISOString(), '2026-01-01T00:05:00.000Z');
  assert.equal(r.source, 'local');
  assert.equal(r.extrapolated, false);
});

test('a global anchor between two locals wins over a wide local bracket', () => {
  const local = [{ id: 1000000, createdAt: '2011-08-23T20:40:35Z' }, { id: 330000000, createdAt: '2026-09-16T12:49:41Z' }];
  const r = idToDate(100000000, local);
  assert.equal(r.at.toISOString(), '2022-02-18T22:03:02.000Z');
  assert.equal(r.source, 'global');
});

test('extrapolates just outside the local range from the two nearest locals', () => {
  const local = [{ id: 1000, createdAt: '2026-01-01T00:00:00Z' }, { id: 2000, createdAt: '2026-01-01T00:10:00Z' }];
  const r = idToDate(2500, local, [{ id: 0, createdAt: '2025-01-01T00:00:00Z' }, { id: 10_000_000, createdAt: '2027-01-01T00:00:00Z' }]);
  assert.equal(r.at.toISOString(), '2026-01-01T00:15:00.000Z');
  assert.equal(r.extrapolated, true);
  assert.equal(r.source, 'local');
});

test('beyond the table: extrapolates from the last two anchors, marked extrapolated', () => {
  const r = idToDate(340000000);
  assert.equal(r.extrapolated, true);
  assert.ok(r.at > new Date('2026-09-16T12:49:41Z'));
});

test('leave-one-out on the global table: anchors since id 250M within 3 days', () => {
  for (let i = 1; i < GLOBAL_ANCHORS.length - 1; i++) {
    const a = GLOBAL_ANCHORS[i];
    if (a.id < 250000000) continue;
    const rest = GLOBAL_ANCHORS.filter((_, j) => j !== i);
    const err = Math.abs(idToDate(a.id, [], rest).at - Date.parse(a.createdAt)) / 86400e3;
    assert.ok(err < 3, `id ${a.id}: ${err.toFixed(2)} days`);
  }
});

test('farm cohort accounts: local anchors put them within seconds', () => {
  const raw = load('raw.planted.clashdesk.json');
  const local = Object.values(raw.profiles);
  // leave each profile out in turn and predict it from the others
  let worst = 0;
  for (const p of local) {
    const others = local.filter((x) => x !== p);
    worst = Math.max(worst, Math.abs(idToDate(p.id, others).at - Date.parse(p.createdAt)) / 1000);
  }
  assert.ok(worst < 60, `worst leave-one-out error ${worst} s`);
});
