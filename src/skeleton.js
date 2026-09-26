import { sha1Hex } from './sha1.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * README skeleton: what is left of a README once the parts a template fills in are removed.
 * Farms stamp one template over many repos, changing only the name, owner, description, emoji and version.
 *   1. description -> {desc}, repo name -> {name}, owner -> {owner} (name and owner case-insensitive)
 *   2. drop non-ASCII (emoji, accents)   3. v1.2 / 1.2.3 -> {v}   4. lowercase   5. collapse whitespace, trim
 * The skeleton is the first 12 hex chars of SHA-1 over the result.
 * @param {string} text
 * @param {{ owner?: string, name?: string, description?: string|null }} [ctx]
 */
export function readmeSkeleton(text, { owner = '', name = '', description = null } = {}) {
  let s = String(text ?? '');
  if (description && description.trim().length >= 3) s = s.split(description).join('{desc}');
  if (name && name.length >= 2) s = s.replace(new RegExp(esc(name), 'gi'), '{name}');
  if (owner && owner.length >= 2) s = s.replace(new RegExp(esc(owner), 'gi'), '{owner}');
  s = s.replace(/[^\x00-\x7F]/g, '');
  s = s.replace(/v?\d+\.\d+(\.\d+)?/g, '{v}');
  s = s.toLowerCase().replace(/\s+/g, ' ').trim();
  return sha1Hex(s).slice(0, 12);
}
