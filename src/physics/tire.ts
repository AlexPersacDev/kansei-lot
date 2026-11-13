import type { TireParams } from '../data/e30';

export interface TireForce {
  fx: number;   // longitudinal, + = forward in wheel frame [N]
  fy: number;   // lateral, + = left in wheel frame [N]
  slip: number; // combined normalized slip (1 = at peak)
}

/**
 * Simplified combined-slip Pacejka.
 * Longitudinal and lateral slip are normalized by their peak values and combined into one slip
 * vector; a single "magic formula" curve gives the force magnitude, which is shared out along
 * the slip direction. This yields a friction circle/ellipse that keeps ~76 % of peak grip when
 * fully sliding, which is what makes long drifts controllable.
 */
export function tireForce(
  p: TireParams, fz: number, kappa: number, tanAlpha: number, gripScale: number,
  slideLong: number, slideLat: number, out: TireForce,
): TireForce {
  out.fx = 0; out.fy = 0; out.slip = 0;
  if (fz <= 0) return out;
  const sx = kappa / p.slipRatioPeak;
  const sy = tanAlpha / Math.tan(p.slipAnglePeak);
  const rho = Math.hypot(sx, sy);
  out.slip = rho;
  if (rho < 1e-6) return out;
  const C = p.shape;
  const B = Math.tan(Math.PI / (2 * C)); // puts the peak exactly at rho = 1
  const f = Math.sin(C * Math.atan(B * rho));
  const mu = p.mu * gripScale * Math.max(0.4, 1 - p.loadSensitivity * (fz / p.refLoad - 1));
  const F = mu * fz * f;
  // Direction: normalized slip near the peak (friction ellipse), turning into the real sliding
  // velocity once the patch slides — a spinning rear tire then pushes along its slide, which is
  // what keeps speed up in a powered drift.
  let dx = sx / rho, dy = sy / rho;
  const sl = Math.hypot(slideLong, slideLat);
  if (sl > 1e-4) {
    const w = rho <= 1 ? 0 : rho >= 3 ? 1 : ((rho - 1) / 2) ** 2 * (3 - (rho - 1));
    dx = dx * (1 - w) + (slideLong / sl) * w;
    dy = dy * (1 - w) + (slideLat / sl) * w;
    const n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;
  }
  out.fx = F * dx;
  out.fy = -F * dy;
  return out;
}

/** Peak-grip slope helper used by tests. */
export function tirePeakForce(p: TireParams, fz: number, gripScale = 1): number {
  return p.mu * gripScale * Math.max(0.4, 1 - p.loadSensitivity * (fz / p.refLoad - 1)) * fz;
}
