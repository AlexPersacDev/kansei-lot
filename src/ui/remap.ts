import type { PadDevice } from '../input/gamepad';
import { saveSettings, type Binding, type Settings } from '../settings';
import { injectStyles } from './styles';

interface Step { action: Binding['action']; prompt: string; kind: 'axis' | 'button' | 'either' }

const AXES: Step[] = [
  { action: 'steer', kind: 'axis', prompt: 'Con el volante/stick centrado, gíralo a la DERECHA del todo y vuelve al centro' },
  { action: 'throttle', kind: 'either', prompt: 'Pisa el ACELERADOR a fondo y suéltalo' },
  { action: 'brake', kind: 'either', prompt: 'Pisa el FRENO a fondo y suéltalo' },
  { action: 'clutch', kind: 'either', prompt: 'Pisa el EMBRAGUE a fondo y suéltalo (o salta si no tienes)' },
  { action: 'handbrake', kind: 'either', prompt: 'Tira del FRENO DE MANO (eje o botón)' },
];
const BUTTONS: Step[] = [
  { action: 'shiftUp', kind: 'button', prompt: 'Pulsa SUBIR MARCHA (leva derecha)' },
  { action: 'shiftDown', kind: 'button', prompt: 'Pulsa BAJAR MARCHA (leva izquierda)' },
  { action: 'camera', kind: 'button', prompt: 'Pulsa el botón de CÁMARA' },
  { action: 'reset', kind: 'button', prompt: 'Pulsa el botón de RECOLOCAR' },
  { action: 'pause', kind: 'button', prompt: 'Pulsa el botón de PAUSA' },
  { action: 'toggleHelp', kind: 'button', prompt: 'Pulsa el botón de AYUDA de controles' },
];
const SHIFTER: Step[] = [
  { action: 'gear1', kind: 'button', prompt: 'Palanca H: mete 1ª (o salta si no tienes palanca)' },
  { action: 'gear2', kind: 'button', prompt: 'Palanca H: mete 2ª' },
  { action: 'gear3', kind: 'button', prompt: 'Palanca H: mete 3ª' },
  { action: 'gear4', kind: 'button', prompt: 'Palanca H: mete 4ª' },
  { action: 'gear5', kind: 'button', prompt: 'Palanca H: mete 5ª' },
  { action: 'gearR', kind: 'button', prompt: 'Palanca H: mete la marcha atrás' },
];

/**
 * "Move / press the control" mapping screen. Axes are calibrated as they are captured: the value
 * at the start of the step is "rest", the extreme reached is "full" (so inverted pedals just work).
 * Note: the H-shifter is often a separate USB device; pass every connected pad in `extra`.
 */
export function openRemap(pad: PadDevice, settings: Settings, extra: PadDevice[], onClose: () => void): void {
  injectStyles();
  const steps = [...AXES, ...BUTTONS, ...(pad.kind === 'wheel' ? SHIFTER : [])];
  const devices = [pad, ...extra.filter((p) => p !== pad)];
  const result: Binding[] = [];
  const shifterBinds: Map<string, Binding[]> = new Map();
  let i = 0;
  let shifterSkipped = false;

  const ov = document.createElement('div');
  ov.className = 'kl-overlay';
  ov.innerHTML = `<div class="kl-menu">
    <h2>Asignar controles</h2>
    <div class="kl-note dev"></div>
    <p class="prompt" style="font-size:17px;min-height:3em;margin:16px 0 6px"></p>
    <div class="kl-note live" style="font-variant-numeric:tabular-nums;min-height:1.3em"></div>
    <div class="kl-note" style="margin-top:4px"><span class="count"></span></div>
    <div class="kl-actions"><button class="skip">Saltar</button><button class="back">Atrás</button><button class="cancel">Cancelar</button></div>
  </div>`;
  document.body.appendChild(ov);
  const $ = <T extends HTMLElement>(s: string) => ov.querySelector(s) as T;
  $('.dev').textContent = pad.id;

  let base: { axes: number[]; buttons: boolean[] }[] = [];
  let candidate: { dev: number; axis: number; extreme: number } | null = null;
  let raf = 0;

  const snapshot = () => devices.map((d) => {
    const p = d.pad();
    return { axes: p ? [...p.axes] : [], buttons: p ? p.buttons.map((b) => b.pressed || b.value > 0.5) : [] };
  });

  const begin = () => {
    if (i >= steps.length) return finish();
    const s = steps[i];
    if (shifterSkipped && s.action.startsWith('gear')) { i++; return begin(); }
    $('.prompt').textContent = s.prompt;
    $('.count').textContent = `${i + 1} / ${steps.length}`;
    $('.live').textContent = '';
    candidate = null;
    // wait a moment so the press that ended the previous step doesn't count
    base = [];
    setTimeout(() => { base = snapshot(); }, 250);
  };

  const commit = (devIdx: number, b: Binding) => {
    const owner = devices[devIdx];
    if (owner === pad) result.push(b);
    else {
      const list = shifterBinds.get(owner.id) ?? [];
      list.push(b);
      shifterBinds.set(owner.id, list);
    }
    i++;
    begin();
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!base.length || i >= steps.length) return;
    const s = steps[i];
    const now = snapshot();
    // buttons
    if (s.kind !== 'axis') {
      for (let d = 0; d < now.length; d++) {
        for (let b = 0; b < now[d].buttons.length; b++) {
          if (now[d].buttons[b] && !base[d].buttons[b]) {
            return commit(d, { action: s.action, kind: 'button', index: b, rest: 0, full: 1 });
          }
        }
      }
    }
    // axes: track the axis that moved most; commit when it returns near rest
    if (s.kind !== 'button') {
      if (!candidate) {
        let best = 0;
        for (let d = 0; d < now.length; d++) {
          for (let a = 0; a < now[d].axes.length; a++) {
            const delta = Math.abs(now[d].axes[a] - base[d].axes[a]);
            if (delta > 0.5 && delta > best) { best = delta; candidate = { dev: d, axis: a, extreme: now[d].axes[a] }; }
          }
        }
      } else {
        const v = now[candidate.dev].axes[candidate.axis];
        const rest = base[candidate.dev].axes[candidate.axis];
        if (Math.abs(v - rest) > Math.abs(candidate.extreme - rest)) candidate.extreme = v;
        $('.live').textContent = `Eje ${candidate.axis}: reposo ${rest.toFixed(2)} · fondo ${candidate.extreme.toFixed(2)} · ahora ${v.toFixed(2)}`;
        if (Math.abs(v - rest) < 0.15) {
          commit(candidate.dev, { action: s.action, kind: 'axis', index: candidate.axis, rest, full: candidate.extreme });
        }
      }
    }
  };

  const finish = () => {
    cancelAnimationFrame(raf);
    settings.bindings[pad.id] = result;
    for (const [id, list] of shifterBinds) settings.bindings[id] = [...(settings.bindings[id] ?? []).filter((b) => !list.some((n) => n.action === b.action)), ...list];
    saveSettings(settings);
    ov.remove();
    onClose();
  };

  $('.skip').addEventListener('click', () => {
    if (steps[i]?.action === 'gear1') shifterSkipped = true;
    i++; begin();
  });
  $('.back').addEventListener('click', () => {
    if (i === 0) return;
    i--;
    const a = steps[i].action;
    const idx = result.findIndex((b) => b.action === a);
    if (idx >= 0) result.splice(idx, 1);
    if (a === 'gear1') shifterSkipped = false;
    begin();
  });
  $('.cancel').addEventListener('click', () => { cancelAnimationFrame(raf); ov.remove(); onClose(); });

  begin();
  tick();
}
