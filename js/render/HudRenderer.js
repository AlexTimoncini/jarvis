/* ============================================================
   HudRenderer - 2D HUD overlay drawn around the sphere center
   --------------------------------------------------------------
   Concentric dashed/segmented rings, tick scales, a sweeping
   gauge arc, rotating scan beam, expanding ripples and a corner
   reticle. All colors/intensities come from VisualState.
   ============================================================ */
import { visual } from '../core/VisualState.js';
import { TAU, rgbToCss, clamp } from '../core/util.js';
import { dprCap } from '../core/device.js';

export class HudRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = dprCap;
    this.t = 0;
    this.rot = 0;     // segmented ring rotation
    this.scanAngle = 0;
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cx = w / 2;
    this.cy = h / 2;
    this.base = Math.min(w, h) * 0.46;
  }

  _accent(a = 1) { return rgbToCss(visual.accent, a); }
  _accent2(a = 1) { return rgbToCss(visual.accent2, a); }

  update(dt) {
    this.t += dt;
    this.rot += visual.hudSpin * dt;
    this.scanAngle += (0.4 + visual.scan * 1.6) * dt;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.cx, this.cy);

    const op = clamp(visual.hudOpacity, 0, 1.2);
    ctx.globalCompositeOperation = 'lighter';

    this._segmentedRing(this.base * 0.92, 56, op * 0.9);
    this._tickRing(this.base * 1.02, 90, op * 0.55);
    this._gaugeArc(this.base * 0.8, op);
    this._innerDashes(this.base * 0.66, op * 0.7);
    this._scanBeam(this.base * 1.05, op * visual.scan);
    this._ripples(op);
    this._reticle(op * 0.6);

    ctx.restore();
  }

  _segmentedRing(r, segments, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.rotate(this.rot);
    ctx.lineWidth = 2;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * TAU;
      const gap = 0.018;
      // vary segment length to mimic HUD ticks
      const long = i % 6 === 0;
      ctx.beginPath();
      ctx.strokeStyle = this._accent(alpha * (long ? 1 : 0.5));
      ctx.lineWidth = long ? 3 : 1.5;
      const rr = long ? r + 6 : r;
      ctx.arc(0, 0, rr, a0 + gap, a0 + TAU / segments - gap);
      ctx.stroke();
    }
    ctx.restore();
  }

  _tickRing(r, ticks, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.rotate(-this.rot * 0.6);
    ctx.strokeStyle = this._accent(alpha);
    ctx.lineWidth = 1;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * TAU;
      const len = i % 5 === 0 ? 9 : 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(a) * (r + len), Math.sin(a) * (r + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  _gaugeArc(r, alpha) {
    const ctx = this.ctx;
    const sweep = 0.6 + 0.4 * Math.sin(this.t * 0.8);
    ctx.save();
    ctx.rotate(this.rot * 1.4);
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = this._accent2(alpha);
    ctx.beginPath();
    ctx.arc(0, 0, r, -0.2, -0.2 + sweep * 1.6);
    ctx.stroke();
    // opposite shorter arc
    ctx.lineWidth = 2;
    ctx.strokeStyle = this._accent(alpha * 0.8);
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, Math.PI + 0.9);
    ctx.stroke();
    ctx.restore();
  }

  _innerDashes(r, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.rotate(-this.rot * 2.0);
    ctx.strokeStyle = this._accent(alpha);
    ctx.setLineDash([3, 10]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _scanBeam(r, alpha) {
    if (alpha <= 0.01) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.rotate(this.scanAngle);
    const grad = ctx.createLinearGradient(0, 0, r, 0);
    grad.addColorStop(0, this._accent2(alpha * 0.5));
    grad.addColorStop(1, this._accent2(0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, -0.18, 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _ripples(alpha) {
    const ctx = this.ctx;
    for (const rp of visual.ripples) {
      const t = rp.age / rp.life;
      const r = this.base * (0.5 + t * 0.9);
      const a = (1 - t) * rp.strength * alpha;
      ctx.beginPath();
      ctx.strokeStyle = this._accent2(a);
      ctx.lineWidth = 2 * (1 - t) + 0.5;
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    }
  }

  _reticle(alpha) {
    const ctx = this.ctx;
    const r = this.base * 1.12;
    ctx.strokeStyle = this._accent(alpha);
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14);
      ctx.stroke();
      // little bracket
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, TAU);
      ctx.stroke();
    }
  }
}
