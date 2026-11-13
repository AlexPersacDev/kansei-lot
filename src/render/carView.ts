import * as THREE from 'three';
import type { Car } from '../physics/car';

/**
 * Anything that can draw the car. The physics never touches this, so the greybox can later be
 * swapped for a loaded glTF that implements the same interface.
 */
export interface CarVisual {
  readonly root: THREE.Object3D;
  update(car: Car, dt: number): void;
}

/** Step-1 placeholder: proportioned boxes + real wheels, with steer, spin and body roll/pitch. */
export class BoxCarVisual implements CarVisual {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private wheelSteer: THREE.Group[] = [];
  private wheelSpin: THREE.Group[] = [];
  private roll = 0;
  private pitch = 0;

  constructor(car: Car) {
    const { length, width, height } = car.spec.dims;
    const paint = new THREE.MeshPhysicalMaterial({ color: '#c8402e', roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#1d2329', roughness: 0.05, metalness: 0.2 });
    const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.7 });

    const r = car.wheels[0].tire.radius;
    const sill = 0.16;
    const lower = new THREE.Mesh(new THREE.BoxGeometry(width, 0.62, length), paint);
    lower.position.y = sill + 0.31;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, height - sill - 0.62, length * 0.44), glass);
    cabin.position.set(0, sill + 0.62 + (height - sill - 0.62) / 2, -0.15);
    // a nose marker so heading is obvious
    const nose = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.12, 0.08), black);
    nose.position.set(0, sill + 0.4, length / 2 + 0.02);
    for (const m of [lower, cabin, nose]) { m.castShadow = true; m.receiveShadow = true; this.body.add(m); }
    this.root.add(this.body);

    const tireMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#b9bcc0', roughness: 0.3, metalness: 0.8 });
    for (const w of car.wheels) {
      const steer = new THREE.Group();
      steer.position.set(w.px, w.tire.radius, w.pz);
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(w.tire.radius, w.tire.radius, w.tire.width, 24), tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w.tire.width + 0.01, 5), rimMat);
      rim.rotation.z = Math.PI / 2;
      spin.add(tire, rim);
      steer.add(spin);
      this.root.add(steer);
      this.wheelSteer.push(steer);
      this.wheelSpin.push(spin);
    }
  }

  update(car: Car, dt: number): void {
    this.root.position.set(car.x, 0, car.z);
    this.root.rotation.y = car.yaw;
    car.wheels.forEach((w, i) => {
      this.wheelSteer[i].rotation.y = w.steer;
      this.wheelSpin[i].rotation.x = w.spinAngle;
    });
    const s = car.spec.suspension;
    const k = 1 - Math.exp(-dt * 10);
    this.roll += (car.accLeft * s.rollGain - this.roll) * k;
    this.pitch += (-car.accFwd * s.pitchGain - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
  }
}
