import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRepo, gatewayUrl, repoFromMetadata, repoFromDexPairs, collect, StarcropError } from '../src/index.js';

const MINT = '64S9QFTFhrcLWsXWjTBkaWPS4asdcrQGwvVQWxUjpump';
const json = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });

test('gatewayUrl rewrites ipfs.io and ipfs:// to the pump Pinata gateway', () => {
  assert.equal(gatewayUrl('https://ipfs.io/ipfs/bafkreia'), 'https://pump.mypinata.cloud/ipfs/bafkreia');
  assert.equal(gatewayUrl('ipfs://bafkreia'), 'https://pump.mypinata.cloud/ipfs/bafkreia');
  assert.equal(gatewayUrl('https://arweave.net/abc'), 'https://arweave.net/abc');
});

test('links: website first, then socials; DexScreener pairs', () => {
  assert.equal(repoFromMetadata({ website: 'https://github.com/sample-owner-0153/bitcoinmachinecode', twitter: 'https://x.com/a' }), 'sample-owner-0153/bitcoinmachinecode');
  assert.equal(repoFromMetadata({ website: 'https://example.com', description: 'code: github.com/a/b' }), 'a/b');
  assert.equal(repoFromDexPairs([{ info: { websites: [{ url: 'https://x.com' }], socials: [{ url: 'https://github.com/c/d' }] } }]), 'c/d');
  assert.equal(repoFromMetadata(null), null);
});

test('mint -> DAS -> metadata JSON -> repo (stubbed fetch)', async () => {
  const fetch = async (url, init) => {
    if (String(url).startsWith('https://rpc.test')) return json({ result: { content: { json_uri: 'https://ipfs.io/ipfs/cid1', metadata: { name: 'Bitcoin Machine Code', symbol: 'BMC' } } } });
    if (url === 'https://pump.mypinata.cloud/ipfs/cid1') return json({ name: 'Bitcoin Machine Code', website: 'https://github.com/sample-owner-0153/bitcoinmachinecode' });
    throw new Error('unexpected ' + url);
  };
  const r = await resolveRepo(MINT, { rpcUrl: 'https://rpc.test/?api-key=x', fetch });
  assert.equal(r.fullName, 'sample-owner-0153/bitcoinmachinecode');
  assert.deepEqual(r.token, { name: 'Bitcoin Machine Code', symbol: 'BMC', linkFoundIn: 'metadata' });
  assert.equal(r.heliusCredits, 10);
});

test('mint with no GitHub link -> collect throws NO_REPO with the token', async () => {
  const fetch = async (url) => {
    if (String(url).includes('dexscreener')) return json([{ baseToken: { address: MINT, name: 'Dog', symbol: 'DOG' }, info: { websites: [{ url: 'https://dog.xyz' }] } }]);
    return json({}, 404);
  };
  await assert.rejects(collect(MINT, { fetch }), (e) => e instanceof StarcropError && e.code === 'NO_REPO' && e.status === 422 && e.token.symbol === 'DOG');
});

test('unknown mint -> NOT_FOUND', async () => {
  const fetch = async (url) => (String(url).includes('dexscreener') ? json([]) : json({}, 404));
  await assert.rejects(resolveRepo(MINT, { fetch }), (e) => e.code === 'NOT_FOUND');
});

test('repo that does not exist -> NOT_FOUND; exhausted GitHub budget -> RATE_LIMITED with retryAfter', async () => {
  await assert.rejects(collect('a/b', { fetch: async () => json({ message: 'Not Found' }, 404) }), (e) => e.code === 'NOT_FOUND' && e.status === 404);
  const reset = Math.floor(Date.now() / 1000) + 120;
  await assert.rejects(collect('a/b', { fetch: async () => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }) }),
    (e) => e.code === 'RATE_LIMITED' && e.status === 429 && e.retryAfter > 100 && e.retryAfter <= 121);
});

test('budget runs out mid-survey -> partial report, not an error', async () => {
  const repo = { full_name: 'a/b', description: null, created_at: '2026-09-20T00:00:00Z', pushed_at: null, stargazers_count: 300, forks_count: 3, size: 10, language: null, owner: { login: 'a', id: 5 } };
  const fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/repos/a/b')) return json(repo);
    if (u.endsWith('/users/a')) return json({ login: 'a', id: 5, created_at: '2020-01-01T00:00:00Z', followers: 9, public_repos: 3 });
    // everything else hangs until aborted by the deadline
    return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  };
  const { analyze } = await import('../src/index.js');
  const raw = await collect('a/b', { fetch, budgetMs: 600 });
  assert.equal(raw.partial, true);
  const r = analyze(raw);
  assert.equal(r.partial, true);
  assert.equal(r.signals.find((s) => s.id === 'siblings').fired, null);
  assert.ok(['UNSURVEYED', 'MIXED'].includes(r.verdict));
});
