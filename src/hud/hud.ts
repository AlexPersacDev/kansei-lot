import type { Car } from '../physics/car';
import type { DriftScoring, ScoreEvent } from '../game/scoring';
import { SCORING } from '../game/scoring';

const CSS = `
.kl-hud { position: fixed; pointer-events: none; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.7); font-family: system-ui, sans-serif; }
.kl-dash { right: max(14px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom)); text-align: right; }
.kl-dash .spd { font: 800 44px/1 system-ui; font-variant-numeric: tabular-nums; letter-spacing: -1px; }
.kl-dash .unit { font: 600 12px system-ui; opacity: .75; margin-left: 4px; }
.kl-dash .gear { display: inline-block; margin-left: 12px; font: 800 30px/1 system-ui; min-width: 30px; text-align: center;
  padding: 3px 6px; border-radius: 7px; background: rgba(0,0,0,.35); }
.kl-dash .gear.cut { background: #d8432f; }
.kl-dash .mode { font: 600 10px system-ui; opacity: .7; display: block; margin-top: 2px; }
.kl-rpm { width: 220px; height: 9px; margin: 6px 0 0 auto; background: rgba(0,0,0,.4); border-radius: 5px; position: relative; overflow: hidden; }
.kl-rpm i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg,#9fd3ff,#ffffff 70%,#ffcf5a 88%,#ff4b3a); }
.kl-rpm b { position: absolute; top: 0; bottom: 0; background: rgba(255,60,40,.45); }
.kl-rpm-l { font: 600 11px system-ui; opacity: .8; font-variant-numeric: tabular-nums; margin-top: 3px; }
.kl-angle { font: 700 15px system-ui; opacity: .9; }
.kl-combo { left: 50%; top: max(12px, env(safe-area-inset-top)); transform: translateX(-50%); text-align: center; min-width: 200px; }
.kl-combo .pts { font: 800 34px/1.05 system-ui; font-variant-numeric: tabular-nums; }
.kl-combo .mult { font: 800 18px system-ui; color: #ffcf5a; margin-left: 6px; }
.kl-combo .grace { height: 3px; width: 160px; margin: 4px auto 0; background: rgba(255,255,255,.2); border-radius: 2px; overflow: hidden; }
.kl-combo .grace i { display: block; height: 100%; background: #ffcf5a; }
.kl-pops { left: 50%; top: calc(max(12px, env(safe-area-inset-top)) + 70px); transform: translateX(-50%); text-align: center; }
.kl-pop { font: 700 17px system-ui; animation: klpop 1.6s ease-out forwards; }
.kl-pop.lost { color: #ff6b5e; } .kl-pop.banked { color: #8ff0a4; font-size: 22px; } .kl-pop.bonus { color: #ffcf5a; }
@keyframes klpop { 0% { opacity: 0; transform: translateY(6px) scale(.9); } 12% { opacity: 1; transform: none; } 75% { opacity: 1; } 100% { opacity: 0; transform: translateY(-14px); } }
.kl-zone { left: max(14px, env(safe-area-inset-left)); top: max(10px, env(safe-area-inset-top)); }
.kl-zone .name { font: 800 15px system-ui; letter-spacing: .06em; text-transform: uppercase; }
.kl-zone .line { font: 600 12px system-ui; opacity: .85; font-variant-numeric: tabular-nums; }
@media (max-height: 520px) { .kl-dash .spd { font-size: 34px; } .kl-rpm { width: 170px; } .kl-combo .pts { font-size: 28px; } }
`;

const fmt = (n: number) => Math.round(n).toLocaleString('es-ES');

/** Game HUD: dash (speed, gear, rpm with limiter), combo + popups, zone / total / record. */
export class Hud {
  private dash = document.createElement('div');
  private combo = document.createElement('div');
  private pops = document.createElement('div');
  private zone = document.createElement('div');
  private els: Record<string, HTMLElement> = {};
  private acc = 0;

  constructor(parent: HTMLElement, private car: Car, private score: DriftScoring) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const red = car.spec.engine.redlineRpm, max = car.spec.engine.limiterRpm + 400;
    this.dash.className = 'kl-hud kl-dash';
    this.dash.innerHTML = `<div class="kl-angle"></div>
      <div><span class="spd">0</span><span class="unit">km/h</span><span class="gear">1</span></div>
      <div class="kl-rpm"><b style="left:${(red / max) * 100}%;right:0"></b><i></i></div>
      <div class="kl-rpm-l"></div><span class="mode"></span>`;
    this.combo.className = 'kl-hud kl-combo';
    this.combo.innerHTML = `<div><span class="pts"></span><span class="mult"></span></div><div class="grace"><i></i></div>`;
    this.pops.className = 'kl-hud kl-pops';
    this.zone.className = 'kl-hud kl-zone';
    this.zone.innerHTML = `<div class="name"></div><div class="line total"></div><div class="line rec"></div>`;
    parent.append(this.dash, this.combo, this.pops, this.zone);
    const q = (root: HTMLElement, s: string) => root.querySelector(s) as HTMLElement;
    this.els = {
      angle: q(this.dash, '.kl-angle'), spd: q(this.dash, '.spd'), gear: q(this.dash, '.gear'),
      rpm: q(this.dash, '.kl-rpm i'), rpmL: q(this.dash, '.kl-rpm-l'), mode: q(this.dash, '.mode'),
      pts: q(this.combo, '.pts'), mult: q(this.combo, '.mult'), grace: q(this.combo, '.grace i'),
      zname: q(this.zone, '.name'), total: q(this.zone, '.total'), rec: q(this.zone, '.rec'),
    };
    this.rpmMax = max;
  }
  private rpmMax: number;

  /** Push a popup (transition, clipping, banked, lost). */
  event(e: ScoreEvent): void {
    const d = document.createElement('div');
    d.className = `kl-pop ${e.kind}`;
    d.textContent = e.kind === 'bonus' && e.points ? `${e.text} +${fmt(e.points)}` : e.text;
    this.pops.prepend(d);
    while (this.pops.children.length > 4) this.pops.lastChild?.remove();
    setTimeout(() => d.remove(), 1700);
  }

  update(dt: number): void {
    // rpm bar every frame (it is the one thing that must feel instant)
    const car = this.car;
    const e = this.els;
    e.rpm.style.width = `${Math.min(100, (car.rpm / this.rpmMax) * 100)}%`;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const s = this.score;
    const kmh = Math.abs(car.forwardSpeed) * 3.6;
    const angle = Math.abs(car.driftAngle) * 180 / Math.PI;
    e.spd.textContent = kmh.toFixed(0);
    e.gear.textContent = car.gear < 0 ? 'R' : car.gear === 0 ? 'N' : String(car.gear);
    e.gear.classList.toggle('cut', car.limiterCut);
    e.rpmL.textContent = `${Math.round(car.rpm / 10) * 10} rpm`;
    e.mode.textContent = car.setup.autoGearbox ? 'AUTO' : 'MANUAL';
    e.angle.textContent = angle >= SCORING.minAngleDeg && car.speed > 3 ? `${angle.toFixed(0)}°` : '';
    if (s.active) {
      e.pts.textContent = fmt(s.comboPoints);
      e.mult.textContent = `×${s.mult.toFixed(1).replace('.', ',')}`;
      e.grace.style.width = `${(1 - s.grace / SCORING.straightenGrace) * 100}%`;
      this.combo.style.opacity = '1';
    } else {
      this.combo.style.opacity = '0';
    }
    e.zname.textContent = s.zone;
    e.total.textContent = `Total ${fmt(s.total)}`;
    e.rec.textContent = `Récord ${fmt(s.record)}`;
  }
}
