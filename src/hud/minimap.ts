import type { Car } from '../physics/car';
import { HALF, OBSTACLE_SIZE, ZONES, type Layout } from '../world/layout';

const PX_PER_M = 2;      // pre-rendered map resolution
const VIEW_M = 170;      // metres shown across the minimap

/**
 * Heading-up local minimap. The whole lot is pre-rendered once (zones, paint, obstacles);
 * each frame only a rotated crop is drawn. Map x is mirrored so it matches the driver's view
 * (+x is on the left when facing +z).
 */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private map: HTMLCanvasElement;
  private acc = 0;
  private size: number;

  constructor(parent: HTMLElement, layout: Layout) {
    this.size = Math.round(Math.min(150, Math.max(76, Math.min(window.innerHeight, window.innerWidth) * 0.22)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.el = document.createElement('canvas');
    this.el.width = this.el.height = Math.round(this.size * dpr);
    Object.assign(this.el.style, {
      position: 'fixed', right: 'max(14px, env(safe-area-inset-right))', top: 'calc(max(10px, env(safe-area-inset-top)) + 48px)',
      width: `${this.size}px`, height: `${this.size}px`, borderRadius: '50%', pointerEvents: 'none',
      boxShadow: '0 0 0 2px rgba(255,255,255,.25), 0 2px 10px rgba(0,0,0,.4)', background: 'rgba(20,22,26,.55)',
    } as CSSStyleDeclaration);
    parent.appendChild(this.el);
    this.ctx = this.el.getContext('2d')!;
    this.map = this.prerender(layout);
  }

  private toMap(x: number, z: number): [number, number] {
    return [(HALF - x) * PX_PER_M, (HALF - z) * PX_PER_M];
  }

  private prerender(layout: Layout): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = cv.height = HALF * 2 * PX_PER_M;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#3b3d42';
    g.fillRect(0, 0, cv.width, cv.height);
    for (const z of ZONES) {
      const [ax, az] = this.toMap(z.x1, z.z1);
      g.fillStyle = z.tint + '55';
      g.fillRect(ax, az, (z.x1 - z.x0) * PX_PER_M, (z.z1 - z.z0) * PX_PER_M);
    }
    const col = { white: '#e9e7dd', yellow: '#e2b632', red: '#e0503f' };
    g.lineCap = 'round';
    for (const p of layout.paint) {
      g.strokeStyle = col[p.color];
      g.lineWidth = Math.max(1.5, p.width * PX_PER_M * 2);
      g.setLineDash(p.dash ? p.dash.map((d) => d * PX_PER_M) : []);
      g.beginPath();
      p.pts.forEach(([x, z], i) => { const [mx, mz] = this.toMap(x, z); if (i) g.lineTo(mx, mz); else g.moveTo(mx, mz); });
      if (p.closed) g.closePath();
      g.stroke();
    }
    g.setLineDash([]);
    const kindCol: Record<string, string> = { cone: '#ff7a2a', barrel: '#3f7ae0', tires: '#111', pole: '#ddd', block: '#c9c6bd', wall: '#c9c6bd' };
    for (const o of layout.obstacles) {
      const [mx, mz] = this.toMap(o.x, o.z);
      const s = OBSTACLE_SIZE[o.kind];
      g.fillStyle = kindCol[o.kind];
      if (s.half) {
        g.save(); g.translate(mx, mz); g.rotate(o.yaw);
        g.fillRect(-s.half[1] * PX_PER_M * 1.5, -s.half[0] * PX_PER_M, s.half[1] * PX_PER_M * 3, s.half[0] * PX_PER_M * 2);
        g.restore();
      } else {
        g.beginPath(); g.arc(mx, mz, Math.max(2, (s.radius ?? 0.3) * PX_PER_M * 3), 0, Math.PI * 2); g.fill();
      }
    }
    return cv;
  }

  update(dt: number, car: Car): void {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const c = this.ctx, W = this.el.width;
    const scale = W / (VIEW_M * PX_PER_M);
    const heading = Math.atan2(car.vx, car.vz);
    const yaw = car.speed > 3 ? heading : car.yaw;
    const [mx, mz] = this.toMap(car.x, car.z);
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath(); c.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#2a2c30'; c.fillRect(0, 0, W, W);
    c.translate(W / 2, W / 2);
    c.rotate(yaw);
    c.scale(scale, scale);
    c.drawImage(this.map, -mx, -mz);
    c.restore();
    // car marker: points up = travel direction; nose offset shows the drift angle
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(yaw - car.yaw);
    const s = W / 40;
    c.fillStyle = '#fff';
    c.strokeStyle = '#000a';
    c.lineWidth = s * 0.3;
    c.beginPath(); c.moveTo(0, -s * 1.6); c.lineTo(s, s * 1.2); c.lineTo(0, s * 0.6); c.lineTo(-s, s * 1.2); c.closePath();
    c.fill(); c.stroke();
    c.restore();
  }
}
