import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type * as RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Car } from '../physics/car';
import { OBSTACLE_SIZE, type Layout, type Obstacle, type ObstacleKind, type Paint } from './layout';

type Rapier = typeof import('@dimforge/rapier3d-compat').default;
type V2 = [number, number];

const PAINT_COLORS: Record<Paint['color'], string> = { white: '#e9e7dd', yellow: '#e2b632', red: '#c63b2c' };

interface DynItem { kind: ObstacleKind; idx: number; home: Obstacle; body: RAPIER_NS.RigidBody | null; displacedFor: number }
interface StaticShape { kind: ObstacleKind; x: number; z: number; yaw: number; radius?: number; half?: [number, number]; breaks: boolean }

export interface Impact { kind: ObstacleKind; speed: number; breaksCombo: boolean }

/**
 * Builds and runs the lot: painted markings, ground labels, obstacles (instanced),
 * Rapier for knock-over props (cones, barrels, tyre stacks pushed by a kinematic car body),
 * and a small 2D solver for the car against fixed obstacles (walls, blocks, pole).
 */
export class Track {
  readonly group = new THREE.Group();
  private meshes = new Map<ObstacleKind, THREE.InstancedMesh>();
  private dyn: DynItem[] = [];
  private statics: StaticShape[] = [];
  private world: RAPIER_NS.World | null = null;
  private carBody: RAPIER_NS.RigidBody | null = null;
  private carOffsetZ = 0;
  private stepToggle = false;
  private respawnTimer = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s1 = new THREE.Vector3(1, 1, 1);
  ready = false;

  constructor(readonly layout: Layout) {
    this.buildPaint();
    this.buildLabels();
    this.buildObstacles();
  }

  // ------------------------------------------------------------------ visuals
  private buildPaint(): void {
    const byColor = new Map<Paint['color'], THREE.BufferGeometry[]>();
    for (const p of this.layout.paint) {
      const geos = byColor.get(p.color) ?? [];
      geos.push(stripGeometry(p));
      byColor.set(p.color, geos);
    }
    for (const [color, geos] of byColor) {
      const mat = new THREE.MeshStandardMaterial({
        color: PAINT_COLORS[color], roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private buildLabels(): void {
    for (const l of this.layout.labels) {
      const cv = document.createElement('canvas');
      const g = cv.getContext('2d')!;
      const font = '900 180px system-ui, "Arial Black", sans-serif';
      g.font = font;
      const tw = Math.ceil(g.measureText(l.text).width);
      cv.width = tw + 60; cv.height = 220;
      g.font = font;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = l.color ?? '#efece2';
      g.fillText(l.text, cv.width / 2, cv.height / 2 + 8);
      // worn paint
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < (cv.width * cv.height) / 900; i++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`;
        g.fillRect(Math.random() * cv.width, Math.random() * cv.height, 2 + Math.random() * 6, 2 + Math.random() * 4);
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const w = l.size, h = (l.size * cv.height) / cv.width;
      const geo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).rotateY(Math.PI + l.yaw).translate(l.x, 0.006, l.z);
      const mat = new THREE.MeshStandardMaterial({
        map: tex, transparent: true, opacity: 0.88, roughness: 0.85, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private buildObstacles(): void {
    const counts = new Map<ObstacleKind, number>();
    for (const o of this.layout.obstacles) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
    const geos = obstacleGeometries();
    const concrete = new THREE.MeshStandardMaterial({ color: '#bab7ae', roughness: 0.9 });
    const colored = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    for (const [kind, n] of counts) {
      const mat = kind === 'block' || kind === 'wall' ? concrete : colored;
      const mesh = new THREE.InstancedMesh(geos[kind], mat, n);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }
    const used = new Map<ObstacleKind, number>();
    for (const o of this.layout.obstacles) {
      const idx = used.get(o.kind) ?? 0;
      used.set(o.kind, idx + 1);
      const size = OBSTACLE_SIZE[o.kind];
      const y = centreY(o.kind);
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw);
      this.m4.compose(this.v.set(o.x, y, o.z), this.q, this.s1);
      this.meshes.get(o.kind)!.setMatrixAt(idx, this.m4);
      if (size.dynamic) this.dyn.push({ kind: o.kind, idx, home: o, body: null, displacedFor: 0 });
      else this.statics.push({ kind: o.kind, x: o.x, z: o.z, yaw: o.yaw, radius: size.radius, half: size.half, breaks: size.breaksCombo });
    }
    for (const m of this.meshes.values()) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  }

  // ------------------------------------------------------------------ physics (props)
  /** Loads Rapier lazily so the first paint isn't blocked by the WASM. */
  async initPhysics(car: Car): Promise<void> {
    const R: Rapier = (await import('@dimforge/rapier3d-compat')).default;
    await R.init();
    const world = new R.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 120;
    this.world = world;
    world.createCollider(R.ColliderDesc.cuboid(400, 0.5, 400).setTranslation(0, -0.5, 0).setFriction(0.8));

    for (const s of this.statics) {
      const rot = yawQuat(s.yaw);
      if (s.radius !== undefined) {
        const h = OBSTACLE_SIZE[s.kind].height;
        world.createCollider(R.ColliderDesc.cylinder(h / 2, s.radius).setTranslation(s.x, h / 2, s.z));
      } else if (s.half) {
        world.createCollider(R.ColliderDesc.cuboid(s.half[1], 0.4, s.half[0]).setTranslation(s.x, 0.4, s.z).setRotation(rot));
      }
    }
    for (const d of this.dyn) {
      const o = d.home;
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(o.x, centreY(o.kind), o.z).setRotation(yawQuat(o.yaw))
        .setLinearDamping(0.3).setAngularDamping(0.5).setCcdEnabled(o.kind === 'cone'));
      const sz = OBSTACLE_SIZE[o.kind];
      if (o.kind === 'cone') {
        world.createCollider(R.ColliderDesc.cone(0.33, 0.16).setMass(1.4).setFriction(0.6).setRestitution(0.2), body);
        world.createCollider(R.ColliderDesc.cuboid(0.18, 0.015, 0.18).setTranslation(0, -0.335, 0).setMass(1.1).setFriction(0.7), body);
      } else {
        world.createCollider(R.ColliderDesc.cylinder(sz.height / 2, sz.radius!).setMass(sz.mass).setFriction(0.7).setRestitution(0.15), body);
      }
      body.sleep();
      d.body = body;
    }
    // the car: kinematic box that shoves props around (props never push back on it)
    const w = car.wheels;
    const front = w[0].pz + 0.84, rear = w[2].pz - 0.915;
    this.carOffsetZ = (front + rear) / 2;
    this.carBody = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(car.x, 0, car.z));
    world.createCollider(R.ColliderDesc.cuboid(car.spec.dims.width / 2, 0.45, (front - rear) / 2).setTranslation(0, 0.62, this.carOffsetZ), this.carBody);
    this.ready = true;
  }

  /** Call at the car's physics rate; steps Rapier every other call (120 Hz). */
  stepProps(car: Car): void {
    if (!this.world || !this.carBody) return;
    this.stepToggle = !this.stepToggle;
    if (!this.stepToggle) return;
    this.carBody.setNextKinematicTranslation({ x: car.x, y: 0, z: car.z });
    this.carBody.setNextKinematicRotation(yawQuat(car.yaw));
    this.world.step();
  }

  /** Teleport: move the kinematic body without sweeping through everything in between. */
  teleportCar(car: Car): void {
    this.carBody?.setTranslation({ x: car.x, y: 0, z: car.z }, true);
    this.carBody?.setRotation(yawQuat(car.yaw), true);
  }

  /** Copy awake props into their instances; respawn knocked props once the player is away. */
  syncProps(dt: number, car: Car): void {
    if (!this.world) return;
    const touched = new Set<THREE.InstancedMesh>();
    this.respawnTimer += dt;
    const checkRespawn = this.respawnTimer > 1;
    if (checkRespawn) this.respawnTimer = 0;
    for (const d of this.dyn) {
      const b = d.body!;
      if (checkRespawn) {
        const t = b.translation();
        const moved = Math.hypot(t.x - d.home.x, t.z - d.home.z) > 0.3 || Math.abs(t.y - centreY(d.kind)) > 0.08;
        d.displacedFor = moved ? d.displacedFor + 1 : 0;
        if (d.displacedFor > 8 && Math.hypot(car.x - d.home.x, car.z - d.home.z) > 30) {
          b.setTranslation({ x: d.home.x, y: centreY(d.kind), z: d.home.z }, false);
          b.setRotation(yawQuat(d.home.yaw), false);
          b.setLinvel({ x: 0, y: 0, z: 0 }, false);
          b.setAngvel({ x: 0, y: 0, z: 0 }, false);
          b.sleep();
          d.displacedFor = 0;
          this.writeInstance(d, touched);
          continue;
        }
      }
      if (b.isSleeping()) continue;
      this.writeInstance(d, touched);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }

  private writeInstance(d: DynItem, touched: Set<THREE.InstancedMesh>): void {
    const b = d.body!;
    const t = b.translation(), r = b.rotation();
    this.m4.compose(this.v.set(t.x, t.y, t.z), this.q.set(r.x, r.y, r.z, r.w), this.s1);
    const mesh = this.meshes.get(d.kind)!;
    mesh.setMatrixAt(d.idx, this.m4);
    touched.add(mesh);
  }

  // ------------------------------------------------------------------ car vs fixed obstacles
  /**
   * 2D (x, z) push-out + impulse for the car against walls, blocks and the pole.
   * Returns the hardest impact this step, if any.
   */
  collideCar(car: Car): Impact | null {
    const w = car.wheels;
    const front = w[0].pz + 0.84, rear = w[2].pz - 0.915;
    const hl = (front - rear) / 2, hw = car.spec.dims.width / 2;
    const off = (front + rear) / 2;
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    const f: V2 = [sy, cy], l: V2 = [cy, -sy];
    const c: V2 = [car.x + f[0] * off, car.z + f[1] * off];
    let worst: Impact | null = null;
    for (const s of this.statics) {
      const dx = s.x - c[0], dz = s.z - c[1];
      if (dx * dx + dz * dz > 49) continue;
      const hit = s.radius !== undefined
        ? circleVsBox([s.x, s.z], s.radius, c, f, l, hl, hw)
        : boxVsBox(c, f, l, hl, hw, s);
      if (!hit) continue;
      const speed = resolve(car, hit.point, hit.normal, hit.depth);
      if (speed > 0 && (!worst || speed > worst.speed)) worst = { kind: s.kind, speed, breaksCombo: s.breaks };
    }
    return worst;
  }

  /** Static shapes for the minimap. */
  get staticShapes(): readonly StaticShape[] { return this.statics; }
}

// ---------------------------------------------------------------- collision helpers
interface Hit { point: V2; normal: V2; depth: number } // normal pushes the car out

function circleVsBox(p: V2, r: number, c: V2, f: V2, l: V2, hl: number, hw: number): Hit | null {
  const dx = p[0] - c[0], dz = p[1] - c[1];
  const u = dx * f[0] + dz * f[1], v = dx * l[0] + dz * l[1];
  const cu = Math.max(-hl, Math.min(hl, u)), cv = Math.max(-hw, Math.min(hw, v));
  const qx = c[0] + f[0] * cu + l[0] * cv, qz = c[1] + f[1] * cu + l[1] * cv;
  let nx = qx - p[0], nz = qz - p[1];
  const d = Math.hypot(nx, nz);
  if (d >= r) return null;
  if (d < 1e-6) { nx = -dx; nz = -dz; const n = Math.hypot(nx, nz) || 1; return { point: [qx, qz], normal: [nx / n, nz / n], depth: r }; }
  return { point: [qx, qz], normal: [nx / d, nz / d], depth: r - d };
}

function pointInBox(p: V2, c: V2, f: V2, l: V2, hl: number, hw: number): { depth: number; n: V2 } | null {
  const dx = p[0] - c[0], dz = p[1] - c[1];
  const u = dx * f[0] + dz * f[1], v = dx * l[0] + dz * l[1];
  const pu = hl - Math.abs(u), pv = hw - Math.abs(v);
  if (pu <= 0 || pv <= 0) return null;
  return pu < pv ? { depth: pu, n: [f[0] * Math.sign(u), f[1] * Math.sign(u)] } : { depth: pv, n: [l[0] * Math.sign(v), l[1] * Math.sign(v)] };
}

function boxPoints(c: V2, f: V2, l: V2, hl: number, hw: number): V2[] {
  const out: V2[] = [];
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1], [0.5, 1], [0.5, -1], [-0.5, 1], [-0.5, -1]]) {
    out.push([c[0] + f[0] * hl * a + l[0] * hw * b, c[1] + f[1] * hl * a + l[1] * hw * b]);
  }
  return out;
}

function boxVsBox(c: V2, f: V2, l: V2, hl: number, hw: number, s: StaticShape): Hit | null {
  const sf: V2 = [Math.sin(s.yaw), Math.cos(s.yaw)], sl: V2 = [Math.cos(s.yaw), -Math.sin(s.yaw)];
  const sc: V2 = [s.x, s.z];
  const [shl, shw] = s.half!;
  let best: Hit | null = null;
  // car points inside the obstacle → pushed out along the obstacle's face normal
  for (const p of boxPoints(c, f, l, hl, hw)) {
    const r = pointInBox(p, sc, sf, sl, shl, shw);
    if (r && (!best || r.depth > best.depth)) best = { point: p, normal: r.n, depth: r.depth };
  }
  // obstacle corners inside the car → car pushed the opposite way
  for (const p of boxPoints(sc, sf, sl, shl, shw).slice(0, 4)) {
    const r = pointInBox(p, c, f, l, hl, hw);
    if (r && (!best || r.depth > best.depth)) best = { point: p, normal: [-r.n[0], -r.n[1]], depth: r.depth };
  }
  return best;
}

/** Position correction + restitution/friction impulse at the contact. Returns closing speed. */
function resolve(car: Car, p: V2, n: V2, depth: number): number {
  const m = car.spec.mass, I = car.spec.yawInertia;
  car.x += n[0] * (depth + 0.002);
  car.z += n[1] * (depth + 0.002);
  const rx = p[0] - car.x, rz = p[1] - car.z;
  const w = car.yawRate;
  const vpx = car.vx + w * rz, vpz = car.vz - w * rx;   // ω × r for yaw about +y
  const vn = vpx * n[0] + vpz * n[1];
  if (vn >= 0) return 0;
  const e = 0.25, mu = 0.45;
  const kn = rz * n[0] - rx * n[1];
  const jn = (-(1 + e) * vn) / (1 / m + (kn * kn) / I);
  const t: V2 = [-n[1], n[0]];
  const vt = vpx * t[0] + vpz * t[1];
  const kt = rz * t[0] - rx * t[1];
  let jt = -vt / (1 / m + (kt * kt) / I);
  jt = Math.max(-mu * jn, Math.min(mu * jn, jt));
  car.vx += (jn * n[0] + jt * t[0]) / m;
  car.vz += (jn * n[1] + jt * t[1]) / m;
  car.yawRate += (jn * kn + jt * kt) / I;
  return -vn;
}

function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function centreY(kind: ObstacleKind): number {
  return kind === 'block' || kind === 'wall' ? 0 : OBSTACLE_SIZE[kind].height / 2;
}

// ---------------------------------------------------------------- geometry helpers
function stripGeometry(p: Paint): THREE.BufferGeometry {
  const pts = p.closed ? [...p.pts, p.pts[0]] : p.pts;
  const segs: [V2, V2][] = [];
  if (p.dash) {
    const [on, off] = p.dash;
    let state = true, left = on;
    for (let i = 1; i < pts.length; i++) {
      let a: V2 = pts[i - 1];
      const b: V2 = pts[i];
      let segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (segLen > 1e-6) {
        const step = Math.min(left, segLen);
        const t = step / segLen;
        const mid: V2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (state) segs.push([a, mid]);
        a = mid; segLen -= step; left -= step;
        if (left <= 1e-6) { state = !state; left = state ? on : off; }
      }
    }
  } else {
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  }
  const pos: number[] = [];
  const hw = p.width / 2;
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const nx = -uz * hw, nz = ux * hw;
    // extend each end by half width so joints overlap without gaps
    const ax = a[0] - ux * hw, az = a[1] - uz * hw, bx = b[0] + ux * hw, bz = b[1] + uz * hw;
    const y = 0.004;
    pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, ax - nx, y, az - nz);
    pos.push(ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  // winding may vary with direction; paint is seen from above only
  return g;
}

function paintVertices(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => string): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.set(fn(p.getX(i), p.getY(i), p.getZ(i))).convertSRGBToLinear();
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.clearGroups();
  if (n.getAttribute('uv')) n.deleteAttribute('uv');
  return n;
}

/** Geometries centred on each prop's rigid-body origin. */
function obstacleGeometries(): Record<ObstacleKind, THREE.BufferGeometry> {
  const cone = mergeGeometries([
    prep(paintVertices(new THREE.ConeGeometry(0.16, 0.66, 20, 8).translate(0, 0.0, 0), (_x, y) => (y > -0.02 && y < 0.1) || (y > 0.16 && y < 0.24) ? '#f2f2ee' : '#ff5a12')),
    prep(paintVertices(new THREE.BoxGeometry(0.36, 0.03, 0.36).translate(0, -0.335, 0), () => '#1b1b1b')),
  ])!;
  const barrel = prep(paintVertices(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20, 9), (_x, y) => Math.abs(Math.abs(y) - 0.2) < 0.04 ? '#eeeeea' : '#2d63c9'));
  const tyres: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) tyres.push(prep(paintVertices(new THREE.TorusGeometry(0.3, 0.12, 8, 20).rotateX(Math.PI / 2).translate(0, -0.36 + i * 0.24, 0), () => '#1c1c1c')));
  const tires = mergeGeometries(tyres)!;
  const pole = mergeGeometries([
    prep(paintVertices(new THREE.CylinderGeometry(0.1, 0.13, 6, 12).translate(0, 0, 0), (_x, y) => (y < -2.6 ? '#e8c531' : '#8d9196'))),
    prep(paintVertices(new THREE.BoxGeometry(0.12, 0.08, 1.2).translate(0, 2.95, 0.55), () => '#8d9196')),
    prep(paintVertices(new THREE.BoxGeometry(0.3, 0.1, 0.5).translate(0, 2.9, 1.1), () => '#dcdcd6')),
  ])!;
  // jersey barrier: profile in (x across, y up) extruded along z (length 2.0)
  const s = new THREE.Shape();
  const pr: V2[] = [[-0.32, 0], [0.32, 0], [0.32, 0.08], [0.13, 0.28], [0.1, 0.8], [-0.1, 0.8], [-0.13, 0.28], [-0.32, 0.08]];
  s.moveTo(pr[0][0], pr[0][1]);
  for (const p of pr.slice(1)) s.lineTo(p[0], p[1]);
  s.closePath();
  const jersey = prep(new THREE.ExtrudeGeometry(s, { depth: 1.98, bevelEnabled: false }).translate(0, 0, -0.99));
  jersey.computeVertexNormals();
  return { cone, barrel, tires, pole, block: jersey, wall: jersey };
}
