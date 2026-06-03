/* ============================================================
   Playlists - client to server/playlists.php. Create / modify /
   delete named playlists and fetch their tracks for playback.
   Tracks are concrete {artist,title,file} entries (resolved by the
   client against the music catalog before saving).
   ============================================================ */
export class Playlists {
  constructor({ endpoint = './server/playlists.php' } = {}) {
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

  /** @returns {Promise<Array<{name:string,count:number}>>} */
  async list() {
    const r = await this._post({ action: 'list' });
    return Array.isArray(r.playlists) ? r.playlists : [];
  }

  /** @returns {Promise<{name:string,tracks:Array}|null>} */
  async get(name) {
    const r = await this._post({ action: 'get', name });
    return r && r.playlist ? r.playlist : null;
  }

  create(name, tracks) {
    return this._post({ action: 'create', name, tracks });
  }

  add(name, tracks) {
    return this._post({ action: 'add', name, tracks });
  }

  /** Remove tracks by file paths and/or titles. */
  remove(name, { files = [], titles = [] } = {}) {
    return this._post({ action: 'remove', name, files, titles });
  }

  delete(name) {
    return this._post({ action: 'delete', name });
  }
}
