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
  assist: Record<DeviceKind, number>;  // auto-countersteer 0..1 per device kind
  deadzone: number;
  steerCurve: number;                  // gamepad stick response exponent
  mouseSteer: boolean;
  gearbox: 'auto' | 'manual';
  hRequiresClutch: boolean;
  wheelRange: number;                  // degrees lock-to-lock the wheel driver reports
  steerRange: number;                  // degrees lock-to-lock that give full front lock
  vibration: boolean;
  showHelp: boolean;
  showTelemetry: boolean;
  bindings: Record<string, Binding[]>; // keyed by Gamepad.id
  tuning: Tuning | null;               // null = car defaults
}

const KEY = 'kl.settings.v1';

export function defaultSettings(): Settings {
  return {
    assist: { wheel: 0, gamepad: 0.6, keyboard: 0.6, touch: 0.7 },
    deadzone: 0.08,
    steerCurve: 1.25,
    mouseSteer: false,
    gearbox: 'auto',
    hRequiresClutch: true,
    wheelRange: 900,
    steerRange: 540,
    vibration: true,
    showHelp: true,
    showTelemetry: false,
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
    return { ...d, ...s, assist: { ...d.assist, ...(s.assist ?? {}) }, bindings: s.bindings ?? {} };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
