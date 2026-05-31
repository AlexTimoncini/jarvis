/* ============================================================
   JARVIS state machine
   States: boot, idle, wake, listening, thinking, speaking, error
   ============================================================ */
import { bus } from './EventBus.js';

export const STATES = {
  boot:      { label: 'BOOT',      hint: 'inizializzazione',  accentVar: '--state-idle' },
  idle:      { label: 'STANDBY',   hint: 'tocca per attivare', accentVar: '--state-idle' },
  wake:      { label: 'ONLINE',    hint: 'in ascolto...',      accentVar: '--state-wake' },
  listening: { label: 'LISTENING', hint: 'tieni premuto',      accentVar: '--state-listening' },
  thinking:  { label: 'PROCESSING',hint: 'elaboro...',         accentVar: '--state-thinking' },
  speaking:  { label: 'SPEAKING',  hint: 'rispondo',           accentVar: '--state-speaking' },
  error:     { label: 'FAULT',     hint: 'errore di sistema',  accentVar: '--state-error' },
};

/** Allowed transitions (debug panel can bypass via force()). */
const TRANSITIONS = {
  boot:      ['idle', 'error'],
  idle:      ['wake', 'error'],
  wake:      ['listening', 'thinking', 'idle', 'error'],
  listening: ['thinking', 'wake', 'idle', 'error'],
  thinking:  ['speaking', 'idle', 'error'],
  speaking:  ['idle', 'wake', 'listening', 'error'],
  error:     ['idle'],
};

export class StateMachine {
  constructor(initial = 'boot') {
    this.state = initial;
    this.previous = null;
    this.enteredAt = performance.now();
  }

  is(state) {
    return this.state === state;
  }

  canGo(to) {
    return TRANSITIONS[this.state]?.includes(to) ?? false;
  }

  /** Validated transition. Returns false if not allowed. */
  go(to, meta = {}) {
    if (to === this.state) return false;
    if (!STATES[to]) {
      console.warn(`[StateMachine] unknown state "${to}"`);
      return false;
    }
    if (!this.canGo(to)) {
      console.warn(`[StateMachine] illegal transition ${this.state} -> ${to}`);
      return false;
    }
    return this._apply(to, meta);
  }

  /** Force a state ignoring transition rules (debug / system). */
  force(to, meta = {}) {
    if (!STATES[to] || to === this.state) return false;
    return this._apply(to, { ...meta, forced: true });
  }

  _apply(to, meta) {
    this.previous = this.state;
    this.state = to;
    this.enteredAt = performance.now();
    bus.emit('state:change', { from: this.previous, to, config: STATES[to], meta });
    return true;
  }

  timeInState() {
    return (performance.now() - this.enteredAt) / 1000;
  }
}
