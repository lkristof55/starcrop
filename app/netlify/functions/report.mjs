// GET /api/report?q=<mint | github URL | owner/repo>[&fresh=1] -> CropReport
// Full reports are cached 6 h per repo (and under the requested name of a renamed repo). Partial reports (8.5 s budget ran
// out) are served from cache for 60 s, then surveyed again; fresh=1 asks for that re-survey explicitly (429 inside the 60 s).
import { getReport, errorResponse, measured } from '../../lib/service.mjs';

const FRESH = new Set(['1', 'true']);

export default async (req) => {
  if (req.method !== 'GET') return Response.json({ error: 'Use GET.', code: 'BAD_INPUT' }, { status: 405 });
  const params = new URL(req.url).searchParams;
  const q = params.get('q');
  const fresh = FRESH.has(String(params.get('fresh') ?? '').toLowerCase());
  try {
    const report = await getReport(q ?? '', { fresh });
    // Only complete reports may sit in a browser/CDN cache. A partial or cut-short report must never be replayed by a cache,
    // or "Survey again" would get the same bytes back.
    const complete = measured(report) && !report.partial;
    return Response.json(report, { headers: { 'cache-control': complete ? 'public, max-age=60' : 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
};

export const config = { path: '/api/report' };
