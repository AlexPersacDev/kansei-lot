import * as THREE from 'three';
import type { Car } from '../physics/car';

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec2 iSizeAlpha;   // size [m], alpha
attribute float iRot;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vAlpha = iSizeAlpha.y;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iRot), s = sin(iRot);
  vec2 p = mat2(c, -s, s, c) * position.xy * iSizeAlpha.x;
  mvPosition.xy += p;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
}`;

function puffTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size0: number; size1: number; rot: number; spin: number; alpha: number }

/** Tyre smoke: camera-facing instanced quads, emitted from sliding rear (and front) tyres. */
export class TireSmoke {
  readonly mesh: THREE.Mesh;
  /** 0..1 — scales emission and max particles (quality settings). */
  density = 1;
  private parts: Particle[] = [];
  private pos: Float32Array;
  private sa: Float32Array;
  private rot: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  private emitAcc = [0, 0, 0, 0];

  constructor(private max = 700) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.pos = new Float32Array(max * 3);
    this.sa = new Float32Array(max * 2);
    this.rot = new Float32Array(max);
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iSizeAlpha', new THREE.InstancedBufferAttribute(this.sa, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...THREE.UniformsLib.fog, uColor: { value: new THREE.Color('#e9e9e6') }, uMap: { value: puffTexture() } },
      transparent: true, depthWrite: false, fog: true,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(dt: number, car: Car): void {
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    const cap = Math.floor(this.max * this.density);
    car.wheels.forEach((w, i) => {
      // emission scales with sliding speed of the contact patch; fronts smoke less
      const slide = Math.max(0, w.slideSpeed - 2.5);
      const rate = Math.min(60, slide * 5) * (i < 2 ? 0.35 : 1) * this.density;
      this.emitAcc[i] += rate * dt;
      const wx = car.x + w.px * cy + w.pz * sy;
      const wz = car.z - w.px * sy + w.pz * cy;
      while (this.emitAcc[i] >= 1) {
        this.emitAcc[i] -= 1;
        if (this.parts.length >= cap) this.parts.shift();
        const strength = Math.min(1, slide / 10);
        this.parts.push({
          x: wx + (Math.random() - 0.5) * 0.3, y: 0.25, z: wz + (Math.random() - 0.5) * 0.3,
          vx: car.vx * 0.25 + (Math.random() - 0.5) * 1.2, vy: 0.5 + Math.random() * 0.5, vz: car.vz * 0.25 + (Math.random() - 0.5) * 1.2,
          age: 0, life: 1.8 + Math.random() * 1.6, size0: 0.6, size1: 3.5 + Math.random() * 2.5 * strength,
          rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.8, alpha: 0.12 + 0.18 * strength,
        });
      }
    });
    let n = 0;
    const drag = Math.exp(-dt * 1.6);
    for (let k = 0; k < this.parts.length; k++) {
      const p = this.parts[k];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx *= drag; p.vz *= drag; p.vy = p.vy * drag + 0.15 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const t = p.age / p.life;
      this.parts[n++] = p;
      const j = n - 1;
      this.pos[j * 3] = p.x; this.pos[j * 3 + 1] = p.y + t * 1.2; this.pos[j * 3 + 2] = p.z;
      this.sa[j * 2] = p.size0 + (p.size1 - p.size0) * Math.sqrt(t);
      this.sa[j * 2 + 1] = p.alpha * Math.min(1, p.age * 8) * (1 - t) * (1 - t);
      this.rot[j] = p.rot;
    }
    this.parts.length = n;
    this.geo.instanceCount = n;
    for (const name of ['iPos', 'iSizeAlpha', 'iRot']) {
      const a = this.geo.getAttribute(name) as THREE.InstancedBufferAttribute;
      a.needsUpdate = true;
      a.addUpdateRange(0, n * a.itemSize);
    }
  }
}
