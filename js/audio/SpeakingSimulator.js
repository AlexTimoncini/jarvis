/* ============================================================
   SpeakingSimulator - fakes an audio "level" envelope for the
   listening state and for spoken responses that have no real
   audio yet. It is a pure generator: call sample(dt) each frame
   and read the returned 0..1 level (the main loop decides who
   owns the level: real TTS amplitude vs this simulator).
   ============================================================ */
import { clamp } from '../core/util.js';

export class SpeakingSimulator {
  constructor() {
    this.active = false;
    this.mode = 'speaking'; // 'speaking' | 'listening'
    this.t = 0;
    this.level = 0;
  }

  start(mode = 'speaking') {
    this.active = true;
    this.mode = mode;
    this.t = 0;
  }

  stop() {
    this.active = false;
    this.level = 0;
  }

  sample(dt) {
    if (!this.active) { this.level = 0; return 0; }
    this.t += dt;
    let lvl;
    if (this.mode === 'listening') {
      lvl = 0.22 + 0.18 * Math.sin(this.t * 3.1) + Math.random() * 0.12;
    } else {
      const syllable = Math.max(0, Math.sin(this.t * 8.5)) * Math.max(0, Math.sin(this.t * 2.3 + 1));
      const pause = Math.sin(this.t * 0.7) > -0.6 ? 1 : 0.15;
      lvl = (0.18 + syllable * 0.85) * pause + (Math.random() - 0.5) * 0.08;
    }
    this.level = clamp(lvl);
    return this.level;
  }
}
