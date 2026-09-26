// The ID clock: GitHub assigns user ids in signup order, so an id is a timestamp in disguise.
// idToDate() interpolates piecewise-linearly between anchors (id, created_at).
// Report-local anchors (profiles this report fetched anyway, the owner first) beat the global table,
// because signup rate varies by the minute and a local bracket is seconds wide.
import { GLOBAL_ANCHORS } from './anchors.js';

const LOCAL_EXTRAPOLATE_IDS = 5000;

function prep(list, source) {
  return list
    .map((a) => ({ id: Number(a.id), ms: Date.parse(a.createdAt ?? a.created_at), source }))
    .filter((a) => Number.isFinite(a.id) && Number.isFinite(a.ms));
}

function lerp(a, b, id) {
  if (b.id === a.id) return a.ms;
  return a.ms + ((id - a.id) * (b.ms - a.ms)) / (b.id - a.id);
}

/**
 * @param {number} id GitHub user id
 * @param {{ id: number, createdAt: string }[]} [localAnchors]
 * @param {{ id: number, createdAt: string }[]} [globalAnchors] defaults to the recorded table
 * @returns {{ at: Date, exact: boolean, source: 'local'|'global', extrapolated: boolean }}
 */
export function idToDate(id, localAnchors = [], globalAnchors = GLOBAL_ANCHORS) {
  id = Number(id);
  const local = prep(localAnchors, 'local');
  const hit = local.find((a) => a.id === id);
  if (hit) return { at: new Date(hit.ms), exact: true, source: 'local', extrapolated: false };

  const merged = [...local, ...prep(globalAnchors, 'global')].sort((a, b) => a.id - b.id || (a.source === 'local' ? -1 : 1));
  // dedupe equal ids, keeping local
  const anchors = merged.filter((a, i) => i === 0 || a.id !== merged[i - 1].id);
  let lo = null, hi = null;
  for (const a of anchors) { if (a.id <= id) lo = a; else { hi = a; break; } }

  if (lo && hi) {
    // Both neighbours local: a tight local bracket.
    if (lo.source === 'local' && hi.source === 'local') return { at: new Date(lerp(lo, hi, id)), exact: false, source: 'local', extrapolated: false };
    // Just outside the local range: extrapolate from the two nearest local anchors on that side.
    const locals = local.sort((a, b) => a.id - b.id);
    if (locals.length >= 2) {
      const below = locals.filter((a) => a.id < id), above = locals.filter((a) => a.id > id);
      const pair = !above.length && below.length >= 2 ? below.slice(-2) : !below.length && above.length >= 2 ? above.slice(0, 2) : null;
      if (pair) {
        const near = Math.min(...pair.map((a) => Math.abs(a.id - id)));
        const span = pair[1].id - pair[0].id, dt = pair[1].ms - pair[0].ms;
        if (near <= LOCAL_EXTRAPOLATE_IDS && span >= 20 && dt > 0) return { at: new Date(lerp(pair[0], pair[1], id)), exact: false, source: 'local', extrapolated: true };
      }
    }
    return { at: new Date(lerp(lo, hi, id)), exact: false, source: 'global', extrapolated: false };
  }
  // Beyond the table: extrapolate from the two nearest anchors.
  const pair = hi ? anchors.slice(0, 2) : anchors.slice(-2);
  const src = pair.every((a) => a.source === 'local') ? 'local' : 'global';
  return { at: new Date(lerp(pair[0], pair[1], id)), exact: false, source: src, extrapolated: true };
}
