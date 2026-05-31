/* Weather widget - mocked data (real API in a future phase). */
const CONDITIONS = ['SERENO', 'POCO NUVOLOSO', 'NUVOLOSO', 'PIOGGIA', 'TEMPORALE', 'NEBBIA'];

export class Weather {
  constructor(root) {
    this.tempEl = root.querySelector('[data-weather-temp]');
    this.descEl = root.querySelector('[data-weather-desc]');
    this.locEl = root.querySelector('[data-weather-loc]');
    this._set();
    // gentle drift every ~30s so it feels live
    this._timer = setInterval(() => this._drift(), 30000);
  }

  _set() {
    this.temp = 14 + Math.round(Math.random() * 16);
    this.cond = CONDITIONS[(Math.random() * CONDITIONS.length) | 0];
    this.tempEl.innerHTML = `${this.temp}&deg;`;
    this.descEl.textContent = this.cond;
    this.locEl.textContent = 'MILANO, IT';
  }

  _drift() {
    this.temp = Math.max(8, Math.min(34, this.temp + (Math.random() < 0.5 ? -1 : 1)));
    this.tempEl.innerHTML = `${this.temp}&deg;`;
  }
}
