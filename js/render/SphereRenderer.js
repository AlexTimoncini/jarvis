/* ============================================================
   SphereRenderer - the 3D JARVIS core (Three.js)
   --------------------------------------------------------------
   Layered look:
     - inner fresnel "arc-reactor" core (additive glow)
     - rotating wireframe icosphere shell
     - 3 orbital rings on independent axes
     - a fine particle halo
   Reads parameters from VisualState every frame.
   ============================================================ */
import * as THREE from 'three';
import { visual } from '../core/VisualState.js';
import { clamp } from '../core/util.js';

const RADIUS = 1.0;

function makeParticleSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/** Big soft radial halo for diffuse, energetic central light. */
function makeGlowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/** Detailed Iron-Man arc-reactor: coils, notched ring, "V" core. */
function makeReactorTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const W = (a) => `rgba(255,255,255,${a})`;

  // soft outer glow
  let g = ctx.createRadialGradient(cx, cx, 0, cx, cx, S * 0.5);
  g.addColorStop(0, W(0.55));
  g.addColorStop(0.22, W(0.22));
  g.addColorStop(0.6, W(0.06));
  g.addColorStop(1, W(0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  ctx.translate(cx, cx);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // --- outer notched ring (housing) ---
  ctx.lineWidth = 4;
  ctx.strokeStyle = W(0.55);
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = W(0.8);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r0 = S * 0.40;
    const r1 = i % 5 === 0 ? S * 0.435 : S * 0.42;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  }

  // --- electromagnetic coil ring (the bright segmented copper coils) ---
  const COILS = 9;
  const coilR = S * 0.31;
  for (let i = 0; i < COILS; i++) {
    const a0 = (i / COILS) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / COILS - 0.10;
    // coil body (bright trapezoid arc)
    ctx.beginPath();
    ctx.arc(0, 0, coilR + S * 0.035, a0, a1);
    ctx.arc(0, 0, coilR - S * 0.035, a1, a0, true);
    ctx.closePath();
    const cg = ctx.createRadialGradient(0, 0, coilR - S * 0.04, 0, 0, coilR + S * 0.04);
    cg.addColorStop(0, W(0.18));
    cg.addColorStop(0.5, W(0.7));
    cg.addColorStop(1, W(0.15));
    ctx.fillStyle = cg;
    ctx.fill();
    // coil winding ticks
    ctx.strokeStyle = W(0.5);
    ctx.lineWidth = 1.5;
    for (let k = 1; k < 5; k++) {
      const a = a0 + ((a1 - a0) * k) / 5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (coilR - S * 0.034), Math.sin(a) * (coilR - S * 0.034));
      ctx.lineTo(Math.cos(a) * (coilR + S * 0.034), Math.sin(a) * (coilR + S * 0.034));
      ctx.stroke();
    }
  }

  // inner containment ring around the core
  ctx.lineWidth = 3;
  ctx.strokeStyle = W(0.85);
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.205, 0, Math.PI * 2);
  ctx.stroke();

  // --- the downward "V" triangle (drawn with bloom) ---
  const tri = (r, w, a) => {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 3 + Math.PI; // point down
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = w;
    ctx.strokeStyle = W(a);
    ctx.stroke();
  };
  tri(S * 0.165, 14, 0.18);
  tri(S * 0.165, 6, 1.0);
  tri(S * 0.105, 3, 0.9);

  // --- bright central core ---
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.10);
  g.addColorStop(0, W(1));
  g.addColorStop(0.5, W(0.85));
  g.addColorStop(1, W(0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.10, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

const CORE_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const CORE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGlow;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float ndv = max(dot(vNormal, vView), 0.0);
    // softer rim + a diffuse inner fill -> volumetric, energetic light
    float fres = pow(1.0 - ndv, 1.7);
    float fill = pow(ndv, 1.4);
    float glow = fres * (0.45 + 0.55 * uPulse) + fill * (0.55 + 0.35 * uPulse);
    vec3 col = uColor * (uGlow * (0.35 + glow * 1.45));
    float a = clamp((fres * 0.65 + fill * 0.6) * (0.5 + uGlow), 0.0, 1.0);
    gl_FragColor = vec4(col, a);
  }
`;

export class SphereRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.dprCap = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dprCap);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4.4);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this._color = new THREE.Color();
    this._build();
    this.resize(window.innerWidth, window.innerHeight);
  }

  _build() {
    // Diffuse energetic halo (big soft billboard behind the core)
    this.glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowSprite(),
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.glowSprite.scale.setScalar(5.2);
    this.root.add(this.glowSprite);

    // Inner fresnel core
    this.coreUniforms = {
      uColor: { value: new THREE.Color(0x00e5ff) },
      uGlow: { value: 0.6 },
      uPulse: { value: 0.0 },
    };
    const coreMat = new THREE.ShaderMaterial({
      uniforms: this.coreUniforms,
      vertexShader: CORE_VERT,
      fragmentShader: CORE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 0.62, 48, 48), coreMat);
    this.root.add(this.core);

    // Arc-reactor "V" at the very center (camera-facing billboard)
    this.reactor = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeReactorTexture(),
      color: 0xbff6ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.reactor.scale.setScalar(1.9);
    this.root.add(this.reactor);

    // Wireframe shell
    this.shellMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(RADIUS, 2), this.shellMat);
    this.root.add(this.shell);

    // A second finer shell for depth
    this.shell2 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(RADIUS * 1.18, 1),
      new THREE.MeshBasicMaterial({
        color: 0x00e5ff, wireframe: true, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.root.add(this.shell2);

    // Orbital rings
    this.rings = [];
    const ringDefs = [
      { r: 1.45, t: 0.012, rot: [Math.PI / 2.2, 0, 0] },
      { r: 1.7, t: 0.008, rot: [Math.PI / 2, Math.PI / 5, 0] },
      { r: 1.95, t: 0.006, rot: [Math.PI / 3, 0, Math.PI / 4] },
    ];
    for (const d of ringDefs) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, d.t, 8, 120), mat);
      ring.rotation.set(...d.rot);
      this.root.add(ring);
      this.rings.push(ring);
    }

    // Particle halo
    const COUNT = 900;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const r = RADIUS * (1.05 + Math.random() * 1.1);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particleMat = new THREE.PointsMaterial({
      size: 0.045,
      map: makeParticleSprite(),
      color: 0x7df3ff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.particles = new THREE.Points(geo, this.particleMat);
    this.root.add(this.particles);
  }

  _applyColor() {
    const a = visual.accent;
    this._color.setRGB(a.r / 255, a.g / 255, a.b / 255);
    this.coreUniforms.uColor.value.copy(this._color);
    this.shellMat.color.copy(this._color);
    this.shell2.material.color.copy(this._color);
    for (const ring of this.rings) ring.material.color.copy(this._color);
    this.glowSprite.material.color.copy(this._color);
    // reactor V slightly lighter (toward accent2)
    const a2 = visual.accent2;
    this.reactor.material.color.setRGB(clamp(a2.r / 255), clamp(a2.g / 255), clamp(a2.b / 255));
    // particles slightly lighter
    this.particleMat.color.setRGB(
      clamp(a.r / 255 + 0.25), clamp(a.g / 255 + 0.25), clamp(a.b / 255 + 0.3),
    );
  }

  update(dt) {
    this._applyColor();

    // core glow + pulse
    this.coreUniforms.uGlow.value = 0.3 + visual.glow * 1.2;
    this.coreUniforms.uPulse.value = clamp(visual.level * 0.8 + (visual.coreScale - 1) * 3);
    const s = visual.coreScale;
    this.core.scale.setScalar(s);

    // diffuse energetic halo (kept softer so the reactor stays the hero)
    this.glowSprite.material.opacity = 0.16 + visual.glow * 0.4 + visual.level * 0.25;
    this.glowSprite.scale.setScalar(4.0 + visual.glow * 1.1 + (s - 1) * 1.4);

    // arc-reactor: prominent core, gentle mechanism rotation + pulse
    this.reactor.material.rotation += (0.12 + visual.energy * 0.35) * dt;
    this.reactor.material.opacity = Math.min(1, 0.7 + visual.glow * 0.25 + visual.level * 0.35);
    this.reactor.scale.setScalar(1.85 * s + visual.level * 0.22);

    // rotations
    this.shell.rotation.y += visual.coreSpin * dt;
    this.shell.rotation.x += visual.coreSpin * 0.4 * dt;
    this.shell2.rotation.y -= visual.coreSpin * 0.7 * dt;
    this.shellMat.opacity = 0.18 + visual.energy * 0.35;

    const spins = visual.ringSpin;
    this.rings.forEach((ring, i) => {
      ring.rotation.z += (spins[i] || 0.2) * dt;
      ring.rotation.x += (spins[i] || 0.2) * 0.3 * dt;
      ring.material.opacity = visual.ringOpacity * (0.6 + 0.4 * Math.sin(performance.now() / 900 + i));
    });

    // particles
    this.particles.rotation.y += (0.05 + visual.particleEnergy * 0.4) * dt;
    this.particles.rotation.x += 0.02 * dt;
    this.particleMat.opacity = 0.15 + visual.particleEnergy * 0.6;
    this.particles.scale.setScalar(1 + visual.particleEnergy * 0.12 + (s - 1) * 0.5);

    // jitter (error glitch)
    if (visual.jitter > 0.001) {
      const j = visual.jitter * 0.08;
      this.root.position.set((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, 0);
    } else {
      this.root.position.set(0, 0, 0);
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // keep sphere comfortably framed in portrait
    this.camera.position.z = h > w ? 5.2 : 4.2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}
