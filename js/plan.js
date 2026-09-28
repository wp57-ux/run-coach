// The 12-stage plan and the rules that move you through it.

export const DAY = 86400000;
export const MAX_STAGE = 12;
export const WARMUP_MIN = 5;
const LAYOFF_DAYS = 10;

const R = 'run', W = 'walk';
const rep = (n, ...pairs) => Array.from({ length: n }, () => pairs).flat();

// Minutes per block. The last walk of every stage becomes the cool-down.
export const STAGES = [
  { n: 1, name: '5 × (run 3 / walk 2)', main: rep(5, [R, 3], [W, 2]) },
  { n: 2, name: '4 × (run 4 / walk 2)', main: rep(4, [R, 4], [W, 2]) },
  { n: 3, name: '3 × (run 6 / walk 2)', main: rep(3, [R, 6], [W, 2]) },
  { n: 4, name: '3 × (run 7 / walk 1)', main: [[R, 7], [W, 1], [R, 7], [W, 1], [R, 7], [W, 2]] },
  { n: 5, name: '2 × (run 10 / walk 2)', main: [[R, 10], [W, 2], [R, 10], [W, 3]] },
  { n: 6, name: 'Run 12 · walk 1 · run 10', main: [[R, 12], [W, 1], [R, 10], [W, 2]] },
  { n: 7, name: '20 min non-stop', main: [[R, 20], [W, 5]], milestone: 'First non-stop run' },
  { n: 8, name: '22 min non-stop', main: [[R, 22], [W, 3]] },
  { n: 9, name: '25 min non-stop', main: [[R, 25], [W, 3]], milestone: '30-min cap lifts' },
  { n: 10, name: '28 min non-stop', main: [[R, 28], [W, 3]] },
  { n: 11, name: '31 min non-stop', main: [[R, 31], [W, 3]] },
  { n: 12, name: '5K non-stop', main: [[R, '5k'], [W, 3]], milestone: 'The goal' },
];

export const stageInfo = n => STAGES[Math.min(MAX_STAGE, Math.max(1, n)) - 1];

export function speedToMps(speed, units) {
  return units === 'imperial' ? speed * 0.44704 : speed / 3.6;
}

export function buildSegments(n, treadmill, units) {
  const segs = [{ type: 'warmup', sec: WARMUP_MIN * 60 }];
  for (const [type, min] of stageInfo(n).main) {
    if (min === '5k') {
      // Time to cover 5 km at your run speed, rounded up to 15 s.
      const sec = Math.ceil(5000 / speedToMps(treadmill.runSpeed, units) / 15) * 15;
      segs.push({ type, sec, fiveK: true });
    } else {
      segs.push({ type, sec: min * 60 });
    }
  }
  segs[segs.length - 1].type = 'cooldown';
  return segs;
}

// ---- Traffic lights -------------------------------------------------------

export function prelimColor(s) {
  if (s.endedForPain || s.pain >= 5 || s.worseDuring || s.limping) return 'red';
  if (s.pain >= 3 || s.effort === 'hard' || !s.completed) return 'amber';
  return 'green';
}

export function finalColor(s) {
  if (s.prelim === 'red') return 'red';
  if (!s.morning) return 'pending';
  if (s.morning === 'clearly') return 'red';
  if (s.morning === 'slightly') return 'amber';
  return s.prelim;
}

export const needsMorning = s => s.prelim !== 'red' && !s.morning;

export function dayStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);

// Replays every run and manual stage change in order, so deleting or
// editing a run always leaves the plan consistent.
export function progression(state, now = Date.now()) {
  const events = [
    ...state.overrides.map(o => ({ t: Date.parse(o.at), o })),
    ...state.sessions.map(s => ({ t: Date.parse(s.at), s })),
  ].sort((a, b) => a.t - b.t);

  let stage = state.startStage || 1;
  let streak = 0, reds = 0, goal = false;
  let lastT = null, lastRedT = null;

  for (const e of events) {
    if (e.o) { stage = e.o.stage; streak = 0; continue; }
    if (lastT !== null && e.t - lastT > LAYOFF_DAYS * DAY) { stage = Math.max(1, stage - 1); streak = 0; }
    lastT = e.t;
    const c = finalColor(e.s);
    if (c === 'green') {
      reds = 0;
      streak++;
      if (streak >= 2) {
        if (stage < MAX_STAGE) { stage++; streak = 0; } else goal = true;
      }
    } else if (c === 'amber') {
      reds = 0; streak = 0;
    } else if (c === 'red') {
      reds++; lastRedT = e.t; streak = 0;
      stage = Math.max(1, stage - 1);
    }
  }

  let layoff = false;
  if (lastT !== null && now - lastT > LAYOFF_DAYS * DAY) {
    stage = Math.max(1, stage - 1); streak = 0; layoff = true;
  }
  return { stage, streak, reds, goal, layoff, lastT, lastRedT };
}
