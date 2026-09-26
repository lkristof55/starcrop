// GET /api/recent -> { reports: ReportSummary[] } (max 20 user-run reports, newest first)
import { getRecent } from '../../lib/service.mjs';

export default async () => {
  try {
    return Response.json(await getRecent(), { headers: { 'cache-control': 'public, max-age=30' } });
  } catch (e) {
    console.error(`[recent] ${e.message}`);
    return Response.json({ error: 'The recent list is unreachable right now.', code: 'UPSTREAM' }, { status: 502 });
  }
};

export const config = { path: '/api/recent' };
