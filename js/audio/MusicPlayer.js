/* ============================================================
   MusicPlayer - plays library tracks through an <audio> element
   routed into a Web Audio AnalyserNode (for the bass-reactive
   widget) and publishes track info to the OS / Bluetooth via the
   Media Session API (lock screen, car display, BT headset show
   title + artist, and their transport buttons drive playback).

   Bus events emitted:
     music:started  { artist, title, file }
     music:stopped  {}
     music:ended    {}
     music:next / music:prev   (from BT next/prev buttons)
   ============================================================ */
import { bus } from '../core/EventBus.js';
import { clamp } from '../core/util.js';

export class MusicPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this.ctx = null;
    this.analyser = null;
    this.freq = null;
    this.srcNode = null;
    this.current = null;
    this._bass = 0;
    this._wired = false;
    this._userVolume = 1;  // 0..1 set by the user; ducking multiplies this
    this._ducked = false;

    this.audio.addEventListener('ended', () => {
      this.current = null;
      this._setSessionState('none');
      bus.emit('music:ended', {});
    });
  }

  get playing() {
    return !!this.current && !this.audio.paused && !this.audio.ended;
  }

  /** Build the audio graph + media-session handlers. Call from a gesture. */
  ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !this.ctx) {
      try {
        this.ctx = new AC();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;
        this.freq = new Uint8Array(this.analyser.frequencyBinCount);
        this.srcNode = this.ctx.createMediaElementSource(this.audio);
        this.srcNode.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null; // fall back to plain <audio> playback
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    this._wireSession();
    return true;
  }

  _wireSession() {
    if (this._wired || !('mediaSession' in navigator)) return;
    this._wired = true;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', () => this.resume());
      ms.setActionHandler('pause', () => this.pause());
      ms.setActionHandler('stop', () => this.stop());
      ms.setActionHandler('nexttrack', () => bus.emit('music:next', {}));
      ms.setActionHandler('previoustrack', () => bus.emit('music:prev', {}));
    } catch (e) { /* some actions unsupported: ignore */ }
  }

  /** @param {{artist:string,title:string,file:string}} track */
  play(track) {
    if (!track || !track.file) return false;
    this.ensure();
    this.current = track;
    this.audio.src = track.file;
    const p = this.audio.play();
    if (p && p.catch) p.catch((err) => console.warn('[music] play blocked:', err.message));
    this._setMetadata(track);
    this._setSessionState('playing');
    bus.emit('music:started', track);
    return true;
  }

  /** Lower the volume while JARVIS listens/speaks, restore otherwise. */
  duck(on) {
    this._ducked = !!on;
    this._applyVolume();
  }

  _applyVolume() {
    const v = this._ducked ? this._userVolume * 0.16 : this._userVolume;
    this.audio.volume = clamp(v);
  }

  /** Set the user volume (0..1). @returns {number} the applied volume. */
  setVolume(v) {
    this._userVolume = clamp(v);
    this._applyVolume();
    return this._userVolume;
  }

  /** Nudge the volume by a delta (e.g. +0.2 / -0.2). @returns {number} new volume. */
  bumpVolume(delta) {
    return this.setVolume(this._userVolume + delta);
  }

  get volume() { return this._userVolume; }

  pause() {
    if (!this.current) return;
    this.audio.pause();
    this._setSessionState('paused');
  }

  resume() {
    if (!this.current) return;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    this.audio.play().catch(() => {});
    this._setSessionState('playing');
  }

  stop() {
    const had = !!this.current;
    this.current = null;
    try {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    } catch (e) { /* noop */ }
    this._bass = 0;
    this._setSessionState('none');
    if (had) bus.emit('music:stopped', {});
  }

  _setMetadata(track) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'Sconosciuto',
        artist: track.artist || 'JARVIS',
        album: 'JARVIS',
      });
    } catch (e) { /* noop */ }
  }

  _setSessionState(state) {
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = state; } catch (e) { /* noop */ }
    }
  }

  /** Smoothed bass energy 0..1 (drives the sphere / widget pulse). */
  bassLevel(dt = 0.016) {
    if (!this.analyser || !this.playing) {
      this._bass += (0 - this._bass) * clamp(dt * 6);
      return this._bass;
    }
    this.analyser.getByteFrequencyData(this.freq);
    const n = Math.max(2, (this.freq.length * 0.18) | 0); // low ~18% of bins
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.freq[i];
    const target = clamp((sum / n) / 200);
    this._bass += (target - this._bass) * clamp(dt * 10);
    return this._bass;
  }

  /** Raw frequency bins (for the equalizer), or null if no analyser. */
  freqData() {
    if (!this.analyser || !this.playing) return null;
    this.analyser.getByteFrequencyData(this.freq);
    return this.freq;
  }
}
