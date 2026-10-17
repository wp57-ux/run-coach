// Rules for the strength side: which day is next, what weight to use,
// back and shoulder traffic lights, and the primer and stretch routines.
import { EX, DAYS, PHASE2, PRIMER, STRETCH } from './lift-data.js';
import { DAY, daysBetween } from './plan.js';
import { kgOf } from './calories.js';

export const ORDER = ['A', 'B', 'C'];
export const nextDay = d => ORDER[(ORDER.indexOf(d) + 1) % ORDER.length];
const PLANK_EVERY_DAYS = 28;
const PHASE2_DAYS = 42;
const LIFT_MET = 3.5;

const byTime = (a, b) => Date.parse(a.at) - Date.parse(b.at);

// ---- traffic lights ---------------------------------------------------------

export function liftPrelim(s) {
  if (s.back >= 5 || s.catch || s.radiating || (s.tweak?.area === 'back' && s.tweak.pain >= 5)) return 'red';
  if (s.back >= 3 || (s.tweak?.area === 'back')) return 'amber';
  return 'green';
}

export function liftFinal(s) {
  if (s.prelim === 'red') return 'red';
  if (!s.morning) return 'pending';
  if (s.morning === 'clearly') return 'red';
  if (s.morning === 'slightly') return 'amber';
  return s.prelim;
}

export const liftNeedsMorning = s => s.prelim !== 'red' && !s.morning;

// ---- where you are ----------------------------------------------------------

export function weakSide(state) {
  const t = state.planks.at(-1);
  if (!t) return 'left';                       // from your description, until the first test
  const gap = Math.abs(t.left - t.right) / Math.max(t.left, t.right, 1);
  if (gap <= 0.05) return null;
  return t.left < t.right ? 'left' : 'right';
}

export function plankGap(t) {
  if (!t) return null;
  return Math.round(Math.abs(t.left - t.right) / Math.max(t.left, t.right, 1) * 100);
}

export function liftStatus(state, now = Date.now()) {
  const lifts = [...state.lifts].sort(byTime);
  const last = lifts.at(-1) || null;
  const colors = lifts.map(liftFinal);
  const backColor = last ? colors.at(-1) : null;

  let reds = 0;
  for (let i = colors.length - 1; i >= 0 && colors[i] === 'red'; i--) reds++;
  let painful = 0;
  for (let i = lifts.length - 1; i >= 0 && lifts[i].shoulders === 'painful'; i--) painful++;

  const day = state.lift.next && ORDER.includes(state.lift.next) ? state.lift.next : last ? nextDay(last.day) : 'A';
  const lastPlank = state.planks.at(-1);
  const plankDue = !!state.lift.plankDue || !lastPlank || now - Date.parse(lastPlank.at) >= PLANK_EVERY_DAYS * DAY;
  const firstT = lifts.length ? Date.parse(lifts[0].at) : null;
  const early = firstT === null || now - firstT < 14 * DAY;

  const since = now - PHASE2_DAYS * DAY;
  const phase2Ready = state.lift.phase2 === null && firstT !== null && now - firstT >= PHASE2_DAYS * DAY
    && !lifts.some((s, i) => Date.parse(s.at) >= since && colors[i] === 'red');

  return {
    day,
    last,
    lastT: last ? Date.parse(last.at) : null,
    backColor,
    reset: backColor === 'red',
    amber: backColor === 'amber',
    shoulders: last?.shoulders || 'fine',
    reds,
    painful,
    plankDue,
    weak: weakSide(state),
    early,
    phase2: state.lift.phase2 === true,
    phase2Ready,
    liftedToday: !!last && daysBetween(Date.parse(last.at), now) === 0,
    count: lifts.length,
  };
}

// ---- building a session -----------------------------------------------------

// Template id → what you'll actually do today, after phase 2, your swaps and
// any back or shoulder rules.
export function resolveItem(state, orig, st) {
  let id = orig;
  const sw = state.lift.swaps[id];
  if (sw && EX[sw]) id = sw;
  if (st.reset && EX[id].back === 'load') id = EX[id].safe ?? null;
  if (id && st.shoulders === 'painful' && EX[id].press && EX[id].shSafe !== id) id = EX[id].shSafe ?? null;
  return id;
}

// Leg work, left out for a while after a red run with leg pain.
export const LEG = new Set(['legpress', 'calfpress', 'hipthrust', 'legcurl', 'splitsquat', 'hipabd', 'seatedcalf', 'legext',
  'slcalf', 'slcalfbent', 'glutebridge', 'lyingcurl', 'sidelyingraise', 'rdl', 'bss']);

export function buildLift(state, st, { day = st.day, trim = false, noLegs = false } = {}) {
  const p2 = st.phase2 ? PHASE2[day] || {} : {};
  const blocks = [];
  for (const b of DAYS[day].blocks) {
    if (trim && (b.finisher || b.optional)) continue;
    const items = [];
    for (const t of b.items) {
      const orig = p2[t] || t;
      const ex = resolveItem(state, orig, st);
      if (ex && noLegs && LEG.has(ex)) continue;
      if (ex && !items.some(i => i.ex === ex)) items.push({ orig, ex });
    }
    if (!items.length) continue;
    let sets = trim ? b.sets - 1 : b.sets;
    blocks.push({ key: b.key, items, sets, rest: b.rest, finisher: !!b.finisher, optional: !!b.optional });
  }
  return { day, blocks };
}

// Total working sets, for a quick "≈ min" estimate.
export function liftMinutes(plan) {
  let sets = 0;
  for (const b of plan.blocks) if (!b.optional) sets += b.sets * b.items.length;
  return Math.round(sets * 1.55 + 3);
}

// ---- weights ----------------------------------------------------------------

export const incOf = (ex, units) => (EX[ex].kind === 'level' ? 1 : units === 'imperial' ? 5 : 2.5);
const roundTo = (v, inc) => Math.max(0, Math.round(v / inc) * inc);

export function history(state, ex) {
  return [...state.lifts].sort(byTime)
    .map(s => ({ at: s.at, color: liftFinal(s), sets: (s.sets || []).filter(x => x.ex === ex) }))
    .filter(h => h.sets.length);
}

export function target(state, ex, st) {
  const e = EX[ex];
  const [lo, hi] = e.reps;
  const h = history(state, ex);
  if (!h.length) return { setup: e.kind !== 'reps', w: null, reps: hi, last: null, change: 'new' };
  const last = h.at(-1).sets;
  const w = last.at(-1).w;
  const base = { setup: false, last, reps: hi, w, change: 'same' };
  if (e.kind === 'reps') return base;
  if (e.kind === 'carry') return base;
  const inc = incOf(ex, state.profile.units);
  const dir = e.dir || 1;
  const allTop = last.every(s => s.reps >= hi);
  const anyLow = last.some(s => s.reps < lo);
  // Green: anything can go up. Amber: everything except lifts that load your back.
  const backOk = st.backColor === 'green' || (st.backColor === 'amber' && e.back !== 'load');
  const shoulderOk = !e.press || st.shoulders === 'fine';
  if (allTop && backOk && shoulderOk) return { ...base, w: roundTo(w + inc * dir, inc), change: 'up' };
  if (allTop) return { ...base, change: 'held' };
  if (anyLow) return { ...base, w: roundTo(w - inc * dir, inc), change: 'down' };
  return base;
}

// Setup sessions: adjust the next set from "how many more could you have done".
export function setupNext(ex, w, rir, units) {
  const e = EX[ex];
  const inc = incOf(ex, units);
  const harder = e.dir || 1;
  const step = d => {
    if (e.kind === 'level') return Math.max(0, w + d);
    const pct = roundTo(w * (1 + 0.1 * d), inc);
    const one = roundTo(w + inc * d, inc);
    return d > 0 ? Math.max(pct, one) : Math.min(pct, one);
  };
  if (rir >= 4) return step(harder);
  if (rir <= 1) return step(-harder);
  return w;
}

export function liftKcal(sec, weight, units) {
  return Math.round(LIFT_MET * kgOf(Number(weight) || 0, units) * (Math.min(sec, 5400) / 3600));
}

// ---- guided routines (primer and stretches) --------------------------------

// Steps: ready (get into position), hold, relax, rest, stretch, manual, test.
const ready = (ex, side, sec = 6, voice = 'next') => ({ kind: 'ready', ex, side, sec, voice });

function holds(out, ex, n, side, setLabel) {
  for (let i = 1; i <= n; i++) {
    out.push({ kind: 'hold', ex, side, sec: 10, voice: 'hold', label: `${setLabel} · hold ${i} of ${n}` });
    if (i < n) out.push({ kind: 'relax', ex, side, sec: 3, voice: 'relax' });
  }
}

export function primerSteps({ weak, test, warm }) {
  const s = [];
  const sideName = { left: 'Left', right: 'Right' };

  if (warm) s.push({ kind: 'warm', ex: 'warm', sec: 300, voice: 'next', beep: true, label: 'Bike or brisk treadmill walk' });
  s.push(ready('curlup', null));
  [3, 2, 1].forEach((n, k) => {
    if (k) s.push({ kind: 'rest', ex: 'curlup', sec: 10, label: 'Switch the bent knee' });
    holds(s, 'curlup', n, null, `Set ${k + 1}`);
  });

  if (test) {
    s.push(ready('sideplank', 'left', 10));
    s.push({ kind: 'test', ex: 'sideplank', side: 'left', cap: 90 });
    s.push({ kind: 'rest', ex: 'sideplank', sec: 30, label: 'Rest, then the right side' });
    s.push(ready('sideplank', 'right', 6, 'switch'));
    s.push({ kind: 'test', ex: 'sideplank', side: 'right', cap: 90 });
  } else {
    s.push(ready('sideplank', 'left'));
    [3, 2, 1].forEach((n, k) => {
      if (k) s.push({ kind: 'rest', ex: 'sideplank', side: 'left', sec: 8, label: 'Next set, left side' });
      holds(s, 'sideplank', n, 'left', `${sideName.left} · set ${k + 1}`);
      s.push(ready('sideplank', 'right', 5, 'switch'));
      holds(s, 'sideplank', n, 'right', `${sideName.right} · set ${k + 1}`);
    });
    if (weak) {
      s.push(ready('sideplank', weak, 5, 'switch'));
      holds(s, 'sideplank', 2, weak, `Extra set · ${sideName[weak].toLowerCase()} side`);
    }
  }

  s.push(ready('birddog', null));
  [3, 2, 1].forEach((n, k) => {
    if (k) s.push({ kind: 'rest', ex: 'birddog', sec: 8, label: 'Short rest' });
    for (let i = 1; i <= n; i++) {
      if (i > 1) s.push({ kind: 'relax', ex: 'birddog', sec: 3, voice: 'switch', label: 'Back to the left arm' });
      s.push({ kind: 'hold', ex: 'birddog', side: 'left', sec: 10, voice: 'hold', label: `Set ${k + 1} · left arm, right leg` });
      s.push({ kind: 'relax', ex: 'birddog', sec: 3, voice: 'switch', label: 'Switch to the right arm' });
      s.push({ kind: 'hold', ex: 'birddog', side: 'right', sec: 10, voice: 'hold', label: `Set ${k + 1} · right arm, left leg` });
    }
  });

  s.push(ready('extrot', null, 4));
  s.push({ kind: 'manual', ex: 'extrot', label: '15 slow reps each arm' });
  return s.map(x => ({ ...x, lib: 'primer' }));
}

// Every stretch gets time to get into position, and to switch sides.
const GET_IN = 6, SWITCH = 5, BEND = 3;
const hold = (ex, side, sec, label) => ({ kind: 'stretch', ex, side, sec, voice: 'hold', beep: true, label });

function stretch(out, ex, sec, extra) {
  out.push({ kind: 'ready', ex, side: 'left', sec: GET_IN, voice: 'next', label: 'Get into position, left side' });
  out.push(hold(ex, 'left', sec, 'Left side'));
  out.push({ kind: 'ready', ex, side: 'right', sec: SWITCH, voice: 'switch', label: 'Switch to the right side' });
  out.push(hold(ex, 'right', sec, 'Right side'));
  if (extra) {
    out.push({ kind: 'ready', ex, side: extra.side, sec: SWITCH, voice: 'switch', label: `Back to the ${extra.side} side` });
    out.push(hold(ex, extra.side, extra.sec, `A little extra on the ${extra.side} side`));
  }
}

// Both calf stretches on one leg (straight knee, then bend it), then the other leg.
function calves(out, sec) {
  for (const side of ['left', 'right']) {
    out.push({ kind: 'ready', ex: 'calfwall', side, sec: side === 'left' ? GET_IN : SWITCH, voice: side === 'left' ? 'next' : 'switch', label: `Get into position, ${side} leg back` });
    out.push(hold('calfwall', side, sec, `${side === 'left' ? 'Left' : 'Right'} calf, knee straight`));
    out.push({ kind: 'ready', ex: 'soleuswall', side, sec: BEND, voice: null, label: 'Now bend that back knee' });
    out.push(hold('soleuswall', side, sec, `${side === 'left' ? 'Left' : 'Right'} calf, knee bent`));
  }
}

export function runStretchSteps() {
  const s = [];
  calves(s, 30);
  stretch(s, 'hipflexor', 30);
  stretch(s, 'figure4', 30);
  return s.map(x => ({ ...x, lib: 'stretch' }));
}

export function dayStretchSteps(day, tight) {
  const s = [];
  calves(s, 20);
  stretch(s, 'hipflexor', 30);
  stretch(s, 'figure4', 30);
  s.push({ kind: 'ready', ex: 'catcamel', sec: GET_IN, voice: 'next', label: 'Onto hands and knees' });
  s.push({ kind: 'stretch', ex: 'catcamel', sec: 40, voice: null, beep: true, label: '6 slow reps' });
  stretch(s, 'sidereach', 30, { side: tight || 'left', sec: 15 });
  stretch(s, DAYS[day].stretch, 30);
  return s.map(x => ({ ...x, lib: 'stretch' }));
}

export const stepInfo = st => (st.lib === 'primer' ? PRIMER : STRETCH)[st.ex];

export const stepsSeconds = steps => steps.reduce((a, s) => a + (s.sec || (s.kind === 'test' ? 50 : s.kind === 'manual' ? 60 : 0)), 0);
