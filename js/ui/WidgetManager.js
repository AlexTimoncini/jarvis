/* ============================================================
   WidgetManager - reveals / hides HUD widgets on demand.
   Widgets are hidden by default; the assistant shows them in
   response to a request (e.g. "meteo", "orario"), optionally
   auto-hiding them after a delay.
   ============================================================ */
export class WidgetManager {
  constructor() {
    this.els = {};
    this.timers = {};
    document.querySelectorAll('[data-widget]').forEach((el) => {
      this.els[el.dataset.widget] = el;
    });
  }

  show(id, autoHideMs = 0) {
    const el = this.els[id];
    if (!el) return;
    el.classList.add('is-visible');
    clearTimeout(this.timers[id]);
    if (autoHideMs > 0) {
      this.timers[id] = setTimeout(() => this.hide(id), autoHideMs);
    }
  }

  hide(id) {
    const el = this.els[id];
    if (!el) return;
    el.classList.remove('is-visible');
    clearTimeout(this.timers[id]);
  }

  toggle(id, autoHideMs = 0) {
    this.isVisible(id) ? this.hide(id) : this.show(id, autoHideMs);
  }

  hideAll() {
    for (const id in this.els) this.hide(id);
  }

  isVisible(id) {
    return !!this.els[id]?.classList.contains('is-visible');
  }
}
