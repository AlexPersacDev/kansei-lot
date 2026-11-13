import * as THREE from 'three';
import type { Car } from '../physics/car';

export type CameraMode = 'chase' | 'far' | 'hood';
const MODES: CameraMode[] = ['chase', 'far', 'hood'];

interface ChaseParams { dist: number; height: number; look: number; fov: number; distGain: number; fovGain: number }
const PARAMS: Record<'chase' | 'far', ChaseParams> = {
  chase: { dist: 7.2, height: 2.1, look: 0.9, fov: 60, distGain: 1.8, fovGain: 10 },
  far: { dist: 12, height: 4.4, look: 0.8, fov: 55, distGain: 3, fovGain: 8 },
};

/**
 * FR Legends-style camera: low, close, behind the car, but aligned with where the car is going
 * (velocity), not where it points. A drifting car therefore sits sideways on screen.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  followLag = 3.2;     // 1/s, how fast the heading catches up with the velocity direction
  private heading = 0;
  private speedSm = 0;
  private pos = new THREE.Vector3();
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1500);
  }

  cycle(): CameraMode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    return this.mode;
  }

  snap(car: Car): void { this.initialised = false; this.update(car, 1); }

  update(car: Car, dt: number): void {
    const cam = this.camera;
    const speed = car.speed;
    this.speedSm += (speed - this.speedSm) * (1 - Math.exp(-dt * 2));

    if (this.mode === 'hood') {
      const fwdX = Math.sin(car.yaw), fwdZ = Math.cos(car.yaw);
      const p = new THREE.Vector3(car.x + fwdX * 0.6, 1.12, car.z + fwdZ * 0.6);
      cam.position.copy(p);
      cam.lookAt(p.x + fwdX * 10, 1.0, p.z + fwdZ * 10);
      cam.fov = 72 + Math.min(1, this.speedSm / 40) * 8;
      cam.updateProjectionMatrix();
      return;
    }

    // target heading: velocity direction when moving forward, the car's nose otherwise
    const velHeading = Math.atan2(car.vx, car.vz);
    const w = smooth01((car.forwardSpeed - 1.5) / 4);
    const target = lerpAngle(car.yaw, velHeading, w);
    if (!this.initialised) { this.heading = target; }
    this.heading = lerpAngle(this.heading, target, 1 - Math.exp(-dt * this.followLag));

    const p = PARAMS[this.mode];
    const sp = Math.min(1, this.speedSm / 35);
    const dist = p.dist + p.distGain * sp;
    const want = new THREE.Vector3(
      car.x - Math.sin(this.heading) * dist,
      p.height + 0.3 * sp,
      car.z - Math.cos(this.heading) * dist,
    );
    if (!this.initialised) { this.pos.copy(want); this.initialised = true; }
    this.pos.lerp(want, 1 - Math.exp(-dt * 12));
    cam.position.copy(this.pos);
    cam.lookAt(car.x, p.look, car.z);
    cam.fov = p.fov + p.fovGain * sp;
    cam.updateProjectionMatrix();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
