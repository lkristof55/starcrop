// The scheduled survey (lib/job.mjs). Free plan: a cursor splits the work across runs and no run makes more than 45
// upstream requests, retries included. Full plan (Netlify, Workers Paid): everything in one run, as before, no cursor.
// Offline: store = D1 fake, upstreams = test/upstream-stub.mjs (placeholders only).
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runSurveyJob } from '../lib/job.mjs';
import { plan } from '../lib/plan.mjs';
import { getStore, useD1 } from '../lib/store.mjs';
import { getReport, clearMemo } from '../lib/service.mjs';
import { createD1, hasSqlite } from './d1-fake.mjs';
import { createUpstream, TARGET } from './upstream-stub.mjs';

const skip = hasSqlite ? false : 'node:sqlite needs Node >= 22.5';
const realFetch = globalThis.fetch;
const FREE = plan({ CF_FREE_PLAN: '1' });
const FULL = plan({});
let keepAlive, quiet;
before(() => { keepAlive = setInterval(() => {}, 1000); quiet = console.log; console.log = () => {}; });
after(() => { clearInterval(keepAlive); console.log = quiet; globalThis.fetch = realFetch; useD1(null); });
beforeEach(() => { clearMemo(); useD1(createD1()); });

/** Run the job once with this upstream; returns what the run wrote and how many upstream requests it made. */
async function runOnce(up, p) {
  globalThis.fetch = up.fetch;
  const before = up.calls.length;
  const last = await runSurveyJob({ plan: p });
  const s = await getStore('starcrop');
  return { last, requests: up.calls.length - before, cursor: await s.get('survey/cursor') };
}

/** A field index with the stub's 12 placeholder planters (the PLANTED report of the stub's farm repo). */
async function seedField() {
  globalThis.fetch = createUpstream().fetch;
  const r = await getReport(TARGET, { plan: FREE });
  assert.equal(r.field.id, 'F001');
  clearMemo();
  await (await getStore('starcrop')).delete(`report/${TARGET}`); // let the job survey it again later
}

test('free plan, empty index: feeds + one survey per run, the rest queued in survey/cursor, <= 45 requests each', { skip }, async () => {
  const up = createUpstream();
  const r1 = await runOnce(up, FREE);
  assert.deepEqual(r1.last.log.slice(0, 2), ['candidates: dexscreener 2, pumpfun 0, github 1', 'planters refreshed 0, farm repos indexed 0']);
  assert.match(r1.last.log[2], /^dexscreener sample-owner-01\/crop: PLANTED \d+\/17$/);
  assert.equal(r1.last.log.length, 3);
  assert.ok(r1.requests <= 45, `${r1.requests}`);
  assert.equal(r1.last.upstream.used, r1.requests);
  assert.deepEqual(r1.cursor.queue.map((c) => c.fullName), ['sample-owner-02/tool', 'sample-owner-03/fresh']);
  const r2 = await runOnce(up, FREE);
  assert.match(r2.last.log[0], /^candidates: 2 queued since /);
  assert.ok(r2.last.log.some((l) => l.startsWith('dexscreener sample-owner-02/tool: ')), r2.last.log.join('\n'));
  assert.ok(r2.requests <= 45);
  assert.deepEqual(r2.cursor.queue.map((c) => c.fullName), ['sample-owner-03/fresh']);
  const r3 = await runOnce(up, FREE);
  assert.ok(r3.last.log.some((l) => l.startsWith('github sample-owner-03/fresh: ')));
  assert.deepEqual(r3.cursor.queue, []);
  const r4 = await runOnce(up, FREE); // queue empty: feeds again; everything was reported < 6 h ago
  assert.match(r4.last.log[0], /^candidates: dexscreener 2/);
  assert.equal(r4.last.log.length, 1);
});

test('free plan with a field index: the planter refresh is the run\'s one heavy step; its farm repos jump the queue', { skip }, async () => {
  await seedField();
  const up = createUpstream();
  const r1 = await runOnce(up, FREE);
  assert.equal(r1.last.log[1], 'planters refreshed 10, farm repos indexed 6');
  assert.match(r1.last.log[2], /^survey: next run/);
  assert.ok(r1.requests <= 45, `${r1.requests}`);
  assert.equal(r1.cursor.queue[0].from, 'planters');
  assert.ok(r1.cursor.plantersAt);
  const byRepo = await (await getStore('starcrop')).get('by-repo/sample-owner-20/seed-0');
  assert.deepEqual(byRepo.fieldIds, ['F001']);
  const r2 = await runOnce(up, FREE); // planters not due for an hour: one survey, a planted repo first
  assert.equal(r2.last.log.length, 2);
  assert.match(r2.last.log[1], /^planters /);
  assert.ok(r2.requests <= 45);
});

test('free plan worst case: every request needs a retry, and still no run makes more than 45', { skip }, async () => {
  await seedField();
  const up = createUpstream({ flaky: true });
  for (let i = 0; i < 2; i++) { // run 0: feeds + planter refresh; run 1: feeds are fresh, one survey
    const r = await runOnce(up, FREE);
    assert.ok(r.requests <= 45, `run ${i}: ${r.requests} requests\n${r.last.log.join('\n')}`);
    assert.equal(r.last.upstream.used, r.requests);
  }
});

test('free plan: a rate-limited survey keeps its candidate at the head of the queue', { skip }, async () => {
  const up = createUpstream({ rateLimitAfter: 1 }); // the feeds' GitHub search passes, then GitHub is out of calls
  const r = await runOnce(up, FREE);
  assert.match(r.last.log.at(-1), /^dexscreener sample-owner-01\/crop: RATE_LIMITED /);
  assert.equal(r.cursor.queue[0].fullName, TARGET);
  assert.ok(r.requests <= 5, `${r.requests}`);
});

test('full plan (Netlify, Workers Paid): feeds, planters and up to 3 surveys in one run, no cursor', { skip }, async () => {
  await seedField();
  const up = createUpstream();
  const r = await runOnce(up, FULL);
  assert.equal(r.last.log[0], 'candidates: dexscreener 2, pumpfun 0, github 1');
  assert.equal(r.last.log[1], 'planters refreshed 10, farm repos indexed 6');
  assert.equal(r.last.log.length, 5, r.last.log.join('\n'));
  assert.equal(r.cursor, null);
  assert.equal(r.last.upstream, undefined);
  assert.ok(r.requests > 45, 'the full plan is not capped');
});

test('free plan: the cursor moves past a candidate before its survey starts (a run cut off by the CPU limit is not repeated)', { skip }, async () => {
  globalThis.fetch = createUpstream().fetch;
  let started = null;
  const hung = runSurveyJob({ plan: FREE, surveyFn: (fullName) => { started = fullName; return new Promise(() => {}); } });
  for (let i = 0; i < 50 && !started; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(started, TARGET);
  const cursor = await (await getStore('starcrop')).get('survey/cursor');
  assert.deepEqual(cursor.queue.map((c) => c.fullName), ['sample-owner-02/tool', 'sample-owner-03/fresh']);
  assert.ok(cursor.feedsAt);
  void hung; // never settles, like a run the platform stopped
});
