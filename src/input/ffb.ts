import type { Car } from '../physics/car';

/**
 * Force feedback. Browsers can't drive wheel motors (the Gamepad API only has rumble), so the web
 * build uses NullForceFeedback. A future desktop wrapper (Electron / Tauri + SDL or the vendor SDK)
 * can implement this interface and receive the same signals.
 */
export interface ForceFeedback {
  readonly available: boolean;
  /** Steering-column torque, normalised -1..1 (+ = pushes the wheel to the right). */
  setAligningTorque(t: number): void;
  /** Centering spring strength 0..1 (used when parked / paused). */
  setSpring(k: number): void;
  /** Short jolt for impacts, 0..1. */
  impact(strength: number): void;
  stop(): void;
}

export class NullForceFeedback implements ForceFeedback {
  readonly available = false;
  setAligningTorque(): void {}
  setSpring(): void {}
  impact(): void {}
  stop(): void {}
}

const PNEUMATIC_TRAIL = 0.035; // m, shrinks as the front tyres saturate
const MAX_TORQUE = 260;        // Nm at the kingpins that maps to full scale

/**
 * Computes the self-aligning torque a real column would feel from the front tyres and feeds it to
 * the FFB device. Kept here (not in the device) so a desktop build only has to send the number.
 */
export class FfbDriver {
  constructor(public device: ForceFeedback = new NullForceFeedback()) {}
  /** Last computed torque, exposed for telemetry. */
  torque = 0;

  update(car: Car, paused: boolean): void {
    if (paused) { this.device.setSpring(0.6); this.device.setAligningTorque(0); return; }
    let mz = 0;
    for (const w of [car.wheels[0], car.wheels[1]]) {
      // trail collapses past the peak: the classic "wheel goes light" at the limit
      const trail = PNEUMATIC_TRAIL * Math.max(0, 1 - Math.max(0, w.slip - 0.6));
      // lateral force to the left (fy > 0) is felt as the wheel pulling back to the right
      mz += w.fy * trail;
    }
    this.torque = Math.max(-1, Math.min(1, mz / MAX_TORQUE));
    this.device.setSpring(car.speed < 2 ? 0.3 : 0.05);
    this.device.setAligningTorque(this.torque);
  }
}
