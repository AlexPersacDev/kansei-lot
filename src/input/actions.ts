/** Abstract actions every device maps onto. */
export type AxisAction = 'steer' | 'throttle' | 'brake' | 'clutch' | 'handbrake';
export type ButtonAction =
  | 'shiftUp' | 'shiftDown' | 'camera' | 'reset' | 'pause' | 'toggleHelp'
  | 'gearR' | 'gearN' | 'gear1' | 'gear2' | 'gear3' | 'gear4' | 'gear5';

export type DeviceKind = 'keyboard' | 'gamepad' | 'wheel' | 'touch';

export interface InputFrame {
  steer: number;      // -1 left … +1 right
  throttle: number;   // 0..1
  brake: number;
  clutch: number;
  handbrake: number;
  /** Buttons that went down this frame. */
  pressed: Set<ButtonAction>;
  /** H-shifter position held right now (null = neutral / no shifter). */
  hGear: number | null;
}

export function emptyFrame(): InputFrame {
  return { steer: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0, pressed: new Set(), hGear: null };
}

export interface InputDevice {
  readonly kind: DeviceKind;
  /** Fill `out`; return true if the player touched this device this frame. */
  poll(dt: number, out: InputFrame): boolean;
}
