// renderPlat(report): the crop report as an ASCII surveyor's plat (signals table + planting-row plot). Pure.
const pad = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '~' : s + ' '.repeat(n - s.length); };
const lpad = (s, n) => { s = String(s ?? ''); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * @param {import('./index.js').CropReport} r
 * @param {{ width?: number }} [o]
 */
export function renderPlat(r, { width = 96 } = {}) {
  const L = [];
  const rule = (c = '-') => L.push(c.repeat(width));
  rule('=');
  L.push(`STARCROP  crop report  ${r.repo.fullName}`);
  L.push(`${r.repo.stars == null ? 'repository not returned in time' : `${r.repo.stars} stars  ${r.repo.forks} forks  ${r.repo.sizeKb} KB  created ${r.repo.createdAt}`}  checked ${r.checkedAt}${r.source !== 'live' ? `  [${r.source.toUpperCase()}]` : ''}${r.partial ? '  [PARTIAL: budget ran out]' : ''}`);
  if (r.input?.mint) L.push(`from mint ${r.input.mint}${r.input.token?.symbol ? ` ($${r.input.token.symbol}, link in ${r.input.token.linkFoundIn})` : ''}`);
  rule('=');
  L.push(`VERDICT  ${r.verdict}  ${r.score}/${r.maxScore}`);
  L.push(wrap(r.headline, width));
  if (r.reason) L.push(wrap(`WHY UNSURVEYED  ${r.reason}`, width));
  rule();
  L.push(`${pad('SIGNAL', 24)}${pad('W', 3)}${pad('FIRED', 7)}${pad('VALUE', 22)}EVIDENCE`);
  for (const s of r.signals) {
    const fired = s.fired === true ? 'YES' : s.fired === false ? 'no' : 'n/m';
    const value = s.value == null ? '-' : `${s.value}${s.control != null ? ` (ctl ${s.control})` : ''} ${shortUnit(s.unit)}`;
    L.push(`${pad(s.label, 24)}${pad(s.weight, 3)}${pad(fired, 7)}${pad(value, 22)}${s.evidence}`.slice(0, 400));
  }
  rule();
  const accts = r.stargazers.accounts;
  const doors = (r.stargazers.doors || []).filter((d) => d.seeds).map((d) => `${d.via} ${d.confirmed}/${d.seeds}`).join(', ');
  L.push(`STARGAZERS  ${r.stargazers.confirmed} confirmed of ${r.stargazers.seeds} seeds  (doors, confirmed/sampled: ${doors || 'none'})`);
  if (accts.length && r.field.plantings.length) {
    const repos = [...new Set(r.field.plantings.map((p) => p.repo))];
    const firstAt = new Map();
    for (const p of r.field.plantings) { const t = Date.parse(p.at); if (!firstAt.has(p.repo) || t < firstAt.get(p.repo)) firstAt.set(p.repo, t); }
    repos.sort((a, b) => firstAt.get(a) - firstAt.get(b));
    let li = 0;
    const letter = new Map(repos.map((x) => [x, x === r.repo.fullName ? '*' : LETTERS[li++] || '?']));
    L.push('');
    L.push('PLANTING ROWS  one row per stargazer, its stars on the field in the order it planted them (* = this repo)');
    L.push(`${pad('account', 22)}${pad('born', 22)}${pad('via', 14)}order`);
    for (const a of accts.slice(0, 24)) {
      const seq = r.field.plantings.filter((p) => p.login === a.login).sort((p, q) => Date.parse(p.at) - Date.parse(q.at)).map((p) => letter.get(p.repo)).join(' ');
      L.push(`${pad(a.login, 22)}${pad(a.bornAt.replace('T', ' ').replace('Z', '') + (a.bornExact ? '' : '~'), 22)}${pad(a.via, 14)}${seq}`);
    }
    if (accts.length > 24) L.push(`... ${accts.length - 24} more`);
    L.push('');
    for (const x of repos) L.push(`  ${letter.get(x)}  ${x}`);
    L.push('  (~ = birth time from the id clock)');
  }
  rule();
  L.push(`cost: ${r.cost.githubCore} GitHub core + ${r.cost.githubSearch} search calls, ${r.cost.heliusCredits} Helius credits; ${r.trace.reduce((s, x) => s + x.ms, 0)} ms summed over steps`);
  L.push('Public GitHub data only. A pattern, not an accusation: a repo can be starred by a farm without asking for it.');
  rule('=');
  return L.join('\n');
}

function shortUnit(u) { return { 'minutes (IQR)': 'min', 'row agreement': '', 'stars per KB': '*/KB', 'known planters': '', share: '' }[u] ?? u; }
function wrap(s, w) { const out = []; let line = ''; for (const word of s.split(' ')) { if ((line + ' ' + word).trim().length > w) { out.push(line); line = word; } else line = (line + ' ' + word).trim(); } if (line) out.push(line); return out.join('\n'); }
