import type { CarSpec, DiffType, TireParams } from '../data/e30';
import { tireForce, type TireForce } from './tire';

/** Driver inputs after the input layer. steer: -1 full left … +1 full right. Pedals 0..1. */
export interface CarControls {
  steer: number;
  throttle: number;
  brake: number;
  clutch: number;     // pedal travel, 1 = fully pressed (disengaged)
  handbrake: number;
}

/** Values the pause menu can change live. */
export interface CarSetup {
  powerScale: number;
  diffType: DiffType;
  lsdLockRatio: number;
  maxSteerAngle: number; // rad
  gripFront: number;
  gripRear: number;
  brakeBias: number;     // front fraction
  assist: number;        // auto-countersteer 0..1
  autoGearbox: boolean;
  autoClutch: boolean;   // anti-stall / launch clutch (on unless the player uses a clutch pedal)
}

export function defaultSetup(spec: CarSpec): CarSetup {
  return {
    powerScale: spec.engine.powerScale,
    diffType: spec.diff.type,
    lsdLockRatio: spec.diff.lsdLockRatio,
    maxSteerAngle: spec.steering.maxAngle,
    gripFront: 1,
    gripRear: 1,
    brakeBias: spec.brakes.frontBias,
    assist: 0.6,
    autoGearbox: true,
    autoClutch: true,
  };
}

export interface WheelState {
  readonly tire: TireParams;
  readonly px: number;   // body position, +x = left [m]
  readonly pz: number;   // body position, +z = forward [m]
  readonly driven: boolean;
  omega: number;         // spin [rad/s]
  spinAngle: number;     // accumulated, for visuals
  steer: number;         // [rad] + = left
  fz: number;            // load [N]
  slipRatio: number;
  slipAngle: number;     // [rad]
  slip: number;          // combined normalized slip
  slideSpeed: number;    // contact patch sliding speed [m/s] (smoke / squeal)
  fx: number; fy: number;
}

const G = 9.81;
const SUBSTEPS = 4;
const SOLVER_ITERS = 6;
const LOW_SPEED = 3; // m/s floor for slip denominators (keeps the stiff tire stable)

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const RPM = 60 / (2 * Math.PI);

/**
 * Planar rigid-body car (x, z, yaw) with four independently spinning wheels,
 * an engine with inertia, a slipping clutch, a 5-speed box and a configurable diff.
 * Drivetrain couplings (clutch, diff, brakes) are solved as clamped velocity constraints so a
 * locked clutch or welded diff stays stable at a 240 Hz step.
 */
export class Car {
  readonly spec: CarSpec;
  setup: CarSetup;

  // body
  x = 0; z = 0; yaw = 0;
  vx = 0; vz = 0;       // world velocity
  yawRate = 0;          // + = turning left
  /** Filtered body accelerations (forward, left) [m/s^2]; drive load transfer and body roll. */
  accFwd = 0; accLeft = 0;

  readonly wheels: WheelState[];

  // drivetrain
  engineOmega: number;
  gear = 1;             // -1 = R, 0 = N, 1..5
  clutchEngagement = 1;
  throttleApplied = 0;
  limiterCut = false;
  shiftTimer = 0;
  private reverseHold = 0;
  private pendingGear: number | null = null;

  // derived each step, for HUD / scoring / sound
  speed = 0;            // [m/s]
  forwardSpeed = 0;
  driftAngle = 0;       // [rad] signed, + = velocity left of the nose
  steerAngle = 0;

  private tf: TireForce = { fx: 0, fy: 0, slip: 0 };

  constructor(spec: CarSpec, setup?: CarSetup) {
    this.spec = spec;
    this.setup = setup ?? defaultSetup(spec);
    const { wheelbase, trackFront, trackRear } = spec.dims;
    const a = wheelbase * (1 - spec.frontWeight); // CG -> front axle
    const b = wheelbase * spec.frontWeight;       // CG -> rear axle
    const mk = (tire: TireParams, px: number, pz: number, driven: boolean): WheelState => ({
      tire, px, pz, driven, omega: 0, spinAngle: 0, steer: 0, fz: 0,
      slipRatio: 0, slipAngle: 0, slip: 0, slideSpeed: 0, fx: 0, fy: 0,
    });
    this.wheels = [
      mk(spec.tires.front, trackFront / 2, a, false),  // FL
      mk(spec.tires.front, -trackFront / 2, a, false), // FR
      mk(spec.tires.rear, trackRear / 2, -b, true),    // RL
      mk(spec.tires.rear, -trackRear / 2, -b, true),   // RR
    ];
    this.engineOmega = spec.engine.idleRpm / RPM;
  }

  get rpm(): number { return this.engineOmega * RPM; }

  reset(x: number, z: number, yaw: number): void {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = this.vz = this.yawRate = 0;
    this.accFwd = this.accLeft = 0;
    for (const w of this.wheels) { w.omega = 0; w.slip = 0; w.slideSpeed = 0; }
    this.engineOmega = this.spec.engine.idleRpm / RPM;
    this.gear = 1; this.shiftTimer = 0; this.pendingGear = null;
  }

  /** Request a gear change. Manual: immediate request; returns false if refused. */
  shift(delta: number): boolean {
    return this.selectGear(clamp(this.gear + delta, -1, this.spec.gearbox.ratios.length));
  }

  selectGear(g: number): boolean {
    if (g === this.gear || this.pendingGear !== null) return false;
    this.pendingGear = g;
    this.shiftTimer = this.spec.gearbox.shiftTime;
    return true;
  }

  /** Overall ratio engine -> wheel, signed (negative in reverse). */
  gearRatio(g = this.gear): number {
    const gb = this.spec.gearbox;
    if (g === 0) return 0;
    if (g < 0) return -gb.reverse * gb.final;
    return gb.ratios[g - 1] * gb.final;
  }

  engineTorqueCurve(rpm: number): number {
    const c = this.spec.engine.torqueCurve;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (rpm <= c[i][0]) {
        const [r0, t0] = c[i - 1];
        const [r1, t1] = c[i];
        return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
      }
    }
    return c[c.length - 1][1];
  }

  step(dt: number, ctl: CarControls): void {
    const spec = this.spec;
    const set = this.setup;
    const m = spec.mass;
    const L = spec.dims.wheelbase;
    const h = spec.dims.cgHeight;

    // ---- body-frame velocity
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // forward = (sin, cos), left = (cos, -sin) in world (x, z)
    const u = this.vx * sinY + this.vz * cosY;
    const vl = this.vx * cosY - this.vz * sinY;
    this.forwardSpeed = u;
    this.speed = Math.hypot(this.vx, this.vz);
    this.driftAngle = this.speed > 1 ? Math.atan2(vl, Math.abs(u)) : 0;

    // ---- gearbox (auto + shift timing)
    this.updateGearbox(dt, ctl, u);
    let throttle = ctl.throttle;
    let brake = ctl.brake;
    if (set.autoGearbox && this.gear < 0) { throttle = ctl.brake; brake = ctl.throttle; }

    // ---- steering: driver angle + auto-countersteer. The assist points the front wheels along
    // the front axle's own direction of travel (zero front slip), like strong caster: hands off,
    // the fronts follow the slide and the player only adds or removes angle around that.
    const maxSteer = set.maxSteerAngle;
    let delta = -ctl.steer * maxSteer;
    if (set.assist > 0 && u > 0) {
      const fade = smoothstep(2, 6, this.speed);
      const aFront = this.wheels[0].pz;
      const frontCourse = Math.atan2(vl + this.yawRate * aFront, Math.max(u, 0.5));
      delta += set.assist * fade * clamp(frontCourse, -maxSteer, maxSteer);
    }
    delta = clamp(delta, -maxSteer, maxSteer);
    this.steerAngle = delta;
    const ack = spec.steering.ackermann;
    // inner wheel turns more
    this.wheels[0].steer = delta * (1 + (delta > 0 ? ack : -ack) * 0.5);
    this.wheels[1].steer = delta * (1 + (delta < 0 ? ack : -ack) * 0.5);
    this.wheels[2].steer = 0;
    this.wheels[3].steer = 0;

    // ---- vertical loads (static + longitudinal + lateral transfer)
    const wf = spec.frontWeight;
    const longT = (m * this.accFwd * h) / L;
    const frontAxle = m * G * wf - longT;
    const rearAxle = m * G * (1 - wf) + longT;
    const latTotal = m * this.accLeft * h; // + accel left => load moves right
    const dFront = (set_rsf(spec) * latTotal) / spec.dims.trackFront;
    const dRear = ((1 - set_rsf(spec)) * latTotal) / spec.dims.trackRear;
    const W = this.wheels;
    W[0].fz = Math.max(0, frontAxle / 2 - dFront);
    W[1].fz = Math.max(0, frontAxle / 2 + dFront);
    W[2].fz = Math.max(0, rearAxle / 2 - dRear);
    W[3].fz = Math.max(0, rearAxle / 2 + dRear);

    // ---- clutch engagement
    const rpm = this.rpm;
    // pedal travel -> engagement: fully engaged in the top 15 %, bite point around mid-travel
    let engage = 1 - smoothstep(0.15, 0.75, clamp(ctl.clutch, 0, 1));
    if (set.autoClutch && this.gear !== 0) {
      engage = Math.min(engage, smoothstep(spec.engine.idleRpm + 100, spec.engine.idleRpm + 1300, rpm));
    }
    engage *= 1 - smoothstep(0.1, 0.6, ctl.handbrake); // handbrake declutches
    if (this.shiftTimer > 0) engage = 0;
    if (this.gear === 0) engage = 0;
    this.clutchEngagement = engage;

    // ---- engine torque (throttle, idle governor, limiter, engine braking)
    const eng = spec.engine;
    if (rpm > eng.limiterRpm) this.limiterCut = true;
    else if (rpm < eng.limiterRpm - 180) this.limiterCut = false;
    const idleThrottle = clamp((eng.idleRpm + 50 - rpm) / 250, 0, 0.35);
    let th = Math.max(clamp(throttle, 0, 1), idleThrottle);
    if (this.limiterCut) th = 0;
    this.throttleApplied = th;
    const engineTorque =
      this.engineTorqueCurve(rpm) * set.powerScale * th * spec.gearbox.efficiency
      - (1 - th) * eng.engineBrake * (rpm / eng.limiterRpm)
      - eng.frictionTorque - eng.frictionPerRad * this.engineOmega;

    // ---- brakes
    const bias = set.brakeBias;
    const bt = clamp(brake, 0, 1) * spec.brakes.maxTorque * 2;
    const hb = clamp(ctl.handbrake, 0, 1) * spec.brakes.handbrakeTorque;
    const brakeTorque = [bt * bias, bt * bias, bt * (1 - bias) + hb, bt * (1 - bias) + hb];

    // ---- substeps: tire forces + drivetrain
    const hs = dt / SUBSTEPS;
    const ratio = this.gearRatio();
    const capClutch = engage * spec.clutch.maxTorque * hs;
    const grip = [set.gripFront, set.gripFront, set.gripRear, set.gripRear];
    let sumLeft = 0, sumFwd = 0, sumTorque = 0;
    const wFx = [0, 0, 0, 0], wFy = [0, 0, 0, 0], wSlip = [0, 0, 0, 0], wSlide = [0, 0, 0, 0];
    const r = this.yawRate;
    let clutchTorqueAbs = 0;

    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 0; i < 4; i++) {
        const w = W[i];
        const R = w.tire.radius;
        const cvx = vl + r * w.pz;          // contact velocity, body frame (left)
        const cvz = u - r * w.px;           // (forward)
        const sd = Math.sin(w.steer), cd = Math.cos(w.steer);
        const vLong = cvx * sd + cvz * cd;
        const vLat = cvx * cd - cvz * sd;
        const wr = w.omega * R;
        const kappa = (wr - vLong) / Math.max(Math.abs(vLong), Math.abs(wr), LOW_SPEED);
        const tanA = vLat / Math.max(Math.abs(vLong), LOW_SPEED);
        const f = tireForce(w.tire, w.fz, kappa, tanA, grip[i], wr - vLong, vLat, this.tf);
        // body-frame force
        const fl = f.fx * sd + f.fy * cd;
        const ff = f.fx * cd - f.fy * sd;
        sumLeft += fl; sumFwd += ff;
        sumTorque += w.pz * fl - w.px * ff;
        wFx[i] += f.fx; wFy[i] += f.fy;
        wSlip[i] = f.slip;
        wSlide[i] = Math.hypot(wr - vLong, vLat);
        if (s === SUBSTEPS - 1) { w.slipRatio = kappa; w.slipAngle = Math.atan(tanA); }
        // road + rolling resistance torque
        const rr = w.tire.rollingResistance * w.fz * R * Math.tanh(w.omega * R * 2);
        w.omega += ((-f.fx * R - rr) / w.tire.inertia) * hs;
      }
      this.engineOmega += (engineTorque / eng.inertia) * hs;

      // constraint solve (accumulated, clamped impulses)
      const RL = W[2], RR = W[3];
      const invL = 1 / RL.tire.inertia, invR = 1 / RR.tire.inertia, invE = 1 / eng.inertia;
      let accClutch = 0, accDiff = 0;
      const accBrake = [0, 0, 0, 0];
      for (let it = 0; it < SOLVER_ITERS; it++) {
        // clutch: engineOmega = ratio * (RL + RR) / 2
        if (capClutch > 0 && ratio !== 0) {
          const g2 = ratio / 2;
          const C = this.engineOmega - g2 * (RL.omega + RR.omega);
          const invM = invE + g2 * g2 * (invL + invR);
          let lambda = -C / invM;
          const prev = accClutch;
          accClutch = clamp(prev + lambda, -capClutch, capClutch);
          lambda = accClutch - prev;
          this.engineOmega += lambda * invE;
          RL.omega -= g2 * lambda * invL;
          RR.omega -= g2 * lambda * invR;
        }
        // differential: RL.omega = RR.omega, limited by diff type
        {
          const driveT = Math.abs(accClutch / hs) * Math.abs(ratio);
          let cap: number;
          switch (set.diffType) {
            case 'welded': cap = Infinity; break;
            case 'lsd': cap = (spec.diff.lsdPreload + set.lsdLockRatio * driveT) * hs; break;
            default: cap = 4 * hs;
          }
          const C = RL.omega - RR.omega;
          let lambda = -C / (invL + invR);
          const prev = accDiff;
          accDiff = clamp(prev + lambda, -cap, cap);
          lambda = accDiff - prev;
          RL.omega += lambda * invL;
          RR.omega -= lambda * invR;
        }
        // brakes: drive omega toward 0
        for (let i = 0; i < 4; i++) {
          const cap = brakeTorque[i] * hs;
          if (cap <= 0) continue;
          const w = W[i];
          let lambda = -w.omega * w.tire.inertia;
          const prev = accBrake[i];
          accBrake[i] = clamp(prev + lambda, -cap, cap);
          lambda = accBrake[i] - prev;
          w.omega += lambda / w.tire.inertia;
        }
      }
      clutchTorqueAbs += Math.abs(accClutch / hs);
      // the engine never stalls in this prototype
      const minOmega = (eng.idleRpm * 0.55) / RPM;
      if (this.engineOmega < minOmega) this.engineOmega = minOmega;
    }

    // ---- wheel outputs
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      w.fx = wFx[i] / SUBSTEPS; w.fy = wFy[i] / SUBSTEPS;
      w.slip = wSlip[i]; w.slideSpeed = wSlide[i];
      w.spinAngle = (w.spinAngle + w.omega * dt) % (Math.PI * 2);
    }
    this.clutchTorque = clutchTorqueAbs / SUBSTEPS;

    // ---- body integration
    let fLeft = sumLeft / SUBSTEPS;
    let fFwd = sumFwd / SUBSTEPS;
    const tq = sumTorque / SUBSTEPS;
    const aero = 0.5 * spec.aero.airDensity * spec.aero.cd * spec.aero.frontalArea * this.speed;
    fLeft -= aero * vl;
    fFwd -= aero * u;
    const aF = fFwd / m, aL = fLeft / m;
    const ax = aF * sinY + aL * cosY;
    const az = aF * cosY - aL * sinY;
    this.vx += ax * dt;
    this.vz += az * dt;
    this.yawRate += (tq / spec.yawInertia) * dt;
    this.yaw += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // standstill: kill numerical creep
    if (this.speed < 0.05 && Math.abs(this.yawRate) < 0.02 && throttle < 0.02 && (brake > 0.1 || ctl.handbrake > 0.1)) {
      this.vx *= 0.5; this.vz *= 0.5; this.yawRate *= 0.5;
    }

    const k = dt / (spec.suspension.loadTransferLag + dt);
    this.accFwd += (aF - this.accFwd) * k;
    this.accLeft += (aL - this.accLeft) * k;
  }

  clutchTorque = 0;

  private updateGearbox(dt: number, ctl: CarControls, u: number): void {
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      // engage the new gear halfway through the shift
      if (this.pendingGear !== null && this.shiftTimer < this.spec.gearbox.shiftTime * 0.5) {
        this.gear = this.pendingGear;
        this.pendingGear = null;
      }
      return;
    }
    if (!this.setup.autoGearbox) return;
    const gb = this.spec.gearbox;
    const rpm = this.rpm;
    // reverse logic: hold brake at standstill to reverse, throttle to go forward again
    if (Math.abs(u) < 0.6) {
      if (this.gear > 0 && ctl.brake > 0.5 && ctl.throttle < 0.1) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.35) { this.reverseHold = 0; this.selectGear(-1); }
        return;
      }
      if (this.gear < 0 && ctl.throttle > 0.3 && ctl.brake < 0.1) { this.selectGear(1); return; }
      this.reverseHold = 0;
    } else this.reverseHold = 0;
    if (this.gear < 1) { if (this.gear === 0) this.selectGear(1); return; }

    // wheel-based rpm so we don't upshift on wheelspin alone during a drift
    const rear = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    const groundOmega = u / this.wheels[2].tire.radius;
    const spinning = rear - groundOmega > 8;
    if (rpm > gb.autoUpRpm && this.gear < gb.ratios.length && this.clutchEngagement > 0.9 && !spinning) {
      this.selectGear(this.gear + 1);
    } else if (this.gear > 1) {
      const lowerRpm = groundOmega * this.gearRatio(this.gear - 1) * RPM;
      if (rpm < gb.autoDownRpm && lowerRpm < gb.autoUpRpm - 700) this.selectGear(this.gear - 1);
    }
  }
}

function set_rsf(spec: CarSpec): number { return spec.suspension.rollStiffnessFront; }
