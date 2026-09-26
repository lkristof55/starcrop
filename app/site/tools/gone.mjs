// Re-check every named account and repo of the recorded ClashDesk farm against GitHub and write
// site/src/data/gone.json: { checkedAt, accounts: { login: status }, repos: { fullName: status } }.
// The site prints "removed by GitHub · 404 at <time>" only next to names that answered 404 here.
// Uses the gh CLI's own auth (no token is read or written by this script). Run in app/:   node site/tools/gone.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { default: r } = await import(path.join(root, 'lib/reference-report.mjs'));

const logins = [...new Set([r.repo.owner.login, ...r.stargazers.accounts.map((a) => a.login)])];
const repos = [...new Set([r.repo.fullName, ...r.siblings.repos.map((s) => s.fullName), ...r.field.repos.map((s) => s.fullName)])];

function status(p) {
  try { execFileSync('gh', ['api', '-i', p], { stdio: ['ignore', 'pipe', 'pipe'] }); return 200; } catch (e) {
    const m = String(e.stdout || '').match(/^HTTP\/[\d.]+ (\d{3})/m) || String(e.stderr || '').match(/HTTP (\d{3})/);
    return m ? Number(m[1]) : 0;
  }
}
const checkedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const out = { checkedAt, accounts: {}, repos: {} };
for (const l of logins) out.accounts[l] = status(`users/${l}`);
for (const f of repos) out.repos[f] = status(`repos/${f}`);
fs.writeFileSync(path.join(root, 'site/src/data/gone.json'), JSON.stringify(out, null, 1) + '\n');
const n404 = (o) => Object.values(o).filter((s) => s === 404).length;
console.log(`checked ${logins.length} accounts (${n404(out.accounts)} x 404) and ${repos.length} repos (${n404(out.repos)} x 404) at ${checkedAt}`);
