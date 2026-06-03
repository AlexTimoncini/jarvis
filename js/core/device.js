/* ============================================================
   device - shared device/perf capabilities. Mobile gets a lower
   pixel-ratio cap and lighter geometry so the full-screen WebGL +
   2D canvas layers stay smooth on phones.
   ============================================================ */
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const minSide = Math.min(screen.width || 9999, screen.height || 9999);
const raw = window.devicePixelRatio || 1;

/** Phone-class device (touch + small screen). */
export const isMobile = coarse && minSide <= 820;

/** Pixel-ratio cap for every canvas/WebGL surface. */
export const dprCap = isMobile ? Math.min(raw, 1.5) : Math.min(raw, 2);

/** True when we should draw lighter (fewer particles/segments). */
export const lowPower = isMobile;
