import type { Car } from '../physics/car';

export interface ClipPoint { x: number; z: number; radius: number; label?: string }
export type ScoreEventKind = 'bonus' | 'banked' | 'lost';
export interface ScoreEvent { kind: ScoreEventKind; text: string; points?: number }

/** All scoring knobs in one place. */
export const SCORING = {
  minAngleDeg: 12,
  minSpeedKmh: 15,
  spinAngleDeg: 110,
  straightenGrace: 1.0,     // s without drifting before the combo is banked
  pointsPerDegKmhSec: 0.1,  // 40° at 40 km/h ≈ 160 pts/s before multiplier
  multRate: 0.12,           // multiplier gained per second of drift
  multMax: 5,
  transitionBonus: 250,
  transitionMult: 0.25,
  transitionWindow: 1.2,    // s: side change must happen within this of the last drift
  clipBonus: 400,
  clipCooldown: 2.0,
};

const REC_KEY = 'kl.records.v1';

/**
 * Drift score: angle × speed × time, with a multiplier that grows while the combo lasts.
 * Bonuses for transitions and clipping points. Spinning or hitting a wall/block loses the combo;
 * straightening for more than 1 s banks it.
 */
export class DriftScoring {
  zone = 'Zona libre';
  total = 0;
  records: Record<string, number> = {};
  active = false;
  base = 0;
  mult = 1;
  grace = 0;           // time since last drifting frame while a combo is open
  comboTime = 0;
  onEvent: (e: ScoreEvent) => void = () => {};

  private side = 0;
  private clips: ClipPoint[] = [];
  private clipHit = new Map<ClipPoint, number>();
  private time = 0;

  constructor() {
    try { this.records = JSON.parse(localStorage.getItem(REC_KEY) ?? '{}'); } catch { this.records = {}; }
  }

  get comboPoints(): number { return Math.round(this.base * this.mult); }
  get record(): number { return this.records[this.zone] ?? 0; }

  setClipPoints(points: ClipPoint[]): void { this.clips = points; this.clipHit.clear(); }

  setZone(name: string): void { this.zone = name; }

  update(dt: number, car: Car): void {
    this.time += dt;
    const S = SCORING;
    const angle = Math.abs(car.driftAngle) * 180 / Math.PI;
    const kmh = car.speed * 3.6;

    if (this.active && angle > S.spinAngleDeg && car.speed > 2) { this.lose('¡Trompo!'); return; }

    const drifting = car.forwardSpeed > 2 && angle >= S.minAngleDeg && kmh >= S.minSpeedKmh && angle < S.spinAngleDeg;
    if (drifting) {
      const side = Math.sign(car.driftAngle);
      if (!this.active) {
        this.active = true; this.base = 0; this.mult = 1; this.comboTime = 0; this.side = side;
      } else if (side !== this.side && this.grace < S.transitionWindow) {
        this.side = side;
        this.base += S.transitionBonus;
        this.mult = Math.min(S.multMax, this.mult + S.transitionMult);
        this.onEvent({ kind: 'bonus', text: 'Transición', points: S.transitionBonus });
      }
      this.grace = 0;
      this.comboTime += dt;
      this.base += angle * kmh * S.pointsPerDegKmhSec * dt;
      this.mult = Math.min(S.multMax, this.mult + S.multRate * dt);
      this.checkClips(car);
    } else if (this.active) {
      this.grace += dt;
      if (this.grace > S.straightenGrace) this.bank();
    }
  }

  private checkClips(car: Car): void {
    if (!this.clips.length) return;
    const half = car.spec.dims.length / 2;
    const sx = Math.sin(car.yaw), sz = Math.cos(car.yaw);
    const ends = [[car.x + sx * half, car.z + sz * half], [car.x - sx * half, car.z - sz * half]];
    for (const p of this.clips) {
      const last = this.clipHit.get(p) ?? -1e9;
      if (this.time - last < SCORING.clipCooldown) continue;
      let d = Infinity;
      for (const [ex, ez] of ends) d = Math.min(d, Math.hypot(ex - p.x, ez - p.z));
      if (d <= p.radius) {
        this.clipHit.set(p, this.time);
        const pts = Math.round(SCORING.clipBonus * (0.4 + 0.6 * (1 - d / p.radius)));
        this.base += pts;
        this.onEvent({ kind: 'bonus', text: d < p.radius * 0.4 ? 'Clipping perfecto' : 'Clipping', points: pts });
      }
    }
  }

  /** Walls / concrete blocks (not cones) call this. */
  breakCombo(reason: string): void { if (this.active) this.lose(reason); }

  private bank(): void {
    const pts = this.comboPoints;
    this.active = false;
    this.grace = 0;
    if (pts <= 0) return;
    this.total += pts;
    let text = `+${pts.toLocaleString('es-ES')}`;
    if (pts > this.record) {
      this.records[this.zone] = pts;
      try { localStorage.setItem(REC_KEY, JSON.stringify(this.records)); } catch { /* ignore */ }
      text += ' · ¡Récord!';
    }
    this.onEvent({ kind: 'banked', text, points: pts });
  }

  private lose(reason: string): void {
    this.active = false;
    this.grace = 0;
    this.base = 0;
    this.mult = 1;
    this.onEvent({ kind: 'lost', text: reason });
  }
}
