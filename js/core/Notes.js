/* ============================================================
   Notes - client to server/notes.php. Create / append / read /
   list / delete text notes, and download one as a .txt file onto
   the device. Content is structured by the AI (server/ai.php)
   before it gets here, so notes arrive already cleaned up.
   ============================================================ */
export class Notes {
  constructor({ endpoint = './server/notes.php' } = {}) {
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

  /** @returns {Promise<Array<{id,title,updated_at,preview}>>} */
  async list() {
    const r = await this._post({ action: 'list' });
    return Array.isArray(r.notes) ? r.notes : [];
  }

  /** @returns {Promise<object|null>} */
  async get({ id = '', title = '' } = {}) {
    const r = await this._post({ action: 'get', id, title });
    return r && r.note ? r.note : null;
  }

  /** Create (or, if the title already exists, group into) a note. */
  add(title, content) {
    return this._post({ action: 'add', title, content });
  }

  /** Append content to an existing note (collect ideas under one title). */
  append(title, content) {
    return this._post({ action: 'append', title, content });
  }

  delete({ id = '', title = '' } = {}) {
    return this._post({ action: 'delete', id, title });
  }

  /**
   * Semantic search across notes (Gemini embeddings, server-side).
   * @returns {Promise<{ok:boolean, note?:object, matches?:Array, error?:string}>}
   */
  search(query) {
    return this._post({ action: 'search', query });
  }

  /**
   * Fetch the note as a .txt from the server and save it to the device.
   * Uses a Blob + temporary <a download> so it works inside the installed
   * PWA (and falls back to opening the file if download isn't supported).
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async download({ id = '', title = '' } = {}) {
    const qs = new URLSearchParams({ action: 'download' });
    if (id) qs.set('id', id);
    if (title) qs.set('title', title);
    const url = `${this.endpoint}?${qs.toString()}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, error: `http ${res.status}` };
      const blob = await res.blob();
      const fname = this._filenameFrom(res.headers.get('Content-Disposition'), title);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fname;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  _filenameFrom(disposition, fallbackTitle = '') {
    const m = disposition && /filename="?([^"]+)"?/i.exec(disposition);
    if (m && m[1]) return m[1];
    const base = (fallbackTitle || 'nota').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return `${base || 'nota'}.txt`;
  }
}
