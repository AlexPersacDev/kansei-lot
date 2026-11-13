import type { Car } from '../physics/car';

const deg = 180 / Math.PI;

/** Temporary step-1 HUD: big speed/gear/angle readout + debug telemetry. */
export class DebugHud {
  private main: HTMLDivElement;
  private tele: HTMLPreElement;
  private acc = 0;
  showTelemetry = false;

  constructor(parent: HTMLElement) {
    this.main = document.createElement('div');
    Object.assign(this.main.style, {
      position: 'fixed', right: 'max(16px, env(safe-area-inset-right))', bottom: '16px',
      font: '600 18px/1.25 system-ui, sans-serif', textAlign: 'right', textShadow: '0 1px 3px #000a',
      pointerEvents: 'none', whiteSpace: 'pre',
    } as CSSStyleDeclaration);
    this.tele = document.createElement('pre');
    Object.assign(this.tele.style, {
      position: 'fixed', left: 'max(12px, env(safe-area-inset-left))', top: '10px', margin: '0',
      font: '12px/1.35 ui-monospace, Consolas, monospace', background: '#0008', padding: '8px 10px',
      borderRadius: '6px', pointerEvents: 'none',
    } as CSSStyleDeclaration);
    parent.append(this.main, this.tele);
  }

  update(car: Car, dt: number, fps: number): void {
    this.acc += dt;
    if (this.acc < 1 / 20) return;
    this.acc = 0;
    const gear = car.gear < 0 ? 'R' : car.gear === 0 ? 'N' : String(car.gear);
    const kmh = Math.abs(car.forwardSpeed) * 3.6;
    const angle = Math.abs(car.driftAngle * deg);
    this.main.textContent =
      `${angle > 5 && car.speed > 3 ? angle.toFixed(0) + '°' : ''}\n` +
      `${kmh.toFixed(0)} km/h   ${gear}${car.setup.autoGearbox ? ' A' : ' M'}\n` +
      `${car.rpm.toFixed(0)} rpm${car.limiterCut ? ' ▲' : ''}`;
    this.tele.style.display = this.showTelemetry ? '' : 'none';
    if (!this.showTelemetry) return;
    const w = car.wheels;
    const f = (n: number, d = 0) => n.toFixed(d).padStart(6);
    this.tele.textContent =
      `fps ${fps.toFixed(0)}\n` +
      `β ${f(car.driftAngle * deg, 1)}°  r ${f(car.yawRate, 2)}  δ ${f(car.steerAngle * deg, 1)}°\n` +
      `clutch ${f(car.clutchEngagement, 2)}  thr ${f(car.throttleApplied, 2)}  Tc ${f(car.clutchTorque)}\n` +
      `      load     κ     α°   slip\n` +
      ['FL', 'FR', 'RL', 'RR'].map((n, i) =>
        `${n} ${f(w[i].fz)} ${f(w[i].slipRatio, 2)} ${f(w[i].slipAngle * deg, 1)} ${f(w[i].slip, 1)}`).join('\n') +
      `\naxle F ${f(w[0].fz + w[1].fz)}  R ${f(w[2].fz + w[3].fz)}   (F3 oculta)`;
  }
}
