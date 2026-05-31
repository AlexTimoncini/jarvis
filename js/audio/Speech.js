/* ============================================================
   Speech - text-to-speech (SpeechSynthesis) with an Italian
   female voice, tuned to sound like a calm assistant.
   ============================================================ */
const FEMALE_HINTS = /(alice|federica|elsa|chiara|carla|bianca|paola|silvia|giulia|donna|female|samantha|google italiano)/i;

export class Speech {
  constructor({ lang = 'it-IT', rate = 1.0, pitch = 1.12, volume = 1.0 } = {}) {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.synth = this.supported ? window.speechSynthesis : null;
    this.lang = lang;
    this.rate = rate;
    this.pitch = pitch;
    this.volume = volume;
    this.voice = null;

    if (this.supported) {
      this._pickVoice();
      // voices load asynchronously in most browsers
      this.synth.addEventListener?.('voiceschanged', () => this._pickVoice());
    }
  }

  get isSupported() {
    return this.supported;
  }

  _pickVoice() {
    const voices = this.synth.getVoices() || [];
    if (!voices.length) return;
    const italian = voices.filter((v) => /^it(\b|[-_])/i.test(v.lang));
    this.voice =
      italian.find((v) => FEMALE_HINTS.test(v.name)) ||
      italian[0] ||
      voices.find((v) => FEMALE_HINTS.test(v.name)) ||
      null;
  }

  /** Italian voices available (for an optional voice picker). */
  listVoices() {
    if (!this.supported) return [];
    return (this.synth.getVoices() || []).filter((v) => /^it(\b|[-_])/i.test(v.lang));
  }

  setVoiceByName(name) {
    const v = (this.synth?.getVoices() || []).find((x) => x.name === name);
    if (v) this.voice = v;
  }

  /**
   * Speak a phrase. `onend` is always called (even when TTS is
   * unsupported or errors) so callers can chain the next step.
   */
  speak(text, onend) {
    const done = () => { if (onend) onend(); };
    if (!this.supported || !text) {
      // approximate the spoken duration so the UX still flows
      setTimeout(done, Math.min(1800, 400 + (text ? text.length : 0) * 45));
      return;
    }
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.lang;
    if (this.voice) u.voice = this.voice;
    u.rate = this.rate;
    u.pitch = this.pitch;
    u.volume = this.volume;
    u.onend = done;
    u.onerror = done;
    this.synth.speak(u);
  }

  cancel() {
    if (this.supported) this.synth.cancel();
  }
}
