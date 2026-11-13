import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Car, WheelState } from '../physics/car';
import type { CarVisual } from './carView';

/** Look of the greybox. Geometry comes from the car spec + the E30 proportions below. */
export const E30_LOOK = {
  paint: '#a51b14',      // Zinnoberrot-ish
  rim: '#c9ccd1',
  caliper: '#c43a2a',
  steeringRatio: 10,     // visual: steering wheel turns = front wheel angle × this
};

type V3 = [number, number, number];

/**
 * Procedural BMW E30 coupé (no badges). Body = side-profile extrusions:
 *  outer side panels (with wheel arches) + a narrower core (inner wheel wells dark),
 *  greenhouse with tumblehome, thin C-pillar, twin round headlights, kidney grilles,
 *  black bumpers, horizontal tail lights, light arch flares. Static parts are merged per
 *  material to keep draw calls low on phones.
 */
export class E30Visual implements CarVisual {
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private body = new THREE.Group();
  private wheelSteer: THREE.Group[] = [];
  private wheelSpin: THREE.Group[] = [];
  private steeringWheel = new THREE.Group();
  private roll = 0;
  private pitch = 0;
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m: Record<string, THREE.Material>;

  constructor(car: Car, envMap: THREE.Texture | null) {
    const env = { envMap, envMapIntensity: 1 };
    this.m = {
      paint: new THREE.MeshPhysicalMaterial({ color: E30_LOOK.paint, roughness: 0.38, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.08, ...env, envMapIntensity: 0.55 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#0a0f13', roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.86, ...env, envMapIntensity: 1.6 }),
      black: new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.62, ...env, envMapIntensity: 0.4 }),
      trim: new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.4, ...env, envMapIntensity: 0.6 }),
      chrome: new THREE.MeshStandardMaterial({ color: '#e6e8ea', roughness: 0.12, metalness: 1, ...env }),
      lens: new THREE.MeshPhysicalMaterial({ color: '#f4f6f8', roughness: 0.05, metalness: 0.3, ...env, envMapIntensity: 1.5 }),
      red: new THREE.MeshStandardMaterial({ color: '#a3100d', roughness: 0.25, emissive: '#3a0303', ...env }),
      amber: new THREE.MeshStandardMaterial({ color: '#d77a12', roughness: 0.25, ...env }),
      well: new THREE.MeshStandardMaterial({ color: '#0e0e0f', roughness: 0.95 }),
      interior: new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.9 }),
      plate: new THREE.MeshStandardMaterial({ color: '#d9d9d2', roughness: 0.6 }),
      tire: new THREE.MeshStandardMaterial({ color: '#191919', roughness: 0.92 }),
      rim: new THREE.MeshStandardMaterial({ color: E30_LOOK.rim, roughness: 0.28, metalness: 0.85, ...env }),
      rimDark: new THREE.MeshStandardMaterial({ color: '#3a3c40', roughness: 0.5, metalness: 0.6, ...env }),
      disc: new THREE.MeshStandardMaterial({ color: '#77797c', roughness: 0.45, metalness: 0.8, ...env }),
      caliper: new THREE.MeshStandardMaterial({ color: E30_LOOK.caliper, roughness: 0.4, ...env }),
    };

    const F = car.wheels[0].pz;        // front axle z (from CG)
    const R = car.wheels[2].pz;        // rear axle z (negative)
    const halfW = car.spec.dims.width / 2;
    const rF = car.wheels[0].tire.radius, rR = car.wheels[2].tire.radius;
    const bevel = 0.025;
    const yBottom = 0.21;
    const archF = rF + 0.05 + bevel, archR = rR + 0.05 + bevel;

    // ---- body side profile (z, y) — E30 coupé proportions, measured from the axles
    const outline = (arches: boolean) => {
      const s = new THREE.Shape();
      s.moveTo(R - 0.80, yBottom);
      const arch = (cz: number, cy: number, rad: number) => {
        const dy = yBottom - cy;
        const dx = Math.sqrt(rad * rad - dy * dy);
        s.lineTo(cz - dx, yBottom);
        s.absarc(cz, cy, rad, Math.atan2(dy, -dx), Math.atan2(dy, dx), true);
      };
      if (arches) { arch(R, rR, archR); arch(F, rF, archF); }
      const pts: [number, number][] = [
        [F + 0.66, yBottom], [F + 0.735, 0.30], [F + 0.74, 0.60], [F + 0.735, 0.845], [F + 0.69, 0.882],
        [F + 0.25, 0.925], [F - 0.58, 0.952], [R - 0.05, 0.952], [R - 0.70, 0.938], [R - 0.785, 0.905],
        [R - 0.81, 0.62], [R - 0.80, 0.30],
      ];
      for (const [z, y] of pts) s.lineTo(z, y);
      s.closePath();
      return s;
    };
    const panelIn = halfW - 0.27;
    for (const side of [1, -1]) {
      const x0 = side > 0 ? panelIn : -halfW, x1 = side > 0 ? halfW : -panelIn;
      this.add(extrude(outline(true), x0, x1, bevel), this.m.paint);
    }
    // core: caps (inner wheel-well walls) dark, top surface paint
    // overlaps the panels slightly so the bevels don't leave a groove along the hood
    const core = extrude(outline(false), -panelIn - 0.02, panelIn + 0.02, bevel);
    const coreMesh = new THREE.Mesh(core, [this.m.well, this.m.paint]);
    coreMesh.castShadow = true; coreMesh.receiveShadow = true;
    this.body.add(coreMesh);

    // arch flares: slight lip around each arch on both sides
    for (const [cz, cy, rad] of [[F, rF, archF - bevel], [R, rR, archR - bevel]] as const) {
      for (const side of [1, -1]) {
        const dy = yBottom - cy;
        const start = Math.asin(Math.max(-1, Math.min(1, dy / rad)));
        const tor = new THREE.TorusGeometry(rad + 0.012, 0.03, 6, 28, Math.PI - 2 * start);
        tor.rotateZ(start);
        tor.rotateY(Math.PI / 2); // (cos t, sin t) -> (z = -cos t, y = sin t)
        tor.scale(0.9, 1, 1);
        tor.translate(side * (halfW - 0.005), cy, cz);
        this.add(tor, this.m.paint);
      }
    }

    // ---- greenhouse (glass) with tumblehome
    const gh = new THREE.Shape();
    const belt = 0.952, roof = car.spec.dims.height;
    const ghPts: [number, number][] = [
      [R - 0.04, belt], [R + 0.50, roof - 0.02], [F - 1.17, roof], [F - 0.59, belt],
    ];
    gh.moveTo(ghPts[0][0], ghPts[0][1]);
    for (const [z, y] of ghPts.slice(1)) gh.lineTo(z, y);
    gh.closePath();
    const ghHalf = halfW - 0.075;
    const tumble = (y: number) => 1 - 0.15 * THREE.MathUtils.clamp((y - belt) / (roof - belt), 0, 1);
    const ghGeo = extrude(gh, -ghHalf, ghHalf, 0.012);
    const p = ghGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * tumble(p.getY(i)));
    ghGeo.computeVertexNormals();
    const ghMesh = new THREE.Mesh(ghGeo, this.m.glass);
    ghMesh.renderOrder = 3;
    this.body.add(ghMesh);
    const xAt = (y: number) => ghHalf * tumble(y);

    // roof skin, pillars, trims
    const roofZ0 = R + 0.52, roofZ1 = F - 1.19;
    this.box([-xAt(roof) - 0.01, roof - 0.012, roofZ0], [xAt(roof) + 0.01, roof + 0.012, roofZ1], this.m.paint);
    for (const s of [1, -1]) {
      // A pillar (body colour), thin C pillar (body colour), quarter-window divider and belt trim (black)
      this.beam([s * xAt(belt), belt, F - 0.60], [s * (xAt(roof) + 0.005), roof - 0.005, F - 1.17], 0.075, 0.035, this.m.paint);
      this.beam([s * (xAt(belt) + 0.005), belt, R - 0.02], [s * (xAt(roof) + 0.005), roof - 0.01, R + 0.52], 0.12, 0.035, this.m.paint);
      this.beam([s * (xAt(belt) + 0.006), belt, R + 0.70], [s * (xAt(roof) + 0.006), roof - 0.01, R + 0.86], 0.035, 0.02, this.m.trim);
      this.box([s * (ghHalf + 0.004) - 0.008, belt - 0.012, R], [s * (ghHalf + 0.004) + 0.008, belt + 0.012, F - 0.60], this.m.trim);
      this.box([s * (xAt(roof) + 0.012) - 0.008, roof - 0.03, roofZ0], [s * (xAt(roof) + 0.012) + 0.008, roof - 0.005, roofZ1], this.m.trim);
      // side rubbing strip between the arches, door shut lines, handle, mirror
      this.box([s * (halfW + 0.006) - 0.008, 0.525, R + archR + 0.04], [s * (halfW + 0.006) + 0.008, 0.565, F - archF - 0.04], this.m.trim);
      for (const dz of [F - 0.72, R + 0.64]) this.box([s * (halfW + 0.001) - 0.003, 0.26, dz - 0.004], [s * (halfW + 0.001) + 0.003, belt - 0.02, dz + 0.004], this.m.trim);
      this.box([s * (halfW + 0.004) - 0.01, 0.83, R + 0.74], [s * (halfW + 0.004) + 0.01, 0.855, R + 0.88], this.m.trim);
      this.box([s * (halfW + 0.02) - 0.05, 0.98, F - 0.70], [s * (halfW + 0.02) + 0.05, 1.06, F - 0.60], this.m.black);
      this.box([s * (halfW - 0.04), 0.965, F - 0.66], [s * (halfW + 0.0), 0.985, F - 0.63], this.m.black);
    }

    // ---- interior (so the glass reads as a car, not a hole)
    this.box([-ghHalf + 0.06, 0.70, R + 0.05], [ghHalf - 0.06, 0.94, F - 0.60], this.m.interior);
    for (const s of [1, -1]) {
      this.box([s * 0.36 - 0.24, 0.80, R + 0.95], [s * 0.36 + 0.24, 1.18, R + 1.05], this.m.interior); // seat backs
      this.box([s * 0.36 - 0.12, 1.18, R + 0.97], [s * 0.36 + 0.12, 1.27, R + 1.04], this.m.interior); // headrests
    }
    this.box([-ghHalf + 0.06, 0.94, F - 0.98], [ghHalf - 0.06, 1.0, F - 0.62], this.m.interior); // dash
    // steering wheel (left-hand drive), animated
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.016, 8, 32), this.m.trim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12).rotateX(Math.PI / 2), this.m.trim);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.015), this.m.trim);
    this.steeringWheel.add(sw, hub, spoke);
    const swMount = new THREE.Group();
    swMount.position.set(0.36, 1.0, F - 1.02);
    swMount.rotation.x = -0.42;
    swMount.add(this.steeringWheel);
    this.body.add(swMount);

    // ---- front: black grille band, twin round headlights, kidneys, bumper, air dam, indicators
    const fz = F + 0.765;
    this.box([-halfW + 0.07, 0.615, fz - 0.03], [halfW - 0.07, 0.845, fz + 0.012], this.m.black);
    for (const s of [1, -1]) {
      for (const hx of [0.335, 0.555]) {
        const lamp = new THREE.CylinderGeometry(0.08, 0.08, 0.03, 24).rotateX(Math.PI / 2).translate(s * hx, 0.735, fz + 0.02);
        this.add(lamp, this.m.lens);
        this.add(new THREE.TorusGeometry(0.084, 0.008, 6, 24).translate(s * hx, 0.735, fz + 0.036), this.m.chrome);
      }
      // kidney: chrome surround + black slats
      const kid = roundedRect(0.125, 0.185, 0.035);
      this.add(new THREE.ExtrudeGeometry(kid, { depth: 0.03, bevelEnabled: false }).translate(s * 0.078, 0.735, fz), this.m.chrome);
      this.add(new THREE.ExtrudeGeometry(roundedRect(0.1, 0.16, 0.028), { depth: 0.032, bevelEnabled: false }).translate(s * 0.078, 0.735, fz + 0.001), this.m.trim);
      this.box([s * 0.6 - 0.07, 0.43, F + 0.838], [s * 0.6 + 0.07, 0.49, F + 0.846], this.m.amber);
    }
    this.box([-halfW - 0.015, 0.37, F + 0.69], [halfW + 0.015, 0.57, F + 0.84], this.m.black);           // bumper
    for (const s of [1, -1]) this.box([s * (halfW + 0.015) - 0.03, 0.37, F + archF + 0.04], [s * (halfW + 0.015) + 0.0, 0.57, F + 0.72], this.m.black);
    this.box([-halfW + 0.04, 0.17, F + 0.58], [halfW - 0.04, 0.37, F + 0.80], this.m.black);             // air dam
    this.box([-0.22, 0.475, F + 0.842], [0.22, 0.48, F + 0.845], this.m.chrome);                       // bumper strip

    // ---- rear: tail lights, centre panel, plate, bumper, valance, exhaust
    const rz = R - 0.835;
    for (const s of [1, -1]) {
      const a = s * 0.17, b = s * 0.78;
      this.box([Math.min(a, b), 0.745, rz - 0.012], [Math.max(a, b), 0.84, rz + 0.02], this.m.red);
      this.box([Math.min(a, b), 0.705, rz - 0.012], [Math.max(a, b), 0.745, rz + 0.02], this.m.amber);
      this.box([Math.min(a, b), 0.66, rz - 0.012], [Math.max(a, b), 0.705, rz + 0.02], this.m.red);
    }
    this.box([-0.17, 0.66, rz - 0.01], [0.17, 0.84, rz + 0.015], this.m.black);
    this.box([-0.26, 0.585, rz - 0.008], [0.26, 0.655, rz + 0.012], this.m.plate);
    this.box([-halfW - 0.015, 0.36, R - 0.915], [halfW + 0.015, 0.56, R - 0.78], this.m.black);
    for (const s of [1, -1]) this.box([s * (halfW + 0.015) - 0.03, 0.36, R - 0.80], [s * (halfW + 0.015), 0.56, R - archR - 0.05], this.m.black);
    this.box([-halfW + 0.05, 0.19, R - 0.86], [halfW - 0.05, 0.36, R - 0.70], this.m.black);
    this.add(new THREE.CylinderGeometry(0.038, 0.038, 0.16, 14, 1, true).rotateX(Math.PI / 2).translate(-0.5, 0.24, R - 0.88), this.m.chrome);

    this.flush();

    // roll pivot near the roll centre so the body leans instead of sliding
    this.pivot.position.y = 0.4;
    this.body.position.y = -0.4;
    this.pivot.add(this.body);
    this.root.add(this.pivot);

    // ---- wheels
    for (const w of car.wheels) this.buildWheel(w);
  }

  private buildWheel(w: WheelState): void {
    const { radius: R, width: W } = w.tire;
    const out = Math.sign(w.px) || 1; // +1 = left side; outer face toward +x
    const steer = new THREE.Group();
    steer.position.set(w.px, R, w.pz);
    const spin = new THREE.Group();
    const rimR = 0.1905; // 15"
    // tyre: lathe cross-section with rounded shoulders, axis -> X
    const sh = Math.min(0.035, W * 0.18);
    const prof = [
      new THREE.Vector2(rimR + 0.005, -W / 2), new THREE.Vector2(R - sh, -W / 2 - 0.004), new THREE.Vector2(R - sh * 0.3, -W / 2 + sh * 0.3),
      new THREE.Vector2(R, -W / 2 + sh), new THREE.Vector2(R, W / 2 - sh), new THREE.Vector2(R - sh * 0.3, W / 2 - sh * 0.3),
      new THREE.Vector2(R - sh, W / 2 + 0.004), new THREE.Vector2(rimR + 0.005, W / 2),
    ];
    const tire = new THREE.Mesh(new THREE.LatheGeometry(prof, 32).rotateZ(Math.PI / 2), this.m.tire);
    tire.castShadow = true;
    // rim: barrel + recessed dark face + 6 spokes + chrome lip + centre cap, all at the outer side
    const faceX = out * (W / 2 - 0.035);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, W * 0.92, 24, 1, true).rotateZ(Math.PI / 2), this.m.rimDark);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(rimR - 0.01, rimR - 0.01, 0.01, 24).rotateZ(Math.PI / 2), this.m.rimDark);
    face.position.x = faceX - out * 0.03;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.011, 6, 32).rotateY(Math.PI / 2), this.m.chrome);
    lip.position.x = out * (W / 2 - 0.012);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 16).rotateZ(Math.PI / 2), this.m.rim);
    cap.position.x = faceX;
    spin.add(tire, barrel, face, lip, cap);
    const spokes: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      spokes.push(new THREE.BoxGeometry(0.022, rimR - 0.05, 0.045)
        .rotateX(a)
        .translate(faceX - out * 0.012, Math.cos(a) * (rimR / 2 + 0.02), Math.sin(a) * (rimR / 2 + 0.02)));
    }
    spin.add(new THREE.Mesh(mergeGeometries(spokes)!, this.m.rim));
    // brake disc spins; caliper is fixed to the upright (top-rear)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.022, 28).rotateZ(Math.PI / 2), this.m.disc);
    disc.position.x = -out * 0.01;
    spin.add(disc);
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.07), this.m.caliper);
    caliper.position.set(out * 0.012, 0.075, -0.095);
    caliper.rotation.x = 0.65;
    steer.add(spin, caliper);
    this.root.add(steer);
    this.wheelSteer.push(steer);
    this.wheelSpin.push(spin);
  }

  update(car: Car, dt: number): void {
    this.root.position.set(car.x, 0, car.z);
    this.root.rotation.y = car.yaw;
    car.wheels.forEach((w, i) => {
      this.wheelSteer[i].rotation.y = w.steer;
      this.wheelSpin[i].rotation.x = w.spinAngle;
    });
    this.steeringWheel.rotation.z = car.steerAngle * E30_LOOK.steeringRatio;
    const s = car.spec.suspension;
    const k = 1 - Math.exp(-dt * 10);
    this.roll += (car.accLeft * s.rollGain - this.roll) * k;
    this.pitch += (-car.accFwd * s.pitchGain - this.pitch) * k;
    this.pivot.rotation.set(this.pitch, 0, this.roll);
  }

  // ---- static geometry helpers (merged per material)
  private add(g: THREE.BufferGeometry, m: THREE.Material): void {
    const list = this.buckets.get(m) ?? [];
    list.push(g);
    this.buckets.set(m, list);
  }

  private box(a: V3, b: V3, m: THREE.Material): void {
    const sx = Math.abs(b[0] - a[0]), sy = Math.abs(b[1] - a[1]), sz = Math.abs(b[2] - a[2]);
    this.add(new THREE.BoxGeometry(sx, sy, sz).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), m);
  }

  /** Flat bar from a to b (width along the car's length direction, thickness across). */
  private beam(a: V3, b: V3, width: number, thick: number, m: THREE.Material): void {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.BoxGeometry(thick, len, width);
    const dir = vb.clone().sub(va).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    const mid = va.add(vb).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    this.add(g, m);
  }

  private flush(): void {
    for (const [mat, list] of this.buckets) {
      const geos = list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        n.clearGroups();
        for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
        return n;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mat !== this.m.glass;
      mesh.receiveShadow = true;
      this.body.add(mesh);
    }
    this.buckets.clear();
  }
}

/** Extrude a (z, y) side profile across the car from x0 to x1 (proper rotation, no mirroring). */
function extrude(shape: THREE.Shape, x0: number, x1: number, bevel: number): THREE.ExtrudeGeometry {
  const depth = Math.max(0.001, x1 - x0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 20,
  });
  // shape (sx, sy, sz) -> car (x = x1 - bevel - sz, y = sy, z = sx)
  g.applyMatrix4(new THREE.Matrix4().set(
    0, 0, -1, x1 - bevel,
    0, 1, 0, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  ));
  return g;
}

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
