/* ============================================================
   Weather widget - real data from Open-Meteo (no API key needed),
   located via the device GPS (Geo). Updates the HUD widget and
   exposes report(when) so the assistant can speak the forecast.
   Falls back gracefully when there's no position yet.
   ============================================================ */
import { bus } from '../core/EventBus.js';

const API = 'https://api.open-meteo.com/v1/forecast';

/** WMO weather code -> Italian description. */
const WMO = {
  0: 'sereno', 1: 'prevalentemente sereno', 2: 'parzialmente nuvoloso', 3: 'nuvoloso',
  45: 'nebbia', 48: 'nebbia con brina',
  51: 'pioggerella leggera', 53: 'pioggerella', 55: 'pioggerella intensa',
  56: 'pioggerella gelata', 57: 'pioggerella gelata intensa',
  61: 'pioggia leggera', 63: 'pioggia', 65: 'pioggia forte',
  66: 'pioggia gelata', 67: 'pioggia gelata forte',
  71: 'neve leggera', 73: 'neve', 75: 'neve abbondante', 77: 'nevischio',
  80: 'rovesci leggeri', 81: 'rovesci', 82: 'rovesci violenti',
  85: 'rovesci di neve', 86: 'rovesci di neve forti',
  95: 'temporale', 96: 'temporale con grandine', 99: 'temporale con forte grandine',
};
const descFor = (code) => WMO[code] ?? 'condizioni variabili';

export class Weather {
  constructor(root, geo = null) {
    this.tempEl = root.querySelector('[data-weather-temp]');
    this.descEl = root.querySelector('[data-weather-desc]');
    this.locEl = root.querySelector('[data-weather-loc]');
    this.geo = geo;
    this._cache = null;   // { ts, data, lat, lon }
    this._loading = null; // in-flight promise

    this.tempEl.innerHTML = '--&deg;';
    this.descEl.textContent = 'IN ATTESA GPS';
    this.locEl.textContent = '--';

    // Refresh the widget as soon as we get a fix (and once more if it moves).
    bus.on('geo:position', () => { this._refreshWidget(); });
  }

  /** Fetch (cached ~10 min) the forecast for the current position. */
  async _fetch() {
    const pos = this.geo && this.geo.get();
    if (!pos) return null;
    const fresh = this._cache
      && (Date.now() - this._cache.ts < 600000)
      && Math.abs(this._cache.lat - pos.lat) < 0.05
      && Math.abs(this._cache.lon - pos.lon) < 0.05;
    if (fresh) return this._cache.data;
    if (this._loading) return this._loading;

    const url = `${API}?latitude=${pos.lat}&longitude=${pos.lon}`
      + '&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,apparent_temperature'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + '&timezone=auto&forecast_days=4';

    this._loading = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) this._cache = { ts: Date.now(), data, lat: pos.lat, lon: pos.lon };
        return data;
      })
      .catch(() => null)
      .finally(() => { this._loading = null; });
    return this._loading;
  }

  /** Update the HUD widget with current conditions. */
  async _refreshWidget() {
    const data = await this._fetch();
    if (!data || !data.current) return;
    const c = data.current;
    const t = Math.round(c.temperature_2m);
    this.tempEl.innerHTML = `${t}&deg;`;
    this.descEl.textContent = descFor(c.weather_code).toUpperCase();
    const pos = this.geo && this.geo.get();
    if (pos) this.locEl.textContent = `${pos.lat.toFixed(2)}, ${pos.lon.toFixed(2)}`;
  }

  /**
   * Spoken forecast for "today" | "tomorrow" | "week".
   * @returns {Promise<string|null>} a ready-to-speak phrase, or null if no data.
   */
  async report(when = 'today') {
    const data = await this._fetch();
    if (!data) return null;
    this._refreshWidget();

    const daily = data.daily || {};
    const days = Array.isArray(daily.time) ? daily.time : [];

    if (when === 'tomorrow' && days.length > 1) {
      const i = 1;
      const desc = descFor(daily.weather_code[i]);
      const max = Math.round(daily.temperature_2m_max[i]);
      const min = Math.round(daily.temperature_2m_min[i]);
      const p = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null;
      const rain = (p != null && p >= 20) ? `, probabilità di pioggia ${p}%` : '';
      return `Domani ${desc}, tra ${min} e ${max} gradi${rain}, Signore.`;
    }

    if (when === 'week' && days.length > 1) {
      const names = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
      const parts = [];
      for (let i = 1; i < Math.min(days.length, 4); i++) {
        const d = new Date(days[i] + 'T12:00');
        const label = i === 1 ? 'domani' : names[d.getDay()];
        parts.push(`${label} ${descFor(daily.weather_code[i])}, massima ${Math.round(daily.temperature_2m_max[i])}`);
      }
      return `Previsioni: ${parts.join('; ')} gradi, Signore.`;
    }

    // today (default) — use current conditions + today's range
    const c = data.current || {};
    const t = Math.round(c.temperature_2m);
    const feels = Math.round(c.apparent_temperature ?? c.temperature_2m);
    const desc = descFor(c.weather_code);
    let range = '';
    if (days.length) {
      range = `, massima ${Math.round(daily.temperature_2m_max[0])} e minima ${Math.round(daily.temperature_2m_min[0])} gradi`;
    }
    const feelsClause = Math.abs(feels - t) >= 2 ? `, percepiti ${feels}` : '';
    return `Attualmente ${t} gradi${feelsClause}, ${desc}${range}, Signore.`;
  }
}
