// A private copy of your data in the cloud, so it survives a lost phone and
// Claude can read your history from your PC. It goes to your own Cloudflare
// Worker and needs a key this phone gets once, from a setup link (#sync=<code>).
// The key is stored apart from your data, so it's never in an exported backup.
import * as store from './store.js';

const BASE = 'https://run-coach-sync.rapid-cloud-5801.workers.dev';
const KEY = store.TEST ? 'runcoachtest.sync' : 'runcoach.sync';
const SLOT = store.TEST ? 'test' : ['localhost', '127.0.0.1'].includes(location.hostname) ? 'dev' : 'runcoach';
const WAIT_MS = 8000;       // after a change, so a burst of edits goes up once
const KEEPALIVE_MAX = 60000; // browsers only finish small uploads once the app is closed

export function config() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

function save(c) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
}

export const isOn = () => !!config()?.key;
export const off = () => { try { localStorage.removeItem(KEY); } catch {} };
export const host = () => new URL(BASE).host;
export const count = s => (s?.lifts?.length || 0) + (s?.sessions?.length || 0);

// The code from a setup link, or null.
export const linkCode = hash => /^#sync=([\w-]{16,64})$/.exec(hash || '')?.[1] ?? null;

// Trades the one-time code for the key. 'used' = the code was already used or is over 48 h old.
export async function pair(code) {
  try {
    const res = await fetch(`${BASE}/v1/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    if (!res.ok) return { error: res.status === 404 ? 'used' : 'failed' };
    const { key } = await res.json();
    if (typeof key !== 'string' || !key) return { error: 'failed' };
    save({ key, last: null, sent: null, error: null, conflict: null });
    return { ok: true };
  } catch {
    return { error: 'offline' };
  }
}

// A quick fingerprint of what was last sent, so nothing goes up twice.
const fnv = s => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

let timer = null, busy = false;

export function schedule(get, ms = WAIT_MS) {
  if (!isOn()) return;
  clearTimeout(timer);
  timer = setTimeout(() => push(get()), ms);
}

// The app is going into the background: send now.
export function flush(get) {
  if (!isOn()) return;
  clearTimeout(timer);
  push(get(), { keepalive: true });
}

// force = replace the cloud copy even if it has a lot more history than this phone.
export async function push(state, { force = false, keepalive = false } = {}) {
  const c = config();
  if (!c?.key || busy) return { ok: false };
  if (c.conflict && !force) return { ok: false, conflict: c.conflict };
  const data = JSON.stringify(state);
  const h = fnv(data);
  if (h === c.sent && !force) return { ok: true, same: true };
  busy = true;
  const body = `{"app":"run-coach","savedAt":${JSON.stringify(new Date().toISOString())},"state":${data}}`;
  try {
    const res = await fetch(`${BASE}/v1/${SLOT}${force ? '?force=1' : ''}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
      body,
      keepalive: keepalive && body.length < KEEPALIVE_MAX,
    });
    const now = config() || c;
    if (res.status === 409) {
      now.conflict = (await res.json()).cloud;
      save(now);
      return { ok: false, conflict: now.conflict };
    }
    if (!res.ok) {
      now.error = res.status === 401 ? 'key' : 'failed';
      save(now);
      return { ok: false, error: now.error };
    }
    Object.assign(now, { sent: h, last: Date.now(), error: null, conflict: null });
    save(now);
    return { ok: true };
  } catch {
    const now = config();
    if (now) save({ ...now, error: 'offline' });
    return { ok: false, error: 'offline' };
  } finally {
    busy = false;
  }
}

// The cloud copy: { savedAt, state }, or { empty: true }.
export async function pull() {
  const c = config();
  if (!c?.key) return null;
  const res = await fetch(`${BASE}/v1/${SLOT}`, { headers: { Authorization: `Bearer ${c.key}` }, cache: 'no-store' });
  if (res.status === 404) return { empty: true };
  if (!res.ok) throw new Error(`cloud ${res.status}`);
  return res.json();
}

// After restoring: clear the pause, and send again from the restored data.
export function restored() {
  const c = config();
  if (c) save({ ...c, conflict: null, sent: null, error: null });
}
