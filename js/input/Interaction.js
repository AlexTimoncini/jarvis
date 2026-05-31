/* ============================================================
   Interaction - tap vs press-and-hold on the central stage.
   Emits on the bus:
     input:tap        quick tap
     input:holdstart  pointer held past threshold
     input:holdend    release after a hold
   ============================================================ */
import { bus } from '../core/EventBus.js';

const HOLD_MS = 220;
const MOVE_TOLERANCE = 16; // px before a press is treated as a drag/cancel

export class Interaction {
  constructor(target) {
    this.target = target;
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.holding = false;
    this.holdTimer = null;

    this._down = this._down.bind(this);
    this._up = this._up.bind(this);
    this._move = this._move.bind(this);

    target.addEventListener('pointerdown', this._down);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    window.addEventListener('pointermove', this._move);
    // avoid iOS long-press context menu
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _down(e) {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.holding = false;
    this.holdTimer = setTimeout(() => {
      this.holding = true;
      bus.emit('input:holdstart');
    }, HOLD_MS);
  }

  _move(e) {
    if (e.pointerId !== this.pointerId || this.holding) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (dx * dx + dy * dy > MOVE_TOLERANCE * MOVE_TOLERANCE) {
      // moved too far before hold -> cancel pending hold, treat as nothing
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  _up(e) {
    if (e.pointerId !== this.pointerId) return;
    clearTimeout(this.holdTimer);
    if (this.holding) {
      bus.emit('input:holdend');
    } else if (this.holdTimer !== null) {
      bus.emit('input:tap');
    }
    this.pointerId = null;
    this.holding = false;
    this.holdTimer = null;
  }
}
