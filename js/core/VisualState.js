/* ============================================================
   VisualState - shared, mutable bag of animation parameters.
   Written by AnimationDirector, read by SphereRenderer / HudRenderer
   / widgets every frame. Single source of truth for "how it looks".
   ============================================================ */
import { hexToRgb } from './util.js';

export class VisualState {
  constructor() {
    // Color (current, smoothly interpolated toward target accent)
    this.accent = hexToRgb('#00e5ff');
    this.accent2 = hexToRgb('#7df3ff');

    // Energy / glow
    this.energy = 0.25;      // overall activity 0..1
    this.glow = 0.5;         // core glow strength
    this.level = 0;          // instantaneous audio level 0..1 (speaking/listening)

    // Core sphere
    this.coreScale = 1;      // pulsing scale
    this.coreSpin = 0.15;    // rad/s for the wireframe shell

    // Rings (3 independent rings on different axes)
    this.ringSpin = [0.25, -0.18, 0.32];
    this.ringOpacity = 0.6;

    // Particles orbiting the core
    this.particleEnergy = 0.3;

    // HUD overlay (2D)
    this.scan = 0.4;         // scan sweep intensity
    this.hudSpin = 0.12;     // dashed ring rotation
    this.hudOpacity = 0.7;

    // Transient effects (managed by director)
    this.ripples = [];       // { age, life, strength }
    this.jitter = 0;         // glitch displacement 0..1

    // Misc
    this.bootProgress = 0;   // 0..1 during boot reveal
    this.stateName = 'boot';
  }
}

export const visual = new VisualState();
