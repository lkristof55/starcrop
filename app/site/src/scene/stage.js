// The drawing table: one WebGL renderer, one orthographic camera, the lighting from the direction (§10).
// No page-DOM assumptions: pass a canvas; brand-kit can use it for renders too.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { aimCamera } from './field.js';

export const SHEETS = [
  { azimuth: 0.24, elevation: 0.52, halfHeight: 7.9, shiftX: 0.165, shiftY: 0.1, target: [0, -0.5, 0] },
  { azimuth: 0.0, elevation: 0.0, halfHeight: 5.6, shiftX: 0.2, shiftY: 0.0, target: [0, 0.0, 4.4] },
  { azimuth: 0.0, elevation: 1.55, halfHeight: 6.2, shiftX: 0.2, shiftY: 0.02, target: [0, 0, 0] },
  { azimuth: 0.0, elevation: 0.0, halfHeight: 3.2, shiftX: 0.2, shiftY: -0.02, target: [1.0, -1.15, 4.1] },
  { azimuth: Math.PI / 2, elevation: 0.0, halfHeight: 5.0, shiftX: 0.2, shiftY: -0.08, target: [0, 0.35, -0.2] },
  { azimuth: 0.24, elevation: 0.52, halfHeight: 7.9, shiftX: 0.2, shiftY: 0.1, target: [0, -0.5, 0] },
  { azimuth: 0.5, elevation: 0.86, halfHeight: 2.2, shiftX: 0.15, shiftY: 0.02, target: [-4.9, -0.45, 3.4] },
];

// mobile: halfHeight x1.8, model centred in the gap under each sheet's text; sheet 1 = hero-mobile values
export function sheetsFor(mobile) {
  if (!mobile) return SHEETS;
  return SHEETS.map((s, i) => (i === 0
    ? { ...s, halfHeight: 14.5, shiftX: 0, shiftY: -0.085, target: [0, -0.4, 0] }
    : i === 5 ? { ...s, halfHeight: 13.5, shiftX: 0, shiftY: 0.02 }
      : i === 6 ? { ...s, halfHeight: 3.0, shiftX: 0, shiftY: 0.03 }
      : { ...s, halfHeight: s.halfHeight * (i === 3 ? 2.9 : 1.8), shiftX: 0, shiftY: 0, target: i === 3 ? [0, s.target[1], s.target[2]] : s.target }));
}

const plot = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // ~cubic-bezier(.65,0,.35,1)
export const ease = { plot };

export function lerpState(a, b, t) {
  const L = (x, y) => x + (y - x) * t;
  return {
    azimuth: L(a.azimuth, b.azimuth), elevation: L(a.elevation, b.elevation), halfHeight: L(a.halfHeight, b.halfHeight),
    shiftX: L(a.shiftX, b.shiftX), shiftY: L(a.shiftY, b.shiftY), target: [0, 1, 2].map((k) => L(a.target[k], b.target[k])),
  };
}

export function createStage(canvas, { mobile = false, width, height } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  const dpr = mobile ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d3e6, 0.35));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-6, 10, 4); sun.castShadow = !mobile;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 3; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
  scene.add(sun);

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  let W = width, H = height;
  const state = { ...SHEETS[0] };
  function aim(s = state) {
    Object.assign(state, s);
    aimCamera(cam, { ...s, target: new THREE.Vector3(...s.target), aspect: W / H });
  }
  return {
    renderer, scene, cam, sun, dpr,
    get size() { return { w: W, h: H }; },
    aim,
    state,
    resize(w, h) { W = w; H = h; renderer.setSize(w, h, false); aim(state); },
    render() { renderer.render(scene, cam); },
    dispose() { renderer.dispose(); pmrem.dispose(); },
  };
}

// Star heads stand upright facing the azimuth in the dimetric/elevation views and lie face-up in plan.
export function starQuat(az, el) {
  const tilt = -Math.max(0, Math.min(1, (el - 0.6) / 0.95)) * Math.PI / 2;
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, az, 0, 'YXZ'));
}
