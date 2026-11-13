/** Abstract actions every device maps onto. */
export type AxisAction = 'steer' | 'throttle' | 'brake' | 'clutch' | 'handbrake';
export type ButtonAction =
  | 'shiftUp' | 'shiftDown' | 'camera' | 'reset' | 'pause' | 'toggleHelp'
  | 'gearR' | 'gear1' | 'gear2' | 'gear3' | 'gear4' | 'gear5';

export type DeviceKind = 'keyboard' | 'gamepad' | 'wheel' | 'touch';
/** Which icon set the controls help uses. */
export type GlyphFamily = 'keyboard' | 'mouse' | 'xbox' | 'playstation' | 'generic' | 'wheel' | 'touch';

export interface InputFrame {
  steer: number;      // -1 left … +1 right
  throttle: number;   // 0..1
  brake: number;
  clutch: number;
  handbrake: number;
  /** Buttons that went down this frame. */
  pressed: Set<ButtonAction>;
  /** H-shifter position held right now: -1 = R, 1..5, 0 = neutral; null = device has no shifter. */
  hGear: number | null;
  /** True if this device has a real clutch control (disables the automatic launch clutch). */
  hasClutchPedal: boolean;
}

export function emptyFrame(): InputFrame {
  return { steer: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0, pressed: new Set(), hGear: null, hasClutchPedal: false };
}

export function clearFrame(f: InputFrame): void {
  f.steer = f.throttle = f.brake = f.clutch = f.handbrake = 0;
  f.pressed.clear();
  f.hGear = null;
  f.hasClutchPedal = false;
}

export interface InputDevice {
  readonly kind: DeviceKind;
  readonly family: GlyphFamily;
  /** Fill `out`; return true if the player actively used this device this frame. */
  poll(dt: number, out: InputFrame): boolean;
}

export const GEAR_ACTIONS: Record<string, number> = { gearR: -1, gear1: 1, gear2: 2, gear3: 3, gear4: 4, gear5: 5 };
