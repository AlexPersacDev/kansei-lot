import type { GlyphFamily } from '../input/actions';
import type { Binding } from '../settings';

/** Rows shown in the controls help, in order. */
export type HelpAction =
  | 'steer' | 'throttle' | 'brake' | 'handbrake' | 'clutch' | 'shiftUp' | 'shiftDown'
  | 'camera' | 'reset' | 'pause' | 'toggleHelp';

export const HELP_LABELS: Record<HelpAction, string> = {
  steer: 'Dirección', throttle: 'Acelerador', brake: 'Freno', handbrake: 'Freno de mano',
  clutch: 'Embrague', shiftUp: 'Subir marcha', shiftDown: 'Bajar marcha', camera: 'Cámara',
  reset: 'Recolocar', pause: 'Pausa', toggleHelp: 'Ocultar ayuda',
};

const kbd = (t: string, wide = false) => `<span class="kl-g kbd${wide ? ' wide' : ''}">${t}</span>`;
const pill = (t: string) => `<span class="kl-g pill">${t}</span>`;
const face = (t: string, color: string) => `<span class="kl-g face" style="color:${color};border-color:${color}66">${t}</span>`;

const XBOX = {
  south: face('A', '#5fcf4a'), east: face('B', '#ef5350'), west: face('X', '#4f8cf0'), north: face('Y', '#f2c23a'),
  lb: pill('LB'), rb: pill('RB'), lt: pill('LT'), rt: pill('RT'), select: pill('⧉ View'), start: pill('☰ Menu'), ls: pill('◀ LS ▶'),
};
const PS = {
  south: face('✕', '#7ba7ff'), east: face('○', '#ff6f78'), west: face('□', '#e58be0'), north: face('△', '#46d3a8'),
  lb: pill('L1'), rb: pill('R1'), lt: pill('L2'), rt: pill('R2'), select: pill('Create'), start: pill('Options'), ls: pill('◀ L ▶'),
};
const GENERIC = {
  south: face('↓', '#ccc'), east: face('→', '#ccc'), west: face('←', '#ccc'), north: face('↑', '#ccc'),
  lb: pill('L1'), rb: pill('R1'), lt: pill('L2'), rt: pill('R2'), select: pill('Select'), start: pill('Start'), ls: pill('◀ Stick ▶'),
};
type PadGlyphs = typeof XBOX;

function padRows(g: PadGlyphs): Record<HelpAction, string> {
  return {
    steer: g.ls, throttle: g.rt, brake: g.lt, handbrake: g.south, clutch: g.west,
    shiftUp: g.rb, shiftDown: g.lb, camera: g.north, reset: g.east, pause: g.start, toggleHelp: g.select,
  };
}

const KEYBOARD: Record<HelpAction, string> = {
  steer: `${kbd('A')}${kbd('D')} / ${kbd('←')}${kbd('→')}`,
  throttle: `${kbd('W')} / ${kbd('↑')}`,
  brake: `${kbd('S')} / ${kbd('↓')}`,
  handbrake: kbd('Espacio', true),
  clutch: kbd('Shift', true),
  shiftUp: kbd('E'), shiftDown: kbd('Q'), camera: kbd('C'), reset: kbd('R'), pause: kbd('Esc'), toggleHelp: kbd('H'),
};

const MOUSE: Record<HelpAction, string> = {
  ...KEYBOARD,
  steer: `${pill('🖱 ◀ ▶')} o ${kbd('A')}${kbd('D')}`,
  throttle: `${pill('Clic izq.')} / ${kbd('W')}`,
  brake: `${pill('Clic der.')} / ${kbd('S')}`,
};

const TOUCH: Record<HelpAction, string> = {
  steer: pill('Inclinar el móvil'), throttle: pill('Zona derecha ↕'), brake: pill('Zona izquierda ↕'),
  handbrake: pill('Botón FM'), clutch: pill('—'), shiftUp: pill('+'), shiftDown: pill('−'),
  camera: pill('📷'), reset: pill('↺'), pause: pill('❚❚'), toggleHelp: pill('?'),
};

function describeBinding(b: Binding | undefined): string {
  if (!b) return `<span class="kl-note">sin asignar</span>`;
  return pill(b.kind === 'axis' ? `Eje ${b.index}` : `Botón ${b.index}`);
}

export function helpRows(family: GlyphFamily, bindings?: Binding[]): Record<HelpAction, string> {
  switch (family) {
    case 'keyboard': return KEYBOARD;
    case 'mouse': return MOUSE;
    case 'xbox': return padRows(XBOX);
    case 'playstation': return padRows(PS);
    case 'generic': return padRows(GENERIC);
    case 'touch': return TOUCH;
    case 'wheel': {
      const find = (a: string) => bindings?.find((b) => b.action === a);
      const rows = {} as Record<HelpAction, string>;
      for (const a of Object.keys(HELP_LABELS) as HelpAction[]) rows[a] = describeBinding(find(a));
      rows.steer = `${pill('Volante')} ${describeBinding(find('steer'))}`;
      if (bindings?.some((b) => b.action.startsWith('gear'))) rows.shiftUp = pill('Palanca H') + (find('shiftUp') ? ' / ' + describeBinding(find('shiftUp')) : '');
      return rows;
    }
  }
}

export const FAMILY_TITLE: Record<GlyphFamily, string> = {
  keyboard: 'Teclado', mouse: 'Teclado + ratón', xbox: 'Mando Xbox', playstation: 'Mando PlayStation',
  generic: 'Mando', wheel: 'Volante', touch: 'Táctil',
};
