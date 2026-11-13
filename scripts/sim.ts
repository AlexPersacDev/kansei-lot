/**
 * Headless physics checks: `npm run sim` (add `--sweep` for the open-loop drift table).
 * Drift-holding with a closed-loop driver lives in scripts/bot.ts.
 */
import { E30 } from '../src/data/e30';
import { Car, type CarControls } from '../src/physics/car';

const DT = 1 / 240;
const deg = 180 / Math.PI;
const kmh = (ms: number) => ms * 3.6;
const ctl = (): CarControls => ({ steer: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0 });

function finite(car: Car): void {
  for (const v of [car.x, car.z, car.vx, car.vz, car.yaw, car.yawRate, car.engineOmega]) {
    if (!Number.isFinite(v)) throw new Error('NaN in car state');
  }
}

function settleAt(car: Car, speedKmh: number, gear: number): void {
  car.gear = gear;
  car.vz = speedKmh / 3.6;
  for (const w of car.wheels) w.omega = car.vz / w.tire.radius;
  car.engineOmega = (car.vz / car.wheels[2].tire.radius) * car.gearRatio();
}

function idle(): void {
  const car = new Car(E30);
  const c = ctl(); c.handbrake = 1;
  let t = 0;
  while (t < 5) { car.step(DT, c); t += DT; finite(car); }
  console.log(`idle 5 s on handbrake: rpm ${car.rpm.toFixed(0)}, creep ${(car.speed * 100).toFixed(1)} cm/s, gear ${car.gear}`);
}

function launch(): void {
  const car = new Car(E30);
  const c = ctl(); c.throttle = 1;
  let t = 0, t100 = NaN, t60 = NaN;
  while (t < 60) {
    car.step(DT, c); t += DT; finite(car);
    if (isNaN(t60) && kmh(car.speed) >= 60) t60 = t;
    if (isNaN(t100) && kmh(car.speed) >= 100) t100 = t;
  }
  console.log(`launch: 0-60 ${t60.toFixed(1)} s, 0-100 ${t100.toFixed(1)} s, after 60 s ${kmh(car.speed).toFixed(0)} km/h in gear ${car.gear}`);
}

function braking(): void {
  const car = new Car(E30);
  settleAt(car, 100, 4);
  const c = ctl(); c.brake = 0.75;
  const z0 = car.z; let t = 0;
  car.step(DT, c);
  while (car.speed > 0.3 && t < 20) { car.step(DT, c); t += DT; finite(car); }
  console.log(`braking 100-0 at 75 % pedal: ${(car.z - z0).toFixed(1)} m in ${t.toFixed(1)} s`);
}

function gripCircle(): void {
  const car = new Car(E30);
  car.setup.assist = 0;
  settleAt(car, 40, 2);
  const c = ctl(); c.steer = -0.25; c.throttle = 0.25;
  let t = 0;
  while (t < 8) { car.step(DT, c); t += DT; finite(car); }
  console.log(`grip circle (steer 25 %, 25 % throttle): v ${kmh(car.speed).toFixed(0)} km/h, β ${(-car.driftAngle * deg).toFixed(1)}°, lat ${(car.accLeft / 9.81).toFixed(2)} g`);
}

/** Open-loop sweep after a handbrake entry: which fixed (steer, throttle) pairs settle into a drift? */
function sweep(assist: number, entrySpeed: number, gear: number): void {
  console.log(`\nsweep assist ${assist * 100}%, entry ${entrySpeed} km/h in ${gear}: cells = β° @ km/h (σβ) after 8 s`);
  const throttles = [0.4, 0.6, 0.8, 1];
  console.log('steer  | ' + throttles.map((t) => `thr ${t.toFixed(1)}`.padEnd(18)).join(''));
  for (const steer of [-0.5, -0.25, 0, 0.15, 0.3]) {
    let row = `${steer.toFixed(2).padStart(6)} | `;
    for (const thr of throttles) {
      const car = new Car(E30);
      car.setup.assist = assist;
      settleAt(car, entrySpeed, gear);
      const c = ctl();
      let t = 0;
      const betas: number[] = [];
      let spun = false;
      while (t < 8.6) {
        if (t < 0.6) { c.steer = -0.7; c.handbrake = t < 0.4 ? 1 : 0; c.throttle = t > 0.3 ? thr : 0; }
        else { c.steer = steer; c.throttle = thr; c.handbrake = 0; }
        car.step(DT, c); t += DT; finite(car);
        const b = -car.driftAngle * deg;
        if (Math.abs(b) > 110) spun = true;
        if (t > 5.6) betas.push(b);
      }
      const mean = betas.reduce((a, b) => a + b, 0) / betas.length;
      const sd = Math.sqrt(betas.reduce((a, b) => a + (b - mean) ** 2, 0) / betas.length);
      row += (spun ? 'spin' : `${mean.toFixed(0)}° @${kmh(car.speed).toFixed(0)} (${sd.toFixed(0)})`).padEnd(18);
    }
    console.log(row);
  }
}

idle();
launch();
braking();
gripCircle();
if (process.argv.includes('--sweep')) for (const a of [0, 0.6]) sweep(a, 50, 2);
