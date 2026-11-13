import type { ButtonAction, InputDevice, InputFrame } from './actions';

const BUTTONS: Record<string, ButtonAction> = {
  KeyE: 'shiftUp', KeyQ: 'shiftDown', KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyH: 'toggleHelp',
};

/** Keyboard (+ optional mouse steering). Digital keys are ramped so steering is not twitchy. */
export class KeyboardDevice implements InputDevice {
  readonly kind = 'keyboard' as const;
  steerRise = 3.2;    // per second, toward full lock
  steerReturn = 5.0;  // per second, back to centre
  pedalRise = 7;
  pedalFall = 10;

  private down = new Set<string>();
  private justDown: string[] = [];
  private touched = false;
  private steer = 0;
  private throttle = 0;
  private brake = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.down.add(e.code);
      this.justDown.push(e.code);
      this.touched = true;
    });
    target.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    target.addEventListener('blur', () => this.down.clear());
  }

  private any(...codes: string[]): boolean { return codes.some((c) => this.down.has(c)); }

  poll(dt: number, out: InputFrame): boolean {
    const left = this.any('KeyA', 'ArrowLeft');
    const right = this.any('KeyD', 'ArrowRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (target !== 0) {
      // reversing direction snaps through centre quickly
      const rate = Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? this.steerRise + this.steerReturn : this.steerRise;
      this.steer = approach(this.steer, target, rate * dt);
    } else {
      this.steer = approach(this.steer, 0, this.steerReturn * dt);
    }
    this.throttle = approach(this.throttle, this.any('KeyW', 'ArrowUp') ? 1 : 0, (this.any('KeyW', 'ArrowUp') ? this.pedalRise : this.pedalFall) * dt);
    this.brake = approach(this.brake, this.any('KeyS', 'ArrowDown') ? 1 : 0, (this.any('KeyS', 'ArrowDown') ? this.pedalRise : this.pedalFall) * dt);

    out.steer = this.steer;
    out.throttle = this.throttle;
    out.brake = this.brake;
    out.handbrake = this.any('Space') ? 1 : 0;
    out.clutch = this.any('ShiftLeft', 'ShiftRight') ? 1 : 0;
    for (const code of this.justDown) {
      const b = BUTTONS[code];
      if (b) out.pressed.add(b);
    }
    this.justDown.length = 0;
    const touched = this.touched;
    this.touched = false;
    return touched;
  }
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
