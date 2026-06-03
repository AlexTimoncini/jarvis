/* ============================================================
   AppointmentsWidget - small HUD panel listing the next upcoming
   reminders. Refreshed on demand (add / list / delete) by the
   Assistant; also self-refreshes periodically while visible.
   ============================================================ */
import { upcomingAppointments } from '../core/Appointments.js';

export class AppointmentsWidget {
  constructor({ root, listEl, appointments, limit = 3 }) {
    this.root = root;
    this.listEl = listEl;
    this.appointments = appointments;
    this.limit = limit;
    this._items = [];
    // keep the relative labels fresh while shown
    setInterval(() => { if (this.root && this.root.classList.contains('is-visible')) this._render(); }, 30000);
  }

  async refresh() {
    if (!this.appointments) return;
    try {
      const appts = await this.appointments.list();
      this._items = upcomingAppointments(appts, this.limit);
      this._render();
    } catch (e) { /* offline: keep last render */ }
  }

  _render() {
    if (!this.listEl) return;
    if (!this._items.length) {
      this.listEl.innerHTML = '<li class="appt__empty">Nessun impegno in programma</li>';
      return;
    }
    const now = new Date();
    this.listEl.innerHTML = this._items.map(({ appt, occ }) => {
      const when = this._fmt(occ, now, appt.all_day);
      const rec = appt.recurrence && appt.recurrence !== 'none' ? '<span class="appt__rec">\u21bb</span>' : '';
      return `<li class="appt__item">
        <span class="appt__dot"></span>
        <span class="appt__title">${this._esc(appt.title)}${rec}</span>
        <span class="appt__when">${when}</span>
      </li>`;
    }).join('');
  }

  /** Compact Italian date: "oggi 16:00", "dom 2/6 16:00" (no time if all-day). */
  _fmt(date, now, allDay = false) {
    const sameDay = date.toDateString() === now.toDateString();
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = date.toDateString() === tomorrow.toDateString();
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const time = allDay ? '' : ` ${hh}:${mm}`;
    if (sameDay) return `oggi${time}`;
    if (isTomorrow) return `domani${time}`;
    const days = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
    return `${days[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}${time}`;
  }

  _esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
}
