/* ============================================================
   Push - registers the device for Web Push notifications so the
   server cron can deliver appointment reminders even when the PWA
   is closed. Needs: a service worker, HTTPS, and a configured VAPID
   public key (server/push.php?action=vapid).
   ============================================================ */
export class Push {
  constructor({ endpoint = './server/push.php' } = {}) {
    this.endpoint = endpoint;
    this.ready = false;
  }

  get supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  /** Ask permission + subscribe. Safe to call after the user is authenticated. */
  async enable() {
    if (!this.supported) { console.warn('[push] non supportato da questo browser'); return false; }
    if (!window.isSecureContext) { console.warn('[push] richiede HTTPS'); return false; }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { console.warn('[push] permesso negato'); return false; }

      const key = await this._vapidKey();
      if (!key) { console.warn('[push] VAPID non configurato sul server'); return false; }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this._urlBase64ToUint8Array(key),
        });
      }
      const r = await this._post({ action: 'subscribe', subscription: sub.toJSON() });
      this.ready = !!(r && r.ok);
      if (this.ready) console.info('[push] notifiche attive');
      return this.ready;
    } catch (e) {
      console.warn('[push] errore:', e.message);
      return false;
    }
  }

  async _vapidKey() {
    try {
      const res = await fetch(this.endpoint + '?action=vapid');
      const data = await res.json();
      return (data && data.key) || '';
    } catch (e) { return ''; }
  }

  _post(body) {
    return fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => ({ ok: false }));
  }

  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
}
