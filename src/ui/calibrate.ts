import type { PadDevice } from '../input/gamepad';
import { saveSettings, type Binding, type Settings } from '../settings';
import { injectStyles } from './styles';

const LABEL: Record<string, string> = {
  steer: 'Dirección', throttle: 'Acelerador', brake: 'Freno', clutch: 'Embrague', handbrake: 'Freno de mano',
};

/**
 * Live calibration for a bound device: one row per axis with the raw value, the mapped output,
 * and buttons to capture rest / full travel or invert. Changes save immediately.
 */
export function openCalibration(pad: PadDevice, settings: Settings, onClose: () => void): void {
  injectStyles();
  const binds = settings.bindings[pad.id] ?? [];
  const axes = binds.filter((b) => b.kind === 'axis');
  const ov = document.createElement('div');
  ov.className = 'kl-overlay';
  const menu = document.createElement('div');
  menu.className = 'kl-menu';
  ov.appendChild(menu);
  menu.innerHTML = `<h2>Calibración</h2><div class="kl-note">${pad.id}</div>
    <p class="kl-note">Dirección: centra el volante y pulsa «Centro»; gíralo a la derecha del todo y pulsa «Derecha».
    Pedales: suéltalo y pulsa «Reposo»; písalo a fondo y pulsa «Fondo». Los cambios se guardan al momento.</p>`;
  if (!axes.length) {
    const n = document.createElement('p');
    n.textContent = 'Este dispositivo no tiene ejes asignados. Asigna los controles primero.';
    menu.appendChild(n);
  }
  const rows: { b: Binding; raw: HTMLElement; bar: HTMLElement; out: HTMLElement; vals: HTMLElement }[] = [];
  for (const b of axes) {
    const r = document.createElement('div');
    r.style.cssText = 'padding:8px 0;border-top:1px solid #2c2f36';
    const isSteer = b.action === 'steer';
    r.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <b>${LABEL[b.action] ?? b.action}</b><span class="kl-note">Eje ${b.index}</span></div>
      <div style="position:relative;height:12px;background:#23262c;border-radius:6px;margin:6px 0;overflow:hidden">
        ${isSteer ? '<i style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#666"></i>' : ''}
        <i class="bar" style="position:absolute;top:0;bottom:0;background:#d8432f"></i></div>
      <div class="kl-note vals" style="font-variant-numeric:tabular-nums"></div>
      <div class="kl-actions" style="margin-top:6px">
        <button data-a="rest">${isSteer ? 'Centro' : 'Reposo'}</button>
        <button data-a="full">${isSteer ? 'Derecha' : 'Fondo'}</button>
        <button data-a="inv">Invertir</button>
        <span class="kl-note raw" style="align-self:center"></span><span class="kl-note out" style="align-self:center;margin-left:auto"></span>
      </div>`;
    menu.appendChild(r);
    const q = (s: string) => r.querySelector(s) as HTMLElement;
    rows.push({ b, raw: q('.raw'), bar: q('.bar'), out: q('.out'), vals: q('.vals') });
    r.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
      const raw = pad.pad()?.axes[b.index] ?? 0;
      const a = btn.dataset.a;
      if (a === 'rest') b.rest = raw;
      else if (a === 'full') b.full = raw;
      else if (a === 'inv') b.full = isSteer ? 2 * b.rest - b.full : b.rest - (b.full - b.rest);
      if (Math.abs(b.full - b.rest) < 0.05) b.full = b.rest + (isSteer ? 1 : -1) * 0.5;
      saveSettings(settings);
    }));
  }
  const actions = document.createElement('div');
  actions.className = 'kl-actions';
  const done = document.createElement('button');
  done.className = 'primary';
  done.textContent = 'Listo';
  actions.appendChild(done);
  menu.appendChild(actions);
  document.body.appendChild(ov);

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const p = pad.pad();
    if (!p) return;
    for (const r of rows) {
      const raw = p.axes[r.b.index] ?? 0;
      const v = (raw - r.b.rest) / ((r.b.full - r.b.rest) || 1);
      const isSteer = r.b.action === 'steer';
      const out = isSteer ? Math.max(-1, Math.min(1, v)) : Math.max(0, Math.min(1, v));
      r.raw.textContent = `bruto ${raw.toFixed(3)}`;
      r.out.textContent = isSteer ? `${(out * 100).toFixed(0)} %` : `${(out * 100).toFixed(0)} %`;
      r.vals.textContent = `${isSteer ? 'centro' : 'reposo'} ${r.b.rest.toFixed(3)} · ${isSteer ? 'derecha' : 'fondo'} ${r.b.full.toFixed(3)}`;
      if (isSteer) {
        const w = Math.abs(out) * 50;
        r.bar.style.left = out >= 0 ? '50%' : `${50 - w}%`;
        r.bar.style.width = `${w}%`;
      } else {
        r.bar.style.left = '0';
        r.bar.style.width = `${out * 100}%`;
      }
    }
  };
  tick();
  done.addEventListener('click', () => { cancelAnimationFrame(raf); ov.remove(); onClose(); });
}
