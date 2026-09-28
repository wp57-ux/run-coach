// Everything lives in this phone's localStorage. Nothing is sent anywhere.

const KEY = 'runcoach.v1';
const ACTIVE = 'runcoach.active';

export const DEFAULTS = {
  version: 1,
  onboarded: false,
  profile: { units: 'imperial', weight: null },
  treadmill: { walkSpeed: 3.1, runSpeed: 4.6, incline: 1 },
  audio: { voice: true, beeps: true, vibrate: true, updates: true, volume: 0.8, style: 'duck' },
  // natural = measured steps/min; scope = 'first' run block only, or 'all'
  metronome: { on: false, bpm: 160, volume: 0.4, natural: null, scope: 'first' },
  startStage: 1,
  sessions: [],
  overrides: [],
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
    const raw = localStorage.getItem(KEY);
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

export function wipe() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ACTIVE);
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

export function toBackup(state) {
  return JSON.stringify({ app: 'run-coach', exportedAt: new Date().toISOString(), state }, null, 1);
}

export function fromBackup(text) {
  const data = JSON.parse(text);
  const s = data && data.app === 'run-coach' ? data.state : null;
  if (!s || !Array.isArray(s.sessions)) throw new Error('Not a Run Coach backup');
  return merge(clone(DEFAULTS), s);
}
