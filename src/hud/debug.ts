import type { Car } from '../physics/car';

const deg = 180 / Math.PI;

/** Optional debug telemetry (F3 / pause menu): slips, loads, clutch. */
export class DebugHud {
  private tele: HTMLPreElement;
  private acc = 0;
  showTelemetry = false;

  constructor(parent: HTMLElement) {
    this.tele = document.createElement('pre');
    Object.assign(this.tele.style, {
      position: 'fixed', left: 'max(12px, env(safe-area-inset-left))', top: 'calc(max(10px, env(safe-area-inset-top)) + 64px)', margin: '0',
      font: '12px/1.35 ui-monospace, Consolas, monospace', background: '#0008', padding: '8px 10px', color: '#eee',
      borderRadius: '6px', pointerEvents: 'none',
    } as CSSStyleDeclaration);
    parent.append(this.tele);
  }

  update(car: Car, dt: number, fps: number): void {
    this.tele.style.display = this.showTelemetry ? '' : 'none';
    this.acc += dt;
    if (this.acc < 1 / 20 || !this.showTelemetry) return;
    this.acc = 0;
    const w = car.wheels;
    const f = (n: number, d = 0) => n.toFixed(d).padStart(6);
    this.tele.textContent =
      `fps ${fps.toFixed(0)}\n` +
      `β ${f(car.driftAngle * deg, 1)}°  r ${f(car.yawRate, 2)}  δ ${f(car.steerAngle * deg, 1)}°\n` +
      `clutch ${f(car.clutchEngagement, 2)}  thr ${f(car.throttleApplied, 2)}  Tc ${f(car.clutchTorque)}\n` +
      `      load     κ     α°   slip  slide\n` +
      ['FL', 'FR', 'RL', 'RR'].map((n, i) =>
        `${n} ${f(w[i].fz)} ${f(w[i].slipRatio, 2)} ${f(w[i].slipAngle * deg, 1)} ${f(w[i].slip, 1)} ${f(w[i].slideSpeed, 1)}`).join('\n') +
      `\naxle F ${f(w[0].fz + w[1].fz)}  R ${f(w[2].fz + w[3].fz)}   (F3 oculta)`;
  }
}
