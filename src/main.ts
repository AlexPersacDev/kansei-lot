import { E30 } from './data/e30';
import { Car } from './physics/car';
import { createWorld } from './render/world';
import { E30Visual } from './render/e30Model';
import { CameraRig } from './render/camera';
import { InputManager } from './input/manager';
import { PadDevice } from './input/gamepad';
import { DebugHud } from './hud/debug';
import { accessGate } from './ui/gate';
import { HelpPanel } from './ui/help';
import { PauseMenu } from './ui/pause';
import { openRemap } from './ui/remap';
import { injectStyles, toast } from './ui/styles';
import { FAMILY_TITLE } from './ui/glyphs';
import { loadSettings, saveSettings, type Tuning } from './settings';
import { DriftScoring } from './game/scoring';
import { Hud } from './hud/hud';
import { TireSmoke } from './render/smoke';
import { SkidMarks } from './render/skids';
import { CarAudio } from './audio/audio';
import { buildLayout, HALF, ZONES, zoneAt } from './world/layout';
import { Track, type Impact } from './world/track';
import { Minimap } from './hud/minimap';
import { FfbDriver } from './input/ffb';
import { openCalibration } from './ui/calibrate';
import { GyroSteer } from './input/gyro';
import { TouchDevice } from './input/touch';
import { enterFullscreenLandscape, isTouchDevice, keepAwake, lockViewport, RotateOverlay, startScreen } from './ui/mobile';
import { QualityManager } from './render/quality';

// offline cache / installable app (production builds only; dev uses Vite's HMR)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
}

const touchMode = isTouchDevice();
if (touchMode) document.body.classList.add('kl-touch');
lockViewport();
await accessGate();
injectStyles();

const PHYSICS_HZ = 240;
const DT = 1 / PHYSICS_HZ;
const MAX_FRAME = 0.1;
const DEG = Math.PI / 180;

const settings = loadSettings();
const app = document.getElementById('app')!;
const world = createWorld(app);
const car = new Car(E30);
const layout = buildLayout();
const track = new Track(layout);
world.scene.add(track.group);
const startZone = ZONES[0];
car.reset(startZone.spawn.x, startZone.spawn.z, startZone.spawn.yaw);
track.initPhysics(car).catch((e) => console.error('Rapier failed to load', e));
const visual = new E30Visual(car, world.envMap);
world.scene.add(visual.root);
const rig = new CameraRig(app.clientWidth / app.clientHeight);
rig.snap(car);
const input = new InputManager(world.renderer.domElement, settings);
const hud = new DebugHud(document.body);
const help = new HelpPanel(document.body);
const scoring = new DriftScoring();
const gameHud = new Hud(document.body, car, scoring);
const smoke = new TireSmoke();
const skids = new SkidMarks();
world.scene.add(smoke.mesh, skids.mesh);
const audio = new CarAudio();
const minimap = new Minimap(document.body, layout);
const ffb = new FfbDriver(); // no-op device in the browser; a desktop build plugs a real one in
const quality = new QualityManager(world, smoke, touchMode);
let appliedQuality = '';
quality.onChange = (l) => { if (quality.auto) toast(`Calidad automática: ${({ low: 'baja', medium: 'media', high: 'alta' })[l]}`, 1500); };
const gyro = new GyroSteer();
const touchDev = touchMode ? new TouchDevice(settings, gyro) : null;
if (touchDev) input.touch = touchDev;
scoring.setClipPoints(layout.clips);
scoring.setZone(startZone.name);

function spawnAt(zoneId: string): void {
  const z = ZONES.find((zn) => zn.id === zoneId) ?? ZONES[0];
  scoring.breakCombo('Recolocado');
  car.reset(z.spawn.x, z.spawn.z, z.spawn.yaw);
  track.teleportCar(car);
  rig.snap(car);
  scoring.setZone(z.name);
}

scoring.onEvent = (e) => {
  gameHud.event(e);
  const a = input.active;
  if (e.kind === 'lost' && a instanceof PadDevice && settings.vibration) a.rumble(0.8, 0.4, 260);
};

const defaultTuning = (): Tuning => ({
  powerScale: E30.engine.powerScale,
  diffType: E30.diff.type,
  lsdLockRatio: E30.diff.lsdLockRatio,
  maxSteerDeg: Math.round(E30.steering.maxAngle / DEG),
  gripFront: 1,
  gripRear: 1,
  brakeBias: E30.brakes.frontBias,
});

let paused = false;
const pause = new PauseMenu(settings, {
  activeKind: () => input.active.kind,
  pads: () => [...input.pads.values()],
  defaultTuning,
  apply: () => applySettings(),
  remap: (p) => startRemap(p),
  calibrate: (p) => {
    paused = true;
    openCalibration(p, settings, () => { paused = false; refreshHelp(); });
  },
  zones: () => ZONES.map((z) => ({ id: z.id, name: z.name })),
  goZone: (id) => spawnAt(id),
  touch: touchMode,
  calibrateGyro: () => gyro.calibrate(),
  requestGyro: () => {
    if (gyro.live) return;
    void gyro.request().then((ok) => {
      applySettings();
      toast(ok ? 'Giroscopio activado' : 'El giroscopio no está disponible: sigue con botones ◀ ▶', 2500);
    });
  },
  qualityLabel: () => ({ low: 'baja', medium: 'media', high: 'alta' })[quality.level],
  onClose: () => { paused = false; },
});

function applySettings(): void {
  const t = settings.tuning ?? defaultTuning();
  const su = car.setup;
  su.powerScale = t.powerScale;
  su.diffType = t.diffType;
  su.lsdLockRatio = t.lsdLockRatio;
  su.maxSteerAngle = t.maxSteerDeg * DEG;
  su.gripFront = t.gripFront;
  su.gripRear = t.gripRear;
  su.brakeBias = t.brakeBias;
  su.assist = settings.assist[input.active.kind];
  su.autoGearbox = settings.gearbox === 'auto';
  input.keyboard.mouseSteer = settings.mouseSteer;
  help.visible = settings.showHelp;
  hud.showTelemetry = settings.showTelemetry;
  audio.setVolume(settings.volume);
  if (settings.quality !== appliedQuality) { appliedQuality = settings.quality; quality.setMode(settings.quality, touchMode); }
  if (touchDev) {
    touchDev.layout();
    // dim (not hide) the touch controls while a pad drives, so a tap can switch back
    touchDev.root.style.opacity = input.active === touchDev ? '1' : '0.3';
  }
  refreshHelp();
}

function refreshHelp(): void {
  const a = input.active;
  help.show(a.family, a instanceof PadDevice ? a.bindings : undefined, settings.gearbox === 'manual',
    settings.touchSteer === 'buttons' || !gyro.live, settings.touchShiftButtons);
}

function startRemap(p: PadDevice): void {
  paused = true;
  input.keyboard.enabled = false;
  openRemap(p, settings, [...input.pads.values()], () => {
    input.keyboard.enabled = true;
    paused = false;
    input.setActive(p);
    applySettings();
    toast('Controles guardados');
  });
}

input.onActiveChange = (d) => {
  applySettings();
  toast(`${FAMILY_TITLE[d.family]} · autocontravolante ${Math.round(settings.assist[d.kind] * 100)} %`, 1800);
};
input.onNeedsMapping = (p) => {
  toast(p.kind === 'wheel' ? 'Volante detectado: asigna los controles' : 'Mando sin mapeo estándar: asigna los controles');
  startRemap(p);
};
input.onPadsChanged = () => refreshHelp();

// on-screen buttons (top-right): help + pause
function cornerButton(label: string, right: number, title: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'kl-btn';
  b.textContent = label;
  b.title = title;
  b.style.right = `calc(max(12px, env(safe-area-inset-right)) + ${right}px)`;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); b.blur(); });
  document.body.appendChild(b);
  return b;
}
cornerButton('❚❚', 0, 'Pausa', () => togglePause());
cornerButton('?', 46, 'Ayuda de controles', () => toggleHelp());
if (touchMode) {
  cornerButton('📷', 92, 'Cámara', () => rig.cycle());
  cornerButton('↺', 138, 'Recolocar', () => { scoring.breakCombo('Recolocado'); car.reset(car.x, car.z, car.yaw); track.teleportCar(car); rig.snap(car); });
  cornerButton('◎', 184, 'Calibrar centro del giroscopio', () => { gyro.calibrate(); toast('Centro del giroscopio calibrado', 1200); });
}

function togglePause(): void {
  if (pause.open) pause.close();
  else { paused = true; pause.show(); }
}
function toggleHelp(): void {
  settings.showHelp = !settings.showHelp;
  saveSettings(settings);
  help.visible = settings.showHelp;
}

// Phones report the new size late after a rotation (the 'resize' event often still carries the old
// one), which left the camera with the old aspect ratio and a squashed image. So the size is
// checked every frame and everything is re-fitted as soon as it really changes.
let viewW = 0, viewH = 0;
function fitViewport(): void {
  const w = app.clientWidth, h = app.clientHeight;
  if (w === viewW && h === viewH || w === 0 || h === 0) return;
  viewW = w; viewH = h;
  world.resize();
  rig.camera.aspect = w / h;
  rig.camera.updateProjectionMatrix();
  touchDev?.layout();
}
for (const ev of ['resize', 'orientationchange']) window.addEventListener(ev, fitViewport);
window.visualViewport?.addEventListener('resize', fitViewport);
window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    e.preventDefault();
    settings.showTelemetry = !settings.showTelemetry;
    saveSettings(settings);
    hud.showTelemetry = settings.showTelemetry;
  }
});

if (touchDev) input.setActive(touchDev);
applySettings();

// ---- tap to start (unlocks audio; on phones asks for motion permission, fullscreen, wake lock)
const rotate = new RotateOverlay(touchMode);
let started = false;
void startScreen(touchMode, () => {
  // iOS: the permission prompt must be the first thing inside the gesture
  const gyroAsk = touchMode && settings.touchSteer === 'gyro' ? gyro.request() : null;
  audio.unlock();
  if (touchMode) { enterFullscreenLandscape(); keepAwake(); }
  gyroAsk?.then((ok) => {
    if (ok) { applySettings(); return; }
    settings.touchSteer = 'buttons';
    saveSettings(settings);
    applySettings();
    toast(gyro.permission === 'denied'
      ? 'Permiso de movimiento denegado: dirección con botones ◀ ▶ (cámbialo en Pausa)'
      : 'Sin giroscopio en este dispositivo: dirección con botones ◀ ▶', 4000);
  });
}).then(() => { started = true; });

let last = performance.now();
let acc = 0;
let fps = 60;
let appliedHGear: number | null = null;
let grindWarned: number | null = null;
let rumbleT = 0;

world.renderer.setAnimationLoop((now: number) => {
  fitViewport();
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  const frame = input.poll(dt);
  const halted = paused || !started || rotate.blocking;
  for (const b of frame.pressed) {
    if (b === 'pause') { if (started) togglePause(); continue; }
    if (halted) continue;
    switch (b) {
      case 'toggleHelp': toggleHelp(); break;
      case 'camera': rig.cycle(); break;
      case 'reset': scoring.breakCombo('Recolocado'); car.reset(car.x, car.z, car.yaw); track.teleportCar(car); rig.snap(car); break;
      case 'shiftUp':
      case 'shiftDown':
        if (settings.gearbox === 'auto') {
          settings.gearbox = 'manual';
          saveSettings(settings);
          applySettings();
          toast('Caja manual');
        }
        car.shift(b === 'shiftUp' ? 1 : -1);
        break;
    }
  }

  // H-shifter: act on position changes; optionally demand the clutch
  if (frame.hGear !== null && frame.hGear !== appliedHGear && !halted) {
    const g = frame.hGear;
    if (g !== 0 && settings.hRequiresClutch && frame.hasClutchPedal && frame.clutch < 0.6) {
      // not engaged yet; retried every frame until the clutch is pressed
      if (grindWarned !== g) {
        grindWarned = g;
        toast('¡Embrague! La marcha no entra sin pisarlo', 1500);
        audio.grind();
      }
    } else if (car.selectGear(g) || car.gear === g) {
      appliedHGear = g;
      grindWarned = null;
      if (settings.gearbox === 'auto') { settings.gearbox = 'manual'; saveSettings(settings); applySettings(); }
    }
  }
  car.setup.autoClutch = !frame.hasClutchPedal;

  if (!halted) {
    acc += dt;
    let impact: Impact | null = null;
    while (acc >= DT) {
      car.step(DT, frame);
      const hit = track.collideCar(car);
      if (hit && (!impact || hit.speed > impact.speed)) impact = hit;
      track.stepProps(car);
      acc -= DT;
    }
    if (impact && impact.speed > 1.2) {
      if (impact.breaksCombo) scoring.breakCombo('¡Golpe!');
      const a = input.active;
      if (a instanceof PadDevice && settings.vibration) a.rumble(Math.min(1, impact.speed / 8), 0.3, 200);
    }
    // zone + out-of-bounds
    if (Math.abs(car.x) > HALF - 1 || Math.abs(car.z) > HALF - 1) {
      spawnAt(zoneAt(Math.max(-HALF + 2, Math.min(HALF - 2, car.x)), Math.max(-HALF + 2, Math.min(HALF - 2, car.z))).id);
      toast('Fuera de límites: recolocado');
    }
    const zone = zoneAt(car.x, car.z);
    if (zone.name !== scoring.zone && !scoring.active) scoring.setZone(zone.name);
    scoring.update(dt, car);
    skids.update(car);
    track.syncProps(dt, car);
  } else {
    acc = 0;
  }
  smoke.update(halted ? 0 : dt, car);
  audio.update(dt, car, halted);
  ffb.update(car, halted);
  quality.update(dt, !halted);

  // rumble from rear tyre sliding
  rumbleT -= dt;
  const act = input.active;
  if (rumbleT <= 0 && act instanceof PadDevice && settings.vibration && !halted) {
    rumbleT = 0.1;
    const slide = Math.max(car.wheels[2].slideSpeed, car.wheels[3].slideSpeed);
    const weak = Math.min(1, slide / 14) * 0.6;
    const strong = car.limiterCut ? 0.25 : 0;
    if (weak > 0.05 || strong > 0) act.rumble(strong, weak, 140);
  }

  visual.update(car, dt);
  rig.update(car, dt);
  world.follow(car.x, car.z);
  hud.update(car, dt, fps);
  gameHud.update(dt);
  minimap.update(dt, car);
  world.renderer.render(world.scene, rig.camera);
});

// debugging handle
(window as unknown as { __game: unknown }).__game = { car, rig, world, input, settings, scoring, audio, smoke, skids, track, spawnAt, ffb, quality, gyro, touchDev };
