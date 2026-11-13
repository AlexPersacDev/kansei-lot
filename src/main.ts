import { E30 } from './data/e30';
import { Car } from './physics/car';
import { createWorld } from './render/world';
import { BoxCarVisual } from './render/carView';
import { CameraRig } from './render/camera';
import { KeyboardDevice } from './input/keyboard';
import { emptyFrame } from './input/actions';
import { DebugHud } from './hud/debug';
import { accessGate } from './ui/gate';

await accessGate();

const PHYSICS_HZ = 240;
const DT = 1 / PHYSICS_HZ;
const MAX_FRAME = 0.1;

const app = document.getElementById('app')!;
const world = createWorld(app);
const car = new Car(E30);
car.reset(0, 0, 0);
const visual = new BoxCarVisual(car);
world.scene.add(visual.root);
const rig = new CameraRig(app.clientWidth / app.clientHeight);
rig.snap(car);
const keyboard = new KeyboardDevice();
const hud = new DebugHud(document.body);

window.addEventListener('resize', () => {
  world.resize();
  rig.camera.aspect = app.clientWidth / app.clientHeight;
  rig.camera.updateProjectionMatrix();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') { e.preventDefault(); hud.showTelemetry = !hud.showTelemetry; }
  if (e.code === 'KeyM') car.setup.autoGearbox = !car.setup.autoGearbox;
});

const frame = emptyFrame();
let last = performance.now();
let acc = 0;
let fps = 60;

world.renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  frame.pressed.clear();
  keyboard.poll(dt, frame);
  for (const b of frame.pressed) {
    switch (b) {
      case 'shiftUp': car.setup.autoGearbox = false; car.shift(1); break;
      case 'shiftDown': car.setup.autoGearbox = false; car.shift(-1); break;
      case 'camera': rig.cycle(); break;
      case 'reset': car.reset(car.x, car.z, car.yaw); rig.snap(car); break;
    }
  }

  acc += dt;
  while (acc >= DT) {
    car.step(DT, frame);
    acc -= DT;
  }

  visual.update(car, dt);
  rig.update(car, dt);
  world.follow(car.x, car.z);
  hud.update(car, dt, fps);
  world.renderer.render(world.scene, rig.camera);
});

// debugging handle
(window as unknown as { __game: unknown }).__game = { car, rig, world };
