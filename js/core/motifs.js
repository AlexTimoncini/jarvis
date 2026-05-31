/* ============================================================
   Animation motifs library
   --------------------------------------------------------------
   STATE_PROFILES : steady-state look for each state (targets the
                    director damps toward) + a pool of transient
                    motifs the "AI" can autonomously trigger.
   MOTIF_LIB      : transient one-shot behaviors. Each returns a
                    Modifier descriptor (additive fields + envelope)
                    and/or spawns ripples directly on the visual.
   ============================================================ */

/**
 * Steady-state targets per state.
 * pool: { motifName: weight } candidates the director may fire.
 * interval: [min,max] seconds between autonomous motif rolls.
 */
export const STATE_PROFILES = {
  boot: {
    accent: '--state-idle',
    targets: { energy: 0.1, glow: 0.2, coreSpin: 0.05, ringSpinScale: 0.2, ringOpacity: 0.15, particleEnergy: 0.1, scan: 0.1, hudSpin: 0.05, hudOpacity: 0.2 },
    pool: {}, interval: [99, 99],
  },
  idle: {
    accent: '--state-idle',
    targets: { energy: 0.28, glow: 0.45, coreSpin: 0.12, ringSpinScale: 0.6, ringOpacity: 0.55, particleEnergy: 0.3, scan: 0.35, hudSpin: 0.1, hudOpacity: 0.65 },
    pool: { ripple: 1, breathe: 2, scanSweep: 1 }, interval: [3.5, 7],
  },
  wake: {
    accent: '--state-wake',
    targets: { energy: 0.8, glow: 0.9, coreSpin: 0.5, ringSpinScale: 1.6, ringOpacity: 0.9, particleEnergy: 0.8, scan: 0.7, hudSpin: 0.4, hudOpacity: 1 },
    pool: { burst: 3, ripple: 2, spinKick: 2 }, interval: [0.6, 1.2],
  },
  listening: {
    accent: '--state-listening',
    targets: { energy: 0.6, glow: 0.7, coreSpin: 0.28, ringSpinScale: 1.0, ringOpacity: 0.85, particleEnergy: 0.55, scan: 0.6, hudSpin: 0.22, hudOpacity: 0.95 },
    pool: { flutter: 3, ripple: 2 }, interval: [1.2, 2.6],
  },
  thinking: {
    accent: '--state-thinking',
    targets: { energy: 0.75, glow: 0.65, coreSpin: 1.1, ringSpinScale: 2.2, ringOpacity: 0.8, particleEnergy: 0.7, scan: 0.9, hudSpin: 0.7, hudOpacity: 0.95 },
    pool: { spinKick: 3, scanSweep: 3, ripple: 1 }, interval: [0.7, 1.5],
  },
  speaking: {
    accent: '--state-speaking',
    targets: { energy: 0.85, glow: 0.85, coreSpin: 0.4, ringSpinScale: 1.2, ringOpacity: 0.9, particleEnergy: 0.85, scan: 0.7, hudSpin: 0.3, hudOpacity: 1 },
    pool: { pulse: 3, ripple: 2, burst: 1 }, interval: [0.9, 1.8],
  },
  error: {
    accent: '--state-error',
    targets: { energy: 0.5, glow: 0.5, coreSpin: 0.6, ringSpinScale: 0.8, ringOpacity: 0.7, particleEnergy: 0.4, scan: 0.5, hudSpin: 0.2, hudOpacity: 0.8 },
    pool: { glitch: 4 }, interval: [0.4, 0.9],
  },
};

/**
 * Each motif is fn(rng, intensity) -> { mod?, ripple? }
 *   mod    : { dur, shape, fields }  additive modifier (see AnimationDirector)
 *   ripple : { life, strength }      spawns a HUD ripple
 * shapes: 'decay' | 'spike' | 'pulse'
 */
export const MOTIF_LIB = {
  ripple: (rng, k = 1) => ({
    ripple: { life: 1.1 + rng() * 0.7, strength: (0.5 + rng() * 0.5) * k },
  }),

  breathe: (rng, k = 1) => ({
    mod: { dur: 2.4 + rng() * 1.5, shape: 'pulse', fields: { glow: 0.18 * k, coreScale: 0.05 * k } },
  }),

  scanSweep: (rng, k = 1) => ({
    mod: { dur: 1.0 + rng() * 0.6, shape: 'spike', fields: { scan: 0.6 * k, hudOpacity: 0.2 * k } },
  }),

  spinKick: (rng, k = 1) => ({
    mod: { dur: 0.8 + rng() * 0.8, shape: 'decay', fields: { coreSpin: (1 + rng() * 1.5) * k, ringSpinScale: (1 + rng()) * k } },
  }),

  burst: (rng, k = 1) => ({
    mod: { dur: 0.7 + rng() * 0.5, shape: 'spike', fields: { glow: 0.6 * k, particleEnergy: 0.6 * k, coreScale: 0.12 * k } },
    ripple: { life: 1.0, strength: 0.9 * k },
  }),

  pulse: (rng, k = 1) => ({
    mod: { dur: 0.35 + rng() * 0.3, shape: 'spike', fields: { coreScale: 0.14 * k, glow: 0.3 * k } },
  }),

  flutter: (rng, k = 1) => ({
    mod: { dur: 0.5 + rng() * 0.4, shape: 'pulse', fields: { glow: 0.12 * k, ringOpacity: 0.1 * k } },
  }),

  glitch: (rng, k = 1) => ({
    mod: { dur: 0.18 + rng() * 0.18, shape: 'spike', fields: { jitter: (0.6 + rng() * 0.4) * k, coreSpin: rng() * 2 - 1 } },
  }),
};
