import type { DeviceKind } from '../input/actions';
import type { PadDevice } from '../input/gamepad';
import { defaultSettings, saveSettings, type Settings, type Tuning } from '../settings';
import { injectStyles } from './styles';

export interface PauseHooks {
  activeKind: () => DeviceKind;
  pads: () => PadDevice[];
  defaultTuning: () => Tuning;
  /** Called after any change; apply settings to the car / devices. */
  apply: () => void;
  remap: (pad: PadDevice) => void;
  zones: () => { id: string; name: string }[];
  goZone: (id: string) => void;
  onClose: () => void;
}

const KIND_NAME: Record<DeviceKind, string> = { keyboard: 'teclado', gamepad: 'mando', wheel: 'volante', touch: 'táctil' };

/** Pause menu: settings + live car tuning. Everything persists to localStorage. */
export class PauseMenu {
  private ov: HTMLDivElement | null = null;

  constructor(private s: Settings, private hooks: PauseHooks) { injectStyles(); }

  get open(): boolean { return this.ov !== null; }
  toggle(): void { if (this.ov) this.close(); else this.show(); }

  close(): void {
    if (!this.ov) return;
    this.ov.remove();
    this.ov = null;
    this.hooks.onClose();
  }

  show(): void {
    if (this.ov) return;
    const s = this.s;
    const h = this.hooks;
    if (!s.tuning) s.tuning = h.defaultTuning();
    const t = s.tuning;
    const kind = h.activeKind();
    const ov = document.createElement('div');
    ov.className = 'kl-overlay';
    const menu = document.createElement('div');
    menu.className = 'kl-menu';
    ov.appendChild(menu);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) this.close(); });
    this.ov = ov;

    const changed = () => { saveSettings(s); h.apply(); };
    const section = (title: string) => { const el = document.createElement('h3'); el.textContent = title; menu.appendChild(el); };
    const row = (label: string, control: HTMLElement, out?: HTMLElement) => {
      const r = document.createElement('div');
      r.className = 'kl-row';
      const l = document.createElement('span');
      l.textContent = label;
      r.append(l, control, out ?? document.createElement('span'));
      menu.appendChild(r);
    };
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(get());
      const out = document.createElement('output');
      out.textContent = fmt(get());
      inp.addEventListener('input', () => { set(Number(inp.value)); out.textContent = fmt(Number(inp.value)); changed(); });
      row(label, inp, out);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.checked = get();
      inp.style.justifySelf = 'start';
      inp.addEventListener('change', () => { set(inp.checked); changed(); });
      row(label, inp);
    };
    const select = <T extends string>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const sel = document.createElement('select');
      for (const [v, txt] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = txt; sel.appendChild(o); }
      sel.value = get();
      sel.addEventListener('change', () => { set(sel.value as T); changed(); });
      row(label, sel);
    };
    const pct = (v: number) => `${Math.round(v * 100)}%`;

    const title = document.createElement('h2');
    title.textContent = 'Pausa';
    menu.appendChild(title);

    section('Ir a zona');
    {
      const wrap = document.createElement('div');
      wrap.className = 'kl-actions';
      wrap.style.marginTop = '0';
      for (const z of h.zones()) {
        const b = document.createElement('button');
        b.textContent = z.name;
        b.addEventListener('click', () => { h.goZone(z.id); this.close(); });
        wrap.appendChild(b);
      }
      menu.appendChild(wrap);
    }

    section('Conducción');
    slider(`Autocontravolante (${KIND_NAME[kind]})`, 0, 1, 0.05, () => s.assist[kind], (v) => { s.assist[kind] = v; }, pct);
    select('Caja de cambios', [['auto', 'Automática'], ['manual', 'Manual']], () => s.gearbox, (v) => { s.gearbox = v; });
    check('Palanca H exige embrague', () => s.hRequiresClutch, (v) => { s.hRequiresClutch = v; });

    section('Controles');
    check('Dirección con ratón (clic izq. gas, der. freno)', () => s.mouseSteer, (v) => { s.mouseSteer = v; });
    slider('Zona muerta del stick', 0, 0.3, 0.01, () => s.deadzone, (v) => { s.deadzone = v; }, pct);
    slider('Curva del stick', 0.6, 2.5, 0.05, () => s.steerCurve, (v) => { s.steerCurve = v; }, (v) => v.toFixed(2));
    slider('Volante: rango del driver', 180, 1080, 10, () => s.wheelRange, (v) => { s.wheelRange = v; }, (v) => `${v}°`);
    slider('Volante: giro para bloqueo', 90, 1080, 10, () => s.steerRange, (v) => { s.steerRange = v; }, (v) => `${v}°`);
    check('Vibración del mando', () => s.vibration, (v) => { s.vibration = v; });
    const pads = h.pads();
    if (pads.length) {
      const wrap = document.createElement('div');
      wrap.className = 'kl-actions';
      for (const p of pads) {
        const b = document.createElement('button');
        b.textContent = `Asignar: ${p.id.slice(0, 38)}${p.id.length > 38 ? '…' : ''}`;
        b.addEventListener('click', () => { this.close(); h.remap(p); });
        wrap.appendChild(b);
      }
      menu.appendChild(wrap);
    } else {
      const n = document.createElement('div');
      n.className = 'kl-note';
      n.textContent = 'Mandos/volantes: conéctalo y pulsa cualquier botón para que el navegador lo detecte.';
      menu.appendChild(n);
    }

    section('Pantalla y sonido');
    slider('Volumen', 0, 1, 0.05, () => s.volume, (v) => { s.volume = v; }, pct);
    check('Mostrar ayuda de controles', () => s.showHelp, (v) => { s.showHelp = v; });
    check('Telemetría de depuración', () => s.showTelemetry, (v) => { s.showTelemetry = v; });

    section('Reglaje (en vivo)');
    slider('Potencia', 0.6, 2, 0.05, () => t.powerScale, (v) => { t.powerScale = v; }, pct);
    select('Diferencial', [['open', 'Abierto'], ['lsd', 'Autoblocante'], ['welded', 'Soldado']], () => t.diffType, (v) => { t.diffType = v; });
    slider('Bloqueo del autoblocante', 0, 1, 0.05, () => t.lsdLockRatio, (v) => { t.lsdLockRatio = v; }, pct);
    slider('Ángulo de dirección', 30, 65, 1, () => t.maxSteerDeg, (v) => { t.maxSteerDeg = v; }, (v) => `${v}°`);
    slider('Agarre delantero', 0.6, 1.4, 0.02, () => t.gripFront, (v) => { t.gripFront = v; }, pct);
    slider('Agarre trasero', 0.6, 1.4, 0.02, () => t.gripRear, (v) => { t.gripRear = v; }, pct);
    slider('Reparto de frenada (del.)', 0.4, 0.85, 0.01, () => t.brakeBias, (v) => { t.brakeBias = v; }, pct);

    const actions = document.createElement('div');
    actions.className = 'kl-actions';
    const btn = (label: string, fn: () => void, primary = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };
    btn('Continuar', () => this.close(), true);
    btn('Reglaje de serie', () => { s.tuning = h.defaultTuning(); changed(); this.rebuild(); });
    btn('Restaurar todo', () => {
      const d = defaultSettings();
      Object.assign(s, { ...d, bindings: s.bindings });
      changed(); this.rebuild();
    });
    menu.appendChild(actions);
    document.body.appendChild(ov);
  }

  private rebuild(): void {
    if (!this.ov) return;
    this.ov.remove();
    this.ov = null;
    this.show();
  }
}
