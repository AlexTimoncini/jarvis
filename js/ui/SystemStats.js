/* System stats widget - mocked mem/cpu/pwr with smooth random walk. */
import { clamp } from '../core/util.js';

const pad = (n) => String(n).padStart(2, '0');

export class SystemStats {
  constructor(root) {
    this.bars = {
      mem: root.querySelector('[data-stat-bar="mem"]'),
      cpu: root.querySelector('[data-stat-bar="cpu"]'),
      pwr: root.querySelector('[data-stat-bar="pwr"]'),
    };
    this.vals = {
      mem: root.querySelector('[data-stat-val="mem"]'),
      cpu: root.querySelector('[data-stat-val="cpu"]'),
      pwr: root.querySelector('[data-stat-val="pwr"]'),
    };
    this.uptimeEl = root.querySelector('[data-stat-uptime]');
    this.state = { mem: 0.42, cpu: 0.18, pwr: 0.86 };
    this.start = Date.now();
    this._acc = 0;
  }

  /** energy 0..1 from VisualState nudges cpu so stats react to activity. */
  update(dt, energy = 0) {
    this._acc += dt;
    if (this._acc < 0.5) {
      this._uptime();
      return;
    }
    this._acc = 0;
    const walk = (v, target, amt) => clamp(v + (target - v) * 0.2 + (Math.random() - 0.5) * amt);
    this.state.mem = walk(this.state.mem, 0.45 + energy * 0.25, 0.05);
    this.state.cpu = walk(this.state.cpu, 0.12 + energy * 0.7, 0.08);
    this.state.pwr = walk(this.state.pwr, 0.84, 0.02);
    for (const k of ['mem', 'cpu', 'pwr']) {
      const pct = Math.round(this.state[k] * 100);
      this.bars[k].style.width = `${pct}%`;
      this.vals[k].textContent = `${pct}%`;
    }
    this._uptime();
  }

  _uptime() {
    const s = Math.floor((Date.now() - this.start) / 1000);
    this.uptimeEl.textContent = `UPTIME ${pad((s / 3600) | 0)}:${pad(((s / 60) | 0) % 60)}:${pad(s % 60)}`;
  }
}
