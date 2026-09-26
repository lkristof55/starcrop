// resolveRepo(): mint | URL | owner/repo -> "owner/repo".
// Mints: Helius DAS getAsset -> metadata JSON (IPFS via pump.mypinata.cloud) -> first github.com/<o>/<r> in
// website, twitter, description. Fallbacks: DexScreener tokens/v1 (info.websites, info.socials), then pump.fun (unofficial).
import { parseTarget, findGithubRepo } from './parse.js';
import { fetchJson } from './http.js';
import { StarcropError } from './errors.js';

export const DAS_CREDITS = 10; // Helius bills a DAS call at 10 credits
const GATEWAY = 'https://pump.mypinata.cloud/ipfs/';

/** ipfs.io and most public gateways now serve an HTML notice; rewrite any /ipfs/<cid> URL to pump's Pinata gateway. */
export function gatewayUrl(uri) {
  if (!uri) return null;
  const m = String(uri).match(/^ipfs:\/\/(?:ipfs\/)?(.+)$/) || String(uri).match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/) || String(uri).match(/^https?:\/\/([a-z0-9]{46,})\.ipfs\.[^/]+\/?(.*)$/);
  if (!m) return uri;
  return GATEWAY + (m[2] !== undefined && m[2] !== '' ? `${m[1]}/${m[2]}` : m[1]);
}

/** First GitHub repo in a metadata-like object, checking website, then twitter, then description, then anything else. */
export function repoFromMetadata(meta) {
  if (!meta || typeof meta !== 'object') return null;
  for (const k of ['website', 'external_url', 'twitter', 'telegram', 'description']) {
    const r = findGithubRepo(typeof meta[k] === 'string' ? meta[k] : null);
    if (r) return r;
  }
  return findGithubRepo(JSON.stringify(meta));
}

/** GitHub repo in a DexScreener tokens/v1 pair list (info.websites[].url, info.socials[].url). */
export function repoFromDexPairs(pairs) {
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const urls = [...(p?.info?.websites || []).map((w) => w.url), ...(p?.info?.socials || []).map((s) => s.url)];
    for (const u of urls) { const r = findGithubRepo(u); if (r) return r; }
  }
  return null;
}

/**
 * @param {string} input
 * @param {{ rpcUrl?: string, fetch?: typeof fetch, deadline?: number }} [opts]
 * @returns {Promise<{ fullName: string|null, kind: 'mint'|'url'|'slug', mint: string|null, token: { name: string, symbol: string, linkFoundIn: 'metadata'|'dexscreener'|'pumpfun' }|null, note: string|null, calls: number, heliusCredits: number }>}
 */
export async function resolveRepo(input, opts = {}) {
  const target = parseTarget(input);
  if (target.kind !== 'mint') return { fullName: target.fullName, kind: target.kind, mint: null, token: null, note: null, calls: 0, heliusCredits: 0 };
  const mint = target.mint;
  const deadline = opts.deadline ?? Date.now() + 8000;
  const io = { fetch: opts.fetch, deadline };
  let calls = 0, heliusCredits = 0, name = null, symbol = null, exists = false;
  const found = (fullName, linkFoundIn) => ({ fullName, kind: 'mint', mint, token: { name: name ?? '', symbol: symbol ?? '', linkFoundIn }, note: null, calls, heliusCredits });

  // 1) Helius DAS getAsset -> json_uri -> metadata JSON
  if (opts.rpcUrl) {
    calls++; heliusCredits += DAS_CREDITS;
    const das = await fetchJson(opts.rpcUrl, { ...io, method: 'POST', body: { jsonrpc: '2.0', id: 'starcrop', method: 'getAsset', params: { id: mint } }, soft: true });
    const asset = das?.result;
    if (asset) {
      exists = true;
      name = asset.content?.metadata?.name ?? null;
      symbol = asset.content?.metadata?.symbol ?? asset.token_info?.symbol ?? null;
      const inline = repoFromMetadata({ ...asset.content?.metadata, external_url: asset.content?.links?.external_url });
      if (inline) return found(inline, 'metadata');
      const uri = asset.content?.json_uri;
      if (uri) {
        calls++;
        let meta = await fetchJson(gatewayUrl(uri), { ...io, soft: true });
        if (!meta && gatewayUrl(uri) !== uri) { calls++; meta = await fetchJson(uri, { ...io, soft: true }); }
        if (meta) { name ??= meta.name ?? null; symbol ??= meta.symbol ?? null; }
        const r = repoFromMetadata(meta);
        if (r) return found(r, 'metadata');
      }
    }
  }
  // 2) DexScreener
  calls++;
  const pairs = await fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { ...io, soft: true });
  if (Array.isArray(pairs) && pairs.length) {
    exists = true;
    const base = pairs.find((p) => p.baseToken?.address === mint)?.baseToken;
    name ??= base?.name ?? null; symbol ??= base?.symbol ?? null;
    const r = repoFromDexPairs(pairs);
    if (r) return found(r, 'dexscreener');
  }
  // 3) pump.fun (unofficial; fail soft)
  calls++;
  const coin = await fetchJson(`https://frontend-api-v3.pump.fun/coins/${mint}`, { ...io, soft: true });
  if (coin && coin.mint) {
    exists = true;
    name ??= coin.name ?? null; symbol ??= coin.symbol ?? null;
    const r = repoFromMetadata(coin);
    if (r) return found(r, 'pumpfun');
  }
  if (!exists) throw new StarcropError('NOT_FOUND', `No token found for mint ${mint} (Helius, DexScreener and pump.fun know nothing about it).`);
  return { fullName: null, kind: 'mint', mint, token: { name: name ?? '', symbol: symbol ?? '', linkFoundIn: null }, note: 'The token links no github.com/<owner>/<repo>.', calls, heliusCredits };
}
