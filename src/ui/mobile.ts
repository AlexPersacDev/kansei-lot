import { injectStyles } from './styles';

const CSS = `
.kl-start { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: rgba(12,13,16,.78);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); color: #fff; text-align: center; cursor: pointer; }
.kl-start h1 { font: 900 clamp(26px, 6vmin, 46px) system-ui; letter-spacing: .08em; margin: 0 0 8px; }
.kl-start p { font: 600 clamp(14px, 3.2vmin, 18px) system-ui; opacity: .85; margin: 4px 0; }
.kl-start .pulse { animation: klpulse 1.4s ease-in-out infinite; }
@keyframes klpulse { 50% { opacity: .45; } }
.kl-rotate { position: fixed; inset: 0; z-index: 95; display: none; place-items: center; background: #15171b; color: #fff;
  text-align: center; font: 700 20px system-ui; }
.kl-rotate .ph { width: 54px; height: 90px; border: 4px solid #fff; border-radius: 10px; margin: 0 auto 18px;
  animation: klrot 2s ease-in-out infinite; }
@keyframes klrot { 0%, 30% { transform: rotate(0); } 60%, 100% { transform: rotate(-90deg); } }
`;

let styled = false;
function style(): void {
  if (styled) return;
  styled = true;
  injectStyles();
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function isTouchDevice(): boolean {
  if (new URLSearchParams(location.search).has('touch')) return true; // debug: force the phone UI
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && 'ontouchstart' in window);
}

/**
 * "Tap to start" screen. `onGesture` runs synchronously inside the tap/keypress so it can unlock
 * audio and ask iOS for motion permission (both require a user gesture).
 */
export function startScreen(touch: boolean, onGesture: () => void): Promise<void> {
  style();
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'kl-start';
    el.innerHTML = `<div><h1>KANSEI LOT</h1>
      <p class="pulse">${touch ? 'Toca para empezar' : 'Haz clic o pulsa una tecla para empezar'}</p>
      ${touch ? '<p style="font-size:13px;opacity:.65">Sujeta el móvil en horizontal como un volante</p>' : ''}</div>`;
    document.body.appendChild(el);
    const go = (e: Event) => {
      e.preventDefault();
      el.removeEventListener('pointerup', go);
      window.removeEventListener('keydown', go);
      onGesture();
      el.remove();
      resolve();
    };
    // pointerup/keydown count as user activation on iOS and Android
    el.addEventListener('pointerup', go);
    window.addEventListener('keydown', go);
  });
}

/** Portrait warning for phones. `blocking` is true while it is shown. */
export class RotateOverlay {
  private el = document.createElement('div');
  blocking = false;
  constructor(private touch: boolean) {
    style();
    this.el.className = 'kl-rotate';
    this.el.innerHTML = '<div><div class="ph"></div>Gira el móvil</div>';
    document.body.appendChild(this.el);
    const check = () => this.check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    check();
  }
  private check(): void {
    this.blocking = this.touch && window.innerHeight > window.innerWidth;
    this.el.style.display = this.blocking ? 'grid' : 'none';
  }
}

/** Keep the screen awake while playing (re-acquired when the page becomes visible again). */
export function keepAwake(): void {
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ released: boolean }> } };
  if (!nav.wakeLock) return;
  let lock: { released: boolean } | null = null;
  const req = () => { nav.wakeLock!.request('screen').then((l) => { lock = l; }).catch(() => {}); };
  req();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!lock || lock.released)) req();
  });
}

/** Android: real fullscreen + landscape lock (iOS ignores both; the installed PWA is fullscreen). */
export function enterFullscreenLandscape(): void {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' });
    p?.then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
  } catch { /* not allowed */ }
}

/** Stop pinch-zoom, double-tap zoom, scrolling and long-press selection. */
export function lockViewport(): void {
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('touchmove', (e) => {
    // allow scrolling inside menus only
    if (!(e.target as HTMLElement).closest?.('.kl-menu')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('selectstart', (e) => {
    if (!(e.target as HTMLElement).closest?.('input')) e.preventDefault();
  });
}
