// Starcrop field — the 3D object IS the crop report.
// Built procedurally from a CropReport (see concept.json types.CropReport).
//
//   X  (left -> right) : one furrow per confirmed stargazer, sorted by GitHub user id (= birth order)
//   Z  (front -> back) : FIELD MODE (report.field.plantings present): one column per field repo, ordered by
//                        its median planting rank, so the account x repo matrix becomes a planted orchard.
//                        A full rectangle = every account starred every field repo; straight columns = same order.
//                        Columns whose median planting is > 30 min after the row's first go behind a break line.
//                        THIN / GROWN MODE: target stars only, Z = time since the first confirmed star.
//   +Y (above ground)  : stalk height = the starred repo's star count (0.3 + 1.0 * min(1, stars/250)).
//   -Y (below ground)  : root depth = account age at planting, log scale: H*0.94*ln(1+age/30d)/ln(1+AGEMAX/30d).
//                        Strata are calendar boundaries on the same scale, so GitHub's id clock reads as geology.
//   Front face (z=+D/2): SECTION A-A. Each furrow's root is drawn on it; the birth dots line up when the
//                        accounts were born together (birthSpread). Suspect band is hatched in flag pink.
//
// The site-builder can import this file as-is (it only needs `three` + `three/addons`).
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

export const PAL = {
  diazo: '#ECEEEA', board: '#F6F7F3', stratum: '#DDE1DB', blueline: '#1C3A8C',
  nonphoto: '#9FD3E6', flag: '#F2367E', pencil: '#5B6270',
};
const DAY = 864e5;
const T2008 = Date.UTC(2008, 0, 1);

export const DIM = { SP: 0.5, D: 8.2, H: 2.2 };

// ---------- layout (pure data -> numbers; no three.js) ----------
export function layoutReport(report) {
  const { SP, D, H } = DIM;
  const accounts = [...(report.stargazers?.accounts || [])].sort((a, b) => a.id - b.id);
  const n = accounts.length;
  const W = Math.max(n, 6) * SP + 1.1;
  const target = report.repo.fullName;
  const starsOf = new Map((report.siblings?.repos || []).map((r) => [r.fullName, r.stars]));
  starsOf.set(target, report.repo.stars);

  const rows = accounts.map((a) => {
    const list = (report.field?.plantings || []).filter((p) => p.login === a.login).map((p) => ({ repo: p.repo, t: Date.parse(p.at) }));
    // (target-only plantings are fine: they are the same edges as accounts[].starredAt)
    if (a.starredAt && !list.some((p) => p.repo === target)) list.push({ repo: target, t: Date.parse(a.starredAt) });
    list.sort((x, y) => x.t - y.t);
    list.forEach((p, k) => { p.rank = k; p.s = (p.t - list[0].t) / 1000; });
    return { a, list };
  });
  // field mode only when the stargazers also starred OTHER repos (a GROWN report can carry target-only plantings)
  const fieldMode = (report.field?.plantings || []).some((p) => p.repo !== target);
  const allTargetT = rows.flatMap((r) => r.list.filter((p) => p.repo === target).map((p) => p.t));
  const tMin = allTargetT.length ? Math.min(...allTargetT) : Date.parse(report.checkedAt);
  const zFront = D / 2 - 0.7;
  const heightOf = (repo) => 0.3 + 1.0 * Math.min(1, (starsOf.get(repo) ?? report.repo.stars) / 250);

  // FIELD MODE: the account x repo matrix. Z = one column per repo, ordered by its median planting rank.
  // A full rectangle = every account starred every field repo; straight columns = identical order.
  // GROWN / thin mode: target stars only, Z = time since the first confirmed star (hours).
  let cols = []; let hasLater = false; let zBack = -D / 2 + 0.7; let laterGapMs = 0; let colZ = new Map();
  const zLater = -D / 2 + 0.6; const zBreak = -D / 2 + 1.25;
  if (fieldMode) {
    const stat = new Map();
    for (const r of rows) for (const p of r.list) {
      const s = stat.get(p.repo) || { repo: p.repo, ranks: [], secs: [] }; s.ranks.push(p.rank); s.secs.push(p.s); stat.set(p.repo, s);
    }
    const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    cols = [...stat.values()].map((s) => ({ repo: s.repo, rank: med(s.ranks), sec: med(s.secs), count: s.ranks.length }))
      .sort((a, b) => a.rank - b.rank || a.repo.localeCompare(b.repo));
    for (const c of cols) { c.later = c.sec > 1800; if (c.later) { hasLater = true; laterGapMs = Math.max(laterGapMs, c.sec * 1000); } }
    const main = cols.filter((c) => !c.later);
    zBack = -D / 2 + (hasLater ? 1.95 : 0.7);
    const step = main.length > 1 ? (zFront - zBack) / (main.length - 1) : 0;
    main.forEach((c, i) => colZ.set(c.repo, zFront - i * step));
    cols.filter((c) => c.later).forEach((c, i) => colZ.set(c.repo, zLater - i * 0.3));
  }
  const tSpan = Math.max(1, ...allTargetT.map((t) => t - tMin));
  const zOf = (p) => (fieldMode ? colZ.get(p.repo) : zFront - ((p.t - tMin) / tSpan) * (zFront - zBack));

  const ref = allTargetT.length ? allTargetT.slice().sort((a, b) => a - b)[Math.floor(allTargetT.length / 2)] : Date.parse(report.checkedAt);
  const AGEMAX = (ref - T2008) / DAY;
  const depthOfAge = (ageDays) => H * 0.94 * Math.log1p(Math.max(0, ageDays) / 30) / Math.log1p(AGEMAX / 30);

  const stalks = []; const roots = [];
  rows.forEach((r, i) => {
    const x = -((n - 1) / 2) * SP + i * SP;
    for (const p of r.list) {
      if (fieldMode && !colZ.has(p.repo)) continue;
      stalks.push({ x, z: zOf(p), h: heightOf(p.repo), target: p.repo === target, later: fieldMode && cols.find((c) => c.repo === p.repo)?.later, login: r.a.login, repo: p.repo, t: p.t, s: p.s, rank: p.rank });
    }
    const tt = r.list.find((p) => p.repo === target)?.t ?? ref;
    const born = Date.parse(r.a.bornAt);
    const ageDays = (tt - born) / DAY;
    roots.push({ x, login: r.a.login, id: r.a.id, born, ageDays, depth: depthOfAge(ageDays), followers: r.a.followers, via: r.a.via, starredAt: tt });
  });

  // strata boundaries (calendar), on the same log scale
  const bounds = [];
  const refD = new Date(ref);
  const cands = [];
  for (let m = 1; m <= 3; m++) cands.push(Date.UTC(refD.getUTCFullYear(), refD.getUTCMonth() - m + 1, 1));
  for (const y of [2026, 2025, 2024, 2022, 2020, 2017, 2014, 2011, 2008]) cands.push(Date.UTC(y, 0, 1));
  for (const b of cands) if (b < ref) bounds.push({ t: b, depth: depthOfAge((ref - b) / DAY), label: labelFor(b) });
  bounds.sort((a, b) => a.depth - b.depth);
  const uniq = []; for (const b of bounds) if (!uniq.length || b.depth - uniq[uniq.length - 1].depth > 0.06) uniq.push(b);

  const depths = roots.map((r) => r.depth).sort((a, b) => a - b);
  const bornDepth = depths.length ? depths[Math.floor(depths.length / 2)] : 0;
  const borns = roots.map((r) => r.born).sort((a, b) => a - b);

  // the median-gap pair between two adjacent columns in one furrow (the "4 s" dimension)
  let gapPair = null;
  const medGap = report.stargazers?.medianGapSeconds;
  if (fieldMode) {
    const main = cols.filter((c) => !c.later);
    outer: for (let k = 0; k + 1 < main.length; k++) for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; const a = r.list.find((p) => p.repo === main[k].repo); const b = r.list.find((p) => p.repo === main[k + 1].repo);
      if (!a || !b) continue; const g = Math.round((b.t - a.t) / 1000);
      if (medGap == null || g === medGap) { gapPair = { login: r.a.login, rowIndex: i, gap: g, za: colZ.get(a.repo), zb: colZ.get(b.repo) }; break outer; }
    }
  }

  return {
    n, W, D, H, SP, target, fieldMode, cols, hasLater, laterGapMs, zFront, zBack, zLater, zBreak,
    stalks, roots, strata: uniq, bornDepth, bornFrom: borns[0], bornTo: borns[borns.length - 1], ref, gapPair,
    verdict: report.verdict, x0: -((n - 1) / 2) * SP, x1: ((n - 1) / 2) * SP,
  };
}
function labelFor(t) {
  const d = new Date(t);
  return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : d.toISOString().slice(0, 7);
}

// ---------- geometry ----------
function starShape(R = 1, r = 0.486) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5; const rad = i % 2 ? r : R;
    const x = rad * Math.sin(a); const y = rad * Math.cos(a);
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  s.closePath();
  return s;
}
function ribbonGeometry() {
  // flagging tape: a band around the stalk + two tails (same drawing as the mark's #flag)
  const band = new THREE.BoxGeometry(0.06, 0.05, 0.06);
  const tail = (y0, y1, len, drop) => {
    const s = new THREE.Shape();
    s.moveTo(0, y0); s.lineTo(len, y0 + 0.02 - drop); s.lineTo(len * 0.8, (y0 + y1) / 2 - drop); s.lineTo(len * 0.95, y1 - 0.01 - drop * 1.6); s.lineTo(0, y1);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false }); g.translate(0.02, 0, -0.004); return g;
  };
  return mergeGeoms([band, tail(0.0, 0.028, 0.2, -0.01), tail(-0.025, 0.0, 0.17, 0.035)]);
}
function mergeGeoms(list) {
  // tiny non-indexed merge (position + normal) so we don't need BufferGeometryUtils
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0; parts.forEach((g) => (count += g.attributes.position.count));
  const pos = new Float32Array(count * 3); const nor = new Float32Array(count * 3);
  let o = 0; for (const g of parts) { g.computeVertexNormals(); pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
function hatchTexture(color, bg = 'rgba(0,0,0,0)', step = 14, width = 2.2) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = color; g.lineWidth = width;
  for (let i = -128; i < 256; i += step) { g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 128, 0); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Hatch-fill dissolve (direction §8): faces fill in along 45° hatch lines that thicken until solid.
// uSolid 0 = only the LineSegments2 edges remain (ink turns to non-photo ghost), 1 = solid.
export function hatchDissolve(material, uniforms, ghost = false) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uSolid = uniforms.solid; sh.uniforms.uHatch = uniforms.hatch;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uSolid;\nuniform float uHatch;\nvoid main() {')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float hs = fract((gl_FragCoord.x + gl_FragCoord.y) / uHatch);
        if (hs > uSolid) { ${ghost ? 'gl_FragColor = vec4(0.624, 0.827, 0.902, 1.0);' : 'discard;'} }`);
  };
  material.customProgramCacheKey = () => 'hatch' + (ghost ? 'g' : 'd');
  return material;
}

export function makeMaterials({ dpr = 1 } = {}) {
  const hatch = { value: 12 * dpr };
  const solid = { block: { solid: { value: 1 }, hatch }, field: { solid: { value: 1 }, hatch } };
  const m = {
    board: new THREE.MeshStandardMaterial({ color: PAL.board, roughness: 0.92, metalness: 0 }),
    stratum: new THREE.MeshStandardMaterial({ color: PAL.stratum, roughness: 0.95, metalness: 0 }),
    ridge: new THREE.MeshStandardMaterial({ color: PAL.board, roughness: 0.92, metalness: 0 }),
    ink: new THREE.MeshStandardMaterial({ color: PAL.blueline, roughness: 0.5, metalness: 0.08 }),
    flag: new THREE.MeshStandardMaterial({ color: PAL.flag, roughness: 0.62, emissive: PAL.flag, emissiveIntensity: 0.18 }),
    ghost: new THREE.MeshBasicMaterial({ color: PAL.nonphoto, transparent: true, opacity: 0.0 }),
    solid,
  };
  hatchDissolve(m.board, solid.block); hatchDissolve(m.stratum, solid.block);
  hatchDissolve(m.ridge, solid.field); hatchDissolve(m.ink, solid.field, true); hatchDissolve(m.flag, solid.field, true);
  return m;
}
// uSolid for the block (strata boards) and the field above ground (ridges, stalks, stars, flags, scarecrow)
export function setSolid(mats, { block, field } = {}) {
  if (block != null) mats.solid.block.solid.value = block;
  if (field != null) mats.solid.field.solid.value = field;
}

function fatLines(positions, color, width, opts = {}) {
  const g = new LineSegmentsGeometry(); g.setPositions(positions);
  const m = new LineMaterial({ color, linewidth: width, dashed: !!opts.dashed, dashSize: opts.dash ?? 0.08, gapSize: opts.gap ?? 0.06, depthTest: opts.depthTest ?? true, transparent: !!opts.opacity, opacity: opts.opacity ?? 1 });
  const l = new LineSegments2(g, m);
  if (opts.dashed) l.computeLineDistances();
  l.renderOrder = opts.renderOrder ?? 2;
  return l;
}
function edgesOf(mesh, out, threshold = 20) {
  mesh.updateMatrixWorld(true);
  const e = new THREE.EdgesGeometry(mesh.geometry, threshold);
  const p = e.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); out.push(v.x, v.y, v.z); }
}

// Build the whole field. Returns { group, L (layout), anchors, lines, setResolution(w,h), setSolid(k) }
export async function buildField(report, { azimuth = 0.66, markUrl = '/brand/logo.svg', markSvg = null, scarecrow = true, mats = makeMaterials(), lineWidth = 1.25, crowScale = 0.022, crowCorner = 'front-left', bevel = true } = {}) {
  const L = layoutReport(report);
  const { W, D, H } = L;
  const crowAt = { 'front-left': [-W / 2 + 0.28, D / 2 - 0.3], 'back-left': [-W / 2 + 0.28, -D / 2 + 0.4], 'back-right': [W / 2 - 0.28, -D / 2 + 0.4], 'front-right': [W / 2 - 0.28, D / 2 - 0.3] }[crowCorner];
  const group = new THREE.Group(); group.name = 'starcrop-field';
  const edgePos = []; const lines = [];

  // strata: stacked boards, alternate boards inset 0.035 so the layering reads like a laser-cut site model
  const cuts = [0, ...L.strata.map((s) => s.depth).filter((d) => d < H - 0.08), H];
  for (let i = 0; i < cuts.length - 1; i++) {
    const t = cuts[i + 1] - cuts[i]; const inset = i % 2 ? 0.035 : 0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(W - inset * 2, t, D - inset * 2), i % 2 ? mats.stratum : mats.board);
    m.position.y = -(cuts[i] + t / 2); m.castShadow = false; m.receiveShadow = true;
    group.add(m); edgesOf(m, edgePos);
  }
  // furrows: raised ridges, one per account
  const ridgeGeo = new THREE.BoxGeometry(0.2, 0.045, D - 0.5);
  const ridges = [];
  for (const r of L.roots) {
    const m = new THREE.Mesh(ridgeGeo, mats.ridge); m.position.set(r.x, 0.0225, 0); m.receiveShadow = true; m.castShadow = true;
    group.add(m); edgesOf(m, edgePos); ridges.push(m);
  }
  const edges = fatLines(edgePos, PAL.blueline, lineWidth * 0.8); edges.name = 'edges'; group.add(edges); lines.push(edges);

  // stalks + stars + flags (instanced)
  const S = L.stalks;
  const stalkGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 8); stalkGeo.translate(0, 0.5, 0);
  const stalks = new THREE.InstancedMesh(stalkGeo, mats.ink, S.length); stalks.castShadow = true;
  const starGeo = new THREE.ExtrudeGeometry(starShape(), { depth: 0.22, bevelEnabled: bevel, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 }); starGeo.center();
  const stars = new THREE.InstancedMesh(starGeo, mats.ink, S.length); stars.castShadow = true;
  const flagsIdx = S.filter((s) => s.target && (L.verdict === 'PLANTED' || L.verdict === 'MIXED'));
  const flags = new THREE.InstancedMesh(ribbonGeometry(), mats.flag, Math.max(1, flagsIdx.length)); flags.castShadow = true; flags.count = flagsIdx.length;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, azimuth, 0));
  const M = new THREE.Matrix4(); const sc = new THREE.Vector3(); const pos = new THREE.Vector3();
  const furrowOf = new Map(L.roots.map((r, i) => [r.login, i]));
  S.forEach((s) => { s.furrow = furrowOf.get(s.login); });
  const lift = new Float32Array(L.roots.length); const growth = { value: 1 };
  let starQ = q.clone();
  function pose() {
    const g = growth.value;
    S.forEach((s, i) => {
      const y = lift[s.furrow] || 0; const k = Math.max(0.0001, Math.min(1, (g * (S.length + 24) - s.order) / 24));
      M.compose(pos.set(s.x, 0.04 + y, s.z), new THREE.Quaternion(), sc.set(1, s.h * k, 1)); stalks.setMatrixAt(i, M);
      M.compose(pos.set(s.x, 0.04 + s.h * k + 0.09 + y, s.z), starQ, sc.setScalar(0.13 * Math.min(1, k * 1.4))); stars.setMatrixAt(i, M);
    });
    flagsIdx.forEach((s, i) => { const y = lift[s.furrow] || 0; const k = Math.max(0.0001, Math.min(1, (g * (S.length + 24) - s.order) / 24)); M.compose(pos.set(s.x, 0.04 + s.h * 0.62 * k + y, s.z), starQ, sc.setScalar(1.35 * (k >= 1 ? 1 : 0.0001))); flags.setMatrixAt(i, M); });
    stalks.instanceMatrix.needsUpdate = true; stars.instanceMatrix.needsUpdate = true; flags.instanceMatrix.needsUpdate = true;
  }
  // planting order for the growth reveal: column, then furrow
  S.map((s, i) => i).sort((a, b) => (S[a].rank - S[b].rank) || (S[a].furrow - S[b].furrow)).forEach((i, k) => { S[i].order = k; });
  pose();
  group.add(stalks, stars, flags);

  // SECTION A-A on the front face: hatch, roots, birth dots, pink birth line
  const zF = D / 2 + 0.004;
  const suspect = L.verdict === 'PLANTED' || L.verdict === 'MIXED';
  const hatchDepth = suspect ? Math.min(H, L.bornDepth + 0.12) : H;
  const ht = hatchTexture(suspect ? PAL.flag : PAL.nonphoto, 'rgba(0,0,0,0)', 16, suspect ? 2.4 : 1.6);
  ht.repeat.set(W * 3.2, hatchDepth * 3.2);
  const hatch = new THREE.Mesh(new THREE.PlaneGeometry(W, hatchDepth), new THREE.MeshBasicMaterial({ map: ht, transparent: true, opacity: suspect ? 0.55 : 0.5, depthWrite: false }));
  hatch.position.set(0, -hatchDepth / 2, zF); hatch.renderOrder = 1; group.add(hatch);

  const rootPos = []; const rootSeg = []; const dotGeo = new THREE.CircleGeometry(0.05, 20);
  const dots = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ color: PAL.blueline }), L.roots.length);
  L.roots.forEach((r, i) => {
    const seg0 = rootPos.length;
    rootPos.push(r.x, 0, zF + 0.002, r.x, -r.depth, zF + 0.002);
    // grown roots branch: one pair of laterals per doubling of age beyond 60 days (deterministic by id)
    const branches = Math.max(0, Math.floor(Math.log2(Math.max(1, r.ageDays / 60))));
    for (let b = 0; b < branches; b++) {
      const y = -r.depth * (0.25 + 0.7 * (b + 1) / (branches + 1)); const len = 0.08 + 0.05 * ((r.id >> b) % 3); const dir = (b + (r.id % 2)) % 2 ? 1 : -1;
      rootPos.push(r.x, y, zF + 0.002, r.x + dir * len, y - len * 0.7, zF + 0.002);
    }
    M.compose(pos.set(r.x, -r.depth, zF + 0.003), new THREE.Quaternion(), sc.setScalar(1)); dots.setMatrixAt(i, M);
    rootSeg.push([seg0, rootPos.length]);
  });
  const rootLines = fatLines(rootPos, PAL.blueline, lineWidth * 1.9); rootLines.name = 'roots'; group.add(rootLines, dots); lines.push(rootLines);
  // the pulled root is drawn apart, thicker (2.4 -> 3.6 px), so one furrow can leave the section face
  const pulled = fatLines([0, 0, 0, 0, 0, 0], PAL.blueline, lineWidth * 2.9); pulled.name = 'pulledRoot'; pulled.visible = false; group.add(pulled); lines.push(pulled);
  const plug = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), new THREE.MeshBasicMaterial({ color: PAL.blueline })); plug.visible = false; group.add(plug);
  function poseRoot(k, y, { color = PAL.blueline, clean = false } = {}) {
    const keep = []; rootSeg.forEach(([a, b], i) => { if (i !== k || k == null) for (let j = a; j < b; j++) keep.push(rootPos[j]); });
    rootLines.geometry.dispose(); rootLines.geometry = new LineSegmentsGeometry(); rootLines.geometry.setPositions(keep.length ? keep : [0, 0, 0, 0, 0, 0]);
    L.roots.forEach((r, i) => { M.compose(pos.set(r.x, -r.depth + (i === k ? y : 0), zF + 0.003), new THREE.Quaternion(), sc.setScalar(i === k && clean ? 0.0001 : 1)); dots.setMatrixAt(i, M); });
    dots.instanceMatrix.needsUpdate = true;
    if (k == null) { pulled.visible = false; plug.visible = false; return; }
    const [a, b] = rootSeg[k]; const pp = rootPos.slice(a, b).map((v, j) => (j % 3 === 1 ? v + y : v));
    pulled.geometry.dispose(); pulled.geometry = new LineSegmentsGeometry(); pulled.geometry.setPositions(pp);
    pulled.material.color.set(color); pulled.visible = true;
    const r = L.roots[k]; plug.position.set(r.x, -r.depth + y, zF + 0.004); plug.visible = clean;
  }
  let bornLine = null;
  if (suspect) {
    const bl = fatLines([-W / 2, -L.bornDepth, zF + 0.004, W / 2 + 0.0, -L.bornDepth, zF + 0.004, W / 2, -L.bornDepth, zF + 0.004, W / 2, -L.bornDepth, -D / 2], PAL.flag, lineWidth * 1.6, { dashed: true, dash: 0.12, gap: 0.07 });
    bl.name = 'bornLine'; group.add(bl); lines.push(bl); bornLine = bl;
  }

  // break line across the field (drafting zig-zag) when later plantings exist
  if (L.hasLater) {
    const zb = L.zBreak; const bp = []; const x0 = -W / 2 - 0.25; const x1 = W / 2 + 0.25; const mid = 0;
    const pts = [[x0, zb], [mid - 0.18, zb], [mid - 0.06, zb - 0.22], [mid + 0.06, zb + 0.22], [mid + 0.18, zb], [x1, zb]];
    for (let i = 0; i < pts.length - 1; i++) bp.push(pts[i][0], 0.06, pts[i][1], pts[i + 1][0], 0.06, pts[i + 1][1]);
    const br = fatLines(bp, PAL.blueline, lineWidth * 1.1); br.name = 'break'; group.add(br); lines.push(br);
  }

  // scarecrow = the mark, extruded, planted at the back-left corner as the drawing's scale figure
  let crow = null;
  if (scarecrow && (markSvg || markUrl)) {
    try {
      const txt = markSvg || await (await fetch(markUrl)).text();
      const data = new SVGLoader().parse(txt);
      crow = new THREE.Group(); crow.name = 'scarecrow';
      for (const p of data.paths) {
        const id = p.userData?.node?.id; const isFlag = id === 'flag';
        const shapes = p.toShapes(true);
        const g = new THREE.ExtrudeGeometry(shapes, { depth: isFlag ? 13 : 10, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.5, bevelSegments: 2, curveSegments: 4 });
        g.translate(-50, -97, isFlag ? -6.5 : -5);
        const mesh = new THREE.Mesh(g, isFlag ? mats.flag : mats.ink); mesh.castShadow = true;
        crow.add(mesh);
      }
      const k = crowScale; crow.scale.set(k, -k, k);
      crow.position.set(crowAt[0], 0.02, crowAt[1]); crow.rotation.y = azimuth;
      group.add(crow);
    } catch (e) { /* mark optional */ }
  }

  // Scrubbed id-clock reveal (sheet 3 -> 4): every root drops from the furrow to its birth depth, left to right in
  // user-id order (furrows are sorted by id), the birth dot riding the tip; then the pink birth line draws across
  // the section and the suspect hatch prints. k = 1 is the resting drawing (and what poseRoot / the pull test expect).
  const hatchOpacity = hatch.material.opacity; let grownK = 1;
  function growRoots(k) {
    k = Math.max(0, Math.min(1, k));
    if (Math.abs(k - grownK) < 1e-4) return;
    grownK = k;
    const n = L.roots.length; const kr = Math.min(1, k / 0.78); const d = 0.34;
    const ez = (t) => 1 - Math.pow(1 - t, 3);
    const keep = [];
    L.roots.forEach((r, i) => {
      const p = k >= 1 ? 1 : ez(Math.max(0, Math.min(1, (kr - (i * (1 - d)) / Math.max(1, n - 1)) / d)));
      const tip = -r.depth * p;
      const [a, b] = rootSeg[i];
      if (p > 0) keep.push(r.x, 0, zF + 0.002, r.x, tip, zF + 0.002);
      for (let j = a + 6; j < b; j += 6) {
        const y0 = rootPos[j + 1]; if (tip > y0) continue; // the tip hasn't reached this lateral yet
        const f = p >= 1 ? 1 : Math.min(1, (y0 - tip) / 0.18);
        keep.push(rootPos[j], y0, rootPos[j + 2], rootPos[j] + (rootPos[j + 3] - rootPos[j]) * f, y0 + (rootPos[j + 4] - y0) * f, rootPos[j + 5]);
      }
      M.compose(pos.set(r.x, tip, zF + 0.003), new THREE.Quaternion(), sc.setScalar(p > 0 ? 1 : 0.0001)); dots.setMatrixAt(i, M);
    });
    dots.instanceMatrix.needsUpdate = true;
    rootLines.geometry.dispose(); rootLines.geometry = new LineSegmentsGeometry(); rootLines.geometry.setPositions(keep.length ? keep : [0, 0, 0, 0, 0, 0]);
    const kb = k >= 1 ? 1 : Math.max(0, Math.min(1, (k - 0.7) / 0.3));
    if (bornLine) {
      const y = -L.bornDepth, x1 = -W / 2 + W * kb;
      const pts = kb >= 1 ? [-W / 2, y, zF + 0.004, W / 2, y, zF + 0.004, W / 2, y, zF + 0.004, W / 2, y, -D / 2] : [-W / 2, y, zF + 0.004, Math.max(-W / 2 + 1e-4, x1), y, zF + 0.004];
      bornLine.geometry.dispose(); bornLine.geometry = new LineSegmentsGeometry(); bornLine.geometry.setPositions(pts); bornLine.computeLineDistances();
      bornLine.visible = kb > 0;
    }
    hatch.material.opacity = hatchOpacity * (bornLine ? kb : Math.min(1, k / 0.6));
    hatch.visible = hatch.material.opacity > 0.001;
  }

  // anchors for 2D annotation overlay (world space)
  const A = {};
  if (L.gapPair) {
    const x = L.x0 + L.gapPair.rowIndex * L.SP;
    A.gapA = new THREE.Vector3(x, 0.05, L.gapPair.za); A.gapB = new THREE.Vector3(x, 0.05, L.gapPair.zb);
  }
  A.rowsL = new THREE.Vector3(L.x0, 0, D / 2); A.rowsR = new THREE.Vector3(L.x1, 0, D / 2);
  A.bornR = new THREE.Vector3(W / 2, -L.bornDepth, D / 2);
  A.bornL = new THREE.Vector3(-W / 2, -L.bornDepth, D / 2); A.surfL = new THREE.Vector3(-W / 2, 0, D / 2);
  A.bornMid = new THREE.Vector3(L.x0 + Math.min(3, L.n - 1) * L.SP, -L.bornDepth, D / 2);
  A.strataL = L.strata.filter((s) => s.depth < H).map((s) => ({ label: s.label, p: new THREE.Vector3(-W / 2 + 0.08, -s.depth, D / 2) }));
  A.bottomL = new THREE.Vector3(L.x0, -H, D / 2); A.bottomR = new THREE.Vector3(L.x1, -H, D / 2);
  A.surfR = new THREE.Vector3(W / 2, 0, D / 2);
  A.frontBL = new THREE.Vector3(-W / 2, -H, D / 2); A.frontBR = new THREE.Vector3(W / 2, -H, D / 2);
  A.strata = L.strata.filter((s) => s.depth < H).map((s) => ({ label: s.label, p: new THREE.Vector3(W / 2, -s.depth, D / 2) }));
  A.breakR = new THREE.Vector3(W / 2 + 0.25, 0.06, L.zBreak);
  const tallest = S.filter((s) => s.target).sort((a, b) => b.x - a.x)[0];
  if (tallest) { A.hTop = new THREE.Vector3(tallest.x, 0.04 + tallest.h, tallest.z); A.hBase = new THREE.Vector3(tallest.x, 0.04, tallest.z); }
  if (crow) A.crow = new THREE.Vector3(crowAt[0], 93 * crowScale, crowAt[1]);
  A.targetRow = S.filter((s) => s.target).map((s) => new THREE.Vector3(s.x, 0.04 + s.h * 0.62, s.z));

  return {
    group, L, anchors: A, lines, stalks, stars, flags, crow, ridges, mats, growth, lift, pose, poseRoot, hatch, growRoots,
    setStarQuat(quat) { starQ = quat.clone(); pose(); },
    setLift(k, y) { lift.fill(0); if (k != null) { lift[k] = y; ridges[k].position.y = 0.0225 + y; } ridges.forEach((m, i) => { if (i !== k) m.position.y = 0.0225; }); pose(); },
    setResolution(w, h) { for (const l of lines) l.material.resolution.set(w, h); },
    dispose() { group.traverse((o) => { o.geometry?.dispose?.(); }); ht.dispose(); },
  };
}

// Orthographic dimetric camera, framed on a box, with an optional horizontal offset (fraction of viewport)
export function makeCamera(aspect) {
  const cam = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 200);
  return cam;
}
export function aimCamera(cam, { azimuth = 0.66, elevation = 0.42, target = new THREE.Vector3(0, -0.6, 0), halfHeight = 6, aspect = 1.6, shiftX = 0, shiftY = 0 }) {
  const d = 60;
  cam.position.set(target.x + d * Math.sin(azimuth) * Math.cos(elevation), target.y + d * Math.sin(elevation), target.z + d * Math.cos(azimuth) * Math.cos(elevation));
  cam.up.set(0, 1, 0); cam.lookAt(target);
  cam.left = -halfHeight * aspect - shiftX * halfHeight * aspect * 2; cam.right = halfHeight * aspect - shiftX * halfHeight * aspect * 2;
  cam.top = halfHeight - shiftY * halfHeight * 2; cam.bottom = -halfHeight - shiftY * halfHeight * 2;
  cam.updateProjectionMatrix();
}

export function project(v, cam, w, h) {
  const p = v.clone().project(cam);
  return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
}

// ---------- per-beat helpers ----------
// Re-orient star heads and flags to face the camera (call when the camera changes view; 150 instances is cheap).
export function faceStars(F, quat) {
  if (F.setStarQuat) { F.setStarQuat(quat); return; }
  const M = new THREE.Matrix4(); const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3();
  for (const mesh of [F.stars, F.flags]) {
    for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, M); M.decompose(p, q, s); M.compose(p, quat, s); mesh.setMatrixAt(i, M); }
    mesh.instanceMatrix.needsUpdate = true;
  }
}

// Sheet 2: the repo's side, as GitHub shows it since 2026-06-30. A board facade in front of the field with the
// stargazers door hatched shut. Raise it for sheet 2, drop it (y -= H + 2.4) as sheet 3 starts.
export function buildFence(report, L, { mats = makeMaterials() } = {}) {
  const w = L.W + 0.3, h = L.H + 2.2;
  const c = document.createElement('canvas'); const PX = 180; c.width = Math.round(w * PX); c.height = Math.round(h * PX);
  const g = c.getContext('2d');
  g.fillStyle = PAL.board; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = PAL.blueline; g.lineWidth = 5; g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.fillStyle = PAL.blueline; g.font = `600 ${0.2 * PX}px "Overpass Mono", monospace`; g.textBaseline = 'top';
  g.fillText(report.repo.fullName, 0.35 * PX, 0.35 * PX);
  g.font = `900 ${0.62 * PX}px "Zalando Sans Expanded", sans-serif`;
  g.fillText(`${report.repo.stars} STARS`, 0.35 * PX, 0.72 * PX);
  // the door: stargazers, hatched shut
  const dx = 0.35 * PX, dy = 1.7 * PX, dw = w * PX - 0.7 * PX, dh = (h - 2.1) * PX;
  g.save(); g.beginPath(); g.rect(dx, dy, dw, dh); g.clip();
  g.strokeStyle = PAL.flag; g.lineWidth = 4;
  for (let i = -dh; i < dw + dh; i += 26) { g.beginPath(); g.moveTo(dx + i, dy + dh); g.lineTo(dx + i + dh, dy); g.stroke(); g.beginPath(); g.moveTo(dx + i, dy); g.lineTo(dx + i + dh, dy + dh); g.stroke(); }
  g.restore();
  g.lineWidth = 6; g.strokeStyle = PAL.blueline; g.strokeRect(dx, dy, dw, dh);
  const lbw = Math.min(dw - 0.5 * PX, 6.2 * PX), lbh = 0.95 * PX;
  g.font = `900 ${0.3 * PX}px "Zalando Sans Expanded", sans-serif`;
  const big = '404 · SINCE 2026-06-30'; const fit = Math.min(1, (lbw - 0.3 * PX) / g.measureText(big).width);
  g.fillStyle = PAL.board; g.fillRect(dx + 0.25 * PX, dy + 0.25 * PX, lbw, lbh); g.strokeRect(dx + 0.25 * PX, dy + 0.25 * PX, lbw, lbh);
  g.fillStyle = PAL.blueline; g.font = `600 ${0.17 * PX}px "Overpass Mono", monospace`;
  g.fillText('GET /repos/{o}/{r}/stargazers', dx + 0.4 * PX, dy + 0.4 * PX);
  g.fillStyle = '#C8175E'; g.font = `900 ${0.3 * PX * fit}px "Zalando Sans Expanded", sans-serif`;
  g.fillText(big, dx + 0.4 * PX, dy + 0.72 * PX);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  const fence = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), [mats.board, mats.board, mats.board, mats.board, face, mats.board]);
  fence.position.set(0, h / 2 - L.H, L.D / 2 + 0.45); fence.castShadow = true; fence.receiveShadow = true; fence.name = 'fence';
  return fence;
}

// Sheet 7: a survey bench-mark disc (brass, the only non-palette material on the site) set on a concrete monument
// standing beside the plot, top flush with the field surface (y = 0). Stamp text comes from the MEASURED library bench
// numbers; pass lines = [] until they exist (never invent). Default spot: left of the front-left corner.
// The monument is drawn, not just shaded: a quarter is cut away toward `cutAz` (the viewing azimuth) as SECTION B-B,
// the cut faces carry the drafting symbol for concrete (stipple + aggregate triangles) with the brass shank sectioned
// in them, and every visible edge and silhouette is blueline linework like the field's.
// Only the disc head turns (userData.head); call userData.setResolution(w, h) like the field's lines.
function concreteTexture({ w = 512, h = 512, seed = 7, bg = PAL.board, ink = PAL.blueline, dots = 420, tris = 34, alpha = 0.85 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  let x = seed; const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.globalAlpha = alpha; g.fillStyle = ink; g.strokeStyle = ink;
  for (let i = 0; i < dots; i++) { g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.9 + rnd() * 1.5, 0, Math.PI * 2); g.fill(); }
  g.lineWidth = 1.6;
  for (let i = 0; i < tris; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = 5 + rnd() * 7, a = rnd() * Math.PI * 2;
    g.beginPath(); for (let k = 0; k < 3; k++) { const t = a + (k * Math.PI * 2) / 3 + (rnd() - 0.5) * 0.5; g[k ? 'lineTo' : 'moveTo'](cx + r * Math.cos(t), cy + r * Math.sin(t)); }
    g.closePath(); g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}
export function buildBenchmark(lines = [], { at = [-5.0, 0.0, 3.4], postHeight = 2.2, mats = makeMaterials(), cutAz = 0.5, lineWidth = 1.25, resolution = null } = {}) {
  const grp = new THREE.Group(); grp.name = 'benchmark';
  const h = postHeight, Rt = 0.6, Rb = 0.64, rs = 0.12, shank = 0.5;
  const th0 = cutAz + Math.PI / 4, thL = Math.PI * 1.5; // kept 270 degrees; the removed quarter faces cutAz
  const thA = cutAz - Math.PI / 4, thB = cutAz + Math.PI / 4;
  const polyOff = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };

  // the monument: tapered concrete, stippled like a drafted elevation (light), quarter removed
  const skin = new THREE.CanvasTexture(concreteTexture({ w: 1024, h: 512, seed: 11, ink: PAL.pencil, dots: 900, tris: 40, alpha: 0.28 }));
  skin.colorSpace = THREE.SRGBColorSpace; skin.wrapS = skin.wrapT = THREE.RepeatWrapping; skin.anisotropy = 8; skin.repeat.set(2, Math.max(1, h / 1.1));
  const concrete = new THREE.MeshStandardMaterial({ color: '#FFFFFF', map: skin, roughness: 0.94, metalness: 0, side: THREE.DoubleSide, ...polyOff });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(Rt, Rb, h, 72, 1, false, th0, thL), concrete);
  post.position.y = -h / 2 - 0.001; post.castShadow = post.receiveShadow = true; grp.add(post);

  // SECTION B-B: the two cut faces. Concrete symbol + the brass shank cut through its axis.
  const PX = 420; const cw = Math.round(Rb * PX), ch = Math.round(h * PX);
  const sc = document.createElement('canvas'); sc.width = cw; sc.height = ch; const sg = sc.getContext('2d');
  sg.drawImage(concreteTexture({ w: cw, h: ch, seed: 5, dots: Math.round(cw * ch / 260), tris: Math.round(cw * ch / 5200), alpha: 0.9 }), 0, 0);
  // the taper: outside the concrete stays transparent
  sg.globalCompositeOperation = 'destination-in'; sg.beginPath(); sg.moveTo(0, 0); sg.lineTo(Rt * PX, 0); sg.lineTo(Rb * PX, ch); sg.lineTo(0, ch); sg.closePath(); sg.fill();
  sg.globalCompositeOperation = 'source-over';
  const sw = Math.round(rs * PX), sd = Math.round(shank * PX), fl = Math.round(0.17 * PX), flH = Math.round(0.07 * PX);
  sg.fillStyle = '#B08A4E'; sg.strokeStyle = '#5E4520'; sg.lineWidth = 4;
  sg.beginPath(); sg.moveTo(0, 0); sg.lineTo(sw, 0); sg.lineTo(sw, sd - flH); sg.lineTo(fl, sd); sg.lineTo(0, sd); sg.closePath(); sg.fill(); sg.stroke();
  // brass in section: 45-degree hatch in the dark brass tone
  sg.save(); sg.clip(); sg.lineWidth = 2.2; for (let k = -sd; k < sd + fl; k += 14) { sg.beginPath(); sg.moveTo(k, 0); sg.lineTo(k + sd, sd); sg.stroke(); } sg.restore();
  const secTex = new THREE.CanvasTexture(sc); secTex.colorSpace = THREE.SRGBColorSpace; secTex.anisotropy = 8;
  // a drafted section is a flat fill: unlit, so both cut faces print the same board white with blueline stipple
  const secMat = new THREE.MeshBasicMaterial({ map: secTex, alphaTest: 0.5, side: THREE.DoubleSide, ...polyOff });
  const at3 = (r, y, th) => [r * Math.sin(th), y, r * Math.cos(th)];
  const cutFace = (th) => {
    const g = new THREE.BufferGeometry();
    const P = [at3(0, 0, th), at3(Rb, 0, th), at3(Rb, -h, th), at3(0, -h, th)].flat();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals();
    const m = new THREE.Mesh(g, secMat); m.receiveShadow = true; return m;
  };
  const faceA = cutFace(thA), faceB = cutFace(thB); faceA.position.y = faceB.position.y = -0.001; grp.add(faceA, faceB);

  // the brass shank below the head, sectioned with the monument
  const brass = new THREE.MeshStandardMaterial({ color: '#B08A4E', metalness: 1, roughness: 0.34 });
  const shankProf = [[rs, 0.0], [rs, -(shank - 0.07)], [0.17, -shank], [0, -shank]].map(([x, y]) => new THREE.Vector2(x, y));
  const shankMesh = new THREE.Mesh(new THREE.LatheGeometry(shankProf, 48, th0, thL), brass); shankMesh.castShadow = true; grp.add(shankMesh);

  // the disc head (turns as you scroll): brass lathe + stamped face
  const head = new THREE.Group(); head.name = 'benchHead'; grp.add(head);
  const prof = [[0, 0.07], [0.52, 0.07], [0.56, 0.05], [0.56, 0.0], [0.0, 0.0]].map(([x, y]) => new THREE.Vector2(x, y));
  const disc = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), brass); disc.castShadow = true; disc.receiveShadow = true; head.add(disc);
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
  g.fillStyle = '#B08A4E'; g.fillRect(0, 0, 1024, 1024);
  g.translate(512, 512); g.fillStyle = '#5E4520'; g.strokeStyle = '#5E4520'; g.lineWidth = 10;
  g.beginPath(); g.arc(0, 0, 470, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, 340, 0, Math.PI * 2); g.stroke();
  const ring = 'STARCROP · BENCH MARK · MEASURED ON THIS MAC · DO NOT DISTURB · ';
  g.font = '600 50px "Overpass Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < ring.length; i++) { g.save(); g.rotate((i / ring.length) * Math.PI * 2); g.fillText(ring[i], 0, -405); g.restore(); }
  g.beginPath(); g.moveTo(0, -150); g.lineTo(130, 75); g.lineTo(-130, 75); g.closePath(); g.lineWidth = 12; g.stroke();
  g.beginPath(); g.moveTo(-200, 0); g.lineTo(200, 0); g.moveTo(0, -200); g.lineTo(0, 200); g.lineWidth = 6; g.stroke();
  g.font = '600 38px "Overpass Mono", monospace';
  lines.slice(0, 3).forEach((s, i) => g.fillText(s, 0, 150 + i * 46));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.52, 72), new THREE.MeshStandardMaterial({ map: tex, metalness: 1, roughness: 0.38, bumpMap: tex, bumpScale: 1.5 }));
  top.rotation.x = -Math.PI / 2; top.position.y = 0.071; head.add(top);

  // linework: outline (rims + silhouettes + cut outline) heavier, section edges lighter, axis as a chain line
  const arc = (r, y, a0, a1, n = 64) => { const o = []; for (let i = 0; i < n; i++) { const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n; o.push(...at3(r, y, t0), ...at3(r, y, t1)); } return o; };
  const outline = [
    ...arc(Rt * 1.003, 0.001, th0, th0 + thL), ...arc(Rb * 1.003, -h, th0, th0 + thL),
    ...at3(Rt * 1.003, 0, cutAz + Math.PI / 2), ...at3(Rb * 1.003, -h, cutAz + Math.PI / 2),
    ...at3(Rt * 1.003, 0, cutAz - Math.PI / 2), ...at3(Rb * 1.003, -h, cutAz - Math.PI / 2),
    ...at3(Rt, 0, thA), ...at3(Rb, -h, thA), ...at3(Rt, 0, thB), ...at3(Rb, -h, thB),
  ];
  const section = [
    ...at3(0, 0, 0), ...at3(0, -h, 0),
    ...at3(0, 0.001, thA), ...at3(Rt, 0.001, thA), ...at3(0, 0.001, thB), ...at3(Rt, 0.001, thB),
    ...at3(0, -h, thA), ...at3(Rb, -h, thA), ...at3(0, -h, thB), ...at3(Rb, -h, thB),
  ];
  const L1 = fatLines(outline, PAL.blueline, lineWidth * 1.3, { renderOrder: 3 });
  const L2 = fatLines(section, PAL.blueline, lineWidth * 0.85, { renderOrder: 3 });
  const blines = [L1, L2]; grp.add(...blines);
  const setResolution = (w, hh) => { for (const l of blines) l.material.resolution.set(w, hh); };
  if (resolution) setResolution(...resolution);
  else if (typeof window !== 'undefined') setResolution(window.innerWidth * (window.devicePixelRatio || 1), window.innerHeight * (window.devicePixelRatio || 1));

  grp.userData = { head, lines: blines, setResolution, cutAz, height: h, radius: Rb, sectionPoint: new THREE.Vector3(...at3(Rb * 0.62, -h * 0.62, thB)) };
  grp.position.set(...at);
  return grp;
}
