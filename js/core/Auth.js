/* ============================================================
   Auth - client to the access-code gate (server/auth.php).
   verify(code) -> bool   ; update(code) -> bool
   Fails closed: on any error verify() resolves false.
   ============================================================ */
export class Auth {
  constructor({ endpoint = './server/auth.php' } = {}) {
    this.endpoint = endpoint;
  }

  async _post(body) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json().catch(() => ({}));
  }

  /** @returns {Promise<boolean>} true if the spoken code matches. */
  async verify(code) {
    try {
      const data = await this._post({ action: 'verify', code });
      return data.ok === true;
    } catch {
      return false;
    }
  }

  /** Persist a new access code to config.php. @returns {Promise<boolean>} */
  async update(code) {
    try {
      const data = await this._post({ action: 'update', code });
      return data.ok === true;
    } catch {
      return false;
    }
  }
}
