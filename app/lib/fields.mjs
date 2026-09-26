// Field index: pure functions that turn PLANTED reports into fields of known planters.
// Store layout (lib/service.mjs does the I/O):
//   field/<id>                -> Field (FieldSummary + planters[] + origin)
//   planter/<login lowercase> -> { fieldId, id, login }
//   by-repo/<owner>/<name>    -> { fieldIds[], planters[] }   (lowercase key)
//   fields/list               -> FieldSummary[]
import { iso } from '../../src/stats.js';

export const repoKey = (fullName) => fullName.toLowerCase();

/** A report plants a field when it is PLANTED and its stargazers were born together (birthSpread fired). */
export function plantsField(report) {
  return report.verdict === 'PLANTED' && report.signals.find((s) => s.id === 'birthSpread')?.fired === true && report.stargazers.accounts.length > 0;
}

/**
 * Decide which field a PLANTED report belongs to.
 * @param {object} report CropReport
 * @param {Record<string, { fieldId: string }>} knownPlanters planter/<login> records for this report's stargazers (lowercase login keys)
 * @param {string[]} existingIds ids already used ("F001", ...)
 * @returns {{ fieldId: string, isNew: boolean }}
 */
export function assignField(report, knownPlanters, existingIds) {
  const logins = report.stargazers.accounts.map((a) => a.login.toLowerCase());
  const votes = new Map();
  for (const l of logins) { const f = knownPlanters[l]?.fieldId; if (f) votes.set(f, (votes.get(f) || 0) + 1); }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (best && best[1] >= logins.length / 2) return { fieldId: best[0], isNew: false };
  const n = existingIds.reduce((m, id) => Math.max(m, Number(id.slice(1)) || 0), 0) + 1;
  return { fieldId: `F${String(n).padStart(3, '0')}`, isNew: true };
}

/**
 * Merge a PLANTED report into a field record (new or existing).
 * @param {object|null} field existing field/<id> record
 * @param {object} report CropReport
 * @param {string} fieldId
 * @param {string} now ISO
 */
export function mergeField(field, report, fieldId, now) {
  const f = field ? structuredClone(field) : { id: fieldId, origin: report.repo.fullName, firstSeen: now, planters: [], repoSet: [] };
  const planters = new Map(f.planters.map((p) => [p.login.toLowerCase(), p]));
  for (const a of report.stargazers.accounts) planters.set(a.login.toLowerCase(), { login: a.login, id: a.id, bornAt: a.bornAt });
  f.planters = [...planters.values()];
  const repos = new Map(f.repoSet.map((r) => [repoKey(r.fullName), r]));
  const meta = new Map(report.siblings.repos.map((r) => [repoKey(r.fullName), r]));
  const add = (fullName, stars, createdAt) => { if (!repos.has(repoKey(fullName))) repos.set(repoKey(fullName), { fullName, stars, createdAt }); else Object.assign(repos.get(repoKey(fullName)), stars != null ? { stars } : {}); };
  add(report.repo.fullName, report.repo.stars, report.repo.createdAt);
  for (const r of report.field.repos) { const m = meta.get(repoKey(r.fullName)); add(r.fullName, m?.stars ?? null, m?.createdAt ?? null); }
  f.repoSet = [...repos.values()];
  const plantAts = report.field.plantings.map((p) => Date.parse(p.at));
  const last = Math.max(Date.parse(f.lastPlanting || 0) || 0, ...plantAts);
  f.lastPlanting = last ? iso(last) : null;
  const born = f.planters.map((p) => Date.parse(p.bornAt)).filter(Number.isFinite);
  f.bornFrom = born.length ? iso(Math.min(...born)) : null;
  f.bornTo = born.length ? iso(Math.max(...born)) : null;
  return f;
}

/** FieldSummary for /api/fields. */
export function fieldSummary(f) {
  return {
    id: f.id, planters: f.planters.length, repos: f.repoSet.length,
    reposSample: [...f.repoSet].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.fullName.localeCompare(b.fullName)).slice(0, 12)
      .map((r) => ({ fullName: r.fullName, stars: r.stars, createdAt: r.createdAt })),
    firstSeen: f.firstSeen, lastPlanting: f.lastPlanting, bornFrom: f.bornFrom, bornTo: f.bornTo,
  };
}

/** Put a summary at the head of a list, deduped by `key`, capped at `max`. */
export function prepend(list, item, max, key = (x) => x.fullName?.toLowerCase() ?? x.id) {
  const k = key(item);
  return [item, ...(list || []).filter((x) => key(x) !== k)].slice(0, max);
}

/** Sort + cap for fields/list: newest lastPlanting first, max 12. */
export function upsertFieldList(list, summary) {
  return [summary, ...(list || []).filter((x) => x.id !== summary.id)].sort((a, b) => (Date.parse(b.lastPlanting) || 0) - (Date.parse(a.lastPlanting) || 0)).slice(0, 12);
}
