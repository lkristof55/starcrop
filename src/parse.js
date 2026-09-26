import { StarcropError } from './errors.js';

export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const OWNER_RE = /^[A-Za-z0-9-]{1,39}$/;
export const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

// github.com/<x> paths that are not user or org accounts.
export const RESERVED = new Set(['orgs', 'topics', 'features', 'sponsors', 'marketplace', 'settings', 'login', 'join', 'about',
  'pricing', 'explore', 'trending', 'collections', 'apps', 'search', 'notifications', 'issues', 'pulls', 'enterprise',
  'site', 'security', 'customer-stories', 'readme', 'team', 'contact', 'events', 'new', 'codespaces', 'copilot', 'blog']);

function cleanName(name) {
  let n = name.replace(/\.git$/i, '').replace(/\.+$/, '');
  if (!n || n === '.' || n === '..') return null;
  return REPO_RE.test(n) ? n : null;
}

/**
 * Parse user input into a target. Accepts a base58 mint, a github.com URL (extra path, query, .git ignored)
 * or owner/repo. Throws StarcropError BAD_INPUT otherwise.
 * @param {string} input
 * @returns {{ kind: 'mint'|'url'|'slug', mint: string|null, owner: string|null, name: string|null, fullName: string|null }}
 */
export function parseTarget(input) {
  const q = String(input ?? '').trim();
  if (!q) throw new StarcropError('BAD_INPUT', 'Give a pump.fun mint, a GitHub URL or owner/repo.');
  if (q.length > 300) throw new StarcropError('BAD_INPUT', 'Input is too long.');
  if (BASE58_RE.test(q)) return { kind: 'mint', mint: q, owner: null, name: null, fullName: null };
  const url = q.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)\/([^/?#\s]+)(?:[/?#].*)?$/i);
  if (url) {
    const owner = url[1], name = cleanName(url[2]);
    if (!OWNER_RE.test(owner) || !name || RESERVED.has(owner.toLowerCase())) throw new StarcropError('BAD_INPUT', 'That GitHub URL does not point to a repository.');
    return { kind: 'url', mint: null, owner, name, fullName: `${owner}/${name}` };
  }
  const slug = q.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (slug) {
    const owner = slug[1], name = cleanName(slug[2]);
    if (!OWNER_RE.test(owner) || !name) throw new StarcropError('BAD_INPUT', 'owner/repo has characters GitHub does not allow.');
    return { kind: 'slug', mint: null, owner, name, fullName: `${owner}/${name}` };
  }
  throw new StarcropError('BAD_INPUT', 'Not a mint (32-44 base58 chars), a github.com/<owner>/<repo> URL or owner/repo.');
}

/**
 * First github.com/<owner>/<repo> link in a piece of text (skips github.com/orgs, /sponsors, ...).
 * @param {string|null|undefined} text
 * @returns {string|null} "owner/repo"
 */
export function findGithubRepo(text) {
  if (!text || typeof text !== 'string') return null;
  const re = /github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})/gi;
  let m;
  while ((m = re.exec(text))) {
    const owner = m[1], name = cleanName(m[2]);
    if (!name || RESERVED.has(owner.toLowerCase())) continue;
    return `${owner}/${name}`;
  }
  return null;
}
