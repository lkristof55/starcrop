// The dimension overlay: drafting conventions (extension lines, 45° ticks, text on the line), drawn in SVG over the
// orthographic view. Every number here comes from the CropReport or a recorded GitHub response.
import * as THREE from 'three';
import { project, PAL } from '../scene/field.js';
import { span, pct } from '../function/survey.js';

const NS = 'http://www.w3.org/2000/svg';
const ink = PAL.blueline, pink = PAL.flag, pinkInk = '#C8175E';
const tfill = (c) => (c === pink ? pinkInk : c);
const DAY = 864e5; const T2008 = Date.UTC(2008, 0, 1);
const fmtT = (t) => new Date(t).toISOString().slice(11, 16);
const num = (n) => Number(n).toLocaleString('en-US');

export function createOverlay(svg) {
  let parent = svg; let animate = false;
  const el = (t, a, p = parent) => { const e = document.createElementNS(NS, t); for (const k in a) if (a[k] !== undefined && a[k] !== '') e.setAttribute(k, a[k]); p.appendChild(e); return e; };
  const plotted = (e, len, delay) => { if (!animate) return e; e.classList.add('plotline'); e.style.setProperty('--len', Math.ceil(len) + 1); e.style.animationDelay = `${delay}ms`; return e; };
  let order = 0; const nextDelay = () => (order++) * 30;
  const line = (x1, y1, x2, y2, color, w, extra = {}) => plotted(el('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': w, ...extra }), Math.hypot(x2 - x1, y2 - y1), nextDelay());
  const text = (x, y, s, a) => { const t = el('text', { x, y, ...a }); t.textContent = s; if (animate) { t.classList.add('plottext'); t.style.animationDelay = `${nextDelay() + 200}ms`; } return t; };
  const o = {
    begin(cam, w, h, { anim = false } = {}) { svg.replaceChildren(); parent = svg; animate = anim; order = 0; o.cam = cam; o.w = w; o.h = h; },
    P: (v) => project(v, o.cam, o.w, o.h),
    el,
    dim(a, b, off, label, { color = ink, cls = '', side = 1, textOff = 7 } = {}) {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1; const nx = -dy / len * side, ny = dx / len * side;
      const a2 = { x: a.x + nx * off, y: a.y + ny * off }, b2 = { x: b.x + nx * off, y: b.y + ny * off };
      line(a.x + nx * 3, a.y + ny * 3, a2.x + nx * 5, a2.y + ny * 5, color, 0.8);
      line(b.x + nx * 3, b.y + ny * 3, b2.x + nx * 5, b2.y + ny * 5, color, 0.8);
      line(a2.x - dx / len * 6, a2.y - dy / len * 6, b2.x + dx / len * 6, b2.y + dy / len * 6, color, 1);
      for (const p of [a2, b2]) { const ux = dx / len, uy = dy / len; const tx = (ux + nx) * 4.2, ty = (uy + ny) * 4.2; line(p.x - tx, p.y - ty, p.x + tx, p.y + ty, color, 1.6); }
      let ang = Math.atan2(dy, dx) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const mx = (a2.x + b2.x) / 2 + nx * textOff, my = (a2.y + b2.y) / 2 + ny * textOff;
      return text(mx, my, label, { 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: `rotate(${ang} ${mx} ${my})`, class: cls, fill: tfill(color) });
    },
    leader(p, to, lines, { color = ink, cls = '', anchor = 'start', dot = true } = {}) {
      const e = el('polyline', { points: `${p.x},${p.y} ${to.x},${to.y} ${to.x + (anchor === 'start' ? 14 : -14)},${to.y}`, fill: 'none', stroke: color, 'stroke-width': 0.9 });
      plotted(e, Math.hypot(to.x - p.x, to.y - p.y) + 14, nextDelay());
      if (dot) el('circle', { cx: p.x, cy: p.y, r: 2.2, fill: color });
      const tx = to.x + (anchor === 'start' ? 19 : -19);
      lines.forEach((s, i) => text(tx, to.y + 4 + i * 14, s, { 'text-anchor': anchor, class: i === 0 ? cls : cls.replace('big', ''), fill: tfill(color) }));
    },
    label(p, s, { color = ink, cls = '', anchor = 'start', dx = 0, dy = 0, rot = 0 } = {}) {
      const x = p.x + dx, y = p.y + dy; const transform = rot ? `rotate(${rot} ${p.x} ${p.y})` : undefined;
      const t = text(x, y, s, { 'text-anchor': anchor, class: cls, fill: tfill(color), transform });
      if (/\bhalo\b/.test(cls)) { // a board-colored plate behind the words so strata lines don't strike through them
        const bb = t.getBBox(); const r = document.createElementNS(NS, 'rect');
        for (const [k, v] of Object.entries({ x: bb.x - 3, y: bb.y - 1, width: bb.width + 6, height: bb.height + 2, class: `plate ${t.classList.contains('plottext') ? 'plottext' : ''}`, transform })) if (v !== undefined) r.setAttribute(k, v);
        r.style.animationDelay = t.style.animationDelay; t.before(r);
      }
      return t;
    },
    line,
    dashed(pts, color = ink, w = 1, dash = '5 4') {
      const e = el('polyline', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: color, 'stroke-width': w, 'stroke-dasharray': dash });
      if (animate) { e.style.opacity = 0; e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: nextDelay(), fill: 'forwards' }); }
      return e;
    },
    faceAngle(D) { const a = o.P(new THREE.Vector3(-1, 0, D / 2)), b = o.P(new THREE.Vector3(1, 0, D / 2)); return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; },
  };
  return o;
}

const medAge = (Lr) => { const a = Lr.roots.map((r) => r.ageDays).sort((x, y) => x - y); return a.length ? Math.round(a[Math.floor(a.length / 2)]) : 0; };
export function ageLabel(days) {
  if (days < 365) return `${Math.round(days)} d`;
  const y = Math.floor(days / 365.25); const m = Math.floor((days - y * 365.25) / 30.44);
  return `${y} y${m ? ` ${m} mo` : ''}`;
}

// SHEET 1 (and 6): the plat
export function drawPlat(o, F, report, { mobile = false, hero = true } = {}) {
  const A = F.anchors, Lr = F.L;
  const suspect = Lr.verdict === 'PLANTED' || Lr.verdict === 'MIXED';
  const spreadMin = ((Lr.bornTo - Lr.bornFrom) / 60000).toFixed(1);
  if (A.gapA && !mobile) { const ga = A.gapA.clone().setX(-Lr.W / 2), gb = A.gapB.clone().setX(-Lr.W / 2); o.dim(o.P(ga), o.P(gb), 22, `${Lr.gapPair.gap} s`, { cls: 'gap', side: -1, textOff: 20 }); }
  if (!mobile && Lr.n) o.dim(o.P(A.bottomL), o.P(A.bottomR), 18, `${Lr.n} ACCOUNT${Lr.n === 1 ? '' : 'S'} · ONE FURROW EACH · SORTED BY USER ID`, { side: 1, textOff: 11 });
  const fa = o.faceAngle(Lr.D);
  const shown = mobile ? new Set(['2011']) : new Set(['2026', '2025', '2022', '2011']);
  const strata = [];
  for (const s of A.strataL) if (shown.has(s.label)) strata.push({ t: o.label(o.P(s.p), s.label, { dy: -3, color: PAL.pencil, rot: fa, cls: 'pencil stratum' }), depth: -s.p.y });
  o.strata = strata;
  if (!Lr.n) return;
  const bm = o.P(A.bornMid);
  if (suspect) {
    if (mobile) o.label(bm, `${Lr.n}/${Lr.n} BORN WITHIN ${spreadMin} MIN`, { color: pink, cls: 'big', dy: 18, dx: -52, rot: fa });
    else {
      o.label(bm, `BORN ${new Date(Lr.bornFrom).toISOString().slice(0, 10)} ${fmtT(Lr.bornFrom)}–${fmtT(Lr.bornTo)}Z`, { color: pink, cls: 'big', dy: 20, dx: -4, rot: fa });
      const iqr = report.stargazers?.birthSpreadMinutes;
      o.label(bm, `${Lr.n} OF ${Lr.n} WITHIN ${spreadMin} MIN${iqr != null ? ` · IQR ${span(iqr).toUpperCase()}` : ''}`, { color: pink, dy: 35, dx: -4, rot: fa });
    }
  } else if (!mobile) {
    const y0 = new Date(Lr.bornFrom).getUTCFullYear(), y1 = new Date(Lr.bornTo).getUTCFullYear();
    o.label(o.P(A.bottomL), `ROOTS ${y0}–${y1} · EACH ON ITS OWN DEPTH`, { dy: -14, dx: 6, rot: fa, cls: 'big' });
  }
  if (!mobile) {
    if (suspect) o.dim(o.P(A.surfL), o.P(A.bornL), 14, ageLabel(medAge(Lr)), { side: 1, textOff: 9 });
    if (suspect) o.label(bm, 'SECTION A–A · DEPTH = AGE AT PLANTING, LOG', { dy: 62, dx: -4, rot: fa, color: PAL.pencil, cls: 'pencil' });
    if (Lr.hasLater && A.breakR) { const p = o.P(A.breakR); o.label(p, `+${Math.round(Lr.laterGapMs / 36e5 * 10) / 10} H LATER`, { dx: 8, dy: 4 }); o.label(p, `ALL ${Lr.n}, ONE MORE REPO`, { dx: 8, dy: 18, color: PAL.pencil, cls: 'pencil' }); }
    if (A.crow && hero) { const p = o.P(A.crow); o.leader(p, { x: p.x - 26, y: p.y - 18 }, ['SCALE FIGURE: STARCROP'], { anchor: 'end', dot: false }); }
    if (!hero) { /* sheet 6: the survey column covers the left of the model */ } else if (A.targetRow?.length && suspect) {
      const pts = A.targetRow.map(o.P).sort((a, b) => b.x - a.x); const q = pts[pts.length - 1];
      o.leader(q, { x: q.x - 44, y: q.y - 62 }, ['FLAGGED: THE TARGET REPO', `${report.repo.stars} STARS · ${report.repo.sizeKb} KB · ${report.repo.commits ?? '?'} COMMITS`], { color: pink, cls: 'big', anchor: 'end' });
    } else if (A.hTop) {
      const p = o.P(A.hTop); o.leader(p, { x: p.x + 40, y: p.y - 30 }, [`THE TARGET REPO · ${report.repo.stars} STARS`, `${report.stargazers?.confirmed ?? 0} STARGAZERS CONFIRMED`], { cls: 'big' });
    }
  }
}

// SHEET 2: the closed side (front elevation of the fence)
export function drawClosed(o, F, fence) {
  if (!fence) return;
  const w = F.L.W + 0.3, z = F.L.D / 2 + 0.49;
  const a = o.P(new THREE.Vector3(-w / 2, -F.L.H, z)), b = o.P(new THREE.Vector3(w / 2, -F.L.H, z));
  o.dim(a, b, 22, 'FRONT ELEVATION · THE REPO AS GITHUB SHOWS IT', { side: 1, textOff: 11 });
  const t = o.P(new THREE.Vector3(w / 2 - 0.25, F.L.H + 2.2 - F.L.H - 0.3, z));
  o.leader(t, { x: t.x + 10, y: t.y - 52 }, ['THE COUNT IS PUBLIC', 'THE LIST BEHIND IT IS NOT'], { cls: 'big', anchor: 'end' });
}

// SHEET 3: plan view, three doors in the survey boundary (all on the front edge, where the survey walks in)
export function drawOtherEnd(o, F, report, { mobile = false } = {}) {
  const L = F.L; const W = L.W, D = L.D; const m = 0.42; const y = 0.05;
  const V = (x, z) => o.P(new THREE.Vector3(x, y, z));
  const x0 = -W / 2 - m, x1 = W / 2 + m, z0 = -D / 2 - m, z1 = D / 2 + m;
  const doors = [[x0 + 0.7, x0 + 1.7], [-0.5, 0.5], [x1 - 1.7, x1 - 0.7]].map(([a, b]) => ({ a: V(a, z1), b: V(b, z1), mx: (a + b) / 2 }));
  const c = [V(x0, z0), V(x1, z0), V(x1, z1), V(x0, z1)];
  o.dashed([doors[0].a, c[3], c[0], c[1], c[2], doors[2].b]); o.dashed([doors[0].b, doors[1].a]); o.dashed([doors[1].b, doors[2].a]);
  for (const d of doors) for (const p of [d.a, d.b]) o.el('circle', { cx: p.x, cy: p.y, r: 3, fill: PAL.blueline });
  const accounts = report.stargazers?.accounts || [];
  const byVia = (v) => accounts.filter((a) => a.via === v).length;
  const vias = ['fork', 'cohort', 'sibling-owner'];
  for (const a of accounts) {
    const r = L.roots.find((q) => q.login === a.login); const k = vias.indexOf(a.via); if (!r || k < 0) continue;
    o.dashed([V(doors[k].mx, z1), V(r.x, D / 2 - 0.25)], PAL.flag, 1, '3 3');
  }
  const sib = report.siblings || {}; const nSib = Math.max(0, (sib.repos?.length || 1) - 1);
  const maxOff = Math.max(0, ...(sib.repos || []).map((r) => Math.abs(r.offsetSeconds)));
  const coh = report.cohort || {};
  const labels = mobile ? [
    [`FORKS ${report.repo.forks}`, `${byVia('fork')} FOUND`, false],
    ['COHORT', coh.computed ? `${coh.count} VS ${coh.controlCount}` : '—', coh.computed && coh.count >= 10],
    [`SIBLINGS ${nSib}`, nSib ? `IN ${maxOff} S VS ${sib.controlCount ?? 0}` : 'NONE', nSib >= 3],
  ] : [
    [`FORKS · ${report.repo.forks}`, `${byVia('fork')} OF ${accounts.length} FOUND THIS WAY`, false],
    ['OWNER COHORT ±6 MIN', coh.computed ? `${coh.count} VS ${coh.controlCount} A DAY EARLIER` : 'NOT COMPUTED', coh.computed && coh.count >= 10],
    [`SIBLINGS ±30 S · ${nSib}`, nSib ? `IN ${maxOff} S · ${sib.controlCount ?? 0} A DAY EARLIER` : 'NONE IN THE WINDOW', nSib >= 3],
  ];
  doors.forEach((d, k) => {
    const p = V(d.mx, z1); const [t1, t2, hot] = labels[k];
    o.line(p.x, p.y + 4, p.x, p.y + 18, PAL.blueline, 0.9);
    o.label({ x: p.x, y: p.y + 32 }, t1, { anchor: 'middle', cls: 'big' });
    o.label({ x: p.x, y: p.y + 46 }, t2, { anchor: 'middle', color: hot ? PAL.flag : PAL.blueline });
  });
  const tr = V(x1, z0); if (!mobile) o.label(tr, `PLAN · ONE COLUMN PER REPO ALL ${accounts.length} STARRED`, { dy: -10, anchor: 'end', cls: 'pencil', color: PAL.pencil });
}

// SHEET 4: section A-A with the id clock as geology
export function drawIdClock(o, F, report, clock, { mobile = false } = {}) {
  const L = F.L; const H = L.H; const zF = L.D / 2;
  const AGEMAX = (L.ref - T2008) / DAY;
  const depthOfDate = (t) => H * 0.94 * Math.log1p(Math.max(0, (L.ref - t) / DAY) / 30) / Math.log1p(AGEMAX / 30);
  const want = [1000000, 50000000, 100000000, 200000001];
  const bornIds = (report.stargazers?.accounts || []).map((a) => a.id).sort((a, b) => a - b);
  const picks = clock.anchors.filter((a) => want.includes(a.id) && Date.parse(a.created_at) < L.ref);
  const extra = clock.anchors.find((a) => bornIds.length && a.id === bornIds[0]);
  if (extra) picks.push(extra);
  let lastY = -1e9;
  for (const a of picks.sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))) {
    const d = depthOfDate(Date.parse(a.created_at)); if (d > H) continue;
    const p0 = o.P(new THREE.Vector3(L.W / 2 - 0.9, -d, zF)), p1 = o.P(new THREE.Vector3(L.W / 2, -d, zF));
    if (Math.abs(p0.y - lastY) < 15) continue; lastY = p0.y;
    const hit = a === extra;
    o.line(p0.x, p0.y, p1.x, p1.y, hit ? PAL.flag : PAL.blueline, hit ? 1.6 : 1.2);
    o.label(p1, `ID ${num(a.id)} · ${hit && !mobile ? a.created_at.replace('T', ' ') : a.created_at.slice(0, 10)}`, { dx: -4, dy: -4, anchor: 'end', cls: `halo ${hit ? 'big' : ''}`, color: hit ? PAL.flag : PAL.blueline });
  }
  if ((L.verdict === 'PLANTED' || L.verdict === 'MIXED') && L.n) {
    const p = o.P(new THREE.Vector3(Math.min(L.x1, 0.1), -L.bornDepth, zF));
    const txt = mobile ? `${L.n} ROOTS · ONE LINE · ${fmtT(L.bornFrom)}–${fmtT(L.bornTo)}Z` : `${L.n} ROOTS END ON ONE LINE · BORN ${new Date(L.bornFrom).toISOString().slice(0, 10)} ${fmtT(L.bornFrom)}–${fmtT(L.bornTo)}Z`;
    o.label(mobile ? o.P(new THREE.Vector3(L.W / 2, -L.bornDepth, zF)) : p, txt, { dy: 24, dx: mobile ? -4 : 0, anchor: mobile ? 'end' : 'start', color: PAL.flag, cls: 'big halo' });
  }
  if (mobile) return;
  const s = o.P(new THREE.Vector3(0.1, 0, zF));
  o.label(s, 'SURFACE = THE DAY THEY STARRED · DEPTH = AGE, LOG SCALE', { dy: -10, cls: 'pencil halo', color: PAL.pencil });
}

// SHEET 5: side elevation, one row, the real gaps between stars
export function drawRow(o, F, report, { mobile = false } = {}) {
  const L = F.L; if (!L.fieldMode || !L.gapPair) return;
  const login = L.gapPair.login;
  const cols = L.cols.filter((c) => !c.later);
  const plantings = (report.field?.plantings || []).filter((p) => p.login === login);
  const tOf = (repo) => { const p = plantings.find((q) => q.repo === repo); return p ? Date.parse(p.at) : (repo === report.repo.fullName ? Date.parse(report.stargazers.accounts.find((a) => a.login === login)?.starredAt || 0) : null); };
  const zOf = (i) => L.zFront - i * ((L.zFront - L.zBack) / Math.max(1, cols.length - 1));
  const y = 1.72; const x = 0;
  for (let i = 0; i + 1 < cols.length; i++) {
    const ta = tOf(cols[i].repo), tb = tOf(cols[i + 1].repo); if (ta == null || tb == null) continue;
    const g = Math.round((tb - ta) / 1000);
    o.dim(o.P(new THREE.Vector3(x, y, zOf(i))), o.P(new THREE.Vector3(x, y, zOf(i + 1))), 0, mobile && i ? '' : `${g} s`, { cls: 'big', side: -1, textOff: 12 });
  }
  const d0 = o.P(new THREE.Vector3(x, y, zOf(0)));
  if (mobile) { o.label({ x: d0.x, y: d0.y - 34 }, `${L.n} FURROWS · ONE ROW · MEDIAN GAP ${report.stargazers.medianGapSeconds} S`, { cls: 'big' }); return; }
  o.label({ x: d0.x, y: d0.y - 56 }, `${L.n} FURROWS, SEEN FROM THE SIDE: ONE ROW · ${login}'S GAPS SHOWN`, { cls: 'big' });
  o.label({ x: d0.x, y: d0.y - 40 }, `MEDIAN GAP ${report.stargazers.medianGapSeconds} S · ROW AGREEMENT ${pct(report.stargazers.rowAgreement)} · ORDER READS LEFT → RIGHT`, { color: PAL.pencil, cls: 'pencil' });
}

// SHEET 7: the bench-mark disc, with each stamped number called out to the measurement it comes from
export function drawBench(o, bench, lines = [], { mobile = false, rows = [], cmd = '' } = {}) {
  if (!bench) return;
  const g = bench.position; const rot = bench.rotation.y + (bench.userData.head?.rotation.y || 0);
  const onDisc = (x, z) => { const c = Math.cos(rot), s = Math.sin(rot); return o.P(new THREE.Vector3(g.x + x * c + z * s, g.y + 0.075, g.z - x * s + z * c)); };
  const rim = o.P(new THREE.Vector3(g.x - 0.56, g.y + 0.07, g.z)); const rimR = o.P(new THREE.Vector3(g.x + 0.56, g.y + 0.07, g.z));
  const top = o.P(new THREE.Vector3(g.x, g.y + 0.07, g.z - 0.56));
  if (mobile) {
    o.label({ x: (rim.x + rimR.x) / 2, y: top.y - 18 }, lines.length ? 'BENCH MARK · STAMPED WITH MEASURED NUMBERS' : 'BENCH MARK · STAMP PENDING', { anchor: 'middle', cls: 'big halo' });
    return;
  }
  const x0 = rimR.x + 56;
  o.leader(onDisc(0.3, -0.36), { x: x0 - 19, y: top.y - 24 }, ['BENCH MARK · BRASS ON CONCRETE', lines.length ? 'STAMPED WITH THE MEASURED NUMBERS' : 'STAMP PENDING: NOT MEASURED YET'], { cls: 'big', dot: false });
  lines.slice(0, 3).forEach((s, i) => {
    const p = onDisc(0.1, 0.152 + i * 0.047);
    const n = (s.match(/[\d][\d,.]*/) || [''])[0];
    const row = rows.find((r) => n && r[1].includes(n));
    const what = row ? row[0].replace(/\s*\((?!\)).*$/, '').replace(/,\s*\d+ runs$/, '') : '';
    o.leader(p, { x: x0 - 19, y: top.y + 50 + i * 42 }, [s, what.length > 36 ? `${what.slice(0, 35)}…` : what], { cls: 'big' });
  });
  if (cmd) o.label({ x: x0, y: top.y + 50 + 3 * 42 + 4 }, `CHECK IT: ${cmd.toUpperCase()} IN OSS/`, { cls: 'pencil', color: PAL.pencil });
  const sp = bench.userData.sectionPoint;
  if (sp) o.leader(o.P(sp.clone().add(g)), { x: x0 - 19, y: top.y + 50 + 4 * 42 + 22 }, ['SECTION B-B · CONCRETE MONUMENT', 'quarter cut away, stipple = concrete'], { cls: 'big' });
}
