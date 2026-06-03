/* ============================================================
   NeuralTTS - speaks via the PHP proxy (ElevenLabs) and plays
   the returned audio through an AnalyserNode so the sphere can
   react to the REAL voice amplitude. Falls back to the browser
   SpeechSynthesis voice if the network/proxy fails.

   Public surface (compatible with the Assistant's `speech`):
     speak(text, onend)   - always calls onend eventually
     cancel()
     get speaking
     sample(dt) -> 0..1   - current audio level (real or synthetic)
   ============================================================ */
import { clamp } from '../core/util.js';

export class NeuralTTS {
  constructor({ endpoint = './server/tts.php', voiceId = null, fallback = null } = {}) {
    this.endpoint = endpoint;
    this.voiceId = voiceId;
    this.fallback = fallback; // a Speech instance (browser TTS)
    this.ctx = null;
    this.analyser = null;
    this.data = null;
    this.gain = null;

    this.speaking = false;
    this.mode = null;   // 'neural' | 'browser'
    this.level = 0;
    this._phase = 0;
    this._src = null;
  }

  setVoice(id) {
    this.voiceId = id || null;
  }

  /** Create/resume the AudioContext (call from a user gesture). */
  ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!this.ctx) {
      this.ctx = new AC();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      this.gain = this.ctx.createGain();
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  /**
   * @param {string} text
   * @param {Function} onend
   * @param {{cache?:boolean}} opts cache=true only for fixed phrases.
   */
  async speak(text, onend, { cache = false } = {}) {
    this.cancel();
    const phrase = (text || '').trim();
    if (!phrase) { if (onend) onend(); return; }

    try {
      if (!this.ensure()) throw new Error('no AudioContext');
      // On mobile the context can be suspended after a TTS gap; resume it
      // before playback or the neural voice plays silently.
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) { /* noop */ } }

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: phrase, voiceId: this.voiceId, cache }),
      });
      if (!res.ok) throw new Error('tts http ' + res.status);
      // Guard against an HTML/JSON error page (e.g. host interstitial) being
      // decoded as audio: that would silently fail and drop to the default voice.
      const ct = (res.headers.get('Content-Type') || '').toLowerCase();
      if (ct && !/audio|mpeg|octet-stream/.test(ct)) {
        throw new Error('tts non-audio response (' + ct + ')');
      }
      const arr = await res.arrayBuffer();
      if (!arr || arr.byteLength < 256) throw new Error('tts empty audio');
      const audioBuf = await this._decode(arr);

      const src = this.ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(this.analyser);
      src.onended = () => this._finish(onend);
      this._src = src;
      this.mode = 'neural';
      this.speaking = true;
      this._phase = 0;
      src.start();
    } catch (err) {
      console.warn('[NeuralTTS] fallback to browser voice:', err.message);
      this._browserSpeak(phrase, onend);
    }
  }

  /** decodeAudioData with the Safari/iOS callback fallback. */
  _decode(arr) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = (buf) => { if (!settled) { settled = true; resolve(buf); } };
      const no = (e) => { if (!settled) { settled = true; reject(e || new Error('decode failed')); } };
      try {
        const p = this.ctx.decodeAudioData(arr, ok, no);
        if (p && p.then) p.then(ok, no);
      } catch (e) { no(e); }
    });
  }

  _browserSpeak(text, onend) {
    this.mode = 'browser';
    this.speaking = true;
    this._phase = 0;
    if (this.fallback && this.fallback.isSupported) {
      this.fallback.speak(text, () => this._finish(onend));
    } else {
      // no TTS at all: approximate duration then finish
      const ms = Math.min(2200, 500 + text.length * 45);
      setTimeout(() => this._finish(onend), ms);
    }
  }

  _finish(onend) {
    this.speaking = false;
    this.mode = null;
    this.level = 0;
    if (this._src) {
      try { this._src.onended = null; this._src.disconnect(); } catch (e) { /* noop */ }
      this._src = null;
    }
    if (onend) onend();
  }

  /**
   * Pre-cache fixed phrases on the server (no playback). Phrases
   * already cached return instantly with no ElevenLabs cost, so this
   * is safe to call on every startup. Runs sequentially and quietly.
   */
  async warm(phrases = []) {
    for (const text of phrases) {
      const phrase = (text || '').trim();
      if (!phrase) continue;
      try {
        await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: phrase, voiceId: this.voiceId, cache: true }),
        });
      } catch (e) { /* offline / no key: ignore, cached later on demand */ }
    }
  }

  cancel() {
    if (this._src) {
      try { this._src.onended = null; this._src.stop(); this._src.disconnect(); } catch (e) { /* noop */ }
      this._src = null;
    }
    if (this.fallback) this.fallback.cancel();
    this.speaking = false;
    this.mode = null;
    this.level = 0;
  }

  /** Current audio level 0..1 (real RMS for neural, synthetic for browser). */
  sample(dt) {
    if (!this.speaking) { this.level = 0; return 0; }
    if (this.mode === 'neural' && this.analyser) {
      this.analyser.getByteTimeDomainData(this.data);
      let sum = 0;
      for (let i = 0; i < this.data.length; i++) {
        const v = (this.data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.data.length);
      this.level = clamp(this.level + (clamp(rms * 3.4) - this.level) * clamp(dt * 18));
    } else {
      // browser voice gives no amplitude -> synthesize a speech envelope
      this._phase += dt * 9;
      const syl = Math.max(0, Math.sin(this._phase)) * Math.max(0, Math.sin(this._phase * 0.42 + 1));
      this.level = clamp(0.2 + syl * 0.8);
    }
    return this.level;
  }
}
