/* Clock widget - time + date (Italian, uppercase). */
const DAYS = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];
const MONTHS = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];

const pad = (n) => String(n).padStart(2, '0');

export class Clock {
  constructor(root) {
    this.timeEl = root.querySelector('[data-clock-time]');
    this.secEl = root.querySelector('[data-clock-sec]');
    this.dateEl = root.querySelector('[data-clock-date]');
    this._last = -1;
  }

  update() {
    const d = new Date();
    const sec = d.getSeconds();
    if (sec === this._last) return; // throttle to 1Hz
    this._last = sec;
    this.timeEl.firstChild.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    this.secEl.textContent = pad(sec);
    this.dateEl.textContent = `${DAYS[d.getDay()]} ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
}
