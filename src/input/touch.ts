import type { Settings } from '../settings';
import type { ButtonAction, InputDevice, InputFrame } from './actions';
import type { GyroSteer } from './gyro';

type Ctl = 'gas' | 'brake' | 'hb' | 'left' | 'right' | 'up' | 'down';

const CSS = `
.kl-touch-ui { position: fixed; inset: 0; pointer-events: none; z-index: 10; }
.kl-tc { position: absolute; pointer-events: auto; touch-action: none; border: 2px solid rgba(255,255,255,.28);
  background: rgba(255,255,255,.07); color: rgba(255,255,255,.75); font: 700 13px system-ui; letter-spacing: .06em;
  display: flex; align-items: flex-end; justify-content: center; padding-bottom: 10px; box-sizing: border-box;
  border-radius: 18px; overflow: hidden; -webkit-tap-highlight-color: transparent; }
.kl-tc .fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: rgba(255,255,255,.16); }
.kl-tc.on { border-color: rgba(255,255,255,.55); background: rgba(255,255,255,.14); }
.kl-tc span { position: relative; }
.kl-tc.round { border-radius: 50%; align-items: center; padding: 0; font-size: 15px; }
.kl-tc.gas .fill { background: rgba(120,230,140,.28); } .kl-tc.brake .fill { background: rgba(255,110,90,.28); }
`;

/**
 * Touch controls for phones (always landscape). Gas and brake are analog by finger height inside
 * their zone; handbrake is a big round button; steering is the gyro, or ◀ ▶ buttons as fallback.
 * Every control is multi-touch and keeps its finger until it lifts (pointer capture).
 */
export class TouchDevice implements InputDevice {
  readonly kind = 'touch' as const;
  readonly family = 'touch' as const;
  readonly root = document.createElement('div');
  private els = new Map<Ctl, HTMLDivElement>();
  private fingers = new Map<number, Ctl>();
  private values: Record<Ctl, number> = { gas: 0, brake: 0, hb: 0, left: 0, right: 0, up: 0, down: 0 };
  private pressedQueue: ButtonAction[] = [];
  private touched = false;
  private steerBtn = 0;

  constructor(private settings: Settings, private gyro: GyroSteer) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root.className = 'kl-touch-ui';
    document.body.appendChild(this.root);
    const mk = (c: Ctl, label: string, cls = '') => {
      const d = document.createElement('div');
      d.className = `kl-tc ${c} ${cls}`;
      d.innerHTML = `<div class="fill"></div><span>${label}</span>`;
      d.addEventListener('pointerdown', (e) => this.down(e, c));
      d.addEventListener('pointermove', (e) => this.move(e));
      d.addEventListener('pointerup', (e) => this.up(e));
      d.addEventListener('pointercancel', (e) => this.up(e));
      d.addEventListener('lostpointercapture', (e) => this.up(e));
      d.addEventListener('contextmenu', (e) => e.preventDefault());
      this.els.set(c, d);
      this.root.appendChild(d);
    };
    mk('brake', 'FRENO');
    mk('gas', 'GAS');
    mk('hb', 'FRENO<br>MANO', 'round');
    mk('left', '◀', 'round');
    mk('right', '▶', 'round');
    mk('up', '+', 'round');
    mk('down', '−', 'round');
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  set visible(v: boolean) { this.root.style.display = v ? '' : 'none'; }

  /** Place controls for the current screen and steering mode (all sizes relative to the short side). */
  layout(): void {
    const W = window.innerWidth, H = window.innerHeight;
    const u = Math.min(W, H);
    const safeL = 'max(10px, env(safe-area-inset-left))', safeR = 'max(10px, env(safe-area-inset-right))';
    const bottom = 'max(10px, env(safe-area-inset-bottom))';
    const buttons = this.settings.touchSteer === 'buttons';
    const zoneW = Math.round(u * 0.3), zoneH = Math.round(H * 0.52);
    const hb = Math.round(u * 0.26), small = Math.round(u * 0.15), steer = Math.round(u * 0.25);
    const set = (c: Ctl, css: Partial<CSSStyleDeclaration>) => Object.assign(this.els.get(c)!.style, { left: '', right: '', top: '', bottom: '', ...css });
    // right thumb: gas (outer) ; left thumb: brake (outer) + handbrake (inner)
    set('gas', { right: safeR, bottom, width: `${zoneW}px`, height: `${zoneH}px` });
    if (!buttons) {
      set('brake', { left: safeL, bottom, width: `${Math.round(zoneW * 0.8)}px`, height: `${zoneH}px` });
      set('hb', { left: `calc(${safeL} + ${Math.round(zoneW * 0.8) + 14}px)`, bottom: `calc(${bottom} + ${Math.round(u * 0.06)}px)`, width: `${hb}px`, height: `${hb}px` });
    } else {
      // left thumb steers with buttons; brake + handbrake move to the right thumb, inside the gas zone
      set('left', { left: safeL, bottom: `calc(${bottom} + ${Math.round(u * 0.04)}px)`, width: `${steer}px`, height: `${steer}px` });
      set('right', { left: `calc(${safeL} + ${steer + 12}px)`, bottom: `calc(${bottom} + ${Math.round(u * 0.04)}px)`, width: `${steer}px`, height: `${steer}px` });
      set('brake', { right: `calc(${safeR} + ${zoneW + 12}px)`, bottom, width: `${Math.round(zoneW * 0.62)}px`, height: `${Math.round(zoneH * 0.62)}px` });
      set('hb', { right: `calc(${safeR} + ${zoneW + 12}px)`, bottom: `calc(${bottom} + ${Math.round(zoneH * 0.62) + 12}px)`, width: `${Math.round(hb * 0.85)}px`, height: `${Math.round(hb * 0.85)}px` });
    }
    this.els.get('left')!.style.display = buttons ? '' : 'none';
    this.els.get('right')!.style.display = buttons ? '' : 'none';
    const shift = this.settings.touchShiftButtons;
    for (const c of ['up', 'down'] as Ctl[]) this.els.get(c)!.style.display = shift ? '' : 'none';
    set('up', { right: `calc(${safeR} + ${Math.round(zoneW / 2 - small / 2)}px)`, bottom: `calc(${bottom} + ${zoneH + 12}px)`, width: `${small}px`, height: `${small}px` });
    set('down', { right: `calc(${safeR} + ${Math.round(zoneW / 2 + small / 2 + 10)}px)`, bottom: `calc(${bottom} + ${zoneH + 12}px)`, width: `${small}px`, height: `${small}px` });
  }

  private down(e: PointerEvent, c: Ctl): void {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic / stale pointer */ }
    this.fingers.set(e.pointerId, c);
    this.touched = true;
    if (c === 'up') this.pressedQueue.push('shiftUp');
    if (c === 'down') this.pressedQueue.push('shiftDown');
    this.update(c, e);
  }

  private move(e: PointerEvent): void {
    const c = this.fingers.get(e.pointerId);
    if (c) this.update(c, e);
  }

  private up(e: PointerEvent): void {
    const c = this.fingers.get(e.pointerId);
    if (!c) return;
    this.fingers.delete(e.pointerId);
    if (![...this.fingers.values()].includes(c)) this.setValue(c, 0);
  }

  private update(c: Ctl, e: PointerEvent): void {
    if (c === 'gas' || c === 'brake') {
      // analog: touching low = 30 %, sliding the finger up = more
      const r = this.els.get(c)!.getBoundingClientRect();
      const t = (r.bottom - e.clientY) / r.height;
      this.setValue(c, Math.max(0.3, Math.min(1, 0.3 + 0.85 * t)));
    } else {
      this.setValue(c, 1);
    }
  }

  private setValue(c: Ctl, v: number): void {
    this.values[c] = v;
    const el = this.els.get(c)!;
    el.classList.toggle('on', v > 0);
    (el.firstElementChild as HTMLElement).style.height = `${v * 100}%`;
  }

  poll(dt: number, out: InputFrame): boolean {
    const s = this.settings;
    if (s.touchSteer === 'gyro' && this.gyro.live) {
      out.steer = this.gyro.steer(s.gyroLockDeg, s.gyroDeadzone, s.gyroInvert);
    } else {
      const target = this.values.right - this.values.left;
      const rate = target === 0 ? 5 : Math.sign(target) !== Math.sign(this.steerBtn) && this.steerBtn !== 0 ? 8 : 3.2;
      this.steerBtn = target > this.steerBtn ? Math.min(target, this.steerBtn + rate * dt) : Math.max(target, this.steerBtn - rate * dt);
      out.steer = this.steerBtn;
    }
    out.throttle = this.values.gas;
    out.brake = this.values.brake;
    out.handbrake = this.values.hb;
    for (const b of this.pressedQueue) out.pressed.add(b);
    this.pressedQueue.length = 0;
    const t = this.touched;
    this.touched = false;
    return t;
  }
}
