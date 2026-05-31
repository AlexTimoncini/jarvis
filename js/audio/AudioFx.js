/* ============================================================
   AudioFx - synthesized UI sound effects (no audio assets).
   Built with the Web Audio API. The AudioContext must be
   created/resumed from a user gesture (see ensure()).
   ============================================================ */
export class AudioFx {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  /** Create/resume the context. Call from a user gesture. */
  ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  /** A pitch-swept tone with an attack/decay envelope. */
  _tone({ f0, f1 = f0, dur = 0.18, type = 'sine', gain = 0.2, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Short filtered noise burst (adds "digital" texture). */
  _noise({ dur = 0.12, gain = 0.06, freq = 2200, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  /** Wake word received: bright rising two-tone confirmation. */
  confirm() {
    if (!this.ensure()) return;
    this._tone({ f0: 523, f1: 1046, dur: 0.16, type: 'triangle', gain: 0.22 });
    this._tone({ f0: 784, f1: 1568, dur: 0.22, type: 'sine', gain: 0.16, delay: 0.05 });
    this._noise({ dur: 0.12, gain: 0.05, freq: 3000, delay: 0.02 });
  }

  /** Start of active listening: soft single blip. */
  listenStart() {
    if (!this.ensure()) return;
    this._tone({ f0: 880, f1: 1200, dur: 0.12, type: 'sine', gain: 0.14 });
  }

  /** Command captured: quick descending acknowledgement. */
  ack() {
    if (!this.ensure()) return;
    this._tone({ f0: 1200, f1: 700, dur: 0.14, type: 'triangle', gain: 0.16 });
  }

  /** Error / denied: low buzz. */
  error() {
    if (!this.ensure()) return;
    this._tone({ f0: 220, f1: 110, dur: 0.3, type: 'sawtooth', gain: 0.14 });
  }
}
