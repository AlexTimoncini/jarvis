/* ============================================================
   AnimationDirector
   --------------------------------------------------------------
   The "brain" that decides how JARVIS animates. It:
   - damps the VisualState toward the current state's profile,
   - layers transient modifiers (from motifs) additively,
   - applies live audio "level" reactivity,
   - AUTONOMOUSLY composes motif sequences (seeded RNG) so the
     animation feels alive and self-directed,
   - resolves the accent color and publishes it to CSS vars.

   In the future a server/AI can call applyCommand({...}) with the
   documented JSON schema; today the same path is driven by the
   state machine + debug panel + the autonomous composer.
   ============================================================ */
import { bus } from './EventBus.js';
import { visual } from './VisualState.js';
import { STATE_PROFILES, MOTIF_LIB } from './motifs.js';
import { clamp, damp, mulberry32, weightedPick, hexToRgb, mixRgb } from './util.js';

const ADDITIVE_FIELDS = [
  'glow', 'coreScale', 'coreSpin', 'ringSpinScale',
  'ringOpacity', 'particleEnergy', 'scan', 'hudOpacity', 'jitter',
];

export class AnimationDirector {
  constructor() {
    this.profile = STATE_PROFILES.boot;
    this.base = { ...STATE_PROFILES.boot.targets };
    this.mods = [];
    this.ripples = visual.ripples;

    this.level = 0;             // external audio level (0..1)
    this.targetAccent = hexToRgb('#00e5ff');

    this.seed = (Math.random() * 1e9) | 0;
    this.rng = mulberry32(this.seed);
    this.nextRoll = 1.5;

    // base ring directions (signs), scaled by ringSpinScale
    this._ringDirs = [0.25, -0.18, 0.32];

    bus.on('state:change', (e) => this.onStateChange(e));
  }

  /** Resolve a CSS custom property (e.g. '--state-idle') to {r,g,b}. */
  _resolveAccent(varName) {
    const css = getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim() || '#00e5ff';
    return hexToRgb(css);
  }

  onStateChange({ to, config }) {
    this.profile = STATE_PROFILES[to] || STATE_PROFILES.idle;
    visual.stateName = to;

    // accent target + DOM CSS vars
    this.targetAccent = this._resolveAccent(this.profile.accent);
    const a = this.targetAccent;
    const a2 = mixRgb(a, { r: 255, g: 255, b: 255 }, 0.4);
    const root = document.documentElement.style;
    root.setProperty('--accent', `rgb(${a.r | 0}, ${a.g | 0}, ${a.b | 0})`);
    root.setProperty('--accent-2', `rgb(${a2.r | 0}, ${a2.g | 0}, ${a2.b | 0})`);
    root.setProperty('--accent-rgb', `${a.r | 0}, ${a.g | 0}, ${a.b | 0}`);

    // a signature motif fires immediately on entering certain states
    const opener = { wake: 'burst', error: 'glitch', speaking: 'pulse', thinking: 'spinKick' }[to];
    if (opener) this.fire(opener, 1);

    this.nextRoll = this._rollInterval();
  }

  _rollInterval() {
    const [lo, hi] = this.profile.interval;
    return lo + this.rng() * (hi - lo);
  }

  /** Fire a named motif now (used by composer, debug, openers). */
  fire(name, intensity = 1) {
    const factory = MOTIF_LIB[name];
    if (!factory) return;
    const out = factory(this.rng, intensity);
    if (out.mod) this.mods.push({ ...out.mod, age: 0 });
    if (out.ripple) this.pushRipple(out.ripple.strength, out.ripple.life);
    bus.emit('director:fire', { name, intensity });
  }

  pushRipple(strength = 0.8, life = 1.1) {
    this.ripples.push({ age: 0, life, strength });
    if (this.ripples.length > 24) this.ripples.shift();
  }

  /** Autonomous selection: the "AI" picks a motif from the state pool. */
  _compose(dt) {
    this.nextRoll -= dt;
    if (this.nextRoll > 0) return;
    const pool = this.profile.pool;
    const name = weightedPick(this.rng, pool);
    if (name) this.fire(name, 0.7 + this.rng() * 0.5);
    // occasionally chain a second motif for richer behavior
    if (this.rng() < 0.25) {
      const second = weightedPick(this.rng, pool);
      if (second) this.fire(second, 0.5 + this.rng() * 0.4);
    }
    this.nextRoll = this._rollInterval();
  }

  /**
   * Apply an external command (future AI / server path).
   * @param {{state?:string, intensity?:number, accent?:string,
   *          motifs?:string[], seed?:number}} cmd
   */
  applyCommand(cmd = {}) {
    if (typeof cmd.seed === 'number') {
      this.seed = cmd.seed | 0;
      this.rng = mulberry32(this.seed);
    }
    if (cmd.accent) {
      this.targetAccent = hexToRgb(cmd.accent);
    }
    const k = typeof cmd.intensity === 'number' ? cmd.intensity : 1;
    (cmd.motifs || []).forEach((m) => this.fire(m, k));
  }

  setLevel(v) {
    this.level = clamp(v);
  }

  _envelope(mod) {
    const t = clamp(mod.age / mod.dur);
    switch (mod.shape) {
      case 'spike': return t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      case 'pulse': return Math.sin(Math.PI * t);
      default:      return (1 - t) * (1 - t); // decay (ease-out)
    }
  }

  update(dt) {
    const targets = this.profile.targets;

    // 1) damp base toward profile targets
    for (const key in targets) {
      this.base[key] = damp(this.base[key] ?? targets[key], targets[key], 3.0, dt);
    }

    // 2) accumulate transient modifiers
    const add = {};
    for (const f of ADDITIVE_FIELDS) add[f] = 0;
    for (let i = this.mods.length - 1; i >= 0; i--) {
      const mod = this.mods[i];
      mod.age += dt;
      if (mod.age >= mod.dur) { this.mods.splice(i, 1); continue; }
      const env = this._envelope(mod);
      for (const f in mod.fields) add[f] = (add[f] || 0) + mod.fields[f] * env;
    }

    // 3) autonomous composition
    if (this.profile.pool && Object.keys(this.profile.pool).length) this._compose(dt);

    // 4) live audio reactivity (speaking / listening)
    const lvl = damp(visual.level, this.level, 14, dt);
    visual.level = lvl;
    const react = (visual.stateName === 'speaking' || visual.stateName === 'listening') ? lvl : 0;

    // 5) write final values into visual
    visual.energy = clamp(this.base.energy + add.glow * 0.3);
    visual.glow = clamp(this.base.glow + add.glow + react * 0.5);
    visual.coreScale = 1 + add.coreScale + react * 0.16;
    visual.coreSpin = this.base.coreSpin + add.coreSpin;
    visual.particleEnergy = clamp(this.base.particleEnergy + add.particleEnergy + react * 0.4);
    visual.ringOpacity = clamp(this.base.ringOpacity + add.ringOpacity);
    visual.scan = clamp(this.base.scan + add.scan);
    visual.hudOpacity = clamp(this.base.hudOpacity + add.hudOpacity, 0, 1.2);
    visual.jitter = clamp(add.jitter);

    const spinScale = this.base.ringSpinScale + add.ringSpinScale;
    visual.ringSpin = this._ringDirs.map((d) => d * spinScale);
    visual.hudSpin = this.base.hudSpin;

    // 6) accent color easing
    visual.accent = mixRgb(visual.accent, this.targetAccent, clamp(dt * 4));
    visual.accent2 = mixRgb(visual.accent, { r: 255, g: 255, b: 255 }, 0.4);

    // 7) age ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      if (r.age >= r.life) this.ripples.splice(i, 1);
    }
  }
}
