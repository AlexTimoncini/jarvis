/* ============================================================
   MusicWidget - "now playing" panel: title + artist text and a
   bass/frequency equalizer drawn from the MusicPlayer analyser.
   ============================================================ */
import { bus } from '../core/EventBus.js';
import { rgbToCss, clamp } from '../core/util.js';
import { visual } from '../core/VisualState.js';
import { dprCap } from '../core/device.js';

export class MusicWidget {
  constructor({ root, canvas, titleEl, artistEl, player }) {
    this.root = root;
    this.canvas = canvas;
    this.titleEl = titleEl;
    this.artistEl = artistEl;
    this.player = player;
    this.ctx = canvas.getContext('2d');
    this.dpr = dprCap;
    this.bars = 28;
    this.values = new Array(this.bars).fill(0);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    bus.on('music:started', (t) => this.setTrack(t));
  }

  setTrack({ artist = '', title = '' } = {}) {
    if (this.titleEl) this.titleEl.textContent = title || 'Brano sconosciuto';
    if (this.artistEl) this.artistEl.textContent = artist || 'JARVIS';
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width || 460;
    this.h = r.height || 64;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  update(dt) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.player || !this.player.playing) return;

    // keep canvas backing size in sync with CSS box once visible
    const r = this.canvas.getBoundingClientRect();
    if (Math.abs(r.width - this.w) > 1 || Math.abs(r.height - this.h) > 1) this.resize();

    const freq = this.player.freqData();
    const bw = this.w / this.bars;
    const col = rgbToCss(visual.accent, 0.85);
    ctx.fillStyle = col;

    const bins = freq ? freq.length : 0;
    for (let i = 0; i < this.bars; i++) {
      let target = 0;
      if (bins) {
        // sample low-to-mid bins (bass forward), log-ish spread
        const idx = Math.min(bins - 1, 1 + ((i * bins * 0.5) / this.bars) | 0);
        target = freq[idx] / 255;
      }
      this.values[i] += (target - this.values[i]) * clamp(dt * 14);
      const a = clamp(this.values[i]);
      const bh = Math.max(2, a * this.h * 0.9);
      const x = i * bw + bw * 0.18;
      const ww = bw * 0.64;
      ctx.globalAlpha = 0.35 + a * 0.65;
      ctx.fillRect(x, this.h - bh, ww, bh);
    }
    ctx.globalAlpha = 1;
  }
}
