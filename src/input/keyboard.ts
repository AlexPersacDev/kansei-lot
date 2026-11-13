import type { ButtonAction, GlyphFamily, InputDevice, InputFrame } from './actions';

const BUTTONS: Record<string, ButtonAction> = {
  KeyE: 'shiftUp', KeyQ: 'shiftDown', KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyH: 'toggleHelp',
};

/**
 * Keyboard, with optional mouse steering (horizontal pointer position steers, left button =
 * throttle, right button = brake). Digital keys are ramped so steering is not twitchy.
 */
export class KeyboardDevice implements InputDevice {
  readonly kind = 'keyboard' as const;
  get family(): GlyphFamily { return this.mouseSteer ? 'mouse' : 'keyboard'; }
  mouseSteer = false;
  steerRise = 3.2;    // per second, toward full lock
  steerReturn = 5.0;  // per second, back to centre
  pedalRise = 7;
  pedalFall = 10;
  /** Set false while a menu has focus so typing doesn't drive the car. */
  enabled = true;

  private down = new Set<string>();
  private justDown: string[] = [];
  private touched = false;
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private mouseX = 0.5;
  private mouseButtons = 0;

  constructor(canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.down.add(e.code);
      this.justDown.push(e.code);
      this.touched = true;
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); this.mouseButtons = 0; });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseX = e.clientX / window.innerWidth;
      if (this.mouseSteer) this.touched = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseButtons = e.buttons;
      if (this.mouseSteer) this.touched = true;
    });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') this.mouseButtons = e.buttons; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private any(...codes: string[]): boolean { return codes.some((c) => this.down.has(c)); }

  poll(dt: number, out: InputFrame): boolean {
    if (!this.enabled) { this.down.clear(); this.justDown.length = 0; this.mouseButtons = 0; }
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
    const gas = this.any('KeyW', 'ArrowUp') || (this.mouseSteer && (this.mouseButtons & 1) !== 0);
    const brk = this.any('KeyS', 'ArrowDown') || (this.mouseSteer && (this.mouseButtons & 2) !== 0);
    this.throttle = approach(this.throttle, gas ? 1 : 0, (gas ? this.pedalRise : this.pedalFall) * dt);
    this.brake = approach(this.brake, brk ? 1 : 0, (brk ? this.pedalRise : this.pedalFall) * dt);

    if (this.mouseSteer && target === 0) {
      // centre 70 % of the screen width spans full lock; outside clamps
      out.steer = Math.max(-1, Math.min(1, (this.mouseX - 0.5) / 0.35));
      this.steer = out.steer;
    } else {
      out.steer = this.steer;
    }
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
