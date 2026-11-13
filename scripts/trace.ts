/** Detailed trace of one open-loop drift: `npx tsx scripts/trace.ts <steer> <throttle> [assist]` */
import { E30 } from '../src/data/e30';
import { Car } from '../src/physics/car';

const DT = 1 / 240;
const deg = 180 / Math.PI;
const steer = Number(process.argv[2] ?? -0.5);
const thr = Number(process.argv[3] ?? 1);
const car = new Car(E30);
car.setup.assist = Number(process.argv[4] ?? 0.6);
car.gear = 2; car.vz = 50 / 3.6;
for (const w of car.wheels) w.omega = car.vz / w.tire.radius;
car.engineOmega = (car.vz / car.wheels[2].tire.radius) * car.gearRatio();
const c = { steer: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0 };
let t = 0, next = 0;
while (t < 6) {
  if (t < 0.6) { c.steer = -0.7; c.handbrake = t < 0.4 ? 1 : 0; c.throttle = t > 0.3 ? thr : 0; }
  else { c.steer = steer; c.throttle = thr; c.handbrake = 0; }
  car.step(DT, c); t += DT;
  if (t >= next) {
    next += 0.2;
    const [fl, fr, rl, rr] = car.wheels;
    const rearV = ((rl.omega + rr.omega) / 2) * rl.tire.radius;
    console.log(
      `t=${t.toFixed(1)} β=${(-car.driftAngle * deg).toFixed(0).padStart(4)} v=${(car.speed * 3.6).toFixed(0).padStart(3)} ` +
      `r=${car.yawRate.toFixed(2).padStart(5)} δ=${(car.steerAngle * deg).toFixed(0).padStart(4)} rpm=${car.rpm.toFixed(0).padStart(4)} g=${car.gear} ` +
      `cl=${car.clutchEngagement.toFixed(2)} rearV=${(rearV * 3.6).toFixed(0).padStart(3)} ` +
      `F fx/fy: FL ${fl.fx.toFixed(0)}/${fl.fy.toFixed(0)} FR ${fr.fx.toFixed(0)}/${fr.fy.toFixed(0)} RL ${rl.fx.toFixed(0)}/${rl.fy.toFixed(0)} RR ${rr.fx.toFixed(0)}/${rr.fy.toFixed(0)} ` +
      `fz ${car.wheels.map((w) => w.fz.toFixed(0)).join(',')}`,
    );
  }
}
