/**
 * Closed-loop "driver" that tries to hold a circle drift at a target angle, to prove the car can
 * sustain 30–50°. Grid-searches simple driver gains and reports the best run per entry style.
 * `npx tsx scripts/bot.ts [assist] [targetDeg]`
 */
import { E30 } from '../src/data/e30';
import { Car, type CarControls } from '../src/physics/car';

const DT = 1 / 240;
const deg = 180 / Math.PI;
const assist = Number(process.argv[2] ?? 0.6);
const target = Number(process.argv[3] ?? 40);
type Entry = 'handbrake' | 'clutchkick';

interface Gains { kb: number; kd: number; thrBase: number; kt: number; st0: number }
interface Result { mean: number; sd: number; speed: number; radius: number; inBand: number; spun: boolean }

function run(entry: Entry, g: Gains, seconds = 14, trace = false): Result {
  const car = new Car(E30);
  car.setup.assist = assist;
  car.gear = 2; car.vz = 50 / 3.6;
  for (const w of car.wheels) w.omega = car.vz / w.tire.radius;
  car.engineOmega = (car.vz / car.wheels[2].tire.radius) * car.gearRatio();
  const c: CarControls = { steer: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0 };
  let t = 0, prevB = 0;
  const bs: number[] = []; let sp = 0, rad = 0, n = 0, spun = false, band = 0;
  let prevCourse = Math.atan2(car.vx, car.vz);
  while (t < seconds) {
    const b = -car.driftAngle * deg;
    const bdot = (b - prevB) / DT; prevB = b;
    if (t < 0.7) {
      c.steer = -0.8;
      if (entry === 'handbrake') { c.handbrake = t < 0.35 ? 1 : 0; c.throttle = t > 0.3 ? 1 : 0; c.clutch = 0; }
      else { c.handbrake = 0; c.throttle = 1; c.clutch = t > 0.05 && t < 0.3 ? 1 : 0; }
    } else {
      c.handbrake = 0; c.clutch = 0;
      // countersteer when over target or when the angle is growing fast; turn in otherwise
      c.steer = Math.max(-1, Math.min(1, g.st0 + g.kb * (b - target) + g.kd * bdot));
      c.throttle = Math.max(0, Math.min(1, g.thrBase + g.kt * (target - b)));
    }
    car.step(DT, c); t += DT;
    if (Math.abs(b) > 120) { spun = true; break; }
    const course = Math.atan2(car.vx, car.vz);
    let dc = course - prevCourse; prevCourse = course;
    if (dc > Math.PI) dc -= 2 * Math.PI; if (dc < -Math.PI) dc += 2 * Math.PI;
    if (t > 4) {
      bs.push(b); sp += car.speed; n++;
      rad += car.speed / Math.max(0.05, Math.abs(dc / DT));
      if (b >= 30 && b <= 50) band++;
    }
    if (trace && Math.abs((t * 2) % 1) < DT * 2) {
      console.log(`  t=${t.toFixed(1)} β=${b.toFixed(0)} v=${(car.speed * 3.6).toFixed(0)} g=${car.gear} rpm=${car.rpm.toFixed(0)} st=${c.steer.toFixed(2)} thr=${c.throttle.toFixed(2)} δ=${(car.steerAngle * deg).toFixed(0)}`);
    }
  }
  if (spun || n === 0) return { mean: 0, sd: 99, speed: 0, radius: 0, inBand: 0, spun: true };
  const mean = bs.reduce((a, x) => a + x, 0) / n;
  const sd = Math.sqrt(bs.reduce((a, x) => a + (x - mean) ** 2, 0) / n);
  return { mean, sd, speed: (sp / n) * 3.6, radius: rad / n, inBand: band / n, spun };
}

for (const entry of ['handbrake', 'clutchkick'] as Entry[]) {
  let best: { g: Gains; r: Result } | null = null;
  const score = (r: Result) => r.inBand * Math.min(1, r.speed / 28);
  for (const st0 of [-0.4, -0.2, 0, 0.15])
    for (const kb of [0.01, 0.02, 0.035, 0.05])
      for (const kd of [0, 0.004, 0.008])
        for (const thrBase of [0.6, 0.8, 1])
          for (const kt of [0, 0.02, 0.05]) {
            const g = { kb, kd, thrBase, kt, st0 };
            const r = run(entry, g);
            if (!r.spun && (!best || score(r) > score(best.r))) best = { g, r };
          }
  if (!best) { console.log(`${entry}: no gains held a drift`); continue; }
  const { g, r } = best;
  console.log(`${entry} (assist ${assist * 100}%, target ${target}°): ${(r.inBand * 100).toFixed(0)}% of time in 30–50°, β ${r.mean.toFixed(1)}±${r.sd.toFixed(1)}°, ${r.speed.toFixed(0)} km/h, radius ${r.radius.toFixed(1)} m  gains ${JSON.stringify(g)}`);
  if (process.argv.includes('-v')) run(entry, g, 14, true);
}
