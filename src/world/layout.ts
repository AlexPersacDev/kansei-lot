/**
 * The 600 × 600 m lot: four zones (one per quadrant), obstacles, painted markings, labels and
 * clipping points. Pure data — rendering (track.ts), collisions and the minimap read from it.
 * World axes: +z = "north", +x is on the driver's LEFT when facing north (three.js right-handed).
 */
import type { ClipPoint } from '../game/scoring';

export type ObstacleKind = 'cone' | 'barrel' | 'tires' | 'pole' | 'block' | 'wall';
export interface Obstacle { kind: ObstacleKind; x: number; z: number; yaw: number }
export interface Paint { pts: [number, number][]; width: number; color: 'white' | 'yellow' | 'red'; closed?: boolean; dash?: [number, number] }
export interface Label { text: string; x: number; z: number; yaw: number; size: number; color?: string }
export interface Spawn { x: number; z: number; yaw: number }
export interface Zone { id: string; name: string; x0: number; x1: number; z0: number; z1: number; spawn: Spawn; tint: string }

/** Footprints used by collisions (and the minimap). Heights are visual. */
export const OBSTACLE_SIZE: Record<ObstacleKind, { radius?: number; half?: [number, number]; height: number; breaksCombo: boolean; dynamic: boolean; mass: number }> = {
  cone: { radius: 0.17, height: 0.7, breaksCombo: false, dynamic: true, mass: 2.5 },
  barrel: { radius: 0.3, height: 0.9, breaksCombo: false, dynamic: true, mass: 18 },
  tires: { radius: 0.42, height: 0.96, breaksCombo: false, dynamic: true, mass: 55 },
  pole: { radius: 0.13, height: 6, breaksCombo: true, dynamic: false, mass: 0 },
  block: { half: [1.0, 0.32], height: 0.8, breaksCombo: true, dynamic: false, mass: 0 },
  wall: { half: [1.0, 0.32], height: 0.8, breaksCombo: true, dynamic: false, mass: 0 },
};

export const HALF = 180;

export const ZONES: Zone[] = [
  { id: 'free', name: 'Zona libre', x0: -HALF, x1: 0, z0: -HALF, z1: 0, spawn: { x: -90, z: -90, yaw: 0 }, tint: '#4c7d5a' },
  { id: 'pivots', name: 'Zona de pivotes', x0: 0, x1: HALF, z0: -HALF, z1: 0, spawn: { x: 90, z: -170, yaw: 0 }, tint: '#7d6a4c' },
  { id: 'lanes', name: 'Zona de carriles', x0: -HALF, x1: 0, z0: 0, z1: HALF, spawn: { x: -35, z: 5, yaw: 0 }, tint: '#4c5f7d' },
  { id: 'gymkhana', name: 'Gymkhana', x0: 0, x1: HALF, z0: 0, z1: HALF, spawn: { x: 30, z: 6, yaw: 0 }, tint: '#7d4c6c' },
];

export function zoneAt(x: number, z: number): Zone {
  return ZONES.find((zn) => x >= zn.x0 && x < zn.x1 && z >= zn.z0 && z < zn.z1) ?? ZONES[x < 0 ? (z < 0 ? 0 : 2) : (z < 0 ? 1 : 3)];
}

export interface Layout { obstacles: Obstacle[]; paint: Paint[]; labels: Label[]; clips: ClipPoint[] }

// ---------- helpers
const ring = (cx: number, cz: number, r: number, n = 72): [number, number][] =>
  Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as [number, number]; });

function arcPts(cx: number, cz: number, r: number, a0: number, a1: number, step = 2): [number, number][] {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as [number, number]; });
}

/** Offset a centre polyline sideways by d (+ = left of travel, i.e. +x when heading +z). */
function offset(pts: [number, number][], d: number): [number, number][] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    // heading (dx, dz) -> left (dz, -dx): heading +z gives left +x
    return [p[0] + (dz / len) * d, p[1] - (dx / len) * d] as [number, number];
  });
}

/** Place items every `spacing` metres along a polyline. */
function along(pts: [number, number][], spacing: number, fn: (x: number, z: number, yaw: number) => void): void {
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const seg = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    let d = carry;
    while (d <= seg) { const t = d / seg; fn(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, yaw); d += spacing; }
    carry = d - seg;
  }
}

function line(a: [number, number], b: [number, number], n = 2): [number, number][] {
  return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)] as [number, number]);
}

export function buildLayout(): Layout {
  const obstacles: Obstacle[] = [];
  const paint: Paint[] = [];
  const labels: Label[] = [];
  const clips: ClipPoint[] = [];
  const ob = (kind: ObstacleKind, x: number, z: number, yaw = 0) => obstacles.push({ kind, x, z, yaw });
  const pivot = (kind: ObstacleKind, x: number, z: number, ringR: number, label: string, yaw = 0) => {
    ob(kind, x, z, yaw);
    paint.push({ pts: ring(x, z, ringR), width: 0.25, color: 'white', closed: true });
    paint.push({ pts: ring(x, z, ringR + 2.5, 96), width: 0.15, color: 'yellow', closed: true, dash: [2, 2] });
    // clipping a pivot = bringing the nose or tail well inside the painted ring
    clips.push({ x, z, radius: ringR * 0.72, label });
  };

  // ---- separators, lot edge, centre cross
  paint.push({ pts: [[0.3, -HALF + 2], [0.3, HALF - 2]], width: 0.15, color: 'yellow' });
  paint.push({ pts: [[-0.3, -HALF + 2], [-0.3, HALF - 2]], width: 0.15, color: 'yellow' });
  paint.push({ pts: [[-HALF + 2, 0.3], [HALF - 2, 0.3]], width: 0.15, color: 'yellow' });
  paint.push({ pts: [[-HALF + 2, -0.3], [HALF - 2, -0.3]], width: 0.15, color: 'yellow' });
  paint.push({ pts: [[-HALF + 2, -HALF + 2], [HALF - 2, -HALF + 2], [HALF - 2, HALF - 2], [-HALF + 2, HALF - 2]], width: 0.3, color: 'white', closed: true });

  // Compact lot (360 × 360 m): element spacing tightened, but ring radii, lane widths and
  // cone spacing keep their real drift sizes.

  // ---- 1. free zone: just the name and a big practice circle
  labels.push({ text: 'ZONA LIBRE', x: -90, z: -70, yaw: 0, size: 22 });
  paint.push({ pts: ring(-90, -120, 25, 120), width: 0.2, color: 'white', closed: true, dash: [3, 3] });

  // ---- 2. pivots zone
  labels.push({ text: 'ZONA DE PIVOTES', x: 90, z: -155, yaw: 0, size: 24 });
  // cone cluster pivot
  pivot('cone', 45, -115, 9, 'Pivote de conos');
  ob('cone', 45.6, -114.6); ob('cone', 44.4, -115.4);
  // stacked tyres pivot
  pivot('tires', 45, -45, 10, 'Neumáticos');
  // figure eight around two barrels
  pivot('barrel', 100, -128, 12, 'Ocho');
  pivot('barrel', 100, -100, 12, 'Ocho');
  // concrete block pivot (breaks the combo if hit)
  pivot('block', 100, -45, 10, 'Bloque', 0.4);
  // lamp pole pivot (breaks the combo if hit)
  pivot('pole', 155, -165, 9, 'Poste');
  // slalom
  for (let z = -132; z <= -20; z += 16) { ob('cone', 152, z); clips.push({ x: 152, z, radius: 2.4, label: 'Slalom' }); }
  paint.push({ pts: line([152, -145], [152, -10]), width: 0.15, color: 'white', dash: [3, 4] });
  labels.push({ text: 'SLALOM', x: 152, z: -141, yaw: 0, size: 10 });

  // ---- 3. lanes zone: entry straight → 180° right hairpin with outer wall → exit; plus a straight lane
  labels.push({ text: 'ZONA DE CARRILES', x: -80, z: 9, yaw: 0, size: 22 });
  {
    const W = 6; // half width of the lane
    const C: [number, number] = [-80, 85];
    const R = 45;
    // centreline: start (-35, 18) north to (-35, 85), arc around C from angle 0 to π, exit south
    const entry = line([-35, 18], [-35, 85], 8);
    const arc = arcPts(C[0], C[1], R, 0, Math.PI, 2);
    const exit = line([-125, 85], [-125, 18], 8);
    const centre = [...entry, ...arc.slice(1), ...exit.slice(1)];
    // the centre C is to the driver's right (−x), so this is a right-hand hairpin: inside = −offset
    const inner = offset(centre, -W), outer = offset(centre, W);
    paint.push({ pts: inner, width: 0.25, color: 'white' }, { pts: outer, width: 0.25, color: 'white' });
    along(inner, 10, (x, z) => ob('cone', x, z));
    along(outer, 10, (x, z) => ob('cone', x, z));
    paint.push({ pts: line([-35 - W, 18], [-35 + W, 18]), width: 0.6, color: 'white' });
    labels.push({ text: 'ENTRADA', x: -35, z: 12, yaw: 0, size: 8 });
    labels.push({ text: 'SALIDA', x: -125, z: 12, yaw: Math.PI, size: 8 });
    // inner clipping points (apexes) — painted boxes
    for (const a of [Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.75]) {
      const x = C[0] + Math.cos(a) * (R - W - 1.5), z = C[1] + Math.sin(a) * (R - W - 1.5);
      paint.push({ pts: ring(x, z, 1.6, 24), width: 0.35, color: 'yellow', closed: true });
      clips.push({ x, z, radius: 3.2, label: 'Clip interior' });
    }
    // outer clipping zone with a concrete wall behind it
    for (const a of [Math.PI * 0.38, Math.PI * 0.62]) {
      const x = C[0] + Math.cos(a) * (R + W + 1.0), z = C[1] + Math.sin(a) * (R + W + 1.0);
      paint.push({ pts: ring(x, z, 1.6, 24), width: 0.35, color: 'red', closed: true });
      clips.push({ x, z, radius: 3.2, label: 'Zona exterior' });
    }
    along(arcPts(C[0], C[1], R + W + 4.5, Math.PI * 0.3, Math.PI * 0.7, 1), 2.05, (x, z, yaw) => ob('wall', x, z, yaw));
  }
  {
    // straight transition lane with alternating clip boxes
    const x = -158, W = 6;
    paint.push({ pts: line([x - W, 25], [x - W, 170]), width: 0.25, color: 'white' });
    paint.push({ pts: line([x + W, 25], [x + W, 170]), width: 0.25, color: 'white' });
    along(line([x - W, 25], [x - W, 170]), 12, (cx, cz) => ob('cone', cx, cz));
    along(line([x + W, 25], [x + W, 170]), 12, (cx, cz) => ob('cone', cx, cz));
    labels.push({ text: 'TRANSICIONES', x, z: 17, yaw: 0, size: 9 });
    let side = 1;
    for (let z = 45; z <= 157; z += 28) {
      const cx = x + side * (W - 1.5);
      paint.push({ pts: ring(cx, z, 1.6, 24), width: 0.35, color: 'yellow', closed: true });
      clips.push({ x: cx, z, radius: 3.2, label: 'Clip' });
      side = -side;
    }
  }

  // ---- 4. gymkhana: slalom → 360 around tyres → eight around barrels → finish box
  labels.push({ text: 'GYMKHANA', x: 95, z: 10, yaw: 0, size: 22 });
  paint.push({ pts: line([22, 20], [38, 20]), width: 0.6, color: 'white' });
  labels.push({ text: '1', x: 45, z: 30, yaw: 0, size: 6, color: '#ffd24a' });
  for (let z = 35; z <= 105; z += 14) { ob('cone', 30, z); clips.push({ x: 30, z, radius: 2.4, label: 'Slalom' }); }
  labels.push({ text: '2', x: 45, z: 115, yaw: 0, size: 6, color: '#ffd24a' });
  pivot('tires', 30, 130, 9, '360°');
  labels.push({ text: '3', x: 70, z: 162, yaw: 0, size: 6, color: '#ffd24a' });
  pivot('barrel', 90, 140, 11, 'Ocho');
  pivot('barrel', 118, 140, 11, 'Ocho');
  labels.push({ text: '4', x: 150, z: 122, yaw: 0, size: 6, color: '#ffd24a' });
  // finish box (park inside)
  const bx = 155, bz = 95, hw = 3.5, hl = 6;
  paint.push({ pts: [[bx - hw, bz - hl], [bx + hw, bz - hl], [bx + hw, bz + hl], [bx - hw, bz + hl]], width: 0.3, color: 'yellow', closed: true });
  for (const [cx, cz] of [[bx - hw, bz - hl], [bx + hw, bz - hl], [bx + hw, bz + hl], [bx - hw, bz + hl]] as [number, number][]) ob('cone', cx, cz);
  labels.push({ text: 'META', x: bx, z: bz, yaw: Math.PI, size: 5 });
  paint.push({ pts: [[30, 110], [30, 117], [44, 148], [66, 160], [104, 162], [135, 152], [150, 132], [155, 104]], width: 0.15, color: 'white', dash: [2, 3] });

  return { obstacles, paint, labels, clips };
}
