// The Crop Report UI: GET /api/report?q=… per concept.json, with loading, empty and error states in the surveyor's voice.
export const REPO = { planned: 'https://github.com/lkristof55/starcrop', pkg: 'starcrop', cmd: 'npx starcrop owner/repo', published: true };

const RX = {
  mint: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  url: /^https?:\/\/(www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})/i,
  slug: /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/,
};
export function parseInput(q) {
  q = (q || '').trim();
  if (!q) return null;
  if (RX.url.test(q)) return 'url';
  if (RX.slug.test(q)) return 'slug';
  if (RX.mint.test(q)) return 'mint';
  return 'none';
}
const READS = { url: 'READS AS: GITHUB REPO', slug: 'READS AS: GITHUB REPO', mint: 'READS AS: PUMP.FUN MINT', none: "DOESN'T READ AS ANYTHING YET" };

const STEPS = ['resolve', 'repo', 'siblings', 'cohort', 'seeds', 'starred', 'profiles', 'soil', 'twins', 'score'];
const CAPTION = {
  PLANTED: 'Real stars grow. These were planted.',
  MIXED: 'Some of this field was planted.',
  GROWN: 'Grown. Strangers, years apart, each on their own path.',
  SEEDLING: "Seedling. Under 20 stars, nothing to check. Stars aren't the claim here, the code is.",
  UNSURVEYED: "Too few stargazers came through the public doors to say. That's not a pass and not a fail.",
};
const DOORNAME = { 'star-event': 'star events', fork: 'forks', engaged: 'issue/PR authors', cohort: 'owner cohort', 'sibling-owner': 'sibling owners', 'known-planter': 'known planters' };
export const DOOR = {
  siblings: 'search/repositories created:±30 s', ownerCohort: 'search/users created:±6 min', birthSpread: '/users + the id clock',
  plantingRows: '/users/{u}/starred · starred_at', field: '/users/{u}/starred', hollowAccounts: '/users/{u}',
  thinSoil: '/repos + /commits', templateTwins: '/repos/{r}/readme', knownField: 'planted-field index',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const utc = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '—');
const fmtV = (v) => (v == null ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-US') : String(Math.round(v * 100) / 100)) : String(v));
// ratios read as percentages, long spans in hours, days or years (a spec sheet never prints "1 share" or "1,143,543 min")
export const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)} %`);
export function span(min) {
  if (min == null) return '—';
  const r1 = (x) => (Math.round(x * 10) / 10).toLocaleString('en-US');
  if (min < 120) return `${r1(min)} min`;
  if (min < 48 * 60) return `${r1(min / 60)} h`;
  if (min < 730 * 1440) return `${Math.round(min / 1440).toLocaleString('en-US')} days`;
  return `${r1(min / 525960)} years`;
}
const spanS = (sec) => (sec == null ? '—' : sec < 120 ? `${fmtV(sec)} s` : span(sec / 60));
export function measureText(s) {
  if (s.value == null) return null;
  if (s.id === 'birthSpread') return `${span(s.value)} (IQR)`;
  if (s.id === 'plantingRows') return `${pct(s.value)} of pairs in one order`;
  if (s.id === 'hollowAccounts') return `${pct(s.value)} of confirmed`;
  return `${fmtV(s.value)} ${s.unit}`;
}

export function signalRow(s, { full = false, i = 0 } = {}) {
  const tr = document.createElement('tr');
  tr.className = s.fired === true ? 'fired' : s.fired === null ? 'nm' : '';
  tr.style.setProperty('--i', i);
  const measured = s.fired === null && s.value == null ? 'not measured' : `${esc(measureText(s) ?? '—')}${s.control != null ? ` <span class="muted">vs ${fmtV(s.control)}</span>` : ''}`;
  tr.innerHTML = `<td><span class="lab">${esc(s.label)}</span><span class="thr">${esc(DOOR[s.id] || '')}${full ? ` · ${esc(s.threshold)}` : ''}</span>${full ? `<span class="ev">${esc(s.evidence)}</span>` : ''}</td>
    <td>${measured}</td><td class="f">${s.fired === true ? 'FIRED' : s.fired === null ? 'NOT MEASURED' : '—'}</td><td>${s.weight}</td>`;
  // the stacked mobile layout changes display on table parts; keep the table semantics explicit
  if (full) { tr.setAttribute('role', 'row'); for (const td of tr.cells) td.setAttribute('role', 'cell'); }
  tr.addEventListener('click', () => tr.classList.toggle('open'));
  return tr;
}

export function verdictClass(v) { return String(v || '').toLowerCase(); }

export function createSurvey({ onReport, onLoading, onScrollTo, goneNote = () => null }) {
  const $ = (id) => document.getElementById(id);
  const forms = [$('tb'), $('sf')];
  const inputs = [$('q1'), $('q2')];
  const parses = [$('parse1'), $('parse2')];
  const err = $('err'); const loading = $('loading'); const traceLive = $('trace-live'); const reportEl = $('report');
  const sbtn = $('sbtn'); const heroBtn = forms[0].querySelector('button[type=submit]');
  let busy = false; let countdown = null; let tickT = null; let againQ = ''; let againT = null;
  const againBtn = $('r-again-btn');
  // "Survey again" on a partial report: the service walks a partial field again at most once a minute (resurveyAt);
  // until then the button counts down, then it asks for the re-walk explicitly (fresh=1)
  againBtn.addEventListener('click', () => { if (!againQ || againBtn.disabled) return; inputs[1].value = againQ; inputs[1].dispatchEvent(new Event('input')); run(againQ, { fresh: true }); });
  function armAgain(at) {
    clearInterval(againT);
    const paint = () => {
      const n = at ? Math.min(60, Math.ceil((at - Date.now()) / 1000)) : 0;
      againBtn.disabled = n > 0;
      againBtn.textContent = n > 0 ? `Survey again in ${n} s` : 'Survey again ↻';
      if (n <= 0) clearInterval(againT);
    };
    paint(); if (at && at > Date.now()) againT = setInterval(paint, 1000);
  }

  inputs.forEach((inp, i) => inp.addEventListener('input', () => {
    const k = parseInput(inp.value); const p = parses[i];
    p.textContent = k ? READS[k] : (i === 1 ? 'Paste a repo. The field will be drawn from what we measure.' : '');
    p.classList.toggle('ok', k && k !== 'none');
    inputs[1 - i].value = inp.value; parses[1 - i].textContent = p.textContent; parses[1 - i].classList.toggle('ok', k && k !== 'none');
  }));
  forms.forEach((f, i) => f.addEventListener('submit', (e) => { e.preventDefault(); run(inputs[i].value, { from: i }); }));
  document.querySelectorAll('.try[data-q]').forEach((b) => b.addEventListener('click', () => { inputs[1].value = b.dataset.q; inputs[1].dispatchEvent(new Event('input')); run(b.dataset.q, { from: 1 }); }));

  function setBusy(on) {
    busy = on;
    for (const b of [sbtn, heroBtn]) { b.disabled = on; b.firstChild.textContent = on ? 'SURVEYING…' : 'SURVEY'; }
  }
  function showError(code, body = {}, kind, { keep = false } = {}) {
    clearInterval(countdown);
    let msg = {
      BAD_INPUT: "That doesn't read as a mint, a GitHub URL or owner/repo.",
      NOT_FOUND: kind === 'mint' ? 'No such mint on Solana.' : "No such field. GitHub says that repo doesn't exist.",
      NO_REPO: `${body.token?.symbol ? '$' + body.token.symbol : 'That coin'} links no GitHub repo. Nothing planted, nothing grown. Just a coin.`,
      RATE_LIMITED: 'Resurvey available in {n} s. A partial field is walked again at most once a minute.',
      UPSTREAM: "GitHub didn't answer in time. The field's still there. Try again in a minute.",
    }[code] || "GitHub didn't answer in time. The field's still there. Try again in a minute.";
    err.hidden = false;
    // a refused re-walk of the report on screen keeps it: it IS this input, just not re-surveyable yet
    if (!keep) { reportEl.classList.add('void'); reportEl.setAttribute('aria-hidden', 'true'); }
    if (code === 'RATE_LIMITED') {
      let n = Math.max(1, Math.round(body.retryAfter || 60));
      const paint = () => { err.textContent = msg.replace('{n}', n); };
      if (keep) armAgain(Date.now() + n * 1000);
      paint(); countdown = setInterval(() => { n -= 1; if (n <= 0) { clearInterval(countdown); err.textContent = 'The field is clear. Survey again.'; } else paint(); }, 1000);
    } else err.textContent = msg;
  }

  async function run(q, { from = 1, fresh = false } = {}) {
    if (busy) return;
    q = (q || '').trim();
    const kind = parseInput(q);
    err.hidden = true; clearInterval(countdown);
    if (!kind || kind === 'none') { showError('BAD_INPUT'); if (from === 0) onScrollTo?.(); return; }
    setBusy(true); onLoading?.(true);
    if (from === 0) onScrollTo?.();
    loading.hidden = false; reportEl.classList.add('stale');
    traceLive.innerHTML = STEPS.map((s) => `<li>${s}</li>`).join('');
    let step = kind === 'mint' ? 0 : 1; const lis = [...traceLive.children];
    if (step) lis[0].textContent = 'resolve · skipped';
    clearInterval(tickT); tickT = setInterval(() => { if (step < STEPS.length - 2) { lis[step].classList.add('on'); step += 1; } }, 520);
    try {
      const res = await fetch(`/api/report?q=${encodeURIComponent(q)}${fresh ? '&fresh=1' : ''}`, { headers: { accept: 'application/json' } });
      let body = null; try { body = await res.json(); } catch { body = null; }
      if (!res.ok || !body || body.error) { const code = body?.code || (res.status === 404 ? 'NOT_FOUND' : 'UPSTREAM'); showError(code, body || {}, kind, { keep: fresh && code === 'RATE_LIMITED' }); return; }
      render(body, { land: true });
      onReport?.(body);
      refreshLedger();
    } catch {
      showError('UPSTREAM');
    } finally {
      clearInterval(tickT); loading.hidden = true; reportEl.classList.remove('stale'); setBusy(false); onLoading?.(false);
    }
  }

  function copyBtn(text, farm) {
    return `<button type="button" class="copy small" data-copy="${esc(text)}"${farm ? ' data-farm="1"' : ''}>COPY</button>`;
  }

  function render(r, { land = false } = {}) {
    reportEl.classList.remove('void'); reportEl.removeAttribute('aria-hidden');
    const v = r.verdict; const vEl = $('r-verdict');
    vEl.textContent = v; vEl.className = `verdict ${verdictClass(v)}`;
    // the verdict is set as large as the column allows, measured (UNSURVEYED is ten wide letters; it must not push the page sideways)
    const colW = vEl.parentElement.clientWidth;
    const steps = innerWidth > 768 ? [112, 72, 56, 48] : [48, 40, 34, 30, 26];
    for (const px of steps) { vEl.style.fontSize = `${px}px`; if (vEl.scrollWidth <= colW) break; }
    if (land) { vEl.classList.remove('land'); void vEl.offsetWidth; vEl.classList.add('land'); }
    $('r-score').textContent = r.score;
    const src = r.source === 'fixture' ? `RECORDED ${utc(r.checkedAt)}` : r.source === 'cache' ? `FROM CACHE · CHECKED ${utc(r.checkedAt)}` : `SURVEYED ${utc(r.checkedAt)}`;
    $('r-src').textContent = src + (r.partial ? ' · PARTIAL: BUDGET RAN OUT' : '');
    const cutRepo = r.repo?.stars == null; // cut off before GitHub returned the repo: nothing measured
    $('r-caption').textContent = r.partial && v === 'UNSURVEYED'
      ? (cutRepo ? 'Cut short. The clock ran out before GitHub handed over the repo. Nothing measured, nothing decided.' : 'Cut short. The clock ran out before the field was walked. Not a pass, not a fail.')
      : CAPTION[v] || '';
    const why = $('r-reason'); why.textContent = r.reason ? `Why: ${r.reason}` : ''; why.hidden = !r.reason;
    // a cut-short survey offers a retry now (a report without the repo is never kept); a measured partial is served
    // from cache for 60 s (resurveyAt, lib/service.mjs PARTIAL_SERVE_MS), so the button counts down to it
    const again = $('r-again'); again.hidden = !r.partial;
    againQ = r.input?.mint || r.input?.q || r.repo?.fullName || '';
    $('r-again-note').textContent = !r.partial ? '' : cutRepo ? 'Nothing was kept. The next survey starts from the gate.' : 'A partial report is kept 60 s; then the field can be walked again.';
    if (r.partial) armAgain(r.resurveyAt ? Date.parse(r.resurveyAt) : 0); else clearInterval(againT);
    $('r-legal').hidden = $('r-kick').hidden = !(v === 'PLANTED' || v === 'MIXED');
    $('r-headline').textContent = r.headline || '';
    const farm = v === 'PLANTED' || v === 'MIXED';
    const gone = (name) => { const n = r.source === 'fixture' ? goneNote(name) : null; return n ? `<span class="gone">${esc(n)}</span>` : ''; };
    const repo = r.repo || {}; const own = repo.owner || {};
    const repoUrl = repo.url || (repo.fullName ? `https://github.com/${repo.fullName}` : '');
    const pair = (a, b, sa = '', sb = '') => (a == null && b == null ? 'not returned in time' : `${fmtV(a)}${sa} · ${fmtV(b)}${sb}`);
    const repoCell = farm
      ? `${esc(repo.fullName)} ${copyBtn(repo.fullName, true)}${gone(repo.fullName)}`
      : repoUrl ? `<a href="${esc(repoUrl)}" target="_blank" rel="noopener nofollow">${esc(repo.fullName)} ↗</a>` : '—';
    const tok = r.input?.token ? `$${esc(r.input.token.symbol)} · link found in ${esc(r.input.token.linkFoundIn)}` : esc(r.input?.kind || '');
    $('r-facts').innerHTML = [
      ['Repo', repoCell], ['Stars · forks', pair(repo.stars, repo.forks)], ['Created', repo.createdAt ? utc(repo.createdAt) : cutRepo ? 'not returned in time' : '—'],
      ['Size · commits', pair(repo.sizeKb, repo.commits, ' KB')],
      ['Owner', own.login ? `${esc(own.login)}${own.createdAt ? ` · born ${utc(own.createdAt).slice(0, 10)}` : ''}${own.followers != null ? ` · ${fmtV(own.followers)} followers` : ''}${gone(own.login)}` : cutRepo ? 'not returned in time' : '—'],
      ['Input', tok + (r.input?.mint ? `<br>${esc(r.input.mint.slice(0, 6))}…${esc(r.input.mint.slice(-4))}` : '')],
      ['Stargazers', `${r.stargazers?.confirmed ?? 0} confirmed of ${r.stargazers?.seeds ?? 0} seeds${(r.stargazers?.doors || []).length ? `<span class="doors">${r.stargazers.doors.map((d) => `${esc(DOORNAME[d.via] || d.via)} ${d.confirmed}/${d.seeds}`).join(' · ')}</span>` : ''}`],
      ['Birth spread', r.stargazers?.birthSpreadMinutes != null ? `IQR ${span(r.stargazers.birthSpreadMinutes)}` : '—'],
      ['Row agreement', r.stargazers?.rowAgreement != null ? `${pct(r.stargazers.rowAgreement)} of pairs · median gap ${spanS(r.stargazers.medianGapSeconds)}` : '—'],
    ].map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('');
    const tb = $('schedule-6').tBodies[0]; tb.replaceChildren(...(r.signals || []).map((s, i) => signalRow(s, { full: true, i })));
    $('r-trace').innerHTML = (r.trace || []).map((t) => `<li><b>${esc(t.step)}</b> · ${fmtV(t.calls)} · ${fmtV(t.ms)} ms</li>`).join('');
    $('r-cost').textContent = `${r.cost?.githubCore ?? 0} core + ${r.cost?.githubSearch ?? 0} search calls${r.cost?.heliusCredits ? ` + ${r.cost.heliusCredits} Helius credits` : ''} · read-only`;
    const sibs = (r.siblings?.repos || []).filter((s) => s.fullName !== repo.fullName);
    const fieldRepos = (r.field?.repos || []);
    const list = (title, items, fmt) => (items.length ? `<div><div class="k">${title}</div><ol class="plain">${items.slice(0, 10).map(fmt).join('')}${items.length > 10 ? `<li class="muted">+${items.length - 10} more in the JSON</li>` : ''}</ol></div>` : '');
    $('r-lists').innerHTML = list(`Siblings born within ±30 s · plain text, not links`, sibs, (s) => `<li><span>${esc(s.fullName)} <span class="m">${s.offsetSeconds >= 0 ? '+' : ''}${s.offsetSeconds} s · ${s.stars} stars</span>${gone(s.fullName)}</span>${copyBtn(s.fullName, true)}</li>`)
      + list(`The field: other repos the stargazers starred`, fieldRepos, (s) => `<li><span>${esc(s.fullName)} <span class="m">${s.starredBy} of ${r.stargazers?.confirmed ?? '?'}</span>${gone(s.fullName)}</span>${copyBtn(s.fullName, farm)}</li>`);
    $('r-limits').innerHTML = (r.limits || []).map((l) => `<li>${esc(l)}</li>`).join('');
  }

  async function refreshLedger() {
    try {
      const res = await fetch('/api/recent'); if (!res.ok) throw 0;
      const { reports = [] } = await res.json();
      const ol = $('recent');
      if (!reports.length) { ol.innerHTML = '<li class="muted">Nobody\'s walked the field yet today.</li>'; return; }
      ol.innerHTML = reports.slice(0, 10).map((s) => `<li><button type="button" data-q="${esc(s.fullName)}"><span class="n">${esc(s.fullName)}${s.symbol ? ` · $${esc(s.symbol)}` : ''}</span><span class="v ${verdictClass(s.verdict)}">${esc(s.verdict)} ${s.score}/${s.maxScore}</span></button></li>`).join('');
      ol.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { inputs[1].value = b.dataset.q; inputs[1].dispatchEvent(new Event('input')); run(b.dataset.q); }));
    } catch { $('recent').innerHTML = '<li class="muted">The ledger didn\'t answer. Surveys still work.</li>'; }
  }
  function renderFields(fields = []) {
    const ol = $('fields');
    if (!fields.length) { ol.innerHTML = '<li class="muted">No planted fields indexed yet.</li>'; return; }
    ol.innerHTML = fields.slice(0, 8).map((f) => `<li><span class="n">${esc(f.id)} · ${f.planters} planters · ${f.repos} repos</span><br><span class="muted">born ${utc(f.bornFrom)}–${utc(f.bornTo).slice(11)} · last planting ${utc(f.lastPlanting)}</span></li>`).join('');
  }

  // copy buttons everywhere (delegated)
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.copy'); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch { /* clipboard blocked */ }
    const was = b.textContent; b.textContent = b.dataset.farm ? "COPIED · DON'T RUN IT" : 'COPIED'; b.classList.add('done');
    setTimeout(() => { b.textContent = was; b.classList.remove('done'); }, 1600);
  });

  return { run, render, refreshLedger, renderFields };
}
