import type { Binding, Settings } from '../settings';
import { GEAR_ACTIONS, type ButtonAction, type DeviceKind, type GlyphFamily, type InputDevice, type InputFrame } from './actions';

/** W3C "standard" mapping indices. */
export const STD = {
  south: 0, east: 1, west: 2, north: 3, lb: 4, rb: 5, lt: 6, rt: 7,
  select: 8, start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15, home: 16,
} as const;

/** Standard-mapping layout used for Xbox / PlayStation / generic pads. */
export const PAD_LAYOUT: Record<ButtonAction | 'handbrake' | 'clutch', number | null> = {
  handbrake: STD.south,
  clutch: STD.west,
  camera: STD.north,
  reset: STD.east,
  shiftDown: STD.lb,
  shiftUp: STD.rb,
  pause: STD.start,
  toggleHelp: STD.select,
  gearR: null, gear1: null, gear2: null, gear3: null, gear4: null, gear5: null,
};

const WHEEL_VENDORS = ['046d', '044f', '0eb7', '346e', '11ff', '3416'];
const LOGITECH_WHEEL_PRODUCTS = ['c24f', 'c260', 'c261', 'c262', 'c266', 'c267', 'c26d', 'c26e', 'c29b', 'c294', 'c298', 'c299', 'c29a', 'c29c'];

export function detectFamily(id: string, mapping: string): { kind: DeviceKind; family: GlyphFamily } {
  const s = id.toLowerCase();
  const vendor = /vendor:\s*([0-9a-f]{4})/.exec(s)?.[1] ?? /^([0-9a-f]{4})-/.exec(s)?.[1] ?? '';
  const product = /product:\s*([0-9a-f]{4})/.exec(s)?.[1] ?? /^[0-9a-f]{4}-([0-9a-f]{4})/.exec(s)?.[1] ?? '';
  const named = /wheel|racing|g29|g920|g923|g27|g25|driving force|thrustmaster|t300|t150|t248|tmx|fanatec|csl|clubsport|podium|moza|simagic|simucube|pedal|shifter/.test(s);
  const isWheel = named
    || (vendor === '046d' && LOGITECH_WHEEL_PRODUCTS.includes(product))
    || (vendor !== '' && vendor !== '046d' && WHEEL_VENDORS.includes(vendor));
  if (isWheel) return { kind: 'wheel', family: 'wheel' };
  // vendor ids first; names after (Xbox pads are also called "Wireless Controller")
  if (vendor === '054c') return { kind: 'gamepad', family: 'playstation' };
  if (vendor === '045e') return { kind: 'gamepad', family: 'xbox' };
  if (/xbox|xinput|microsoft/.test(s)) return { kind: 'gamepad', family: 'xbox' };
  if (/dualsense|dualshock|playstation|ps4|ps5|^wireless controller/.test(s)) return { kind: 'gamepad', family: 'playstation' };
  void mapping;
  return { kind: 'gamepad', family: 'generic' };
}

/**
 * One physical Gamepad API device. Uses the standard mapping when the browser provides it,
 * otherwise (wheels, odd pads) the bindings the player recorded on the mapping screen.
 */
export class PadDevice implements InputDevice {
  readonly kind: DeviceKind;
  readonly family: GlyphFamily;
  readonly id: string;
  readonly standard: boolean;
  private prevButtons: boolean[] = [];
  private restAxes: number[] | null = null;
  private lastHGear: number | null = null;

  constructor(public index: number, pad: Gamepad, private settings: Settings) {
    this.id = pad.id;
    this.standard = pad.mapping === 'standard';
    const d = detectFamily(pad.id, pad.mapping);
    this.kind = d.kind;
    this.family = d.family;
  }

  get bindings(): Binding[] | undefined { return this.settings.bindings[this.id]; }
  /** Wheels always use bindings; non-standard pads need them too. */
  get usesBindings(): boolean { return this.kind === 'wheel' || !this.standard; }
  get needsMapping(): boolean { return this.usesBindings && !this.bindings?.length; }
  get shifterOnly(): boolean {
    const b = this.bindings;
    return !!b?.length && b.every((x) => x.action in GEAR_ACTIONS);
  }

  pad(): Gamepad | null { return navigator.getGamepads()[this.index] ?? null; }

  poll(_dt: number, out: InputFrame): boolean {
    const pad = this.pad();
    if (!pad) return false;
    let touched = false;
    const pressedNow = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const edge = (i: number) => pressedNow[i] && !this.prevButtons[i];
    for (let i = 0; i < pressedNow.length; i++) if (edge(i)) touched = true;

    if (!this.usesBindings) {
      const s = this.settings;
      const x = pad.axes[0] ?? 0;
      const ax = Math.abs(x);
      const dz = s.deadzone;
      out.steer = ax <= dz ? 0 : Math.sign(x) * Math.pow((ax - dz) / (1 - dz), s.steerCurve);
      out.throttle = pad.buttons[STD.rt]?.value ?? 0;
      out.brake = pad.buttons[STD.lt]?.value ?? 0;
      out.handbrake = pad.buttons[STD.south]?.value ?? 0;
      out.clutch = pad.buttons[STD.west]?.value ?? 0;
      for (const [action, idx] of Object.entries(PAD_LAYOUT)) {
        if (idx === null || action === 'handbrake' || action === 'clutch') continue;
        if (edge(idx)) out.pressed.add(action as ButtonAction);
      }
      if (ax > 0.35 || out.throttle > 0.2 || out.brake > 0.2) touched = true;
    } else {
      const binds = this.bindings ?? [];
      if (!this.restAxes) this.restAxes = [...pad.axes];
      let hGear: number | null = null;
      let hasShifter = false;
      for (const b of binds) {
        if (b.action in GEAR_ACTIONS) {
          hasShifter = true;
          if (b.kind === 'button' && pressedNow[b.index]) hGear = GEAR_ACTIONS[b.action];
          continue;
        }
        let v: number;
        if (b.kind === 'button') {
          v = pad.buttons[b.index]?.value ?? 0;
          if (edge(b.index) && !isAxisAction(b.action)) out.pressed.add(b.action as ButtonAction);
        } else {
          const raw = pad.axes[b.index] ?? b.rest;
          const span = b.full - b.rest || 1;
          v = (raw - b.rest) / span;
        }
        switch (b.action) {
          case 'steer': {
            // 1:1 — no filtering; range maps the driver's lock-to-lock onto our steering range
            const ratio = this.settings.wheelRange / Math.max(90, this.settings.steerRange);
            out.steer = clamp(v * ratio, -1, 1);
            break;
          }
          case 'throttle': out.throttle = clamp(v, 0, 1); break;
          case 'brake': out.brake = clamp(v, 0, 1); break;
          case 'clutch': out.clutch = clamp(v, 0, 1); out.hasClutchPedal = true; break;
          case 'handbrake': out.handbrake = clamp(v, 0, 1); break;
        }
      }
      if (hasShifter) out.hGear = hGear ?? 0;
      // active if anything moved meaningfully from rest
      for (let i = 0; i < pad.axes.length; i++) {
        if (Math.abs(pad.axes[i] - this.restAxes[i]) > 0.25) { touched = true; break; }
      }
      if (hasShifter && out.hGear !== this.lastHGear) touched = true;
      this.lastHGear = out.hGear;
    }
    this.prevButtons = pressedNow;
    // a stand-alone H-shifter feeds gears but must never become the "active" driving device
    return touched && !this.shifterOnly;
  }

  /** Rumble where supported (Chromium: dual-rumble on Xbox / DualShock / most DualSense). */
  rumble(strong: number, weak: number, ms: number): void {
    const pad = this.pad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
    const act = pad?.vibrationActuator;
    if (!act?.playEffect) return;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
  }
}

function isAxisAction(a: string): boolean { return a === 'steer' || a === 'throttle' || a === 'brake' || a === 'clutch' || a === 'handbrake'; }
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
