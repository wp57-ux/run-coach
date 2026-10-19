// The bike plan: 12 stages you unlock with green rides, and targets that
// grow with you, in watts or in resistance levels. Same traffic lights as the
// runs (plan.js).
import { DAY, finalColor, dayStart, daysBetween } from './plan.js';
import { kgOf } from './calories.js';

export const BIKE_MAX = 12;
export const WARM_MIN = 5;
export const COOL_MIN = 3;
const LAYOFF_DAYS = 10;

// What your targets are in. "power" below means your steady value in that
// unit: watts, or a level ridden at a steady 80–90 rpm. Bikes without either
// are ridden by feel (no steady value).
export const UNITS = {
  watts: { step: 5, min: 30, max: 400, short: 'W' },
  level: { step: 1, min: 1, max: 30, short: 'level' },
};
export const sessionUnit = s => s.unit || (s.watts ? 'watts' : 'feel');

// Targets are a share of your steady power. met = fallback calorie rate for
// bikes that don't show watts (Compendium of Physical Activities).
export const ZONES = {
  easy: { label: 'Easy', pct: 0.6, met: 4.8, talk: 'Easy spin. You could chat all day.' },
  steady: { label: 'Steady', pct: 1, met: 6.8, talk: 'Breathing harder, still talking in short sentences.' },
  strong: { label: 'Strong', pct: 1.15, met: 8.8, talk: 'A few words at a time.' },
  hard: { label: 'Hard', pct: 1.35, met: 11, talk: 'Big effort, only for a minute. Spin faster rather than grinding.' },
};

const E = 'easy', S = 'steady', ST = 'strong', H = 'hard';
const rep = (n, ...pairs) => Array.from({ length: n }, () => pairs).flat();

// Minutes per block. Every ride adds a 5-min easy warm-up and a 3-min cool-down.
export const BIKE_STAGES = [
  { n: 1, name: '15 min steady', main: [[S, 15]] },
  { n: 2, name: '18 min steady', main: [[S, 18]] },
  { n: 3, name: '21 min steady', main: [[S, 21]] },
  { n: 4, name: '25 min steady', main: [[S, 25]] },
  { n: 5, name: '5 × (3 strong / 2 easy)', main: rep(5, [ST, 3], [E, 2]), milestone: 'Intervals start' },
  { n: 6, name: '4 × (5 strong / 2 easy)', main: rep(4, [ST, 5], [E, 2]) },
  { n: 7, name: '3 × (8 strong / 2 easy)', main: rep(3, [ST, 8], [E, 2]) },
  { n: 8, name: '2 × (12 strong / 3 easy)', main: rep(2, [ST, 12], [E, 3]) },
  { n: 9, name: '6 × (1 hard / 2 easy) + 12 steady', main: [...rep(6, [H, 1], [E, 2]), [S, 12]], milestone: 'Hard minutes' },
  { n: 10, name: '8 × (1 hard / 2 easy) + 12 steady', main: [...rep(8, [H, 1], [E, 2]), [S, 12]] },
  { n: 11, name: '30 min strong, non-stop', main: [[ST, 30]] },
  { n: 12, name: '35 min strong, non-stop', main: [[ST, 35]], milestone: 'The goal' },
];

export const bikeStage = n => BIKE_STAGES[Math.min(BIKE_MAX, Math.max(1, n)) - 1];

export function bikeSegments(n) {
  const segs = [{ type: 'warmup', zone: E, clip: 'bikewarm', sec: WARM_MIN * 60 }];
  for (const [zone, min] of bikeStage(n).main) segs.push({ type: zone, zone, clip: zone, sec: min * 60 });
  segs.push({ type: 'cooldown', zone: E, clip: 'bikecool', sec: COOL_MIN * 60 });
  return segs;
}

export const zoneOf = type => (type === 'warmup' || type === 'cooldown' ? E : type);

export const zoneWatts = (zone, power) => (power ? Math.max(20, Math.round(power * ZONES[zone].pct / 5) * 5) : null);

// On levels: at a steady cadence a level is roughly 15 W, so these steps
// match the watts zones (easy 60%, strong 115%, hard 135% of steady).
const LEVEL_STEP = { easy: -4, steady: 0, strong: 2, hard: 4 };
export function zoneTarget(zone, power, unit = 'watts') {
  if (!power) return null;
  return unit === 'level' ? Math.max(1, power + LEVEL_STEP[zone]) : zoneWatts(zone, power);
}

export const isWork = type => type === S || type === ST || type === H;

export function bikeTotals(segs) {
  let workSec = 0, totalSec = 0;
  for (const s of segs) {
    totalSec += s.sec;
    if (isWork(s.type)) workSec += s.sec;
  }
  return { workSec, totalSec };
}

// Calories. With watts: the ACSM leg-cycling equation,
// VO2 (ml/kg/min) = 1.8 × work rate (kg·m/min) / body mass + 7.
// Without watts: a typical calorie rate for each effort zone.
export function bikeKcal(secByType, power, weight, units) {
  const kg = kgOf(Number(weight) || 0, units);
  let kcal = 0;
  for (const [type, sec] of Object.entries(secByType)) {
    const zone = zoneOf(type);
    if (!ZONES[zone] || !sec) continue;
    const w = zoneWatts(zone, power);
    const perMin = w ? (1.8 * w * 6.12 + 7 * kg) * 5 / 1000 : ZONES[zone].met * kg * 3.5 * 5 / 1000;
    kcal += perMin * sec / 60;
  }
  return Math.round(kcal);
}

export const planSecByType = segs => segs.reduce((a, s) => ({ ...a, [s.type]: (a[s.type] || 0) + s.sec }), {});

// Replays every ride (and any change you made by hand) in order, so deleting
// a ride always leaves the stage and power consistent.
export function bikeProgression(state, now = Date.now()) {
  const b = state.bike;
  const unit = b.unit || 'level';
  const u = UNITS[unit];
  const events = [
    ...(b.overrides || []).map(o => ({ t: Date.parse(o.at), o })),
    ...state.sessions.filter(s => s.mode === 'bike').map(s => ({ t: Date.parse(s.at), s })),
  ].sort((x, y) => x.t - y.t);

  let stage = b.startStage || 1;
  let power = null;
  let streak = 0, reds = 0, goal = false;
  let lastT = null, lastRedT = null;
  const powers = [];

  for (const e of events) {
    if (e.o) {
      if (e.o.stage) { stage = e.o.stage; streak = 0; }
      if ('power' in e.o && (e.o.unit || 'watts') === unit) power = e.o.power;
      continue;
    }
    const s = e.s;
    if (lastT !== null && e.t - lastT > LAYOFF_DAYS * DAY) { stage = Math.max(1, stage - 1); streak = 0; }
    lastT = e.t;
    // Rides logged in another unit still count for stages, not for the steady value.
    const same = !!u && sessionUnit(s) === unit;
    if (same && s.setPower) power = s.setPower;
    const c = finalColor(s);
    if (c === 'green') {
      reds = 0;
      streak++;
      if (same && s.effort === 'easy' && power && !s.setPower) power = Math.min(u.max, power + u.step);
      if (streak >= 2) {
        if (stage < BIKE_MAX) { stage++; streak = 0; } else goal = true;
      }
    } else if (c === 'amber') {
      reds = 0;
      streak = 0;
      if (same && s.effort === 'hard' && power && !s.setPower) power = Math.max(u.min, power - u.step);
    } else if (c === 'red') {
      reds++;
      lastRedT = e.t;
      streak = 0;
      stage = Math.max(1, stage - 1);
    }
    if (power) powers.push({ t: e.t, power });
  }

  let layoff = false;
  if (lastT !== null && now - lastT > LAYOFF_DAYS * DAY) {
    stage = Math.max(1, stage - 1);
    streak = 0;
    layoff = true;
  }
  return { stage, streak, reds, goal, layoff, lastT, lastRedT, power: u ? power : null, powers: u ? powers : [], unit };
}

// The bike is easy on tendons, so riding on back-to-back days is fine.
// After a red ride: 2 days off the bike.
export function bikeRest(prog, now) {
  if (prog.lastRedT === null || prog.lastRedT !== prog.lastT || daysBetween(prog.lastT, now) >= 2) return null;
  const until = new Date(dayStart(prog.lastT));
  until.setDate(until.getDate() + 2);
  return { kind: 'red', until: until.getTime() };
}
