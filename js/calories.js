// Calorie and distance estimates from treadmill speed and incline,
// using the ACSM metabolic equations for walking and running.
import { speedToMps } from './plan.js';

const M_PER_MIN = { imperial: 26.8224, metric: 1000 / 60 };

export const kgOf = (weight, units) => (units === 'imperial' ? weight * 0.45359237 : weight);

export function kcalPerMin(kind, speed, inclinePct, weight, units) {
  const s = speed * M_PER_MIN[units];
  const g = (inclinePct || 0) / 100;
  const vo2 = kind === 'run'
    ? 0.2 * s + 0.9 * s * g + 3.5
    : 0.1 * s + 1.8 * s * g + 3.5;
  return (vo2 * kgOf(weight, units) / 1000) * 5;
}

export function planTotals(segs) {
  let runSec = 0, walkSec = 0;
  for (const s of segs) {
    if (s.type === 'run') runSec += s.sec;
    else walkSec += s.sec;
  }
  return { runSec, walkSec, totalSec: runSec + walkSec };
}

export function sessionTotals({ runSec, walkSec }, tm, weight, units) {
  const w = Number(weight) || 0;
  const kcal =
    (runSec / 60) * kcalPerMin('run', tm.runSpeed, tm.incline, w, units) +
    (walkSec / 60) * kcalPerMin('walk', tm.walkSpeed, tm.incline, w, units);
  const distKm = (runSec * speedToMps(tm.runSpeed, units) + walkSec * speedToMps(tm.walkSpeed, units)) / 1000;
  return { kcal: Math.round(kcal), distKm };
}
