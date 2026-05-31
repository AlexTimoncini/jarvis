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
      (pos) => {
        this.position = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: Date.now(),
        };
        bus.emit('geo:position', this.position);
      },
      (err) => {
        bus.emit('geo:error', { error: err.code === 1 ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
    );
  }

  get() {
    return this.position;
  }
}
