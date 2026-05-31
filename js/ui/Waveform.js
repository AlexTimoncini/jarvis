/* Waveform widget - audio visualizer reacting to VisualState.level. */
import { visual } from '../core/VisualState.js';
import { rgbToCss, clamp } from '../core/util.js';

export class Waveform {
  constructor(canvas, labelEl) {
    this.canvas = canvas;
    this.label = labelEl;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.bars = 40;
    this.values = new Array(this.bars).fill(0);
    this.phase = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width || 160;
    this.h = r.height || 56;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  update(dt) {
    this.phase += dt * 6;
    const lvl = visual.level;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const mid = this.h / 2;
    const bw = this.w / this.bars;
    ctx.fillStyle = rgbToCss(visual.accent, 0.9);

    for (let i = 0; i < this.bars; i++) {
      // target amplitude: shaped by level + a moving envelope
      const env = Math.sin((i / this.bars) * Math.PI); // taller in the middle
      const wobble = 0.5 + 0.5 * Math.sin(this.phase + i * 0.6);
      const target = lvl * env * wobble + 0.04;
      this.values[i] += (target - this.values[i]) * clamp(dt * 12);
      const a = clamp(this.values[i]);
      const bh = a * (this.h * 0.46);
      const x = i * bw + bw * 0.2;
      const ww = bw * 0.6;
      ctx.globalAlpha = 0.5 + a * 0.5;
      ctx.fillRect(x, mid - bh, ww, bh * 2);
    }
    ctx.globalAlpha = 1;

    if (this.label) {
      this.label.textContent =
        visual.stateName === 'speaking' ? 'AUDIO OUT'
        : visual.stateName === 'listening' ? 'AUDIO IN'
        : 'AUDIO IDLE';
    }
  }
}
