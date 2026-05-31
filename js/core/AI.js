/* ============================================================
   AI - client to the JARVIS brain proxy (server/ai.php).
   Sends the transcript, returns { intent, reply }. Keeps a short
   rolling conversation history for context. Fails soft so the
   assistant can always say something.
   ============================================================ */
export const INTENTS = ['conversation', 'standby', 'music', 'appointment', 'note', 'update_access_code'];

export class AI {
  constructor({ endpoint = './server/ai.php', historyLimit = 8 } = {}) {
    this.endpoint = endpoint;
    this.historyLimit = historyLimit;
    this.history = []; // [{ role:'user'|'model', text }]
  }

  reset() {
    this.history = [];
  }

  _push(role, text) {
    if (!text) return;
    this.history.push({ role, text });
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }
  }

  /**
   * @param {string} text user utterance
   * @returns {Promise<{intent:string, reply:string, error?:string}>}
   */
  async ask(text) {
    const utterance = (text || '').trim();
    if (!utterance) return { intent: 'conversation', reply: '' };

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: utterance, history: this.history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        return { intent: 'conversation', reply: '', error: data.error || ('http ' + res.status) };
      }
      const intent = INTENTS.includes(data.intent) ? data.intent : 'conversation';
      const reply = typeof data.reply === 'string' ? data.reply : '';
      const accessCode = typeof data.accessCode === 'string' ? data.accessCode : '';
      const musicArtist = typeof data.musicArtist === 'string' ? data.musicArtist : '';
      const musicTitle = typeof data.musicTitle === 'string' ? data.musicTitle : '';
      const musicAction = typeof data.musicAction === 'string' ? data.musicAction : '';
      const remembered = Array.isArray(data.remembered) ? data.remembered : [];
      this._push('user', utterance);
      if (intent === 'conversation' && reply) this._push('model', reply);
      return { intent, reply, accessCode, musicArtist, musicTitle, musicAction, remembered };
    } catch (err) {
      return { intent: 'conversation', reply: '', error: err.message };
    }
  }
}
