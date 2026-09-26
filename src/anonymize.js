// anonymize(raw): a RawSurvey with every GitHub login replaced by a stable placeholder (sample-user-NN for accounts
// seen as stargazers, sample-owner-NN for repo owners). Ids, dates, counts and star lists are kept, READMEs keep the
// skeleton hash of their original text, so analyze() gives the same report with the names swapped.
// Use it before you share or commit a survey: the people in it didn't ask to be in your fixture.
import { readmeSkeleton } from './skeleton.js';
import { RESERVED } from './parse.js';

export const PLACEHOLDER_RE = /^sample-(?:user|owner)-\d{2,}$/;
const lc = (s) => String(s).toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN = '[A-Za-z0-9][A-Za-z0-9-]{0,38}';
const GH_LINK = new RegExp(`(github\\.com/)(${TOKEN})(?![A-Za-z0-9-])`, 'gi');
const PROSE_SLUG = new RegExp(`(^|[\\s(\\[<"'\`])(${TOKEN})(?=/)`, 'g');
const MENTION = new RegExp(`(^|[^A-Za-z0-9._-])@(${TOKEN})(?![A-Za-z0-9.-])`, 'g');

/** Free-text fields of a RawSurvey (they can carry github.com links or @mentions). */
function texts(raw) {
  const out = [raw.input?.q, raw.repo?.description, raw._note, ...(raw.limits || [])];
  for (const x of raw.siblings?.items || []) out.push(x.description);
  for (const r of Object.values(raw.readmes || {})) out.push(r?.text);
  return out.filter((s) => typeof s === 'string');
}

/**
 * Every GitHub login a RawSurvey names, by role.
 * users: seeds, starred and profile keys, cohort accounts, known planters. owners: repo owners (target, siblings,
 * starred repos, READMEs, github.com links in free text) that are not also users.
 * @returns {{ users: Set<string>, owners: Set<string> }}
 */
export function surveyLogins(raw) {
  const users = new Set(), owners = new Set();
  const user = (l) => { if (l) users.add(l); };
  const own = (full) => { if (typeof full === 'string' && full.includes('/')) owners.add(full.split('/')[0]); };
  for (const s of raw.seeds || []) user(s.login);
  for (const k of Object.keys(raw.starred || {})) user(k);
  for (const k of Object.keys(raw.profiles || {})) user(k);
  for (const x of raw.cohort?.items || []) user(x.login);
  for (const k of ['planters', 'starredThis']) for (const l of raw.known?.[k] || []) user(l);
  for (const s of raw.known?.seeds || []) user(typeof s === 'string' ? s : s?.login);
  for (const l of Object.values(raw.starred || {})) for (const it of l?.items || []) own(it.repo);
  if (raw.owner?.login) owners.add(raw.owner.login);
  own(raw.repo?.fullName);
  for (const x of raw.siblings?.items || []) { own(x.fullName); if (x.ownerLogin) owners.add(x.ownerLogin); }
  for (const k of Object.keys(raw.readmes || {})) own(k);
  for (const s of texts(raw)) for (const m of s.matchAll(GH_LINK)) if (!RESERVED.has(lc(m[2]))) owners.add(m[2]);
  const u = new Set([...users].map(lc));
  for (const o of owners) if (u.has(lc(o))) owners.delete(o);
  return { users, owners };
}

/**
 * Replace logins with placeholders. Pass an array to number several surveys with one stable table.
 * @param {object|object[]} raws RawSurvey(s) from collect() or `starcrop --raw`
 * @param {{ keep?: string[], map?: Map<string, string> }} [opts] keep: logins left as they are (e.g. an organization
 *   used as the input); map: lowercase login -> placeholder, reused and extended (it holds the real logins: never commit it)
 * @returns {object|object[]} new RawSurvey(s); the inputs are not modified
 */
export function anonymize(raws, { keep = [], map = new Map() } = {}) {
  const list = Array.isArray(raws) ? raws : [raws];
  const keepSet = new Set(keep.map(lc));
  const users = new Map(), owners = new Map(); // lowercase -> first spelling seen
  const found = list.map(surveyLogins);
  for (const f of found) for (const l of f.users) if (!users.has(lc(l))) users.set(lc(l), l);
  for (const f of found) for (const l of f.owners) if (!users.has(lc(l)) && !owners.has(lc(l))) owners.set(lc(l), l);
  // Number in the order analyze() sorts by (plantings: login code units; field ties: fullName localeCompare),
  // so tie-breaks and listing order survive the rename.
  const assign = (m, kind, cmp) => {
    const todo = [...m.values()].filter((l) => !keepSet.has(lc(l)) && !map.has(lc(l))).sort(cmp);
    let n = [...map.values()].filter((p) => p.startsWith(`sample-${kind}-`)).length;
    const width = Math.max(2, String(n + todo.length).length);
    for (const l of todo) map.set(lc(l), `sample-${kind}-${String(++n).padStart(width, '0')}`);
  };
  assign(users, 'user', (a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assign(owners, 'owner', (a, b) => a.localeCompare(b));

  const L = (l) => (typeof l !== 'string' || keepSet.has(lc(l)) ? l : map.get(lc(l)) ?? l);
  // owner/name: the owner is replaced, and so is the owner's login inside the name (profile repos alice/alice,
  // alice.github.io), which would name the account again.
  const R = (full) => {
    if (typeof full !== 'string') return full;
    const i = full.indexOf('/');
    if (i < 0) return full;
    const o = full.slice(0, i), p = L(o);
    return p === o ? full : `${p}/${full.slice(i + 1).replace(new RegExp(`(?<![A-Za-z0-9])${esc(o)}(?![A-Za-z0-9])`, 'gi'), p)}`;
  };
  const T = (s) => typeof s !== 'string' ? s : s
    .replace(GH_LINK, (m, p, l) => p + L(l))
    .replace(PROSE_SLUG, (m, p, l) => p + L(l))
    .replace(MENTION, (m, p, l) => `${p}@${L(l)}`);
  const keys = (o, f, v = (x) => x) => (o ? Object.fromEntries(Object.entries(o).map(([k, x]) => [f(k), v(x)])) : o);

  const out = list.map((raw) => {
    const r = structuredClone(raw);
    if (r.input) r.input.q = T(r.input.q);
    if (r.repo) { r.repo.fullName = R(r.repo.fullName); r.repo.description = T(r.repo.description); }
    if (r.owner) r.owner.login = L(r.owner.login);
    if (r.siblings?.items) for (const x of r.siblings.items) { x.fullName = R(x.fullName); x.ownerLogin = L(x.ownerLogin); x.description = T(x.description); }
    if (r.cohort?.items) for (const x of r.cohort.items) x.login = L(x.login);
    for (const s of r.seeds || []) s.login = L(s.login);
    if (r.known) {
      for (const k of ['planters', 'starredThis']) if (Array.isArray(r.known[k])) r.known[k] = r.known[k].map(L);
      if (Array.isArray(r.known.seeds)) r.known.seeds = r.known.seeds.map((s) => (typeof s === 'string' ? L(s) : { ...s, login: L(s.login) }));
    }
    r.starred = keys(r.starred, L, (l) => (l ? { ...l, items: l.items.map((it) => ({ ...it, repo: R(it.repo) })) } : l));
    r.profiles = keys(r.profiles, L);
    // READMEs: the skeleton is pinned from the original text (a third-party link rewritten in the text would change it).
    r.readmes = raw.readmes && Object.fromEntries(Object.entries(raw.readmes).map(([k, v]) => {
      if (!v || v.skeleton || v.text == null) return [R(k), v];
      const [o, n] = k.split('/');
      const desc = k === raw.repo?.fullName ? raw.repo.description : raw.siblings?.items?.find((x) => x.fullName === k)?.description ?? null;
      return [R(k), { ...v, text: T(v.text), skeleton: readmeSkeleton(v.text, { owner: o, name: n, description: desc }) }];
    }));
    if (typeof r._note === 'string') r._note = T(r._note);
    if (Array.isArray(r.limits)) r.limits = r.limits.map(T);
    return r;
  });
  return Array.isArray(raws) ? out : out[0];
}
