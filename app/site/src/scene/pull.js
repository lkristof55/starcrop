// Signature move: the pull test. Grab a star-stalk and pull. A furrow is one account, so the whole furrow lifts with
// its one root. Resistance comes only from the measured root depth (account age at planting):
//   lift = drag · exp(-6 · (depth / H)²)      breaks free at lift >= 0.35 scene units
// A 63-day root comes up clean at ~25 px of drag; a 2011 root never does within 200 px.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { PAL } from './field.js';
import { ageLabel } from '../sections/overlays.js';

const BREAK = 0.35; const MAXPX = 200;
const NS = 'http://www.w3.org/2000/svg';
const iso = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
const num = (n) => Number(n).toLocaleString('en-US');

export function createPullTest({ canvas, stage, tagEl, keysEl, requestRender, isActive, getField, mobile = false, reduced = false, sound, onStrata, goneNote = () => null }) {
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  const hl = document.createElementNS(NS, 'svg'); hl.setAttribute('aria-hidden', 'true');
  Object.assign(hl.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 2, overflow: 'visible' });
  document.body.appendChild(hl);
  let F = null; let report = null; let hit = null;
  const st = { k: null, lift: 0, pop: 0, drag: 0, broken: false, held: false, dragging: false, y0: 0, x0: 0, t0: 0, hover: null, focus: null, auto: null };

  function attach() {
    const cur = getField(); if (!cur || cur.F === F) return;
    release(true);
    F = cur.F; report = cur.report;
    if (hit) { hit.parent?.remove(hit); hit.geometry.dispose(); }
    const S = F.L.stalks; const g = new THREE.CylinderGeometry(0.12, 0.12, 1, 6); g.translate(0, 0.5, 0);
    hit = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ visible: false }), S.length);
    const M = new THREE.Matrix4();
    S.forEach((s, i) => { M.compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion(), new THREE.Vector3(1, s.h + 0.3, 1)); hit.setMatrixAt(i, M); });
    hit.computeBoundingSphere(); F.group.add(hit);
    // keyboard: one button per furrow, in id order
    keysEl.replaceChildren();
    F.L.roots.forEach((r, k) => {
      const b = document.createElement('button'); b.type = 'button';
      b.setAttribute('aria-label', `Pull test, furrow ${k + 1} of ${F.L.roots.length}: account ${r.login}. Enter pulls, Escape releases.`);
      b.addEventListener('focus', () => { if (!isActive()) return; st.focus = k; drawHL(); });
      b.addEventListener('blur', () => { if (st.focus === k) { st.focus = null; drawHL(); release(); } });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); autoPull(k); }
        if (e.key === 'Escape') { e.preventDefault(); release(); }
      });
      keysEl.appendChild(b);
    });
  }

  const unitsPerPx = () => (stage.cam.top - stage.cam.bottom) / stage.size.h;
  const resist = (k) => Math.exp(-6 * (F.L.roots[k].depth / F.L.H) ** 2);

  function pick(e) {
    if (!F || !hit || !isActive()) return null;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, stage.cam);
    const hits = ray.intersectObject(hit, false);
    if (!hits.length) return null;
    return F.L.stalks[hits[0].instanceId].furrow;
  }

  function ridgePoly(k) {
    const r = F.L.roots[k]; const D = F.L.D; const y = 0.045 + (st.k === k ? st.lift + st.pop : 0);
    const pts = [[r.x - 0.1, -D / 2 + 0.25], [r.x + 0.1, -D / 2 + 0.25], [r.x + 0.1, D / 2 - 0.25], [r.x - 0.1, D / 2 - 0.25]]
      .map(([x, z]) => new THREE.Vector3(x, y, z).project(stage.cam)).map((p) => `${(p.x * 0.5 + 0.5) * innerWidth},${(-p.y * 0.5 + 0.5) * innerHeight}`);
    return pts.join(' ');
  }
  function drawHL() {
    hl.replaceChildren();
    if (!F || !isActive()) return;
    for (const [k, focus] of [[st.focus, true], [st.hover, false]]) {
      if (k == null) continue;
      const pts = ridgePoly(k);
      if (focus) { const h = document.createElementNS(NS, 'polygon'); h.setAttribute('points', pts); h.setAttribute('fill', 'none'); h.setAttribute('stroke', PAL.nonphoto); h.setAttribute('stroke-width', '8'); h.setAttribute('stroke-linejoin', 'round'); hl.appendChild(h); }
      const p = document.createElementNS(NS, 'polygon'); p.setAttribute('points', pts); p.setAttribute('fill', 'none'); p.setAttribute('stroke', PAL.blueline); p.setAttribute('stroke-width', '2'); hl.appendChild(p);
    }
  }

  function tagAt(k) {
    const S = F.L.stalks.filter((s) => s.furrow === k); const t = S.find((s) => s.target) || S[0]; if (!t) return { x: 0, y: 0 };
    const y = 0.04 + t.h * 0.62 + (st.k === k ? st.lift + st.pop : 0);
    const p = new THREE.Vector3(t.x, y, t.z).project(stage.cam);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
  }
  function account(k) { const r = F.L.roots[k]; return { r, a: (report.stargazers?.accounts || []).find((x) => x.login === r.login) || {} }; }
  function showTag(k, kind) {
    const { r, a } = account(k);
    const born = a.bornAt ? iso(a.bornAt) : iso(r.born);
    const clock = a.bornExact === false ? ' (ID CLOCK)' : '';
    let html;
    if (kind === 'hover') html = `<span class="l1">${esc(r.login)}</span>`;
    else if (kind === 'clean') {
      // only what was fetched: a profile the survey didn't read prints no numbers
      const prof = [a.followers != null ? `${a.followers} FOLLOWERS` : null, a.publicRepos != null ? `${a.publicRepos} REPOS` : null].filter(Boolean).join(' · ') || 'PROFILE NOT FETCHED';
      const g = goneNote(r.login);
      html = `<b class="l1">${esc(r.login)}</b><br>BORN ${born}${clock} · ID ${num(r.id)}<br>${prof}<br>PLANTED ${iso(r.starredAt)}<br>ROOT ${ageLabel(r.ageDays)} · CAME UP CLEAN${g ? `<br><span class="g">${esc(g.toUpperCase())}</span>` : ''}`;
    }
    else html = `<b class="l1">${esc(r.login)}</b><br>BORN ${born.slice(0, 10)}${clock}${a.followers != null ? ` · ${a.followers} FOLLOWERS` : ''}<br>ROOT ${ageLabel(r.ageDays)} · HELD`;
    tagEl.innerHTML = html;
    tagEl.className = `tag ${kind === 'clean' ? '' : 'grown'}`;
    tagEl.hidden = false;
    placeTag(k);
    requestAnimationFrame(() => tagEl.classList.add('show'));
    tagEl.dataset.k = k;
  }
  function placeTag(k) {
    if (mobile && tagEl.dataset.kind !== 'hover') return;
    const p = tagAt(k); tagEl.style.left = `${Math.round(p.x + 10)}px`; tagEl.style.top = `${Math.round(p.y - 12)}px`;
  }
  function hideTag(delay = 0) {
    clearTimeout(hideTag.t);
    hideTag.t = setTimeout(() => { tagEl.classList.remove('show'); setTimeout(() => { if (!tagEl.classList.contains('show')) tagEl.hidden = true; }, 260); }, delay);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function apply() {
    if (!F) return;
    const y = st.lift + st.pop;
    F.setLift(st.k, y);
    F.poseRoot(st.k, y, { clean: st.broken, color: st.tension ? PAL.flag : PAL.blueline });
    if (st.k != null) { placeTag(st.k); onStrata?.(F.L.roots[st.k].depth, y > 0.005); } else onStrata?.(0, false);
    drawHL(); requestRender();
  }

  function setDrag(k, px) {
    st.k = k; st.drag = Math.min(MAXPX, Math.max(0, px));
    st.lift = st.drag * unitsPerPx() * resist(k);
    if (!st.broken && st.lift >= BREAK) {
      st.broken = true; tagEl.dataset.kind = 'clean'; showTag(k, 'clean'); sound?.pop();
      if (reduced) st.pop = BREAK; else gsap.to(st, { pop: BREAK, duration: 0.32, ease: 'power3.out', onUpdate: apply });
    } else if (!st.broken && !st.held && st.drag >= 120) {
      st.held = true; tagEl.dataset.kind = 'held'; showTag(k, 'held'); sound?.creak();
      st.tension = true; setTimeout(() => { st.tension = false; apply(); }, reduced ? 0 : 420);
    }
    apply();
  }

  function release(now = false) {
    if (st.auto) { st.auto.kill(); st.auto = null; }
    if (st.k == null) return;
    const done = () => { st.k = null; st.broken = false; st.held = false; st.pop = 0; st.lift = 0; st.drag = 0; F && F.setLift(null, 0); F && F.poseRoot(null, 0); onStrata?.(0, false); drawHL(); requestRender(); };
    hideTag(200);
    if (now || reduced) { done(); return; }
    const k = st.k;
    gsap.to(st, { lift: 0, pop: 0, duration: 0.7, ease: 'elastic.out(1, 0.35)', onUpdate: () => { st.k = k; apply(); }, onComplete: done });
  }

  function autoPull(k) {
    release(true); st.k = k; st.broken = false; st.held = false; st.pop = 0;
    if (reduced) { setDrag(k, MAXPX); return; }
    const o = { px: 0 };
    st.auto = gsap.to(o, { px: MAXPX, duration: 0.6, ease: 'power2.out', onUpdate: () => setDrag(k, o.px) });
  }

  // pointer
  let hoverT;
  canvas.addEventListener('pointermove', (e) => {
    if (st.dragging) { setDrag(st.k, st.y0 - e.clientY); return; }
    if (e.pointerType !== 'mouse') return;
    attach();
    const k = pick(e);
    if (k !== st.hover) {
      st.hover = k; drawHL(); clearTimeout(hoverT);
      document.body.classList.toggle('grab', k != null);
      if (k != null && st.k == null) hoverT = setTimeout(() => { tagEl.dataset.kind = 'hover'; showTag(k, 'hover'); }, 120);
      else if (st.k == null) hideTag(0);
    }
  });
  canvas.addEventListener('pointerdown', (e) => {
    attach();
    const k = pick(e);
    if (e.pointerType !== 'mouse') {
      st.t0 = performance.now(); st.x0 = e.clientX; st.y0 = e.clientY; st.touchK = k;
      return;
    }
    if (k == null) return;
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    release(true); st.dragging = true; st.y0 = e.clientY; st.k = k; st.broken = false; st.held = false; st.pop = 0;
    document.body.classList.add('grabbing'); clearTimeout(hoverT);
  });
  const up = (e) => {
    if (e.pointerType !== 'mouse') {
      const quick = performance.now() - st.t0 < 350 && Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < 10;
      if (quick) { if (st.touchK != null) autoPull(st.touchK); else release(); }
      return;
    }
    if (!st.dragging) return;
    st.dragging = false; document.body.classList.remove('grabbing');
    release();
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (!st.dragging && st.hover != null) { st.hover = null; drawHL(); document.body.classList.remove('grab'); if (st.k == null) hideTag(0); } });

  return {
    attach,
    reset() { release(true); st.hover = null; st.focus = null; hl.replaceChildren(); },
    redraw() { drawHL(); if (st.k != null) placeTag(st.k); },
    get busy() { return st.k != null; },
  };
}

// WebAudio only for the pull test: planted pops, grown creaks. Off by default.
export function createSound() {
  let ctx = null; let on = false;
  const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  return {
    get on() { return on; },
    toggle() { on = !on; if (on) ac().resume(); return on; },
    pop() {
      if (!on) return; const c = ac(); const n = c.createBufferSource(); const b = c.createBuffer(1, c.sampleRate * 0.04, c.sampleRate);
      const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.9; const g = c.createGain(); g.gain.value = 0.6;
      n.buffer = b; n.connect(f).connect(g).connect(c.destination); n.start();
    },
    creak() {
      if (!on) return; const c = ac(); const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, c.currentTime);
      o.frequency.linearRampToValueAtTime(78, c.currentTime + 0.08); o.frequency.linearRampToValueAtTime(66, c.currentTime + 0.22);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 6; const g = c.createGain();
      g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.22);
      o.connect(f).connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.24);
    },
  };
}
