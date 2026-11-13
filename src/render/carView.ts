import type * as THREE from 'three';
import type { Car } from '../physics/car';

/**
 * Anything that can draw the car. The physics never touches this, so the procedural greybox
 * (e30Model.ts) can later be swapped for a loaded glTF that implements the same interface:
 *  - `root` placed at the car's ground point under the CG, +Z = forward, +X = left;
 *  - wheels positioned from `car.wheels[i].px/pz`, spun with `spinAngle`, steered with `steer`;
 *  - body roll / pitch from `car.accLeft / accFwd`.
 */
export interface CarVisual {
  readonly root: THREE.Object3D;
  update(car: Car, dt: number): void;
}
