import type { Settings } from '../settings';
import { clearFrame, emptyFrame, type GlyphFamily, type InputDevice, type InputFrame } from './actions';
import { KeyboardDevice } from './keyboard';
import { PadDevice } from './gamepad';

/**
 * Owns every device, picks the most recently used one as "active" (switching live), and merges:
 * analog values come from the active device; button presses from any device.
 */
export class InputManager {
  readonly keyboard: KeyboardDevice;
  readonly pads = new Map<number, PadDevice>();
  active: InputDevice;
  /** Touch device is plugged in by the mobile layer (step 8). */
  touch: InputDevice | null = null;
  onActiveChange: (d: InputDevice) => void = () => {};
  onNeedsMapping: (p: PadDevice) => void = () => {};
  onPadsChanged: () => void = () => {};
  readonly frame: InputFrame = emptyFrame();
  private scratch: InputFrame = emptyFrame();
  private activeFrame: InputFrame = emptyFrame();
  private asked = new Set<string>();

  constructor(canvas: HTMLElement, private settings: Settings) {
    this.keyboard = new KeyboardDevice(canvas);
    this.keyboard.mouseSteer = settings.mouseSteer;
    this.active = this.keyboard;
    window.addEventListener('gamepadconnected', () => this.scan());
    window.addEventListener('gamepaddisconnected', () => this.scan());
  }

  get family(): GlyphFamily { return this.active.family; }

  /** Re-read navigator.getGamepads(); needed because Chrome only reports pads after a press. */
  scan(): void {
    const seen = new Set<number>();
    let changed = false;
    for (const gp of navigator.getGamepads()) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      const cur = this.pads.get(gp.index);
      if (cur && cur.id === gp.id) continue;
      const dev = new PadDevice(gp.index, gp, this.settings);
      this.pads.set(gp.index, dev);
      changed = true;
    }
    for (const [i, dev] of this.pads) {
      if (!seen.has(i)) {
        this.pads.delete(i);
        changed = true;
        if (this.active === dev) this.setActive(this.keyboard);
      }
    }
    if (changed) this.onPadsChanged();
  }

  setActive(d: InputDevice): void {
    if (this.active === d) return;
    this.active = d;
    this.onActiveChange(d);
  }

  poll(dt: number): InputFrame {
    this.scan();
    const out = this.frame;
    clearFrame(out);
    const devices: InputDevice[] = [this.keyboard, ...this.pads.values()];
    if (this.touch) devices.push(this.touch);
    let activeFilled = false;
    let shifterGear: number | null = null;
    for (const d of devices) {
      const f = d === this.active ? this.activeFrame : this.scratch;
      clearFrame(f);
      const used = d.poll(dt, f);
      for (const b of f.pressed) out.pressed.add(b);
      if (f.hGear !== null) shifterGear = f.hGear; // an H-shifter may be a separate USB device
      if (used && d !== this.active) {
        if (d instanceof PadDevice && d.needsMapping) {
          if (!this.asked.has(d.id)) { this.asked.add(d.id); this.onNeedsMapping(d); }
          continue;
        }
        this.setActive(d);
        copyAnalog(f, this.activeFrame);
      }
      if (d === this.active) activeFilled = true;
    }
    if (activeFilled) copyAnalog(this.activeFrame, out);
    if (out.hGear === null) out.hGear = shifterGear;
    return out;
  }

  /** Let the user re-trigger the mapping screen for a pad later. */
  forgetAsked(id: string): void { this.asked.delete(id); }
}

function copyAnalog(src: InputFrame, dst: InputFrame): void {
  dst.steer = src.steer; dst.throttle = src.throttle; dst.brake = src.brake;
  dst.clutch = src.clutch; dst.handbrake = src.handbrake; dst.hGear = src.hGear;
  dst.hasClutchPedal = src.hasClutchPedal;
}
