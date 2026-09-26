// Upstream wrappers for the service. Keys come from process.env only; every call has a timeout (library fetchJson / githubClient)
// and a retry on 429. The survey itself lives in the library at the repo root (src/); this file adds the env and the job's feeds.
import { fetchJson } from '../../src/http.js';
import { findGithubRepo } from '../../src/parse.js';

export const env = {
  githubToken: () => process.env.GITHUB_TOKEN || '',
  rpcUrl: () => (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : undefined),
  tokenMint: () => process.env.TOKEN_MINT || '',
};

/** Options passed to oss survey(): token, Helius RPC, time budget. */
export function surveyOptions(extra = {}) {
  return { token: env.githubToken() || undefined, rpcUrl: env.rpcUrl(), ...extra };
}

/** Dev-coin repos from DexScreener's latest token profiles (Solana; github links or description). */
export async function dexProfileCandidates({ deadline } = {}) {
  const list = await fetchJson('https://api.dexscreener.com/token-profiles/latest/v1', { soft: true, deadline });
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (p.chainId !== 'solana') continue;
    const fullName = (p.links || []).map((l) => findGithubRepo(l.url)).find(Boolean) || findGithubRepo(p.description);
    if (fullName) out.push({ fullName, mint: p.tokenAddress, symbol: null, from: 'dexscreener' });
  }
  return out;
}

/** pump.fun graduates that link GitHub (unofficial API; fails soft to []). */
export async function pumpGraduateCandidates({ deadline } = {}) {
  const list = await fetchJson('https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&complete=true&includeNsfw=false', { soft: true, deadline });
  const out = [];
  for (const c of Array.isArray(list) ? list : Array.isArray(list?.coins) ? list.coins : []) {
    const fullName = findGithubRepo(c.website) || findGithubRepo(c.twitter) || findGithubRepo(c.description);
    if (fullName) out.push({ fullName, mint: c.mint, symbol: c.symbol ?? null, from: 'pumpfun' });
  }
  return out;
}

/** Fresh GitHub repos with >= 150 stars from the last 72 h (where farms surface). 1 search call. */
export async function freshRepoCandidates({ now = Date.now(), deadline } = {}) {
  const since = new Date(now - 72 * 3600e3).toISOString().slice(0, 19) + 'Z';
  const token = env.githubToken();
  const res = await fetchJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(`created:>=${since} stars:>=150`).replace(/%20/g, '+')}&sort=stars&order=desc&per_page=10`, {
    soft: true, deadline, headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return (res?.items || []).map((x) => ({ fullName: x.full_name, mint: null, symbol: null, from: 'github' }));
}

/** One page of a planter's starred list (1 core call). */
export async function starredPage(login, { deadline } = {}) {
  const token = env.githubToken();
  const res = await fetchJson(`https://api.github.com/users/${encodeURIComponent(login)}/starred?per_page=100`, {
    soft: true, deadline, headers: { accept: 'application/vnd.github.star+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return Array.isArray(res) ? res.filter((x) => x?.repo).map((x) => ({ repo: x.repo.full_name, at: x.starred_at, stars: x.repo.stargazers_count, createdAt: x.repo.created_at })) : null;
}
