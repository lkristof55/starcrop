// Start from a pump.fun mint: find the repo the coin links, then survey it. Real mainnet data.
//   STARCROP_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..." GITHUB_TOKEN=$(gh auth token) node examples/from-mint.js <mint>
// Without STARCROP_RPC_URL the link is taken from DexScreener, then pump.fun.
import { resolveRepo, survey } from '../src/index.js';

const mint = process.argv[2] || '64S9QFTFhrcLWsXWjTBkaWPS4asdcrQGwvVQWxUjpump'; // BMC: its metadata links a 3-star GitHub repo
const rpcUrl = process.env.STARCROP_RPC_URL;
const link = await resolveRepo(mint, { rpcUrl });
console.log(`${mint} -> ${link.fullName ?? 'no GitHub link'} (${link.token?.symbol ?? '?'}, found in ${link.token?.linkFoundIn ?? '-'})`);
if (link.fullName) {
  const r = await survey(mint, { rpcUrl, token: process.env.GITHUB_TOKEN });
  console.log(`${r.verdict} ${r.score}/${r.maxScore}: ${r.headline}`);
}
