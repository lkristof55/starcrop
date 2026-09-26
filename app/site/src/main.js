// Starcrop — boot: the drawing set. One fixed orthographic stage, seven sheets, Lenis → ScrollTrigger → camera.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import markSvg from './assets/logo.svg';
// the recorded ClashDesk report exactly as the library computes it: generated from lib/reference-report.mjs by site/tools/featured.mjs
import featuredFixture from './data/featured.json';
import gone from './data/gone.json';
import clock from './data/idclock.json';
import { buildField, buildFence, buildBenchmark, makeMaterials, setSolid } from './scene/field.js';
import { createStage, sheetsFor, lerpState, ease, starQuat } from './scene/stage.js';
import { createPullTest, createSound } from './scene/pull.js';
import { createOverlay, drawPlat, drawClosed, drawOtherEnd, drawIdClock, drawRow, drawBench } from './sections/overlays.js';
import { fillContent } from './sections/content.js';
import { createSurvey, verdictClass } from './function/survey.js';

gsap.registerPlugin(ScrollTrigger);
const root = document.documentElement; root.classList.add('js');
const mobile = innerWidth <= 768;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const utc = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z';

// ---------- sheet border zone markers ----------
function zones() {
  const z = $('zones'); if (mobile) { z.replaceChildren(); return; }
  const o = 16, iw = innerWidth - 2 * o, ih = innerHeight - 2 * o; let h = '';
  for (let i = 0; i < 8; i++) { const x = (i + 0.5) * iw / 8 - 6; h += `<span style="left:${x}px;top:1px">${i + 1}</span><span style="left:${x}px;bottom:1px">${i + 1}</span>`; }
  for (let j = 0; j < 4; j++) { const y = (j + 0.5) * ih / 4 - 6; const L = 'ABCD'[j]; h += `<span style="top:${y}px;left:1px">${L}</span><span style="top:${y}px;right:1px">${L}</span>`; }
  z.innerHTML = h;
}
zones();

// ---------- the stage ----------
const canvas = $('gl');
const stage = createStage(canvas, { mobile, width: innerWidth, height: innerHeight });
const SHEETS = sheetsFor(mobile);
const fieldOpts = (mats) => ({ azimuth: 0.24, markSvg, crowCorner: 'back-left', crowScale: 0.022, lineWidth: mobile ? 0.8 : 1.25, mats, bevel: !mobile });

let featured = featuredFixture;
let feat = null; let user = null; let fence = null; let bench = null;
// every farm name on the page gets the result of the last re-check (site/tools/gone.mjs)
const goneNote = (name) => (gone.accounts?.[name] === 404 || gone.repos?.[name] === 404 ? `removed by GitHub · 404 at ${utc(gone.checkedAt)}` : null);
const content = fillContent(featured, clock, gone);

async function makeField(report) {
  const mats = makeMaterials({ dpr: stage.dpr });
  const F = await buildField(report, fieldOpts(mats));
  F.setResolution(innerWidth * stage.dpr, innerHeight * stage.dpr);
  if (mobile) F.group.traverse((o) => { o.castShadow = false; });
  return { F, report, mats };
}
function heroTitleBlock(r) {
  $('tb-repo').textContent = r.repo.fullName;
  $('tb-score').textContent = `Verdict · ${r.score} / ${r.maxScore}`;
  const v = $('tb-verdict'); v.textContent = r.verdict; v.className = `stamp ${verdictClass(r.verdict)}`;
  $('tb-when-k').textContent = r.source === 'fixture' ? 'Surveyed · recorded' : 'Surveyed';
  $('tb-when').textContent = `${utc(r.checkedAt)} · ${r.cost.githubCore} core + ${r.cost.githubSearch} search calls`;
}

feat = await makeField(featured);
stage.scene.add(feat.F.group);
heroTitleBlock(featured);
if (mobile) $('q1').placeholder = 'owner/repo or mint';

// ---------- scroll state → scene ----------
const sections = [...document.querySelectorAll('#sheets > .sheet')];
const prog = new Array(sections.length).fill(0);
let sTarget = 0, s = 0, sDrawn = -1, needs = true, overlayKey = '';
let dyM = 0, dyDrawn = 0, svgDy = null;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const band = (x, a, b) => ease.plot(clamp01((x - a) / (b - a)));
let loadingSolid = 1;
let pull = null;
let benchSpin = 0;

function activeField() { return user && s >= 4.5 ? user : feat; }

function applyScene() {
  const i = Math.min(SHEETS.length - 2, Math.floor(s)); const f = s - i;
  const st = lerpState(SHEETS[i], SHEETS[i + 1], ease.plot(clamp01(f)));
  if (mobile) st.shiftY -= dyM / innerHeight; // the drawing rides with its own open paper
  stage.aim(st);
  const q = starQuat(st.azimuth, st.elevation);
  const A = activeField();
  // sheet 7: the field drops out of the drawing and the bench mark stands alone
  const sink = band(s, 5.2, 5.85);
  A.F.group.position.y = -sink * (A.F.L.H + 6);
  feat.F.group.visible = A === feat && sink < 0.999; if (user) user.F.group.visible = A === user && sink < 0.999;
  A.F.setStarQuat(q);
  // the scale figure belongs to the plat views; in elevation, plan and section it only reads as a blob
  if (feat.F.crow) feat.F.crow.visible = s < 0.45 || s > 4.55;
  // sheet 2: the fence rises in front of the field, then drops as sheet 3 starts
  if (fence) {
    const up = s < 1 ? band(s, 0.25, 1) : 1 - band(s, 1, 1.35);
    fence.visible = up > 0.001;
    fence.position.y = fence.userData.y0 - (1 - up) * (fence.userData.h + 0.6);
  }
  // sheet 4: above-ground goes to ghost linework; survey loading does the same to the user's field
  const ghost = s < 3 ? 1 - band(s, 2.4, 3) : band(s, 3, 3.6);
  setSolid(feat.mats, { field: ghost, block: 1 });
  if (user) setSolid(user.mats, { field: loadingSolid, block: Math.max(loadingSolid, 0.25) });
  // sheet 3 -> 4, scrubbed: the id clock runs. Each root drops from its furrow to its birth depth, left to right in
  // user-id order, the birth dot riding the tip; then the pink birth line draws across SECTION A-A. (The front face is
  // edge-on in the plan view, so the roots are withdrawn there unseen, and at rest every sheet shows the full drawing.)
  feat.F.growRoots(s <= 2.02 || s >= 3 ? 1 : clamp01((s - 2.4) / 0.58));
  // sheet 5: the sun swings across so the visible face is lit
  const sx = s < 4 ? band(s, 3.3, 4) : 1 - band(s, 4, 4.7);
  stage.sun.position.x = -6 + 12 * sx;
  if (bench) { bench.visible = s > 5.4; bench.userData.head.rotation.y = benchSpin * (12 * Math.PI / 180); }
}

// ---------- overlay ----------
const overlay = createOverlay($('dims'));
const drawn = new Set();
function drawOverlay() {
  const near = Math.round(s); const settled = Math.abs(s - near) < 0.015;
  const key = settled ? `${near}:${activeField() === user ? 'u' : 'f'}:${innerWidth}x${innerHeight}` : '';
  if (key === overlayKey) return;
  overlayKey = key;
  const svg = $('dims');
  if (!settled) { svg.style.opacity = '0'; svg.replaceChildren(); pull?.reset(); return; }
  const first = !drawn.has(key) && !reduced; drawn.add(key);
  overlay.begin(stage.cam, innerWidth, innerHeight, { anim: first && near !== 0 });
  const A = activeField();
  if (near === 0) drawPlat(overlay, feat.F, featured, { mobile, hero: true });
  else if (near === 1) { if (!mobile) drawClosed(overlay, feat.F, fence); }
  else if (near === 2) drawOtherEnd(overlay, feat.F, featured, { mobile });
  else if (near === 3) drawIdClock(overlay, feat.F, featured, clock, { mobile });
  else if (near === 4) drawRow(overlay, feat.F, featured, { mobile });
  else if (near === 5) drawPlat(overlay, A.F, A.report, { mobile, hero: false });
  else if (near === 6) drawBench(overlay, bench, content.benchLines, { mobile, rows: content.benchRows, cmd: content.benchCmd });
  svg.style.opacity = '1';
  svgDy = dyM; svg.style.transform = '';
  pull?.attach();
}

function render() {
  applyScene();
  stage.render();
  drawOverlay();
  if (mobile && svgDy != null) $('dims').style.transform = `translateY(${(dyM - svgDy).toFixed(1)}px)`;
  pull?.redraw();
  needs = false; sDrawn = s;
}
const requestRender = () => { needs = true; };

// first frame: final, no loader
await document.fonts.ready;
render();

// the fence and the bench mark carry canvas type, so they're built after the fonts
fence = buildFence(featured, feat.F.L, { mats: feat.mats });
fence.userData.y0 = fence.position.y; fence.userData.h = feat.F.L.H + 2.2; fence.visible = false;
stage.scene.add(fence);
bench = buildBenchmark(content.benchLines, { at: [-feat.F.L.W / 2 - 1.1, 0, feat.F.L.D / 2 - 0.7], postHeight: 0.92, cutAz: SHEETS[6].azimuth, lineWidth: mobile ? 0.8 : 1.25, resolution: [innerWidth * stage.dpr, innerHeight * stage.dpr] });
bench.visible = false; stage.scene.add(bench);
SHEETS[6].target = [bench.position.x, -0.25, bench.position.z];
render();
requestAnimationFrame(() => { window.__ready = true; });

// ---------- pull test (signature move) ----------
const sound = createSound();
$('sound').addEventListener('click', (e) => { const on = sound.toggle(); e.currentTarget.textContent = `SOUND: ${on ? 'ON' : 'OFF'}`; e.currentTarget.setAttribute('aria-pressed', on); });
pull = createPullTest({
  canvas, stage, tagEl: $('tag'), keysEl: $('furrows'), requestRender, mobile, reduced, sound,
  isActive: () => { const n = Math.round(s); return Math.abs(s - n) < 0.02 && (n === 0 || n === 5); },
  getField: () => activeField(),
  goneNote,
  onStrata: (depth, on) => { for (const t of overlay.strata || []) t.t.classList.toggle('lit', on && t.depth <= depth + 1e-3); },
});
pull.attach();

// ---------- scroll ----------
let lenis = null;
if (!reduced) {
  lenis = new Lenis({ lerp: 0.12, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
if (!mobile) sections.forEach((sec, i) => {
  if (i === 0) return;
  ScrollTrigger.create({
    trigger: sec, start: 'top bottom', end: 'top top',
    onUpdate: (self) => { prog[i] = self.progress; },
    onRefresh: (self) => { prog[i] = self.progress; },
  });
});
// mobile: every sheet owns a band of open paper (hero: between the thesis and the title block; pinned sheets: the
// screen under their text; survey and bench: the band above their text). The sheet whose band shows most is the one
// drawn, and the drawing rides inside that band, so it never sits under text or leaves a band empty.
const bandsM = mobile ? sections.map((sec, i) => {
  if (i === 0) { const th = sec.querySelector('.thesis'); const tb = $('tb'); return () => [th.getBoundingClientRect().bottom, tb.getBoundingClientRect().top]; }
  if (sec.classList.contains('pinned')) { const col = sec.querySelector('.col'); const pin = sec.querySelector('.pin'); return () => [col.getBoundingClientRect().bottom, pin.getBoundingClientRect().bottom]; }
  if (sec.id === 'survey') { const b = $('survey-band'); return () => { const r = b.getBoundingClientRect(); return [r.top, r.bottom]; }; }
  return () => { const t = sec.getBoundingClientRect().top; return [t, t + parseFloat(getComputedStyle(sec, '::before').height)]; };
}) : null;
// band heights are a share of the GL height (the orthographic drawing scales with innerHeight, not with CSS vh)
const setGh = () => root.style.setProperty('--gh', `${innerHeight}px`);
if (mobile) setGh();
// the drawing's visual centre vs its camera target, per mobile sheet (share of the height; + moves the drawing down)
const BIAS_M = [0, 0, 0, 0.041, 0, 0, -0.02];
function mobileBands() {
  const top = $('nav').getBoundingClientRect().bottom, vh = innerHeight;
  const cl = (y) => Math.max(top, Math.min(vh, y));
  let best = -1, bestPx = 8;
  const dys = bandsM.map((get, i) => {
    const [a, z] = get(); const px = cl(z) - cl(a);
    if (px > bestPx) { bestPx = px; best = i; }
    // every drawing is printed on its own band and scrolls with it (bands are the drawing plus a module of air, so
    // a sliver of band under the nav shows paper, never a slice of stalks)
    return i === 0 ? -scrollY : (a + z) / 2 - vh * (0.5 - SHEETS[i].shiftY) + BIAS_M[i] * vh;
  });
  if (best >= 0) sTarget = best;
  return dys;
}
// pinned sheets taller than the viewport stick by their bottom edge instead of being cut off
function fitPins() {
  if (mobile || reduced) return;
  document.querySelectorAll('.pinned').forEach((sec) => {
    const pin = sec.querySelector('.pin'); const col = pin.querySelector('.col');
    pin.style.height = ''; pin.style.top = ''; sec.style.height = '';
    const h = col.offsetTop + col.offsetHeight + 36;
    if (h > innerHeight) { pin.style.height = `${h}px`; pin.style.top = `${innerHeight - h}px`; sec.style.height = `${h + innerHeight}px`; }
  });
}
fitPins();
// headlines: a 1.5 px rule draws under the words (the words are already there)
document.querySelectorAll('h2.rule').forEach((h) => ScrollTrigger.create({ trigger: h, start: 'top 85%', once: true, onEnter: () => h.classList.add('drawn') }));
ScrollTrigger.create({ trigger: '#schedule-5', start: 'top 80%', once: true, onEnter: () => $('schedule-5').classList.add('in') });
ScrollTrigger.create({ trigger: '#bench', start: 'top bottom', end: 'bottom bottom', onUpdate: (self) => { benchSpin = self.progress; needs = true; } });

let last = performance.now();
gsap.ticker.add(() => {
  const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
  let dys = null;
  if (mobile) dys = mobileBands(); else sTarget = prog.reduce((a, b) => a + b, 0);
  if (reduced) s = Math.round(sTarget);
  else s += (sTarget - s) * (1 - Math.exp(-dt / (mobile ? 0.22 : 0.16)));
  if (Math.abs(s - sTarget) < 1e-4) s = sTarget;
  if (dys) { const i = Math.min(dys.length - 2, Math.floor(s)); const f = clamp01(s - i); dyM = dys[i] + (dys[i + 1] - dys[i]) * ease.plot(f); }
  if (document.hidden) return;
  if (needs || Math.abs(s - sDrawn) > 1e-5 || Math.abs(dyM - dyDrawn) > 0.3) { render(); dyDrawn = dyM; }
});

// nav links through Lenis
document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const t = document.querySelector(a.getAttribute('href')); if (!t) return;
  e.preventDefault(); $('sheetlist').hidden = true; $('menu').setAttribute('aria-expanded', 'false');
  if (lenis) lenis.scrollTo(t, { duration: 1.6 }); else t.scrollIntoView();
}));
$('menu').addEventListener('click', () => { const l = $('sheetlist'); l.hidden = !l.hidden; $('menu').setAttribute('aria-expanded', String(!l.hidden)); });

// ---------- resize ----------
let rT;
addEventListener('resize', () => {
  clearTimeout(rT);
  rT = setTimeout(() => {
    if (mobile) setGh();
    stage.resize(innerWidth, innerHeight);
    for (const x of [feat, user]) x?.F.setResolution(innerWidth * stage.dpr, innerHeight * stage.dpr);
    bench?.userData.setResolution(innerWidth * stage.dpr, innerHeight * stage.dpr);
    zones(); fitPins(); overlayKey = ''; drawn.clear(); needs = true; ScrollTrigger.refresh();
  }, 120);
});

// ---------- the function: crop report ----------
async function showUserReport(r) {
  const next = await makeField(r);
  if (user) { stage.scene.remove(user.F.group); user.F.dispose(); }
  user = next; stage.scene.add(user.F.group);
  // linework first, then the hatch-fill dissolve; stalks grow in planting order
  loadingSolid = 0; user.F.growth.value = 0; user.F.pose();
  const o = { k: 0 };
  if (reduced) { loadingSolid = 1; user.F.growth.value = 1; user.F.pose(); }
  else {
    gsap.to(o, { k: 1, duration: 0.6, ease: 'power2.out', onUpdate: () => { loadingSolid = o.k; needs = true; } });
    gsap.to(user.F.growth, { value: 1, duration: Math.max(0.5, user.F.L.stalks.length * 0.006 + 0.3), ease: 'power1.out', delay: 0.1, onUpdate: () => { user.F.pose(); needs = true; } });
  }
  overlayKey = ''; pull.attach(); needs = true;
}
const survey = createSurvey({
  goneNote,
  onReport: (r) => { showUserReport(r); },
  onLoading: (on) => {
    if (!user) return; // the featured field stays solid; a user field goes to linework while we walk
    gsap.to({ v: loadingSolid }, { v: on ? 0 : 1, duration: 0.24, onUpdate() { loadingSolid = this.targets()[0].v; needs = true; } });
  },
  onScrollTo: () => {
    // mobile: the drawing band lands right under the nav, not under it
    const t = mobile ? $('survey-band') : $('survey'); const off = mobile ? -$('nav').getBoundingClientRect().bottom : 0;
    if (lenis) lenis.scrollTo(t, { duration: 1.8, offset: off }); else scrollTo(0, t.getBoundingClientRect().top + scrollY + off);
  },
});
survey.render(featured);

// /api/fields: sheets 1-5 explain the recorded ClashDesk survey (their copy is about it). If the store has a newer
// PLANTED field, it opens sheet 6 as the first report on the survey sheet.
(async () => {
  try {
    const res = await fetch('/api/fields', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    survey.renderFields(body.fields || []);
    const f = body.featured;
    if (f?.repo && f.source !== 'fixture' && (f.repo.fullName !== featured.repo.fullName || f.checkedAt !== featured.checkedAt)) {
      survey.render(f); await showUserReport(f);
    }
  } catch { /* the recorded report stays on the survey sheet */ }
  survey.refreshLedger();
})();

// pause when hidden
document.addEventListener('visibilitychange', () => { if (!document.hidden) needs = true; });
void THREE;
