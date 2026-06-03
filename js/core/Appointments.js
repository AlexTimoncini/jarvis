/* ============================================================
   Appointments - client to server/appointments.php. Adds, lists
   and deletes reminders. The server (cron + Web Push) handles the
   actual notifications.
   ============================================================ */
export class Appointments {
  constructor({ endpoint = './server/appointments.php' } = {}) {
    this.endpoint = endpoint;
  }

  async _post(body) {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json().catch(() => ({ ok: false }));
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * @param {{title:string, datetime:string, recurrence?:string,
   *          reminders?:string[], notes?:string}} appt
   * @returns {Promise<{ok:boolean, appointment?:object, error?:string}>}
   */
  add(appt) {
    return this._post({ action: 'add', ...appt });
  }

  async list() {
    const r = await this._post({ action: 'list' });
    return Array.isArray(r.appointments) ? r.appointments : [];
  }

  delete(id) {
    return this._post({ action: 'delete', id });
  }

  /** Delete every appointment. -> { ok, deleted, titles } */
  deleteAll() {
    return this._post({ action: 'delete', all: true });
  }

  /** Delete all appointments occurring on a given day ("YYYY-MM-DD"). */
  deleteByDate(date) {
    return this._post({ action: 'delete', date });
  }

  /** Delete appointments whose title matches (server-side fuzzy). */
  deleteByTitle(title) {
    return this._post({ action: 'delete', title });
  }
}

/** Parse a "YYYY-MM-DD HH:MM" local string into a Date (or null). */
export function parseLocal(s = '') {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

/** The next occurrence (Date) of an appointment at/after `now`, or null if past. */
export function nextOccurrence(appt, now = new Date()) {
  const base = parseLocal(appt && appt.datetime);
  if (!base) return null;
  const rec = (appt.recurrence || 'none').toLowerCase();
  if (rec === 'none') return base >= now ? base : null;

  const d = new Date(base);
  let guard = 0;
  while (d < now && guard < 100000) {
    if (rec === 'daily') d.setDate(d.getDate() + 1);
    else if (rec === 'weekly') d.setDate(d.getDate() + 7);
    else if (rec === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (rec === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else return base >= now ? base : null;
    guard++;
  }
  return d;
}

/** Upcoming appointments sorted by next occurrence, each {appt, occ:Date}. */
export function upcomingAppointments(appts = [], limit = 3, now = new Date()) {
  return appts
    .map((a) => ({ appt: a, occ: nextOccurrence(a, now) }))
    .filter((x) => x.occ)
    .sort((a, b) => a.occ - b.occ)
    .slice(0, limit);
}
