// Everything lives in this phone's localStorage. Nothing is sent anywhere.

// The test copy (…/run-coach-test/) keeps its own data under its own names,
// starting from a copy of your real data, so trying things out never touches
// your real log.
export const TEST = typeof location !== 'undefined' && location.pathname.includes('-test/');
const NS = TEST ? 'runcoachtest' : 'runcoach';
const KEY = `${NS}.v1`;
const ACTIVE = `${NS}.active`;
const LIFT = `${NS}.lift`;

export const DEFAULTS = {
  version: 1,
  onboarded: false,
  profile: { units: 'imperial', weight: null },
  treadmill: { walkSpeed: 3.1, runSpeed: 4.6, incline: 1 },
  audio: { voice: true, beeps: true, vibrate: true, updates: true, volume: 0.8, style: 'duck' },
  // natural = measured steps/min; scope = 'first' run block only, or 'all'
  metronome: { on: false, bpm: 160, volume: 0.4, natural: null, scope: 'first' },
  startStage: 1,
  // cardio: 'bike' or 'run'. sessions holds both; bike rides have mode: 'bike'.
  cardio: 'bike',
  sessions: [],
  overrides: [],
  // unit = what the bike's targets are in: 'level' (resistance level at
  // 80–90 rpm), 'watts', or 'feel'. overrides = stage or steady value you set by hand
  bike: { unit: 'level', startStage: 1, overrides: [] },
  // strength: next = a day you picked by hand; swaps = your exercise swaps;
  // notes = machine notes; phase2 = null (not offered yet), true or false;
  // rest = seconds between sets of the 3-set exercises; maxMin = your limit
  // for a whole gym visit (ride, primer, lift and stretch)
  lift: { next: null, swaps: {}, notes: {}, phase2: null, plankDue: false, rest: 90, maxMin: 70 },
  lifts: [],
  planks: [],
};

const clone = o => JSON.parse(JSON.stringify(o));

function merge(base, saved) {
  for (const [k, v] of Object.entries(saved || {})) {
    const b = base[k];
    base[k] = b && v && typeof b === 'object' && typeof v === 'object' && !Array.isArray(b) ? { ...b, ...v } : v;
  }
  return base;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY) || (TEST ? localStorage.getItem('runcoach.v1') : null);
    if (raw) return merge(clone(DEFAULTS), JSON.parse(raw));
  } catch (e) {
    console.warn('Could not read saved data', e);
  }
  return clone(DEFAULTS);
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('Could not save', e);
    return false;
  }
}

// Test copy only: start over from a fresh copy of your real data.
export function refreshTestCopy() {
  if (!TEST) return;
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ACTIVE);
    localStorage.removeItem(LIFT);
  } catch {}
}

export function wipe() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ACTIVE);
    localStorage.removeItem(LIFT);
  } catch {}
}

// An in-progress workout (or a finished one awaiting its check-in), so a
// crash or accidental close doesn't lose the run.
export function saveActive(snap) {
  try { localStorage.setItem(ACTIVE, JSON.stringify({ ...snap, savedAt: Date.now() })); } catch {}
}

export function loadActive() {
  try {
    const s = JSON.parse(localStorage.getItem(ACTIVE) || 'null');
    if (s && Date.now() - s.savedAt < 12 * 3600e3) return s;
    if (s) localStorage.removeItem(ACTIVE);
  } catch {}
  return null;
}

export function clearActive() {
  try { localStorage.removeItem(ACTIVE); } catch {}
}

// A lift in progress, saved after every set.
export function saveLift(snap) {
  try { localStorage.setItem(LIFT, JSON.stringify({ ...snap, savedAt: Date.now() })); } catch {}
}

export function loadLift() {
  try {
    const s = JSON.parse(localStorage.getItem(LIFT) || 'null');
    if (s && Date.now() - s.savedAt < 12 * 3600e3) return s;
    if (s) localStorage.removeItem(LIFT);
  } catch {}
  return null;
}

export function clearLift() {
  try { localStorage.removeItem(LIFT); } catch {}
}

export function toBackup(state) {
  return JSON.stringify({ app: 'run-coach', exportedAt: new Date().toISOString(), state }, null, 1);
}

export function fromBackup(text) {
  const data = JSON.parse(text);
  const s = data && data.app === 'run-coach' ? data.state : null;
  if (!s || !Array.isArray(s.sessions)) throw new Error('Not a Run Coach backup');
  return merge(clone(DEFAULTS), s);
}
