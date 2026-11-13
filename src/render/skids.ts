import * as THREE from 'three';
import type { Car } from '../physics/car';

/**
 * Persistent rubber marks: one ring buffer of quads shared by all four tyres. Old segments are
 * overwritten once the buffer is full, so memory stays fixed.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private max: number;
  private next = 0;
  private count = 0;
  private positions: Float32Array;
  private alphas: Float32Array;
  private geo = new THREE.BufferGeometry();
  private last: ({ lx: number; lz: number; rx: number; rz: number; a: number } | null)[] = [null, null, null, null];
  private dirtyFrom = Infinity;
  private dirtyTo = -1;

  constructor(maxSegments = 6000) {
    this.max = maxSegments;
    this.positions = new Float32Array(maxSegments * 4 * 3);
    this.alphas = new Float32Array(maxSegments * 4);
    const idx = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 2; idx[o + 2] = v + 1;
      idx[o + 3] = v + 1; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute float alpha; varying float vA;
        #include <fog_pars_vertex>
        void main(){ vA = alpha; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `varying float vA;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(0.07,0.07,0.075, vA);
        #include <fog_fragment>
        }`,
      uniforms: { ...THREE.UniformsLib.fog },
      transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  clear(): void {
    this.count = 0; this.next = 0; this.last = [null, null, null, null];
    this.geo.setDrawRange(0, 0);
  }

  /** Call after the physics for the frame; adds a segment per sliding tyre every ~0.2 m. */
  update(car: Car): void {
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    car.wheels.forEach((w, i) => {
      const slide = w.slideSpeed;
      const intensity = Math.min(1, Math.max(0, (slide - 2) / 8)) * Math.min(1, w.fz / 1500);
      if (intensity < 0.05) { this.last[i] = null; return; }
      const cx = car.x + w.px * cy + w.pz * sy;
      const cz = car.z - w.px * sy + w.pz * cy;
      // mark width across the tyre, oriented by the wheel's heading
      const h = car.yaw + w.steer;
      const half = w.tire.width / 2;
      const ox = Math.cos(h) * half, oz = -Math.sin(h) * half;
      const cur = { lx: cx + ox, lz: cz + oz, rx: cx - ox, rz: cz - oz, a: 0.55 * intensity };
      const prev = this.last[i];
      if (!prev) { this.last[i] = cur; return; }
      const d = Math.hypot((cur.lx + cur.rx - prev.lx - prev.rx) / 2, (cur.lz + cur.rz - prev.lz - prev.rz) / 2);
      if (d < 0.2) return;
      if (d > 3) { this.last[i] = cur; return; } // teleport / reset
      this.addSegment(prev, cur);
      this.last[i] = cur;
    });
    this.flush();
  }

  private addSegment(a: { lx: number; lz: number; rx: number; rz: number; a: number }, b: typeof a): void {
    const s = this.next;
    const p = this.positions, al = this.alphas;
    const y = 0.012;
    const o = s * 12;
    p[o] = a.lx; p[o + 1] = y; p[o + 2] = a.lz;
    p[o + 3] = a.rx; p[o + 4] = y; p[o + 5] = a.rz;
    p[o + 6] = b.lx; p[o + 7] = y; p[o + 8] = b.lz;
    p[o + 9] = b.rx; p[o + 10] = y; p[o + 11] = b.rz;
    al[s * 4] = al[s * 4 + 1] = a.a;
    al[s * 4 + 2] = al[s * 4 + 3] = b.a;
    this.dirtyFrom = Math.min(this.dirtyFrom, s);
    this.dirtyTo = Math.max(this.dirtyTo, s);
    this.next = (s + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
  }

  private flush(): void {
    if (this.dirtyTo < 0) return;
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const aa = this.geo.getAttribute('alpha') as THREE.BufferAttribute;
    pa.addUpdateRange(this.dirtyFrom * 12, (this.dirtyTo - this.dirtyFrom + 1) * 12);
    aa.addUpdateRange(this.dirtyFrom * 4, (this.dirtyTo - this.dirtyFrom + 1) * 4);
    pa.needsUpdate = true;
    aa.needsUpdate = true;
    this.geo.setDrawRange(0, this.count * 6);
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }
}
