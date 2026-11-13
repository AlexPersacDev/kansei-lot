import type { World } from './world';
import type { TireSmoke } from './smoke';

export type QualityLevel = 'low' | 'medium' | 'high';
const ORDER: QualityLevel[] = ['low', 'medium', 'high'];

const PRESETS: Record<QualityLevel, { pixelRatio: number; shadows: number; smoke: number }> = {
  low: { pixelRatio: 1, shadows: 0, smoke: 0.35 },
  medium: { pixelRatio: 1.5, shadows: 1024, smoke: 0.65 },
  high: { pixelRatio: 2, shadows: 2048, smoke: 1 },
};

/**
 * Render quality: pixel ratio, sun shadows and smoke density. In 'auto' it starts at a sensible
 * level for the device and steps down when the frame rate stays under ~50 fps (never back up,
 * to avoid flip-flopping).
 */
export class QualityManager {
  level: QualityLevel;
  auto = true;
  onChange: (l: QualityLevel) => void = () => {};
  private frames = 0;
  private time = 0;
  private grace = 3;

  constructor(private world: World, private smoke: TireSmoke, mobile: boolean) {
    this.level = mobile ? 'medium' : 'high';
  }

  setMode(mode: 'auto' | QualityLevel, mobile: boolean): void {
    this.auto = mode === 'auto';
    this.apply(mode === 'auto' ? (mobile ? 'medium' : 'high') : mode);
  }

  apply(level: QualityLevel): void {
    this.level = level;
    const p = PRESETS[level];
    const r = this.world.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    this.world.resize();
    const sun = this.world.sun;
    sun.castShadow = p.shadows > 0;
    if (p.shadows > 0 && sun.shadow.mapSize.x !== p.shadows) {
      sun.shadow.mapSize.set(p.shadows, p.shadows);
      sun.shadow.map?.dispose();
      (sun.shadow as { map: unknown }).map = null;
    }
    this.smoke.density = p.smoke;
    this.grace = 3;
    this.frames = 0; this.time = 0;
    this.onChange(level);
  }

  /** Call once per rendered frame with the real frame time. */
  update(dt: number, active: boolean): void {
    if (!this.auto || !active || document.hidden) return;
    if (this.grace > 0) { this.grace -= dt; return; }
    this.frames++;
    this.time += dt;
    if (this.time < 2.5) return;
    const fps = this.frames / this.time;
    this.frames = 0; this.time = 0;
    const i = ORDER.indexOf(this.level);
    if (fps < 50 && i > 0) this.apply(ORDER[i - 1]);
  }
}
