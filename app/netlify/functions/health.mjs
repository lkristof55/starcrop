// GET /api/health: liveness plus which keys the backend can see (names only, never values).
// tokenMint is additive: the $STCROP mint once TOKEN_MINT is set, null before launch.
export default async () => Response.json({
  ok: true,
  project: 'starcrop',
  time: new Date().toISOString(),
  keys: { helius: !!process.env.HELIUS_API_KEY, birdeye: !!process.env.BIRDEYE_API_KEY, github: !!process.env.GITHUB_TOKEN },
  tokenMint: process.env.TOKEN_MINT || null,
}, { headers: { 'cache-control': 'no-store' } });

export const config = { path: '/api/health' };
