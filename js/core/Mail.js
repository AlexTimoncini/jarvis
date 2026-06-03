/* ============================================================
   Mail - client to server/mail.php. Read-only IMAP access:
   unread count, recent headers, read / summarize the latest
   message. Reading never marks mail as seen (server uses PEEK).
   ============================================================ */
export class Mail {
  constructor({ endpoint = './server/mail.php' } = {}) {
    this.endpoint = endpoint;
  }

  async _post(body) {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json().catch(() => ({ ok: false, error: 'bad response' }));
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** @returns {Promise<{ok,count,items,error?}>} */
  unread() { return this._post({ action: 'unread' }); }

  /** @returns {Promise<{ok,items,error?}>} */
  list() { return this._post({ action: 'list' }); }

  /** Read the latest (or latest unread) message. @returns {Promise<{ok,mail,error?}>} */
  read({ unseen = true } = {}) { return this._post({ action: 'read', unseen }); }

  /** Summarize the latest (or latest unread) message. */
  summary({ unseen = true } = {}) { return this._post({ action: 'summary', unseen }); }
}
