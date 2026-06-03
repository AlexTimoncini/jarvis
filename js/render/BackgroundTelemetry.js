/* ============================================================
   BackgroundTelemetry - JARVIS-style side telemetry behind the
   sphere. Two tidy vertical columns (left/right) of varied
   modules - numeric readouts, a radial gauge, horizontal bars,
   a vertical "flux" meter and a scrolling sparkline - linked by
   a vertical bus line with a travelling pulse. Faint, decorative.
   ============================================================ */
import { visual } from '../core/VisualState.js';
import { rgbToCss, clamp, TAU } from '../core/util.js';
import { dprCap } from '../core/device.js';

const FONT = '"Share Tech Mono", monospace';
const metric = (label, unit, min, max, dec) => ({
  label, unit, min, max, dec, v: (min + max) / 2, t: min + Math.random() * (max - min),
});

export class BackgroundTelemetry {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = dprCap;
    this.time = 0;
    this.acc = 0;

    this.columns = [
      {
        side: 'left',
        modules: [
          { type: 'readout', title: 'REACTOR', metrics: [
            metric('OUTPUT', 'GW', 2.4, 3.9, 2),
            metric('CORE TMP', 'C', 31, 48, 0),
            metric('FLUX', 'mT', 110, 240, 0),
            metric('STABILITY', '%', 92, 100, 0),
          ] },
          { type: 'vmeter', title: 'ENERGY FLUX',
            bars: Array.from({ length: 11 }, () => ({ v: Math.random(), t: Math.random() })) },
          { type: 'spark', title: 'NET TRAFFIC', metric: metric('I/O', 'Mb', 0.2, 18, 1), hist: [] },
        ],
      },
      {
        side: 'right',
        modules: [
          { type: 'gauge', title: 'POWER', metric: metric('', '%', 74, 99, 0) },
          { type: 'bars', title: 'SYSTEM', metrics: [
            metric('MEM', '%', 38, 72, 0),
            metric('CPU', '%', 8, 66, 0),
            metric('GPU', '%', 12, 80, 0),
          ] },
          { type: 'readout', title: 'DIAGNOSTIC', metrics: [
            metric('UPLINK', '%', 88, 100, 0),
            metric('SHIELD', '%', 80, 100, 0),
            metric('SIGNAL', 'dB', -64, -28, 0),
            metric('THRML', 'C', 24, 40, 0),
          ] },
        ],
      },
    ];

    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const marginX = w * 0.035;
    const colW = Math.max(118, Math.min(w * 0.34, 240));
    const moduleH = Math.max(74, h * 0.18);
    const rowY = [h * 0.155, h * 0.405, h * 0.655];

    for (const col of this.columns) {
      const x0 = col.side === 'left' ? marginX : (w - marginX - colW);
      col.x0 = x0;
      col.colW = colW;
      col.spineX = col.side === 'left' ? x0 : x0 + colW;
      col.modules.forEach((m, i) => { m.box = { x: x0, y: rowY[i], w: colW, h: moduleH }; });
    }
  }

  update(dt) {
    this.time += dt;
    this.acc += dt;
    const retarget = this.acc > 1.3;
    if (retarget) this.acc = 0;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    const alpha = 0.30 + visual.energy * 0.26;

    for (const col of this.columns) {
      this._spine(col, alpha * 0.6);
      for (const m of col.modules) {
        this._advance(m, dt, retarget);
        this._frame(m.box, m.title, alpha);
        const fn = this['_' + m.type];
        if (fn) fn.call(this, m, alpha);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _advance(m, dt, retarget) {
    const step = (mt) => {
      if (retarget && Math.random() < 0.7) mt.t = mt.min + Math.random() * (mt.max - mt.min);
      mt.v += (mt.t - mt.v) * clamp(dt * 1.3);
    };
    if (m.metrics) m.metrics.forEach(step);
    if (m.metric) step(m.metric);
    if (m.bars) m.bars.forEach((b) => {
      if (retarget) b.t = Math.random();
      b.v += (b.t - b.v) * clamp(dt * 4);
    });
    if (m.type === 'spark') {
      const mt = m.metric;
      m.hist.push((mt.v - mt.min) / (mt.max - mt.min));
      if (m.hist.length > 40) m.hist.shift();
    }
  }

  /* ---------------- drawing ---------------- */
  _frame(box, title, alpha) {
    const ctx = this.ctx;
    const { x, y, w, h } = box;
    const k = 12;
    ctx.strokeStyle = rgbToCss(visual.accent, alpha * 0.9);
    ctx.lineWidth = 1.2;
    const corner = (cx, cy, sx, sy) => {
      ctx.beginPath();
      ctx.moveTo(cx + sx * k, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * k);
      ctx.stroke();
    };
    corner(x, y, 1, 1);
    corner(x + w, y, -1, 1);
    corner(x, y + h, 1, -1);
    corner(x + w, y + h, -1, -1);

    ctx.fillStyle = rgbToCss(visual.accent2, alpha * 1.2);
    ctx.font = `700 10px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(title, x + 6, y + 13);
    ctx.strokeStyle = rgbToCss(visual.accent, alpha * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 17);
    ctx.lineTo(x + w - 6, y + 17);
    ctx.stroke();
  }

  _readout(m, alpha) {
    const ctx = this.ctx;
    const { x, y, w, h } = m.box;
    const top = y + 30;
    const rh = (h - 36) / m.metrics.length;
    ctx.textBaseline = 'middle';
    m.metrics.forEach((mt, i) => {
      const ry = top + rh * i + rh * 0.5;
      ctx.textAlign = 'left';
      ctx.fillStyle = rgbToCss(visual.accent, alpha * 0.85);
      ctx.font = `9px ${FONT}`;
      ctx.fillText(mt.label, x + 8, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = rgbToCss(visual.accent2, alpha * 1.15);
      ctx.font = `700 11px ${FONT}`;
      ctx.fillText(`${mt.v.toFixed(mt.dec)}${mt.unit ? ' ' + mt.unit : ''}`, x + w - 8, ry);
    });
  }

  _bars(m, alpha) {
    const ctx = this.ctx;
    const { x, y, w, h } = m.box;
    const top = y + 30;
    const rh = (h - 36) / m.metrics.length;
    ctx.textBaseline = 'middle';
    m.metrics.forEach((mt, i) => {
      const ry = top + rh * i + rh * 0.5;
      const f = (mt.v - mt.min) / (mt.max - mt.min);
      ctx.textAlign = 'left';
      ctx.fillStyle = rgbToCss(visual.accent, alpha * 0.8);
      ctx.font = `9px ${FONT}`;
      ctx.fillText(mt.label, x + 8, ry);
      const bx = x + 44;
      const bw = w - 44 - 40;
      const bh = 5;
      ctx.strokeStyle = rgbToCss(visual.accent, alpha * 0.4);
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, ry - bh / 2, bw, bh);
      ctx.fillStyle = rgbToCss(visual.accent2, alpha * 1.1);
      ctx.fillRect(bx, ry - bh / 2, bw * clamp(f), bh);
      ctx.textAlign = 'right';
      ctx.fillStyle = rgbToCss(visual.accent2, alpha);
      ctx.fillText(`${mt.v.toFixed(0)}%`, x + w - 6, ry);
    });
  }

  _vmeter(m, alpha) {
    const ctx = this.ctx;
    const { x, y, w, h } = m.box;
    const top = y + 28;
    const bottom = y + h - 10;
    const area = bottom - top;
    const n = m.bars.length;
    const gap = 4;
    const bw = (w - 16 - gap * (n - 1)) / n;
    m.bars.forEach((b, i) => {
      const bx = x + 8 + i * (bw + gap);
      const bh = clamp(b.v) * area;
      ctx.strokeStyle = rgbToCss(visual.accent, alpha * 0.3);
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, top, bw, area);
      ctx.fillStyle = rgbToCss(visual.accent2, alpha * (0.5 + b.v * 0.6));
      ctx.fillRect(bx, bottom - bh, bw, bh);
    });
  }

  _spark(m, alpha) {
    const ctx = this.ctx;
    const { x, y, w, h } = m.box;
    const top = y + 30;
    const bottom = y + h - 22;
    const area = bottom - top;
    const left = x + 8;
    const right = x + w - 8;
    const hist = m.hist;
    if (hist.length > 1) {
      ctx.strokeStyle = rgbToCss(visual.accent2, alpha * 1.1);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach((f, i) => {
        const px = left + (right - left) * (i / (hist.length - 1));
        const py = bottom - clamp(f) * area;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();
      ctx.lineTo(right, bottom);
      ctx.lineTo(left, bottom);
      ctx.closePath();
      ctx.fillStyle = rgbToCss(visual.accent, alpha * 0.18);
      ctx.fill();
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgbToCss(visual.accent2, alpha);
    ctx.font = `700 10px ${FONT}`;
    ctx.fillText(`${m.metric.v.toFixed(m.metric.dec)} ${m.metric.unit}`, x + w - 8, y + h - 8);
  }

  _gauge(m, alpha) {
    const ctx = this.ctx;
    const { x, y, w, h } = m.box;
    const cx = x + w / 2;
    const cy = y + 30 + (h - 30) / 2;
    const r = Math.min(w, h - 30) * 0.32;
    const f = (m.metric.v - m.metric.min) / (m.metric.max - m.metric.min);
    const A0 = -Math.PI * 0.7;
    const span = Math.PI * 1.4;

    ctx.lineWidth = 4;
    ctx.strokeStyle = rgbToCss(visual.accent, alpha * 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy, r, A0, A0 + span);
    ctx.stroke();

    ctx.strokeStyle = rgbToCss(visual.accent2, alpha * 1.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, A0, A0 + span * clamp(f));
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.strokeStyle = rgbToCss(visual.accent, alpha * 0.5);
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const a = A0 + span * (i / 10);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
      ctx.lineTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8));
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgbToCss(visual.accent2, alpha * 1.3);
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(`${m.metric.v.toFixed(0)}%`, cx, cy);
  }

  _spine(col, alpha) {
    const ctx = this.ctx;
    const x = col.spineX;
    const sign = col.side === 'left' ? -1 : 1;
    const sx = x + sign * 7;
    const top = col.modules[0].box.y;
    const bot = col.modules[2].box.y + col.modules[2].box.h;

    ctx.strokeStyle = rgbToCss(visual.accent, alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, top);
    ctx.lineTo(sx, bot);
    ctx.stroke();

    ctx.fillStyle = rgbToCss(visual.accent2, alpha * 1.4);
    for (const m of col.modules) {
      const my = m.box.y + m.box.h / 2;
      ctx.beginPath();
      ctx.arc(sx, my, 2, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx, my);
      ctx.lineTo(x, my);
      ctx.stroke();
    }

    const p = (this.time * 0.18) % 1;
    const py = top + (bot - top) * p;
    ctx.beginPath();
    ctx.arc(sx, py, 1.8, 0, TAU);
    ctx.fill();
  }
}
