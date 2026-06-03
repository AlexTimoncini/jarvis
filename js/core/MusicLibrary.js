/* ============================================================
   MusicLibrary - loads the catalog from server/music.php and
   resolves an (artist, title) request to a concrete track/URL.
   Matching is forgiving (case/accents/spacing insensitive) so
   the AI's pick and spoken titles still resolve.
   ============================================================ */
const norm = (s = '') =>
  s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export class MusicLibrary {
  constructor({ endpoint = './server/music.php' } = {}) {
    this.endpoint = endpoint;
    this.tracks = [];
    this.loaded = false;
  }

  async load() {
    try {
      const res = await fetch(this.endpoint);
      const data = await res.json();
      this.tracks = Array.isArray(data.tracks) ? data.tracks : [];
    } catch {
      this.tracks = [];
    }
    this.loaded = true;
    return this.tracks;
  }

  get isEmpty() {
    return this.tracks.length === 0;
  }

  /** A random track by the given artist (excluding one file), or null. */
  byArtist(artist = '', exceptFile = null) {
    const nArtist = norm(artist);
    if (!nArtist) return null;
    const pool = this.tracks.filter((t) => {
      if (exceptFile && t.file === exceptFile) return false;
      const ta = norm(t.artist);
      return ta === nArtist || ta.includes(nArtist) || nArtist.includes(ta);
    });
    if (!pool.length) return null;
    return pool[(Math.random() * pool.length) | 0];
  }

  /**
   * Resolve a list of {artist,title} (or "Artist - Title" strings) into
   * concrete library tracks {artist,title,file}. Unresolved items are dropped.
   */
  resolveMany(items = []) {
    const out = [];
    const seen = new Set();
    for (const it of items) {
      let artist = '';
      let title = '';
      let raw = '';
      if (typeof it === 'string') {
        raw = it;
        const parts = it.split(/\s+[-–—]\s+/);
        if (parts.length >= 2) { artist = parts[0]; title = parts.slice(1).join(' - '); }
        else { title = it; }
      } else if (it && typeof it === 'object') {
        artist = it.artist || '';
        title = it.title || '';
        raw = `${artist} ${title}`;
      }
      const t = this.resolve(artist, title, raw);
      if (t && !seen.has(t.file)) { seen.add(t.file); out.push(t); }
    }
    return out;
  }

  /** Pick a random track (used for generic "play music" / next). */
  random(exceptFile = null) {
    const pool = exceptFile ? this.tracks.filter((t) => t.file !== exceptFile) : this.tracks;
    const list = pool.length ? pool : this.tracks;
    if (!list.length) return null;
    return list[(Math.random() * list.length) | 0];
  }

  /**
   * Resolve a track from artist/title hints (and the raw utterance as a
   * fallback). Returns a track {artist,title,file} or null.
   */
  resolve(artist = '', title = '', utterance = '') {
    if (!this.tracks.length) return null;
    const nArtist = norm(artist);
    const nTitle = norm(title);

    // 1) exact-ish artist + title
    if (nTitle) {
      let best = null;
      for (const t of this.tracks) {
        const tt = norm(t.title);
        const ta = norm(t.artist);
        const titleHit = tt === nTitle || tt.includes(nTitle) || nTitle.includes(tt);
        if (!titleHit) continue;
        const artistHit = !nArtist || ta === nArtist || ta.includes(nArtist) || nArtist.includes(ta);
        if (artistHit) return t;
        best = best || t;
      }
      if (best) return best;
    }

    // 2) artist only -> a track by that artist
    if (nArtist) {
      const byArtist = this.tracks.filter((t) => {
        const ta = norm(t.artist);
        return ta === nArtist || ta.includes(nArtist) || nArtist.includes(ta);
      });
      if (byArtist.length) return byArtist[(Math.random() * byArtist.length) | 0];
    }

    // 3) scan the raw utterance for any known title/artist
    const u = norm(utterance);
    if (u) {
      for (const t of this.tracks) {
        if (u.includes(norm(t.title))) return t;
      }
      for (const t of this.tracks) {
        if (u.includes(norm(t.artist))) return t;
      }
    }

    return null;
  }
}
