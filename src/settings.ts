import type { AxisAction, ButtonAction, DeviceKind } from './input/actions';
import type { DiffType } from './data/e30';

/** One control bound to an action on a non-standard device (wheel, pedals, odd gamepad). */
export interface Binding {
  action: AxisAction | ButtonAction;
  kind: 'axis' | 'button';
  index: number;
  rest: number;   // axis value at rest (calibrated)
  full: number;   // axis value at full travel (calibrated); sign encodes inversion
}

export interface Tuning {
  powerScale: number;
  diffType: DiffType;
  lsdLockRatio: number;
  maxSteerDeg: number;
  gripFront: number;
  gripRear: number;
  brakeBias: number;
}

export interface Settings {
  schema: number;
  assist: Record<DeviceKind, number>;  // auto-countersteer 0..1 per device kind
  driftAssist: Record<DeviceKind, number>; // FR Legends-style angle/speed hold 0..1 per device kind
  deadzone: number;
  steerCurve: number;                  // gamepad stick response exponent
  mouseSteer: boolean;
  gearbox: 'auto' | 'manual';
  hRequiresClutch: boolean;
  wheelRange: number;                  // degrees lock-to-lock the wheel driver reports
  steerRange: number;                  // degrees lock-to-lock that give full front lock
  vibration: boolean;
  volume: number;
  showHelp: boolean;
  showTelemetry: boolean;
  touchSteer: 'gyro' | 'buttons';
  gyroLockDeg: number;                 // tilt for full lock (spec: ±60°)
  gyroDeadzone: number;                // degrees
  gyroInvert: boolean;
  touchShiftButtons: boolean;          // show +/− (switches to manual when used)
  quality: 'auto' | 'low' | 'medium' | 'high';
  bindings: Record<string, Binding[]>; // keyed by Gamepad.id
  tuning: Tuning | null;               // null = car defaults
}

const KEY = 'kl.settings.v1';
const SCHEMA = 2;

/** Digital controls lose steering authority at speed (arcade feel); wheels and sticks less or none. */
export const STEER_AT_SPEED: Record<DeviceKind, number> = { wheel: 1, gamepad: 0.6, keyboard: 0.3, touch: 0.3 };

export function defaultSettings(): Settings {
  return {
    schema: SCHEMA,
    assist: { wheel: 0, gamepad: 0.6, keyboard: 0.6, touch: 0.7 },
    driftAssist: { wheel: 0, gamepad: 0.7, keyboard: 0.85, touch: 1 },
    deadzone: 0.08,
    steerCurve: 1.25,
    mouseSteer: false,
    gearbox: 'auto',
    hRequiresClutch: true,
    wheelRange: 900,
    steerRange: 540,
    vibration: true,
    volume: 0.7,
    showHelp: true,
    showTelemetry: false,
    touchSteer: 'buttons', // FR Legends-style ◀ ▶ by default; gyro selectable in Pausa
    gyroLockDeg: 60,
    gyroDeadzone: 2,
    gyroInvert: false,
    touchShiftButtons: false,
    quality: 'auto',
    bindings: {},
    tuning: null,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    // schema 1 → 2: the phone switched to FR Legends-style buttons as default steering
    if ((s.schema ?? 1) < 2) s.touchSteer = 'buttons';
    return {
      ...d, ...s, schema: SCHEMA,
      assist: { ...d.assist, ...(s.assist ?? {}) },
      driftAssist: { ...d.driftAssist, ...(s.driftAssist ?? {}) },
      bindings: s.bindings ?? {},
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
