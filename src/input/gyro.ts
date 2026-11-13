/**
 * Tilt steering: hold the phone in landscape like a steering wheel. Uses the gravity vector
 * (devicemotion.accelerationIncludingGravity) projected onto the screen plane, so it works however
 * far the phone is reclined and has no Euler-angle wrap-around. iOS and Android report gravity
 * with opposite signs; that only rotates the angle by 180°, which the centre calibration removes.
 */
export type GyroPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

type PermissionFn = { requestPermission?: () => Promise<'granted' | 'denied'> };

export class GyroSteer {
  permission: GyroPermission = 'unknown';
  /** True once real (non-null) motion samples are arriving. */
  live = false;
  private gx = 0;
  private gy = 0;
  private center = 0;
  private listening = false;

  private onMotion = (e: DeviceMotionEvent) => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    // light low-pass to drop hand jitter / engine-free vibration, keep it responsive
    const k = this.live ? 0.35 : 1;
    this.gx += (g.x - this.gx) * k;
    this.gy += (g.y! - this.gy) * k;
    this.live = true;
  };

  /**
   * Must be called synchronously from a user gesture (iOS shows its permission prompt).
   * Resolves true when motion data is flowing.
   */
  request(): Promise<boolean> {
    const DOE = (window as unknown as { DeviceOrientationEvent?: PermissionFn }).DeviceOrientationEvent;
    const DME = (window as unknown as { DeviceMotionEvent?: PermissionFn }).DeviceMotionEvent;
    if (!('DeviceMotionEvent' in window)) { this.permission = 'unsupported'; return Promise.resolve(false); }
    const asks: Promise<'granted' | 'denied'>[] = [];
    // both prompts must be started inside the same gesture, before any await
    if (DOE?.requestPermission) asks.push(DOE.requestPermission().catch(() => 'denied' as const));
    if (DME?.requestPermission) asks.push(DME.requestPermission().catch(() => 'denied' as const));
    return Promise.all(asks).then((res) => {
      if (res.some((r) => r !== 'granted')) { this.permission = 'denied'; return false; }
      this.permission = 'granted';
      this.listen();
      return this.waitForData(1200);
    });
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('devicemotion', this.onMotion);
  }

  private waitForData(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const check = () => {
        if (this.live) { this.calibrate(); resolve(true); return; }
        if (performance.now() - t0 > ms) { this.permission = 'unsupported'; resolve(false); return; }
        setTimeout(check, 50);
      };
      check();
    });
  }

  private rawAngle(): number { return Math.atan2(this.gy, this.gx) * 180 / Math.PI; }

  /** Current pose becomes "straight ahead". */
  calibrate(): void { this.center = this.rawAngle(); }

  /** Signed tilt from centre in degrees (+ = turned clockwise, i.e. to the right). */
  angle(): number {
    let d = this.rawAngle() - this.center;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  /** ±lockDeg (default 60°) = full lock; dead zone in degrees; invert for odd devices. */
  steer(lockDeg: number, deadDeg: number, invert: boolean): number {
    if (!this.live) return 0;
    const a = this.angle() * (invert ? -1 : 1);
    const m = Math.abs(a) - deadDeg;
    if (m <= 0) return 0;
    return Math.sign(a) * Math.min(1, m / Math.max(5, lockDeg - deadDeg));
  }
}
