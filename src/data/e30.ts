/**
 * BMW 316i E30 coupé, lightly modified. Every number the physics uses lives here.
 * Units: SI (m, kg, s, N, Nm, rad) unless the name says otherwise.
 */

export type DiffType = 'open' | 'lsd' | 'welded';

export interface TireParams {
  mu: number;            // peak friction coefficient
  loadSensitivity: number; // mu drop per unit of (Fz/Fz0 - 1)
  refLoad: number;       // Fz0 [N]
  slipRatioPeak: number; // kappa at peak longitudinal force
  slipAnglePeak: number; // alpha at peak lateral force [rad]
  shape: number;         // Pacejka C (lower = more grip kept when sliding)
  radius: number;        // [m]
  width: number;         // [m] (visual)
  inertia: number;       // wheel + brake rotating inertia [kg m^2]
  rollingResistance: number;
}

export interface CarSpec {
  name: string;
  dims: {
    length: number; width: number; height: number;
    wheelbase: number; trackFront: number; trackRear: number;
    cgHeight: number;
  };
  mass: number;
  frontWeight: number;   // static fraction on front axle
  yawInertia: number;
  aero: { cd: number; frontalArea: number; airDensity: number };
  engine: {
    idleRpm: number; redlineRpm: number; limiterRpm: number;
    inertia: number;     // crank + flywheel [kg m^2]
    torqueCurve: [rpm: number, nm: number][];
    powerScale: number;  // tuning multiplier
    frictionTorque: number;   // constant [Nm]
    frictionPerRad: number;   // viscous [Nm / (rad/s)]
    engineBrake: number;      // closed-throttle pumping torque at limiter [Nm]
  };
  clutch: { maxTorque: number };
  gearbox: {
    ratios: number[];    // forward gears, 1st first
    reverse: number;
    final: number;
    efficiency: number;
    shiftTime: number;   // [s] clutch open during a shift
    autoUpRpm: number;
    autoDownRpm: number;
  };
  diff: { type: DiffType; lsdPreload: number; lsdLockRatio: number };
  steering: { maxAngle: number; ackermann: number };
  brakes: { maxTorque: number; frontBias: number; handbrakeTorque: number };
  suspension: {
    rollStiffnessFront: number; // fraction of lateral load transfer taken by the front axle
    loadTransferLag: number;    // [s] filter on accelerations (stands in for springs/dampers)
    rideHeightDrop: number;     // [m] coilover drop (visual)
    rollGain: number;           // body roll [rad per m/s^2] (visual)
    pitchGain: number;          // body pitch [rad per m/s^2] (visual)
  };
  tires: { front: TireParams; rear: TireParams };
}

const deg = Math.PI / 180;

export const E30: CarSpec = {
  name: 'BMW 316i E30 coupé',
  dims: {
    length: 4.325, width: 1.645, height: 1.33,
    wheelbase: 2.57, trackFront: 1.407, trackRear: 1.415,
    cgHeight: 0.48,
  },
  mass: 1050,
  frontWeight: 0.53,
  yawInertia: 1550,
  aero: { cd: 0.38, frontalArea: 1.86, airDensity: 1.225 },
  engine: {
    idleRpm: 850, redlineRpm: 6200, limiterRpm: 6400,
    inertia: 0.16,
    // M40B16, ~102 PS stock; powerScale lifts it to ~110 CV.
    torqueCurve: [
      [0, 60], [1000, 95], [2000, 118], [3000, 130], [4250, 141],
      [5000, 138], [5500, 133], [6000, 123], [6400, 113], [7000, 80],
    ],
    powerScale: 1.07,
    frictionTorque: 8,
    frictionPerRad: 0.025,
    engineBrake: 35,
  },
  clutch: { maxTorque: 300 },
  gearbox: {
    ratios: [3.72, 2.02, 1.32, 1.0, 0.81],
    reverse: 3.45,
    final: 4.10,
    efficiency: 0.92,
    shiftTime: 0.18,
    autoUpRpm: 6150,
    autoDownRpm: 2600,
  },
  diff: { type: 'welded', lsdPreload: 60, lsdLockRatio: 0.45 },
  steering: { maxAngle: 55 * deg, ackermann: 0.15 },
  brakes: { maxTorque: 1500, frontBias: 0.66, handbrakeTorque: 2400 },
  suspension: {
    rollStiffnessFront: 0.56,
    loadTransferLag: 0.06,
    rideHeightDrop: 0.04,
    rollGain: 0.0075,
    pitchGain: 0.0045,
  },
  tires: {
    // 195/50 R15 front, 215/50 R15 rear (wider rears)
    front: {
      mu: 1.02, loadSensitivity: 0.12, refLoad: 2700,
      slipRatioPeak: 0.11, slipAnglePeak: 7.5 * deg, shape: 1.45,
      radius: 0.292, width: 0.195, inertia: 1.0, rollingResistance: 0.013,
    },
    rear: {
      mu: 1.0, loadSensitivity: 0.12, refLoad: 2500,
      slipRatioPeak: 0.11, slipAnglePeak: 8 * deg, shape: 1.45,
      radius: 0.297, width: 0.215, inertia: 1.15, rollingResistance: 0.013,
    },
  },
};
