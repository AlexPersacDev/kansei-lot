import type { GlyphFamily } from '../input/actions';
import type { Binding } from '../settings';
import { FAMILY_TITLE, HELP_LABELS, helpRows, type HelpAction } from './glyphs';
import { injectStyles } from './styles';

/** Controls help panel for the active device. Re-renders only when the device changes. */
export class HelpPanel {
  readonly el: HTMLDivElement;
  private key = '';

  constructor(parent: HTMLElement) {
    injectStyles();
    this.el = document.createElement('div');
    this.el.className = 'kl-panel kl-help';
    parent.appendChild(this.el);
  }

  set visible(v: boolean) { this.el.style.display = v ? '' : 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  show(family: GlyphFamily, bindings?: Binding[], manualGearbox = false): void {
    const key = `${family}|${manualGearbox}|${JSON.stringify(bindings ?? [])}`;
    if (key === this.key) return;
    this.key = key;
    const rows = helpRows(family, bindings);
    const order = Object.keys(HELP_LABELS) as HelpAction[];
    const html = order
      .filter((a) => !(family === 'touch' && a === 'clutch'))
      .filter((a) => manualGearbox || family === 'wheel' || (a !== 'shiftUp' && a !== 'shiftDown') || family !== 'touch')
      .map((a) => `<tr><td>${rows[a]}</td><td>${HELP_LABELS[a]}</td></tr>`)
      .join('');
    this.el.innerHTML = `<h4>${FAMILY_TITLE[family]}</h4><table>${html}</table>`;
  }
}
