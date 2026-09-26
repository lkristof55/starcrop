#!/usr/bin/env node
// starcrop <mint|github-url|owner/repo> [--json] [--raw] [--token <t>] [--rpc <url>] [--budget <ms>]
import { survey, collect, renderPlat, StarcropError } from '../src/index.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const target = argv.find((a, i) => !a.startsWith('--') && !['--token', '--rpc', '--budget'].includes(argv[i - 1]));

if (!target || flag('--help') || flag('-h')) {
  console.log(`starcrop: tell grown GitHub stars from planted ones.

usage: starcrop <mint | https://github.com/owner/repo | owner/repo> [options]

  --json          print the CropReport as JSON
  --raw           print the RawSurvey (every upstream answer, replayable with analyze())
  --token <t>     GitHub token (default: $GITHUB_TOKEN). Without one GitHub allows 60 calls/h and 10 searches/min.
  --rpc <url>     Solana RPC with DAS (default: $STARCROP_RPC_URL, or Helius from $HELIUS_API_KEY) for mint inputs.
                  Without it, mints resolve through DexScreener and pump.fun.
  --budget <ms>   time budget (default 20000); unfinished signals come back as not measured.`);
  process.exit(target ? 0 : 1);
}

const token = opt('--token') || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const rpcUrl = opt('--rpc') || process.env.STARCROP_RPC_URL || (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : undefined);
if (!token) console.error('starcrop: no GITHUB_TOKEN; unauthenticated GitHub allows 60 calls/h, enough for ~2 reports. Try: GITHUB_TOKEN=$(gh auth token) starcrop ...');
try {
  const opts = { token, rpcUrl, budgetMs: Number(opt('--budget') || 20000) };
  if (flag('--raw')) { console.log(JSON.stringify(await collect(target, opts), null, 2)); process.exit(0); }
  const report = await survey(target, opts);
  console.log(flag('--json') ? JSON.stringify(report, null, 2) : renderPlat(report, { width: Math.min(process.stdout.columns || 110, 140) }));
} catch (e) {
  if (e instanceof StarcropError) { console.error(`starcrop: ${e.code}: ${e.message}`); process.exit(2); }
  throw e;
}
