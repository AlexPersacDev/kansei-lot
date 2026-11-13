/** Shared UI styles, injected once. */
const CSS = `
.kl-panel { position: fixed; background: rgba(16,17,20,.62); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,.08); border-radius: 10px; color: #eee; font: 13px/1.3 system-ui, sans-serif; }
.kl-help { left: max(12px, env(safe-area-inset-left)); bottom: max(12px, env(safe-area-inset-bottom)); padding: 7px 9px 8px;
  pointer-events: none; font-size: 12px; background: rgba(16,17,20,.5); }
.kl-help .kl-g { height: 19px; min-width: 19px; font-size: 10px; padding: 0 5px; }
.kl-help .kl-g.face { width: 19px; padding: 0; font-size: 11px; }
.kl-help td { padding: 1px 0; }
@media (max-height: 520px), (max-width: 760px) {
  .kl-help { transform: scale(.82); transform-origin: left bottom; }
}
.kl-help h4 { margin: 0 0 6px; font: 600 11px system-ui; letter-spacing: .08em; text-transform: uppercase; color: #aab; }
.kl-help table { border-collapse: collapse; }
.kl-help td { padding: 2px 0; vertical-align: middle; }
.kl-help td:first-child { padding-right: 14px; white-space: nowrap; }
.kl-help td:last-child { color: #cfd2d8; }
.kl-g { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px;
  border-radius: 6px; font: 700 11px/1 system-ui; box-sizing: border-box; margin-right: 3px; vertical-align: middle;
  background: #2b2e35; border: 1px solid #4a4e58; color: #f2f2f2; }
.kl-g.kbd { border-bottom-width: 3px; }
.kl-g.face { border-radius: 50%; width: 22px; padding: 0; font-size: 12px; background: #1d1f24; }
.kl-g.pill { border-radius: 11px; background: #23262c; }
.kl-g.wide { min-width: 52px; }
.kl-btn { position: fixed; top: max(10px, env(safe-area-inset-top)); width: 38px; height: 38px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.15); background: rgba(16,17,20,.55); color: #eee; font: 700 17px system-ui;
  display: grid; place-items: center; cursor: pointer; z-index: 20; }
.kl-overlay { position: fixed; inset: 0; background: rgba(8,9,11,.72); display: grid; place-items: center; z-index: 50;
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.kl-menu { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 18px 20px;
  background: #17191d; border: 1px solid #2c2f36; border-radius: 12px; color: #eee; font: 14px/1.35 system-ui, sans-serif;
  touch-action: pan-y; }
.kl-menu h2 { margin: 0 0 12px; font: 700 18px system-ui; }
.kl-menu h3 { margin: 16px 0 8px; font: 600 12px system-ui; letter-spacing: .08em; text-transform: uppercase; color: #9aa0ab; }
.kl-row { display: grid; grid-template-columns: 1fr 160px 48px; align-items: center; gap: 10px; padding: 4px 0; }
.kl-row input[type=range] { width: 100%; accent-color: #d8432f; }
.kl-row output { text-align: right; color: #bbb; font-variant-numeric: tabular-nums; }
.kl-row select, .kl-menu button { font: 14px system-ui; background: #23262c; color: #eee; border: 1px solid #3a3e47; border-radius: 7px; padding: 6px 10px; }
.kl-menu button { cursor: pointer; }
.kl-menu button.primary { background: #d8432f; border-color: #d8432f; color: #fff; font-weight: 600; }
.kl-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.kl-note { color: #9aa0ab; font-size: 12px; }
.kl-toast { position: fixed; top: max(14px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); padding: 8px 14px;
  z-index: 60; pointer-events: none; transition: opacity .3s; }
`;

let injected = false;
export function injectStyles(): void {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
export function toast(msg: string, ms = 2500): void {
  injectStyles();
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'kl-panel kl-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, ms);
}
