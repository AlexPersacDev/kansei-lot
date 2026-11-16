/**
 * FR Legends-style check: a "phone player" with digital ◀ ▶ buttons (ramped like the touch
 * controls) and full throttle. Compares drift-assist levels on three player styles:
 *  - tapper: taps in/out to keep ~40° (bang-bang)
 *  - lazy: lets go of steering after the entry
 *  - greedy: keeps holding the inside button (should not spin with assist)
 * `npx tsx scripts/frbot.ts`
 */
import { E30 } from '../src/data/e30';
import { Car, type CarControls } from '../src/physics/car';
import { TOUCH_STEER } from '../src/input/touch-tuning';

const DT = 1 / 240;
const deg = 180 / Math.PI;
type Style = 'tapper' | 'lazy' | 'greedy';

function run(style: Style, assist: number, drift: number, steerAtSpeed: number) {
  const car = new Car(E30);
  car.setup.assist = assist;
  car.setup.driftAssist = drift;
  car.setup.steerAtSpeed = steerAtSpeed;
  car.gear = 2; car.vz = 50 / 3.6;
  for (const w of car.wheels) w.omega = car.vz / w.tire.radius;
  car.engineOmega = (car.vz / car.wheels[2].tire.radius) * car.gearRatio();
  const c: CarControls = { steer: 0, throttle: 1, brake: 0, clutch: 0, handbrake: 0 };
  let t = 0, steer = 0, band = 0, n = 0, sp = 0, spun = false, minB = 999, maxB = -999;
  while (t < 15) {
    const b = -car.driftAngle * deg; // + = left-hand drift
    let target: number; // -1 = left (inside), +1 = right (outward)
    if (t < 0.7) { target = -1; c.handbrake = t < 0.35 ? 1 : 0; }
    else {
      c.handbrake = 0;
      if (style === 'lazy') target = 0;
      else if (style === 'greedy') target = -1;
      else target = b > 46 ? 1 : b < 32 ? -1 : 0;
    }
    const rate = target === 0 ? TOUCH_STEER.ret : Math.sign(target) !== Math.sign(steer) && steer !== 0 ? TOUCH_STEER.flip : TOUCH_STEER.rise;
    steer = target > steer ? Math.min(target, steer + rate * DT) : Math.max(target, steer - rate * DT);
    c.steer = steer;
    car.step(DT, c); t += DT;
    if (Math.abs(b) > 110) { spun = true; break; }
    if (t > 4) { n++; sp += car.speed; if (b >= 25 && b <= 55) band++; minB = Math.min(minB, b); maxB = Math.max(maxB, b); }
  }
  return spun ? 'SPIN' : `${((band / n) * 100).toFixed(0).padStart(3)}% in 25–55° [${minB.toFixed(0)}..${maxB.toFixed(0)}] @ ${((sp / n) * 3.6).toFixed(0)} km/h`;
}

const cs = Number(process.argv[2] ?? 0.7);
for (const sas of [0.3, 0.45]) {
  for (const drift of [0, 0.6, 0.85, 1]) {
    console.log(`\ndrift assist ${drift * 100}%, countersteer ${cs * 100}%, button lock at speed ${sas * 100}%`);
    for (const s of ['tapper', 'lazy', 'greedy'] as Style[]) console.log(`  ${s.padEnd(7)} ${run(s, cs, drift, sas)}`);
  }
}
