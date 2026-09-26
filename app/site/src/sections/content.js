// Static sheet content filled from recorded data and from the library at the repo root (never typed by hand).
import restricted from '../data/restricted.json';
import oss from '../data/oss.js';
import { REPO } from '../function/survey.js';
import { signalRow, DOOR } from '../function/survey.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KW = /\b(const|let|var|function|return|if|else|for|of|in|new|export|import|from|await|async|null|true|false|throw|class)\b/g;

// Syntax colouring in the lane's style: keywords 600, strings dotted-underlined, comments pencil, numbers flag-ink.
export function highlight(code) {
  return code.split('\n').map((line) => {
    const out = []; let rest = line;
    const cm = rest.match(/^(.*?)(\/\/.*|^\s*\/?\*.*)$/);
    let comment = '';
    if (cm && !/['"`][^'"`]*\/\/[^'"`]*['"`]/.test(cm[1])) { rest = cm[1]; comment = cm[2]; }
    const parts = rest.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/);
    parts.forEach((p, i) => {
      if (i % 2) out.push(`<span class="st">${esc(p)}</span>`);
      else out.push(esc(p).replace(KW, '<span class="kw">$1</span>').replace(/\b(\d[\d_.]*)\b/g, '<span class="nu">$1</span>'));
    });
    if (comment) out.push(`<span class="cm">${esc(comment)}</span>`);
    return `<span class="l">${out.join('') || ' '}</span>`;
  }).join('');
}
const plain = (lines) => lines.map((l) => `<span class="l">${l || ' '}</span>`).join('');

export function fillContent(featured, clock, gone = null) {
  const $ = (id) => document.getElementById(id);
  const full = featured.repo.fullName;
  const at = gone ? `${gone.checkedAt.slice(0, 16).replace('T', ' ')}Z` : null;
  const is404 = (name) => !!gone && (gone.accounts?.[name] === 404 || gone.repos?.[name] === 404);
  const g = restricted.graphql_repository_stargazers.data.repository;
  $('closed-code').innerHTML = plain([
    `<span class="kw">GET</span> /repos/${esc(full)}/stargazers`,
    `<span class="hit">→ ${esc(restricted.rest_stargazers)}</span>`,
    `<span class="kw">GET</span> /repos/${esc(full)}/subscribers`,
    `<span class="hit">→ ${esc(restricted.rest_subscribers)}</span>`,
    `<span class="kw">POST</span> /graphql <span class="cm">repository { stargazerCount stargazers { totalCount } }</span>`,
    `→ stargazerCount: <span class="nu">${g.stargazerCount}</span>`,
    `<span class="hit">→ stargazers: { totalCount: ${g.stargazers.totalCount}, edges: [] }</span>`,
    ...(is404(full) ? [`<span class="cm">// re-checked ${at}: the repo itself is removed by GitHub (404)</span>`] : []),
  ]);
  const a = featured.stargazers.accounts.find((x) => x.login === 'BricklayerSurmount') || featured.stargazers.accounts[0];
  const mine = (featured.field.plantings || []).filter((p) => p.login === a.login).slice(0, 3);
  $('door-code').innerHTML = plain([
    `<span class="kw">GET</span> /users/${esc(a.login)}/starred?per_page=100`,
    `<span class="kw">Accept:</span> <span class="st">application/vnd.github.star+json</span>`,
    `<span class="cm">→ ${esc(restricted.rest_user_starred)}</span>`,
    ...mine.map((p) => `{ <span class="st">"starred_at"</span>: <span class="nu">"${p.at}"</span>, <span class="st">"repo"</span>: ${p.repo === full ? '<span class="hit">' : ''}"${esc(p.repo)}"${p.repo === full ? '</span>' : ''} }`),
    `<span class="cm">… ${(featured.field.plantings || []).filter((p) => p.login === a.login).length} stars on the field, each to the second</span>`,
    ...(is404(a.login) ? [`<span class="cm">// recorded ${featured.checkedAt.slice(0, 16).replace('T', ' ')}Z · ${esc(a.login)} removed by GitHub · 404 at ${at}</span>`] : []),
  ]);
  const via = (v) => featured.stargazers.accounts.filter((x) => x.via === v).length;
  const nSib = featured.siblings.repos.length - 1;
  $('doors-list').textContent = `forks (${featured.repo.forks} on this repo, ${via('fork')} stargazers found), the owner's birth cohort (${featured.cohort.count} accounts within ±6 min vs ${featured.cohort.controlCount} a day earlier, ${via('cohort')} stargazers found) and siblings (${nSib} repos created within ±30 s vs ${featured.siblings.controlCount} a day earlier).`;

  if (oss.idclock) {
    $('idclock-fig').dataset.title = `${oss.idclock.file} · L${oss.idclock.from}–L${oss.idclock.to}`;
    $('idclock-code').innerHTML = highlight(oss.idclock.code);
    $('idclock-code').style.counterReset = `ln ${oss.idclock.from - 1}`;
  }
  const own = featured.repo.owner;
  const cohortIds = featured.stargazers.accounts.map((x) => x.id);
  $('idclock-note').textContent = `The farm's accounts carry ids ${Math.min(...cohortIds).toLocaleString('en-US')}–${Math.max(...cohortIds).toLocaleString('en-US')}; the owner ${own.login} is id ${own.id.toLocaleString('en-US')}, born ${own.createdAt.replace('T', ' ')}${is404(own.login) ? ` (removed by GitHub · 404 at ${at})` : ''}. Anchors on the section face are recorded GitHub accounts (${clock.recordedAt}). ${(() => { const r = (oss.bench || []).find((b) => /leave-one-out, ClashDesk local/.test(b[0])); return r ? `Measured leave-one-out error with local anchors (${r[0].match(/\(([^()]*)\)\s*$/)?.[1] || 'farm accounts'}): ${r[1]}.` : 'Measured error with local anchors: 1–4 s on 5 cohort accounts.'; })()}`;

  const tb = $('schedule-5').tBodies[0];
  tb.replaceChildren(...featured.signals.map((s, i) => signalRow(s, { i })));
  $('schedule-5').classList.add('stagger');
  $('sched-repo').textContent = `${full} · recorded ${featured.checkedAt.slice(0, 16).replace('T', ' ')}Z`;
  $('sched-foot').innerHTML = `Score ${featured.score} / ${featured.maxScore} → <span class="${featured.verdict === 'PLANTED' ? 'p' : ''}">${featured.verdict}</span>`
    + ((featured.verdict === 'PLANTED' || featured.verdict === 'MIXED') ? '<span class="disc">Public GitHub data only. A pattern, not an accusation: a repo can be starred by a farm without asking for it.</span>' : '');
  if (gone) {
    const nA = Object.values(gone.accounts || {}).filter((x) => x === 404).length; const nR = Object.values(gone.repos || {}).filter((x) => x === 404).length;
    const tA = Object.keys(gone.accounts || {}).length; const tR = Object.keys(gone.repos || {}).length;
    $('gone-note').textContent = `The recorded field on sheets 1–5 (${full}: ${tA} named accounts, ${tR} repos) was surveyed ${featured.checkedAt.slice(0, 16).replace('T', ' ')}Z. Re-checked ${at}: ${nA === tA && nR === tR ? 'GitHub has removed every one of them (404)' : `${nA} of ${tA} accounts and ${nR} of ${tR} repos answer 404`}. The drawing is the recorded survey; a live survey of it now returns "no such field".`;
  }

  // sheet 7: repo block + bench + code
  $('repo-url').textContent = REPO.planned.replace('https://', '');
  $('repo-pkg').textContent = REPO.pkg;
  const bt = $('bench-table').tBodies[0];
  if (oss.bench?.length) {
    if (oss.benchHead) $('bench-table').tHead.innerHTML = `<tr>${oss.benchHead.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
    bt.innerHTML = oss.bench.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
    $('bench-cmd').textContent = `Reproduce: ${oss.benchCmd || 'npm run bench (at the repo root)'}${oss.benchMachine ? ` · ${oss.benchMachine}` : ''}`;
  } else {
    const planned = ['survey() end to end, live (median of 5)', 'analyze() on the recorded ClashDesk fixture', 'idToDate() conversions and leave-one-out error', 'readmeSkeleton() throughput'];
    bt.innerHTML = planned.map((p) => `<tr><td>${esc(p)}</td><td class="pending">PENDING · not measured yet</td></tr>`).join('');
    $('bench-cmd').textContent = 'No number goes on this sheet until bench/bench.js prints it on this Mac.';
  }
  if (oss.index) {
    $('usage-fig').dataset.title = `${oss.index.file} · L${oss.index.from}–L${oss.index.to} · the public API`;
    $('usage-code').innerHTML = highlight(oss.index.code);
    $('usage-code').style.counterReset = `ln ${oss.index.from - 1}`;
  }
  return { benchLines: oss.disc?.length ? oss.disc : [], benchRows: oss.bench || [], benchCmd: oss.benchCmd || '' };
}
export { DOOR };
