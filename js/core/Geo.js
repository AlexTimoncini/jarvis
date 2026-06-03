/* ============================================================
   Geo - requests and caches the device location. Used by future
   features (weather, "near me", etc.). Resolves softly: if the
   user denies or it's unavailable, position stays null.
   ============================================================ */
import { bus } from './EventBus.js';

export class Geo {
  constructor() {
    this.position = null; // { lat, lon, accuracy, ts }
    this.requested = false;
    this.watchId = null;
    this.speed = null;     // m/s from the GPS (null when unknown / desktop)
    this._speedTs = 0;
  }

  /** Ask for the location permission. Safe to call once at startup. */
  request() {
    if (this.requested) return;
    this.requested = true;
    if (!('geolocation' in navigator)) {
      bus.emit('geo:error', { error: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => this._apply(pos),
      (err) => {
        bus.emit('geo:error', { error: err.code === 1 ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
    );
    this._startWatch();
  }

  /** Continuously track position + movement speed (high accuracy for speed). */
  _startWatch() {
    if (this.watchId !== null || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._apply(pos),
      () => { /* keep last known; errors handled by request() */ },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 },
    );
  }

  _apply(pos) {
    this.position = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      ts: Date.now(),
    };
    // coords.speed is m/s (or null on devices without GPS speed).
    if (typeof pos.coords.speed === 'number' && pos.coords.speed >= 0) {
      this.speed = pos.coords.speed;
      this._speedTs = Date.now();
    } else if (Date.now() - this._speedTs > 8000) {
      this.speed = null; // stale: drop it
    }
    bus.emit('geo:position', this.position);
  }

  /** Current speed in km/h (rounded), or null if unknown. */
  speedKmh() {
    if (this.speed === null) return null;
    return Math.max(0, Math.round(this.speed * 3.6));
  }

  get() {
    return this.position;
  }
}
