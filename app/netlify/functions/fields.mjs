// GET /api/fields -> { updatedAt, featured, fields, surveyed }. The hero's first load. Never 5xx for missing data:
// an empty store serves the recorded ClashDesk report as featured (source: 'fixture').
import { getFields } from '../../lib/service.mjs';

let memo = null; // { at, body }
const TTL = 300e3;

export default async () => {
  try {
    if (!memo || Date.now() - memo.at > TTL) memo = { at: Date.now(), body: await getFields() };
    return Response.json(memo.body, { headers: { 'cache-control': 'public, max-age=60', 'netlify-cdn-cache-control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch (e) {
    console.error(`[fields] ${e.message}`);
    return Response.json({ error: 'The field index is unreachable right now.', code: 'UPSTREAM' }, { status: 502 });
  }
};

export const config = { path: '/api/fields' };
