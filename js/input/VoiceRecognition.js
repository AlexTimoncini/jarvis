/* ============================================================
   VoiceRecognition - wake word + command capture via the
   Web Speech API (SpeechRecognition). Designed to run ALWAYS:
     mode 'wake'    -> scans transcript for "JARVIS"
     mode 'command' -> captures following speech as the command,
                       finalized after a short silence.

   Robustness: a SINGLE recognition instance is reused. Restarts
   (the browser ends sessions periodically) are guarded with a
   backoff so a failing engine can't spin in a tight loop and make
   the mic icon flicker / freeze the app.

   Emits on the bus:
     voice:status     { state: 'wake'|'off'|'denied' }
     voice:wake       {}
     voice:transcript { text, isFinal, scanning? }
     voice:command    { text }
     voice:error      { error }
   ============================================================ */
import { bus } from '../core/EventBus.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const WAKE = /\b(jarvis|giarvis|jervis|jarvi|jarvys)\b/i;
const SILENCE_MS = 1000;
const MIN_RESTART_MS = 400;   // floor between (re)starts
const MAX_BACKOFF_MS = 4000;  // cap when the engine keeps bailing out

export class VoiceRecognition {
  constructor({ lang = 'it-IT' } = {}) {
    this.supported = !!SR;
    this.lang = lang;
    this.rec = null;
    this.active = false;
    this.held = false;        // paused while JARVIS is speaking
    this.mode = 'wake';
    this.commandText = '';
    this.wakeIndex = 0;
    this.silence = null;

    // Optional matcher: in wake mode, a terse command can be recognized
    // WITHOUT the wake word. Given the latest spoken phrase it returns the
    // command text to execute, or null. Set by the app (see Assistant).
    this.directMatcher = null;

    this._permitted = false;
    this.running = false;     // engine currently listening
    this.starting = false;    // start() called, awaiting onstart
    this._lastStart = 0;
    this._quickEnds = 0;      // consecutive immediate onend -> backoff
    this._restartTimer = null;

    // While music is actively playing, wake-word scanning is SUSPENDED. The
    // Web Speech engine ends/restarts every couple of seconds and each restart
    // re-grabs the audio session, which would stutter the music. Suspending it
    // lets playback run uninterrupted; tap the sphere/mic to talk (that path
    // captures a command and ducks the music cleanly). Scanning resumes when
    // the music stops or pauses.
    this.musicPlaying = false;
  }

  get isSupported() {
    return this.supported;
  }

  /**
   * Provide a function that, given the latest spoken phrase, returns a terse
   * command to run immediately (without the wake word), or null. Enables
   * hands-free quick commands while idle/scanning.
   */
  setDirectMatcher(fn) {
    this.directMatcher = typeof fn === 'function' ? fn : null;
  }

  /**
   * Explicitly ask for microphone access. Surfaces a clear browser
   * prompt and distinguishes "blocked" from "insecure origin".
   * @returns {Promise<boolean>}
   */
  async _ensurePermission() {
    if (this._permitted) return true;
    if (!window.isSecureContext) {
      bus.emit('voice:error', { error: 'insecure-origin' });
      return false;
    }
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      this._permitted = true; // let SpeechRecognition try and report itself
      return true;
    }
    try {
      const stream = await md.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      this._permitted = true;
      return true;
    } catch (err) {
      bus.emit('voice:error', { error: 'not-allowed' });
      return false;
    }
  }

  async start() {
    if (!this.supported) {
      bus.emit('voice:error', { error: 'unsupported' });
      return false;
    }
    if (this.active) return true;
    const ok = await this._ensurePermission();
    if (!ok) {
      this.active = false;
      bus.emit('voice:status', { state: 'denied' });
      return false;
    }
    this.active = true;
    this.held = false;
    this.mode = 'wake';
    this._startRec();
    bus.emit('voice:status', { state: 'wake' });
    return true;
  }

  stop() {
    this.active = false;
    this.mode = 'wake';
    this._resetEngine(); // fully tear down so the next start() is clean
    bus.emit('voice:status', { state: 'off' });
  }

  async toggle() {
    if (this.active) { this.stop(); return false; }
    return this.start();
  }

  /** Lazily build the single recognition instance. */
  _ensureRec() {
    if (this.rec) return this.rec;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => { this.running = true; this.starting = false; };
    rec.onresult = (e) => this._onResult(e);
    rec.onerror = (e) => {
      bus.emit('voice:error', { error: e.error });
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this._permitted = false;
        this.active = false;
        clearTimeout(this._restartTimer);
        bus.emit('voice:status', { state: 'denied' });
      }
      // other errors (no-speech, network, aborted): onend handles restart
    };
    rec.onend = () => {
      this.running = false;
      this.starting = false;
      // detect rapid end -> back off so we never hammer the engine
      if (performance.now() - this._lastStart < 500) {
        this._quickEnds = Math.min(this._quickEnds + 1, 6);
      } else {
        this._quickEnds = 0;
      }
      this._scheduleRestart();
    };
    this.rec = rec;
    return rec;
  }

  /** Start listening if we should and aren't already. */
  _startRec() {
    if (!this.active || this.held) return;
    // Keep the engine OFF while music plays and we're only scanning for the
    // wake word, so the mic never re-grabs the audio session and interrupts
    // playback. Command capture (mode 'command', after a tap/wake) is allowed.
    if (this.musicPlaying && this.mode === 'wake') return;
    if (this.running || this.starting) return;
    const rec = this._ensureRec();
    this.starting = true;
    this._lastStart = performance.now();
    try {
      rec.start();
    } catch (err) {
      // "already started" or transient: clear flag and reschedule
      this.starting = false;
      this._scheduleRestart();
    }
  }

  /** Schedule a guarded restart (respects active/held + backoff). */
  _scheduleRestart() {
    clearTimeout(this._restartTimer);
    if (!this.active || this.held) return;
    if (this.musicPlaying && this.mode === 'wake') return; // suspended during playback
    const base = MIN_RESTART_MS + this._quickEnds * 500;
    const delay = Math.min(base, MAX_BACKOFF_MS);
    this._restartTimer = setTimeout(() => this._startRec(), delay);
  }

  /**
   * Track whether music is actively playing. While it is, suspend wake-word
   * scanning (stop the engine if it's mid wake-scan) so playback isn't
   * interrupted; an in-progress command capture keeps going. When playback
   * stops or pauses, resume always-on scanning.
   */
  setMusicPlaying(on) {
    const was = this.musicPlaying;
    this.musicPlaying = !!on;
    if (!this.active || this.held) return;
    if (this.musicPlaying) {
      if (this.mode === 'wake') {
        clearTimeout(this._restartTimer);
        if (this.rec) { try { this.rec.stop(); } catch (e) { /* noop */ } }
      }
    } else if (was && this.mode === 'wake') {
      this._quickEnds = 0;
      this._startRec();
    }
  }

  /** Pause recognition (e.g. while JARVIS speaks) to avoid self-hearing. */
  hold() {
    if (!this.active) return;
    this.held = true;
    this._clearSilence();
    clearTimeout(this._restartTimer);
    this.mode = 'wake';
    if (this.rec) {
      try { this.rec.stop(); } catch (e) { /* noop */ }
    }
  }

  /** Resume scanning for the wake word after a hold. */
  resumeWake() {
    if (!this.active) return;
    this.held = false;
    this.mode = 'wake';
    this.wakeIndex = 0;
    this.commandText = '';
    this._quickEnds = 0;
    this._startRec();
  }

  /**
   * Tear down the current recognition instance so the next start() gets a
   * brand-new engine. SpeechRecognition can wedge on mobile (the mic is
   * "lost" and never restarts); recreating it reliably reacquires it.
   */
  _resetEngine() {
    clearTimeout(this._restartTimer);
    this._clearSilence();
    if (this.rec) {
      try { this.rec.onstart = this.rec.onresult = this.rec.onerror = this.rec.onend = null; } catch (e) { /* noop */ }
      try { this.rec.abort(); } catch (e) { /* noop */ }
      try { this.rec.stop(); } catch (e) { /* noop */ }
    }
    this.rec = null;
    this.running = false;
    this.starting = false;
    this._quickEnds = 0;
  }

  /**
   * Resume directly capturing a command (no wake word needed). Always
   * rebuilds the engine so the mic is (re)acquired even if it was lost,
   * and re-prompts for permission if voice was off.
   * @param {number} grace ms to wait for the user to START speaking.
   */
  async resumeCommand(grace = 5000) {
    this.held = false;
    this.mode = 'command';
    this.wakeIndex = 0;
    this.commandText = '';
    this._resetEngine();
    if (!this.active) {
      const ok = await this._ensurePermission();
      if (!ok) { bus.emit('voice:status', { state: 'denied' }); return; }
      this.active = true;
      bus.emit('voice:status', { state: 'wake' });
    }
    this.mode = 'command';
    this._startRec();
    this._armSilence(grace);
  }

  _onResult(e) {
    if (this.held) return; // ignore anything captured while paused
    let full = '';
    for (let i = 0; i < e.results.length; i++) full += e.results[i][0].transcript + ' ';
    full = full.trim();
    const lower = full.toLowerCase();
    // latest spoken segment (best signal for an isolated terse command)
    const last = e.results.length ? (e.results[e.results.length - 1][0].transcript || '').trim() : '';

    if (this.mode === 'wake') {
      // Terse offline commands (no wake word needed), matched on the last phrase.
      if (this.directMatcher && last) {
        const direct = this.directMatcher(last);
        if (direct) {
          this._clearSilence();
          this.commandText = '';
          bus.emit('voice:command', { text: direct });
          if (this.rec) { try { this.rec.abort(); } catch (e2) { /* noop */ } }
          return;
        }
      }
      const m = lower.match(WAKE);
      if (m) {
        this.mode = 'command';
        this.wakeIndex = lower.indexOf(m[0]) + m[0].length;
        this.commandText = this._clean(full.slice(this.wakeIndex));
        bus.emit('voice:wake', {});
        bus.emit('voice:transcript', { text: this.commandText, isFinal: false });
        this._armSilence();
      } else {
        bus.emit('voice:transcript', { text: full, isFinal: false, scanning: true });
      }
    } else {
      this.commandText = this._clean(full.slice(this.wakeIndex));
      bus.emit('voice:transcript', { text: this.commandText, isFinal: false });
      this._armSilence();
    }
  }

  /**
   * Clean the captured command: the recognizer often splits "jarvis"
   * into "jarvi s", leaving an orphan leading "s" (or stray punctuation).
   */
  _clean(text) {
    return text
      .replace(/^[\s.,;:!?'"-]+/, '')
      .replace(/^s\b[\s.,;:!?]*/i, '')
      .replace(/^[\s.,;:!?'"-]+/, '')
      .trim();
  }

  _armSilence(ms = SILENCE_MS) {
    this._clearSilence();
    this.silence = setTimeout(() => this._finalize(), ms);
  }

  _clearSilence() {
    if (this.silence) {
      clearTimeout(this.silence);
      this.silence = null;
    }
  }

  _finalize() {
    this._clearSilence();
    if (this.mode !== 'command') return;
    const text = (this.commandText || '').trim();
    this.mode = 'wake';
    this.commandText = '';
    this.wakeIndex = 0;
    bus.emit('voice:transcript', { text, isFinal: true });
    bus.emit('voice:command', { text });
    // The Assistant will hold() then resume() us; clear the buffer so the
    // next session starts clean.
    if (this.rec) {
      try { this.rec.abort(); } catch (e) { /* noop */ }
    }
  }
}
