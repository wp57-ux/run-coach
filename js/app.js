import * as store from './store.js';
import {
  STAGES, MAX_STAGE, stageInfo, buildSegments, progression, prelimColor, finalColor,
  needsMorning, daysBetween, dayStart,
} from './plan.js';
import { planTotals, sessionTotals } from './calories.js';
import { AudioCoach } from './audio.js';
import { Workout } from './workout.js';
import { EX } from './lift-data.js';
import * as Lift from './lift.js';
import * as Bike from './bike.js';
import { Guide } from './guide.js';

// The drawings are nice to have: if they ever fail to load, the app still works.
const { figure } = await import('./drawings.js').catch(() => ({ figure: () => '' }));

// ?fast=60 runs workouts 60× faster, for testing.
const TIME_SCALE = Math.min(120, Math.max(1, Number(new URLSearchParams(location.search).get('fast')) || 1));
const LB_PER_KG = 2.20462262, KM_PER_MI = 1.609344;
const WHERE = ['Knee', 'Shin', 'Calf / Achilles', 'Hip', 'Back', 'Other'];
const TYPE_LABEL = { warmup: 'Warm up', run: 'Run', walk: 'Walk', cooldown: 'Cool down', easy: 'Easy', steady: 'Steady', strong: 'Strong', hard: 'Hard' };
const THEME = { base: '#0c0e0d', run: '#c9f23a', walk: '#1a47d1', easy: '#27313b', steady: '#c9f23a', strong: '#ffb43d', hard: '#ff5a47', ezone: '#1a47d1' };
const WORK_TYPES = ['run', 'steady', 'strong', 'hard'];
const LIMITS = {
  imperial: { weight: [60, 700], walk: [1, 5], run: [2.5, 12] },
  metric: { weight: [30, 320], walk: [1.5, 8], run: [4, 20] },
};

let state = store.load();
if (store.TEST) document.body.classList.add('test');
let view = 'today';
let wk = null;        // workout in progress
let draft = null;     // finished workout awaiting its check-in
let hurt = null;      // "something hurts" sheet state
let installEvt = null;
let wakeLock = null;
let chartMetric = 'kcal';
const audio = new AudioCoach(() => state);

// ---- helpers ---------------------------------------------------------------

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const round1 = n => Math.round(n * 10) / 10;
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

const units = () => state.profile.units;
const imp = () => units() === 'imperial';
const limits = () => LIMITS[units()];
const spUnit = () => (imp() ? 'mph' : 'km/h');
const dUnit = () => (imp() ? 'mi' : 'km');
const wUnit = () => (imp() ? 'lb' : 'kg');
const distVal = km => (imp() ? km / KM_PER_MI : km);
const fmtDist = (km, dp = 2) => `${distVal(km || 0).toFixed(dp)} ${dUnit()}`;
const fmtClock = ms => { const s = Math.max(0, Math.ceil(ms / 1000 - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtElapsed = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtMins = sec => { const m = sec / 60; return Number.isInteger(m) ? String(m) : m.toFixed(1); };
const fmtDay = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches;
const zone = n => (n <= 2 ? 'zg' : n <= 4 ? 'za' : 'zr');

function persist() {
  if (!store.save(state)) toast('Couldn’t save. Is the phone’s storage full?');
}

let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

function setTheme(c) { $('meta[name=theme-color]').setAttribute('content', c); }

function showScreen(html) {
  const s = $('#screen');
  s.innerHTML = html;
  s.classList.add('on');
  s.scrollTop = 0;
  document.body.classList.add('locked');
}

function hideScreen() {
  const s = $('#screen');
  s.classList.remove('on');
  s.innerHTML = '';
  document.body.classList.remove('locked');
  setTheme(THEME.base);
}

function openSheet(html, dismissable = true) {
  const s = $('#sheet');
  s.onclick = null;
  s.innerHTML = `<div class="sheet-back" ${dismissable ? 'data-act="sheet-close"' : ''}></div><div class="sheet-card" role="dialog" aria-modal="true">${html}</div>`;
  s.classList.add('on');
}

function closeSheet() {
  const s = $('#sheet');
  s.classList.remove('on');
  s.innerHTML = '';
  s.onclick = null;
}

function ask(title, body, buttons) {
  return new Promise(resolve => {
    const s = $('#sheet');
    s.innerHTML = `<div class="sheet-back" data-ans="-1"></div>
      <div class="sheet-card" role="alertdialog" aria-modal="true">
        <h3>${title}</h3>${body ? `<p>${body}</p>` : ''}
        <div class="sheet-btns">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-ans="${i}">${b.label}</button>`).join('')}</div>
      </div>`;
    s.classList.add('on');
    s.onclick = e => {
      const el = e.target.closest('[data-ans]');
      if (!el) return;
      const i = +el.dataset.ans;
      closeSheet();
      resolve(i < 0 ? undefined : buttons[i].value);
    };
  });
}

function restInfo(prog, now) {
  if (prog.lastT === null) return null;
  const since = daysBetween(prog.lastT, now);
  if (prog.lastRedT !== null && prog.lastRedT === prog.lastT && since < 3) {
    const until = new Date(dayStart(prog.lastT));
    until.setDate(until.getDate() + 3);
    return { kind: 'red', until: until.getTime() };
  }
  if (since < 2) return { kind: 'b2b', since };
  return null;
}

// ---- pieces ----------------------------------------------------------------

const headerHTML = sub => `<header class="top"><div class="brand">Run<i>/</i>Coach</div><div class="date">${esc(sub)}</div></header>`;

const card = (tone, title, body, actions = '') =>
  `<div class="card ${tone}"><h3>${title}</h3><p>${body}</p>${actions ? `<div class="row">${actions}</div>` : ''}</div>`;

function roadHTML(stage, goal, bike = false) {
  const max = bike ? Bike.BIKE_MAX : MAX_STAGE;
  let cells = '';
  for (let n = 1; n <= max; n++) {
    const cls = goal || n < stage ? 'done' : n === stage ? 'now' : '';
    cells += `<span class="${cls}">${n === max ? (bike ? '★' : '5K') : n}</span>`;
  }
  return `<div class="road-wrap">
    <div class="road-head"><span class="eyebrow">${bike ? 'Bike plan' : 'Road to 5K'}</span><span class="eyebrow">Stage ${stage} of ${max}</span></div>
    <div class="road">${cells}</div>
  </div>`;
}

// ---- cardio: run or bike ----------------------------------------------------

const isBike = () => state.cardio === 'bike';
const nounOf = s => (s?.mode === 'bike' ? 'ride' : 'run');

// Everything Today and the workout need about the next run or ride.
function cardioCtx(now = Date.now()) {
  if (!isBike()) {
    const prog = progression(state, now);
    const segs = buildSegments(prog.stage, state.treadmill, units());
    const plan = planTotals(segs);
    const est = sessionTotals(plan, state.treadmill, state.profile.weight, units());
    return { bike: false, noun: 'run', prog, info: stageInfo(prog.stage), segs, totalMin: Math.round(plan.totalSec / 60), plan, est, kcal: est.kcal, rest: restInfo(prog, now) };
  }
  const prog = Bike.bikeProgression(state, now);
  const segs = Bike.bikeSegments(prog.stage);
  const t = Bike.bikeTotals(segs);
  const unit = bunit();
  const power = unit !== 'feel' ? prog.power : null;
  return {
    bike: true, noun: 'ride', prog, info: Bike.bikeStage(prog.stage), segs, power, unit,
    totalMin: Math.round(t.totalSec / 60), workSec: t.workSec,
    kcal: Bike.bikeKcal(Bike.planSecByType(segs), unit === 'watts' ? power : null, state.profile.weight, units()),
    rest: Bike.bikeRest(prog, now), setup: unit !== 'feel' && !prog.power,
  };
}

const bunit = () => state.bike.unit || 'level';
const zoneW = (zone, power, unit = bunit()) => Bike.zoneTarget(zone, power, unit);
// "level 11" or "120 W"
const fmtP = (v, unit = bunit()) => (unit === 'level' ? `level ${v}` : `${v} W`);
const STEADY_WORD = { level: 'steady level', watts: 'steady power' };
const steadyStat = (p, unit) => `<div><dt>${unit === 'level' ? 'Level' : 'Steady'}</dt><dd>${p ?? '–'}<small>${p && unit === 'watts' ? 'W' : ''}</small></dd></div>`;

function bikeTargetsHTML(power, unit = bunit()) {
  if (!power) return '';
  return ['easy', 'steady', 'strong', 'hard'].map(z => `${Bike.ZONES[z].label.toLowerCase()} <b>${fmtP(zoneW(z, power, unit), unit)}</b>`).join(' · ');
}

function bikeHeroHTML(c) {
  const { prog, info, power } = c;
  const tip = c.setup
    ? c.unit === 'level'
      ? 'This ride sets your <b>steady level</b>. In the steady part, pick the level where you’re breathing harder but can still talk in short sentences, and remember it for the check-in.'
      : 'Your first ride sets your <b>steady power</b>. In the steady part, settle on an effort where you’re breathing harder but can still talk in short sentences, then note the watts on the screen.'
    : power ? `Targets: ${bikeTargetsHTML(power)}.` : 'Ride by feel: easy = chatty, steady = short sentences, strong = a few words, hard = a big minute.';
  return `<section class="hero">
      <div class="hero-top"><span class="eyebrow">Next ride · Stage ${prog.stage}</span>${c.setup ? '<span class="tag">Setup ride</span>' : info.milestone ? `<span class="tag">${esc(info.milestone)}</span>` : ''}</div>
      <h1>${esc(info.name)}</h1>
      ${matrixHTML(c.segs)}
      <div class="legend"><span class="walk">Easy</span><span class="run">Steady</span><span class="strong">Strong</span><span class="hard">Hard</span><span class="easy">Warm-up / cool-down</span></div>
      <dl class="stats">
        <div><dt>Total</dt><dd>${c.totalMin}<small>min</small></dd></div>
        <div><dt>Working</dt><dd>${fmtMins(c.workSec)}<small>min</small></dd></div>
        <div><dt>Burn</dt><dd>${c.kcal}<small>kcal</small></dd></div>
        ${steadyStat(power, c.unit)}
      </dl>
      ${streakHTML(prog, true)}
      <p class="hint">${tip} Keep about 80–90 rpm. Seat high enough that your knee stays slightly bent at the bottom.</p>
    </section>`;
}

function runHeroHTML(c) {
  const { prog, info, plan, est } = c;
  return `<section class="hero">
      <div class="hero-top"><span class="eyebrow">Next run · Stage ${prog.stage}</span>${info.milestone ? `<span class="tag">${esc(info.milestone)}</span>` : ''}</div>
      <h1>${esc(info.name)}</h1>
      ${matrixHTML(c.segs)}
      <div class="legend"><span class="run">Run</span><span class="walk">Walk</span><span class="easy">Warm-up / cool-down</span></div>
      <dl class="stats">
        <div><dt>Total</dt><dd>${Math.round(plan.totalSec / 60)}<small>min</small></dd></div>
        <div><dt>Running</dt><dd>${fmtMins(plan.runSec)}<small>min</small></dd></div>
        <div><dt>Burn</dt><dd>${est.kcal}<small>kcal</small></dd></div>
        <div><dt>Distance</dt><dd>${distVal(est.distKm).toFixed(1)}<small>${dUnit()}</small></dd></div>
      </dl>
      ${streakHTML(prog)}
      <p class="hint">Treadmill: walk <b>${state.treadmill.walkSpeed} ${spUnit()}</b> · run <b>${state.treadmill.runSpeed} ${spUnit()}</b> · incline <b>${state.treadmill.incline}%</b>. Run at an easy pace: you should be able to talk in full sentences.</p>
    </section>`;
}

// Treadmill-console style dot-matrix profile: one column per minute.
function matrixHTML(segs, pos = null) {
  const total = segs.reduce((a, s) => a + s.sec, 0);
  const cols = Math.max(1, Math.round(total / 60));
  const colSec = total / cols;
  const bounds = [];
  let acc = 0;
  for (const s of segs) { acc += s.sec; bounds.push(acc); }
  let html = '';
  for (let c = 0; c < cols; c++) {
    const mid = (c + 0.5) * colSec;
    const i = bounds.findIndex(b => mid < b);
    const type = segs[i < 0 ? segs.length - 1 : i].type;
    const h = { run: 7, hard: 7, strong: 6, steady: 5, walk: 3, easy: 3 }[type] || 2;
    let cls = '';
    if (pos !== null) {
      const p = pos / 1000;
      cls = p >= (c + 1) * colSec ? ' past' : p >= c * colSec ? ' now' : '';
    }
    html += `<i class="col ${type}${cls}" style="--h:${h}"><b></b></i>`;
  }
  return `<div class="matrix" style="--cols:${cols}" aria-hidden="true">${html}</div>`;
}

function matrixCol(segs, pos) {
  const total = segs.reduce((a, s) => a + s.sec, 0);
  const cols = Math.max(1, Math.round(total / 60));
  return Math.min(cols - 1, Math.floor(pos / 1000 / (total / cols)));
}

function streakHTML(prog, bike = false) {
  if (prog.goal) return '';
  const dots = [0, 1].map(i => `<i class="${i < prog.streak ? 'on' : ''}"></i>`).join('');
  const top = bike ? Bike.BIKE_MAX : MAX_STAGE;
  const what = bike ? 'ride' : 'run';
  const text = prog.stage === top
    ? (bike ? (prog.streak ? '1 more green ride at stage 12 and you’ve done it' : '2 green rides at stage 12 and you’ve done it')
      : (prog.streak ? '1 more green 5K and you’ve done it' : '2 green 5Ks in a row and you’ve done it'))
    : (prog.streak ? `1 more green ${what} to move up` : `2 green ${what}s in a row to move up`);
  return `<div class="streak">${dots}<span>${text}</span></div>`;
}

function morningHTML(s, ago) {
  return `<div class="card morning">
    <span class="eyebrow">Morning check</span>
    <h3>How does your body feel?</h3>
    <p>Compared with before your ${nounOf(s)} ${ago === 1 ? 'yesterday' : 'on ' + fmtDay(s.at)}: knees, ${s.mode === 'bike' ? 'Achilles' : 'shins'}, hips, back.</p>
    <div class="choices">
      <button class="choice green" data-act="morning" data-v="same"><b>Same or better</b><small>Nothing new</small></button>
      <button class="choice amber" data-act="morning" data-v="slightly"><b>A bit worse</b><small>Stiffer, achy</small></button>
      <button class="choice red" data-act="morning" data-v="clearly"><b>Clearly worse</b><small>Sore, painful</small></button>
    </div>
  </div>`;
}

const toggleHTML = (path, label, sub = '') => {
  const on = !!getPath(state, path);
  return `<button class="toggle" role="switch" aria-checked="${on}" data-act="toggle" data-path="${path}">
    <span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><i></i></button>`;
};

const numField = (label, bind, value, unit, min, max, step) =>
  `<label class="field"><span>${label}</span><div class="inp"><input data-bind="${bind}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value ?? ''}"><em>${unit}</em></div></label>`;

// ---- views -----------------------------------------------------------------

function render() {
  if (!state.onboarded) {
    if (!$('#onboard')) showScreen(onboardHTML());
    return;
  }
  $('#view').innerHTML = view === 'progress' ? progressHTML() : view === 'settings' ? settingsHTML() : todayHTML();
  $$('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === view));
}

function todayHTML() {
  const now = Date.now();
  const c = cardioCtx(now);
  const { prog, rest } = c;
  const pending = state.sessions.find(needsMorning);
  const active = store.loadActive();
  const lst = liftCtx(now);
  const lpending = state.lifts.find(s => Lift.liftNeedsMorning(s) && daysBetween(s.at, now) >= 1);
  const cards = [];
  let block = '';

  if (active) {
    block = 'Log or discard your unfinished workout first.';
    cards.push(card('amber', active.kind === 'draft' ? 'Finish your check-in' : 'Unfinished workout',
      `From ${fmtDay(active.startedAt)}, ${fmtTime(active.startedAt)}. Log what you did so the plan stays accurate.`,
      `<button class="btn primary" data-act="recover-log">Log it</button><button class="btn ghost" data-act="recover-drop">Discard</button>`));
  }
  if (pending) {
    const ago = daysBetween(pending.at, now);
    if (ago >= 1) {
      block ||= 'Answer the morning check first.';
      cards.push(morningHTML(pending, ago));
    } else if (nounOf(pending) === c.noun) {
      block ||= `Your next ${c.noun} unlocks after tomorrow morning’s check-in.`;
      cards.push(card('info', 'Check in tomorrow morning', 'Open the app tomorrow and say how your body feels. That decides whether today counts as green.'));
    }
  }
  if (lpending) {
    block ||= 'Answer the back check first.';
    cards.push(backMorningHTML(lpending, daysBetween(lpending.at, now)));
  }
  if (lst.reds >= 2) cards.push(card('red', 'Two red back days in a row', 'Worth getting your back looked at by a physio. Lifts stay on reset days until your back check-ins settle.'));
  if (lst.painful >= 2) cards.push(card('red', 'Shoulders painful twice in a row', 'Worth getting your shoulders looked at by a physio. Presses and raises stay on the gentlest options for now.'));
  if (lst.phase2Ready) {
    cards.push(card('green', 'Phase 2 unlocked', 'Six weeks without a red back day. Ready for three upgrades: dumbbell Romanian deadlift, Bulgarian split squat and the 45° back extension? You can turn them off any time in Settings.',
      '<button class="btn primary" data-act="p2" data-v="1">Add them</button><button class="btn ghost" data-act="p2" data-v="0">Not now</button>'));
  }
  if (prog.goal) {
    cards.push(c.bike
      ? card('green', 'Stage 12. Done.', 'Two green 35-minute strong rides. Keep riding stage 12 two or three times a week, and your steady power keeps climbing.')
      : card('green', '5K. Done.', 'Two green 5Ks in a row. Keep running stage 12 two or three times a week to hold onto it.'));
  }
  if (prog.reds >= 2) cards.push(card('red', 'Two red days in a row', 'Worth getting this looked at by a physio before you push on. The plan keeps you at an easier stage in the meantime.'));
  if (rest?.kind === 'red') {
    cards.push(card('red', 'Rest up', `Your last ${c.noun} was a red day. Take it easy until <b>${fmtDay(rest.until)}</b>. Walking is fine.`));
  } else if (rest?.kind === 'b2b' && !pending) {
    cards.push(card('info', 'Rest day', `You ran ${rest.since === 0 ? 'today' : 'yesterday'}. Leave a day between runs. Shins and Achilles need about 48 hours to recover.`));
  }
  if (prog.layoff) {
    cards.push(card('amber', 'Welcome back', `It’s been ${daysBetween(prog.lastT, now)} days since your last ${c.noun}, so you’ve stepped back one stage. Easy does it.`));
  }
  if (installEvt && !isStandalone()) {
    cards.push(card('info', 'Put it on your home screen', 'Opens full-screen and works offline at the gym.', `<button class="btn primary" data-act="install">Install app</button>`));
  }

  return `
    ${headerHTML(fmtDay(now))}
    ${roadHTML(prog.stage, prog.goal, c.bike)}
    ${cards.join('')}
    ${c.bike ? bikeHeroHTML(c) : runHeroHTML(c)}
    ${safeHTML(() => liftCardHTML(lst, block))}
    <div class="startbar">
      ${block ? `<p class="blocked">${block}</p>` : ''}
      <button class="start" data-act="start" ${block ? 'disabled' : ''}><span>Start</span><small>Stage ${prog.stage} · ${c.totalMin} min${lst.liftedToday ? '' : ` + Day ${lst.day}`}</small></button>
    </div>`;
}

function weekStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const cardioSec = s => (s.mode === 'bike' ? s.workSec : s.runSec) || 0;

const sumOf = arr => ({
  n: arr.length,
  run: arr.reduce((a, s) => a + cardioSec(s), 0),
  km: arr.reduce((a, s) => a + (s.distKm || 0), 0),
  kcal: arr.reduce((a, s) => a + (s.kcal || 0), 0),
});

const MORNING_LABEL = { same: 'same or better', slightly: 'a bit worse', clearly: 'clearly worse' };

function cardioRowHTML(s) {
  const c = finalColor(s);
  const dot = c === 'pending' ? `pending ${s.prelim}` : c;
  const bike = s.mode === 'bike';
  const p = s.setPower || s.power;
  const detail = bike
    ? `<p>Ride · ${Math.round(s.totalSec / 60)} min total${p && Bike.sessionUnit(s) !== 'feel' ? ` · steady ${fmtP(p, Bike.sessionUnit(s))}${s.setPower ? ' (setup)' : ''}` : ''}${s.completed ? '' : ' · <b>stopped early</b>'}</p>`
    : `<p>${fmtDist(s.distKm)} · ${Math.round((s.runSec + s.walkSec) / 60)} min total${s.completed ? '' : ' · <b>stopped early</b>'}</p>`;
  return `<details class="hist">
      <summary><i class="dot ${dot}"></i><span class="h-d">${fmtDay(s.at)}</span><span class="h-s">${bike ? 'B' : 'S'}${s.stage}</span><span class="h-r">${fmtMins(Math.round(cardioSec(s) / 6) * 6)}′ ${bike ? 'ride' : 'run'}</span><span class="h-k">${s.kcal} kcal</span></summary>
      <div class="h-b">
        ${detail}
        <p>Pain ${s.pain}/10${s.where?.length ? ` (${s.where.map(esc).join(', ')})` : ''}${s.worseDuring ? ' · got worse' : ''}${s.limping ? ' · limping' : ''} · felt ${esc(s.effort)}</p>
        <p>Next morning: ${s.morning ? MORNING_LABEL[s.morning] : s.prelim === 'red' ? 'n/a' : 'not answered yet'}</p>
        ${s.notes ? `<p class="h-n">“${esc(s.notes)}”</p>` : ''}
        <button class="btn ghost small" data-act="del" data-id="${s.id}">Delete this ${bike ? 'ride' : 'run'}</button>
      </div>
    </details>`;
}

function powerHTML(prog) {
  const unit = bunit();
  if (unit === 'feel') return '';
  const title = unit === 'level' ? 'Steady level' : 'Steady power';
  const u = unit === 'watts' ? 'W' : '';
  const ps = prog.powers || [];
  if (!ps.length) return `<section class="group"><h2>${title}</h2><p class="note">Your first ride sets it.</p></section>`;
  return `<section class="group"><h2>${title}</h2>
      <div class="plank">
        <div><small>Now</small><b>${prog.power}<i>${u}</i></b></div>
        <div><small>First ride</small><b>${ps[0].power}<i>${u}</i></b></div>
        <div><small>Change</small><b class="${prog.power > ps[0].power ? 'ok' : ''}">${prog.power >= ps[0].power ? '+' : ''}${prog.power - ps[0].power}<i>${u}</i></b></div>
      </div>
      ${ps.length > 1 ? `<div class="power-spark">${sparkSVG(ps.slice(-20).map(x => x.power))}</div>` : ''}
      <p class="note">${unit === 'level'
        ? 'Rides that feel easy move you up a level once the next-morning check confirms them. Hard ones take a level off.'
        : 'Rides that feel easy add 5 W once the next-morning check confirms them. Hard ones take 5 W off.'}</p>
    </section>`;
}

function progressHTML() {
  const now = Date.now();
  const bike = isBike();
  const prog = bike ? Bike.bikeProgression(state, now) : progression(state, now);
  const info = bike ? Bike.bikeStage(prog.stage) : stageInfo(prog.stage);
  const list = [...state.sessions].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const isRide = x => x.mode === 'bike';

  const ws = weekStart(now);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const s = new Date(ws); s.setDate(s.getDate() - 7 * i);
    const e = new Date(s); e.setDate(e.getDate() + 7);
    const within = x => { const t = Date.parse(x.at); return t >= s.getTime() && t < e.getTime(); };
    const ins = list.filter(within);
    const runs = sumOf(ins.filter(x => !isRide(x)));
    const rides = sumOf(ins.filter(isRide));
    const lw = state.lifts.filter(within);
    weeks.push({ start: s.getTime(), runs, rides, lifts: lw.length, min: (bike ? rides : runs).run, kcal: runs.kcal + rides.kcal + lw.reduce((a, x) => a + (x.kcal || 0), 0) });
  }
  const cur = weeks[weeks.length - 1];
  const allRuns = sumOf(list.filter(x => !isRide(x)));
  const allRides = sumOf(list.filter(isRide));
  const liftKcalAll = state.lifts.reduce((a, x) => a + (x.kcal || 0), 0);
  const val = w => (chartMetric === 'kcal' ? w.kcal : Math.round(w.min / 60));
  const max = Math.max(1, ...weeks.map(val));
  const bars = weeks.map((w, i) => {
    const v = val(w);
    const label = new Date(w.start).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
    return `<div class="bar${i === weeks.length - 1 ? ' cur' : ''}"><span class="bv">${v || ''}</span><i style="--p:${v / max}"></i><span class="bl">${label}</span></div>`;
  }).join('');

  const planRows = (bike ? Bike.BIKE_STAGES : STAGES).map(s => {
    const cls = prog.goal || s.n < prog.stage ? 'done' : s.n === prog.stage ? 'now' : '';
    const mins = bike ? Math.round(Bike.bikeTotals(Bike.bikeSegments(s.n)).totalSec / 60) : Math.round(planTotals(buildSegments(s.n, state.treadmill, units())).totalSec / 60);
    return `<li class="${cls}"><b>${s.n}</b><span>${esc(s.name)}</span><em>${mins} min</em></li>`;
  }).join('');

  const allParts = [
    allRides.n ? `<b>${allRides.n}</b> ${allRides.n === 1 ? 'ride' : 'rides'} · <b>${Math.round(allRides.run / 60)}</b> min working` : '',
    allRuns.n ? `<b>${allRuns.n}</b> ${allRuns.n === 1 ? 'run' : 'runs'} · <b>${Math.round(allRuns.run / 60)}</b> min running · <b>${distVal(allRuns.km).toFixed(1)}</b> ${dUnit()}` : '',
    `<b>${state.lifts.length}</b> ${state.lifts.length === 1 ? 'lift' : 'lifts'}`,
    `<b>${(allRuns.kcal + allRides.kcal + liftKcalAll).toLocaleString()}</b> kcal`,
  ].filter(Boolean).join(' · ');

  return `
    ${headerHTML('Progress')}
    <section class="big-stage">
      <div class="bs-num">${prog.stage}<small>/${bike ? Bike.BIKE_MAX : MAX_STAGE}</small></div>
      <div><span class="eyebrow">${bike ? 'Bike stage' : 'Current stage'}</span><p>${esc(info.name)}</p></div>
    </section>
    ${roadHTML(prog.stage, prog.goal, bike)}
    <section class="group"><h2>This week</h2>
      <dl class="stats">
        ${bike
          ? `<div><dt>Rides</dt><dd>${cur.rides.n}</dd></div><div><dt>Lifts</dt><dd>${cur.lifts}</dd></div><div><dt>Riding</dt><dd>${Math.round(cur.rides.run / 60)}<small>min</small></dd></div>`
          : `<div><dt>Runs</dt><dd>${cur.runs.n}</dd></div><div><dt>Lifts</dt><dd>${cur.lifts}</dd></div><div><dt>Distance</dt><dd>${distVal(cur.runs.km).toFixed(1)}<small>${dUnit()}</small></dd></div>`}
        <div><dt>Burn</dt><dd>${cur.kcal}<small>kcal</small></dd></div>
      </dl>
    </section>
    ${bike ? powerHTML(prog) : ''}
    <section class="group">
      <div class="gh"><h2>Last 8 weeks</h2>
        <div class="seg small">
          <button data-act="metric" data-v="kcal" aria-pressed="${chartMetric === 'kcal'}">kcal</button>
          <button data-act="metric" data-v="run" aria-pressed="${chartMetric === 'run'}">${bike ? 'ride' : 'run'} min</button>
        </div>
      </div>
      <div class="chart">${bars}</div>
    </section>
    <section class="group"><h2>All time</h2>
      <p class="alltime">${allParts}</p>
    </section>
    <section class="group"><h2>Cardio history</h2>
      ${list.map(cardioRowHTML).join('') || `<p class="note">No ${bike ? 'rides' : 'runs'} yet. Your first one will show up here.</p>`}
    </section>
    ${safeHTML(strengthHTML)}
    <section class="group"><h2>The ${bike ? 'bike' : 'run'} plan</h2>
      <p class="note">${bike
        ? 'Every ride starts with 5 minutes of easy spinning and ends with a 3-minute cool-down. You move up after 2 green rides in a row, repeat on amber, and drop back one on red.'
        : 'Every run starts with a 5-minute brisk walk. You move up after 2 green runs in a row, repeat on amber, and drop back one on red.'}</p>
      <ol class="planlist">${planRows}</ol>
    </section>`;
}

function bikeSettingsHTML() {
  const bp = Bike.bikeProgression(state);
  const unit = bunit(), U = Bike.UNITS[unit];
  const seg = [['level', 'Levels'], ['watts', 'Watts'], ['feel', 'By feel']]
    .map(([v, l]) => `<button data-act="bike-unit" data-v="${v}" aria-pressed="${unit === v}">${l}</button>`).join('');
  const help = {
    level: 'Ride at a steady 80–90 rpm. Easy is 4 levels below your steady level, strong 2 above, hard 4 above. Levels differ between bike models, so try to use the same one.',
    watts: 'Every target is a share of your steady power: easy 60%, steady 100%, strong 115%, hard 135%. Watts differ a little between bike models.',
    feel: 'No numbers: easy = chatty, steady = short sentences, strong = a few words, hard = a big minute.',
  }[unit];
  return `<section class="group"><h2>Bike</h2>
      <div class="field"><span>Targets in</span><div class="seg">${seg}</div><small>${help}</small></div>
      ${U ? `
      <label class="field"><span>${unit === 'level' ? 'Steady level' : 'Steady power'}</span>
        <div class="row power-row"><div class="inp"><input id="powerIn" type="number" inputmode="numeric" min="${U.min}" max="${U.max}" step="${U.step}" placeholder="Set on your first ride" value="${bp.power ?? ''}"><em>${unit === 'level' ? 'level' : 'W'}</em></div>
        <button class="btn" data-act="power-set">Set</button></div></label>
      <button class="btn wide" data-act="power-redo">Redo the setup ride next time</button>` : ''}
    </section>`;
}

function settingsHTML() {
  const a = state.audio, m = state.metronome, t = state.treadmill, L = limits();
  const bike = isBike();
  const prog = bike ? Bike.bikeProgression(state) : progression(state);
  return `
    ${headerHTML('Settings')}
    <section class="group"><h2>You</h2>
      <div class="seg">
        <button data-act="units" data-v="imperial" aria-pressed="${imp()}">mph · lb · mi</button>
        <button data-act="units" data-v="metric" aria-pressed="${!imp()}">km/h · kg · km</button>
      </div>
      ${numField('Weight', 'profile.weight', state.profile.weight, wUnit(), L.weight[0], L.weight[1], 0.1)}
      <p class="note">Only used for calorie estimates. Update it now and then.</p>
    </section>

    <section class="group"><h2>Cardio</h2>
      <div class="seg">
        <button data-act="cardio" data-v="bike" aria-pressed="${bike}">Bike</button>
        <button data-act="cardio" data-v="run" aria-pressed="${!bike}">Treadmill run</button>
      </div>
      <p class="note">Each plan keeps its own stage and history, so you can switch back any time.</p>
    </section>

    ${bike ? bikeSettingsHTML() : `<section class="group"><h2>Treadmill</h2>
      <div class="grid3">
        ${numField('Walk', 'treadmill.walkSpeed', t.walkSpeed, spUnit(), L.walk[0], L.walk[1], 0.1)}
        ${numField('Run', 'treadmill.runSpeed', t.runSpeed, spUnit(), L.run[0], L.run[1], 0.1)}
        ${numField('Incline', 'treadmill.incline', t.incline, '%', 0, 15, 0.5)}
      </div>
      <p class="note">0–1% incline is kindest to calves and Achilles. Stage 12’s length is worked out from your run speed.</p>
    </section>`}

    <section class="group"><h2>Sound</h2>
      <label class="field"><span>Cue volume <output id="volOut">${Math.round(a.volume * 100)}%</output></span>
        <input type="range" min="0" max="100" step="5" value="${Math.round(a.volume * 100)}" data-bind="audio.volume" data-scale="100" data-out="volOut"></label>
      <p class="note">A share of your phone’s media volume. Still too quiet? Turn the phone up.</p>
      <div class="field"><span>With music playing</span>
        <div class="seg">
          <button data-act="set" data-path="audio.style" data-v="duck" aria-pressed="${a.style === 'duck'}">Lower my music</button>
          <button data-act="set" data-path="audio.style" data-v="mix" aria-pressed="${a.style === 'mix'}">Play over it</button>
        </div>
        <small>If a cue ever stops your music instead of lowering it, switch to “Play over it”.</small>
      </div>
      ${toggleHTML('audio.voice', 'Voice cues', '“Run”, “Walk”, “One minute to go”')}
      ${toggleHTML('audio.beeps', 'Countdown beeps', '3-2-1 before every switch')}
      ${toggleHTML('audio.updates', '5-minute updates', 'On long runs: “Ten minutes”')}
      ${toggleHTML('audio.vibrate', 'Vibrate on switch', 'Two long buzzes = run, three short = walk')}
      <button class="btn wide" data-act="test-sound">▶&nbsp; Test sound</button>
    </section>

    ${bike ? '' : `<section class="group"><h2>Cadence metronome</h2>
      <p class="note">Slightly quicker, shorter steps take load off knees and hips. First find your natural rhythm, then set the tick about 5% faster.</p>

      <div class="howto">
        <span class="eyebrow">Find your natural rhythm</span>
        <ol>
          <li>Leave the metronome <b>off</b> and do a normal run.</li>
          <li>In any run block, when the big clock reads <b>2:00</b>, start counting every time your <b>right foot</b> lands. Stop when it reads <b>1:30</b>. That’s 30 seconds.</li>
          <li>Run as you normally would while you count. Don’t speed up your feet.</li>
          <li>After the run, type the number in below.</li>
        </ol>
      </div>
      <label class="field"><span>Right-foot landings in 30 seconds</span>
        <div class="inp"><input id="footCount" type="number" inputmode="numeric" min="25" max="55" step="1" placeholder="e.g. 38" value="${m.natural ? Math.round(m.natural / 4) : ''}"><em>landings</em></div></label>
      <div class="count-read" id="countRead">${countReadHTML(m.natural)}</div>

      ${toggleHTML('metronome.on', 'Metronome during runs')}
      <div class="field"><span>Plays during</span>
        <div class="seg">
          <button data-act="set" data-path="metronome.scope" data-v="first" aria-pressed="${m.scope === 'first'}">First run block</button>
          <button data-act="set" data-path="metronome.scope" data-v="all" aria-pressed="${m.scope === 'all'}">Every run block</button>
        </div>
        <small>Start with the first block for a week or two. Once the rhythm feels natural, switch to every block.</small>
      </div>
      <div class="bpm">
        <button class="btn round" data-act="bpm" data-d="-1" aria-label="Slower">−</button>
        <div><b id="bpmVal">${m.bpm}</b><small>steps / min</small><em id="bpmRel">${bpmRelHTML()}</em></div>
        <button class="btn round" data-act="bpm" data-d="1" aria-label="Faster">+</button>
      </div>
      <label class="field"><span>Metronome volume <output id="mvolOut">${Math.round(m.volume * 100)}%</output></span>
        <input type="range" min="0" max="100" step="5" value="${Math.round(m.volume * 100)}" data-bind="metronome.volume" data-scale="100" data-out="mvolOut"></label>
      <button class="btn wide" data-act="test-metro">▶&nbsp; Test metronome</button>
      <p class="note" style="margin-top:14px">Match your steps to the tick by making each step a little shorter. Let your foot land the way it normally does. Deliberately running on your toes strains the calves and Achilles. Stay within 10% of your natural rhythm.</p>
    </section>`}

    <section class="group"><h2>Lifting</h2>
      <div class="field"><span>Next lift day</span>
        <div class="seg">${Lift.ORDER.map(d => `<button data-act="lift-day" data-v="${d}" aria-pressed="${d === liftCtx().day}">Day ${d}</button>`).join('')}</div>
        <small>Normally automatic: A → B → C, picking up where you left off.</small></div>
      <div class="field"><span>Rest between sets</span>
        <div class="seg">${Lift.REST_CHOICES.map(v => `<button data-act="set-num" data-path="lift.rest" data-v="${v}" aria-pressed="${Lift.mainRest(state) === v}">${v} s</button>`).join('')}</div>
        <small>For the 3-set exercises. The 2-set ones rest 60 s.</small></div>
      ${state.lift.phase2 !== null ? toggleHTML('lift.phase2', 'Phase 2 exercises', 'Romanian deadlift, Bulgarian split squat, 45° back extension') : ''}
      ${Object.keys(state.lift.swaps).length ? `<button class="btn wide" data-act="swaps-reset">Undo my exercise swaps (${Object.keys(state.lift.swaps).length})</button>` : ''}
      <button class="btn wide" data-act="plank-redo">${state.lift.plankDue ? 'Side plank test is due next lift' : 'Side plank test next lift'}</button>
    </section>

    <section class="group"><h2>Plan</h2>
      <label class="field"><span>Current ${bike ? 'bike' : 'run'} stage</span>
        <select id="stageSel">${(bike ? Bike.BIKE_STAGES : STAGES).map(s => `<option value="${s.n}" ${s.n === prog.stage ? 'selected' : ''}>Stage ${s.n}: ${esc(s.name)}</option>`).join('')}</select>
        <small>Moving yourself by hand resets the green count.</small></label>
    </section>

    <section class="group"><h2>Your data</h2>
      <p class="note">Your runs and lifts are stored only on this phone. Export a backup now and then, because clearing Chrome’s data would wipe them.</p>
      <div class="row"><button class="btn" data-act="export">Export backup</button><button class="btn" data-act="import">Import backup</button></div>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      <button class="btn danger wide" data-act="reset">Erase everything</button>
    </section>
    ${installEvt && !isStandalone() ? `<button class="btn primary wide" data-act="install">Install app</button>` : ''}
    <p class="foot">Run Coach · calorie and distance numbers are estimates.<br>Not medical advice. If something keeps hurting, see a physio.</p>`;
}

function onboardHTML() {
  const t = state.treadmill;
  return `<div class="onboard">
    <div class="brand big">Run<i>/</i>Coach</div>
    <p class="lede">A run/walk coach built for one person: you. Set it up once. Everything stays on this phone.</p>
    <form id="onboard" class="form" autocomplete="off" novalidate>
      <fieldset><legend>Units</legend>
        <div class="seg">
          <label><input type="radio" name="units" value="imperial" ${imp() ? 'checked' : ''}><span>mph · lb · mi</span></label>
          <label><input type="radio" name="units" value="metric" ${imp() ? '' : 'checked'}><span>km/h · kg · km</span></label>
        </div>
      </fieldset>
      <label class="field"><span>Your weight</span>
        <div class="inp"><input name="weight" type="number" inputmode="decimal" step="0.1" placeholder="e.g. 180" value="${state.profile.weight ?? ''}"><em data-u="w">${wUnit()}</em></div>
        <small>Only used to estimate calories.</small></label>
      <div class="grid3">
        <label class="field"><span>Walk speed</span><div class="inp"><input name="walkSpeed" type="number" inputmode="decimal" step="0.1" value="${t.walkSpeed}"><em data-u="s">${spUnit()}</em></div></label>
        <label class="field"><span>Run speed</span><div class="inp"><input name="runSpeed" type="number" inputmode="decimal" step="0.1" value="${t.runSpeed}"><em data-u="s">${spUnit()}</em></div></label>
        <label class="field"><span>Incline</span><div class="inp"><input name="incline" type="number" inputmode="decimal" step="0.5" value="${t.incline}"><em>%</em></div></label>
      </div>
      <p class="note">Your usual treadmill settings. You can change them any time, even after a run.</p>
      <label class="field"><span>Start at</span>
        <select name="stage">${STAGES.map(s => `<option value="${s.n}" ${s.n === (state.startStage || 1) ? 'selected' : ''}>Stage ${s.n}: ${esc(s.name)}</option>`).join('')}</select>
        <small>Stage 1 is 5 × (run 3 / walk 2), which you can already do comfortably.</small></label>
      <button class="start inline" type="submit"><span>Let’s go</span></button>
    </form>
  </div>`;
}

// ---- workout ---------------------------------------------------------------

function workoutHTML() {
  return `<div class="wk" data-type="warmup">
    <div class="wk-flash"></div>
    <header class="wk-top">
      <div class="wk-id"><b>${wk.mode === 'bike' ? 'Ride · ' : ''}Stage ${wk.stage}</b><span id="wkEl">0:00</span></div>
      ${TIME_SCALE > 1 ? `<span class="wk-fast">×${TIME_SCALE} test</span>` : ''}
      <button class="wk-end" data-act="wk-end">End</button>
    </header>
    <div class="wk-main">
      <div class="wk-phase" id="wkPhase">Warm up</div>
      <div class="wk-clock" id="wkClock"></div>
      <div class="wk-hint" id="wkHint"></div>
      <div class="wk-next" id="wkNext"></div>
    </div>
    <div class="wk-prof" id="wkProf"></div>
    <div class="wk-meta"><span id="wkLeft"></span><span id="wkMetro"></span><span id="wkKcal"></span></div>
    <div class="wk-ctrl">
      <button class="wk-btn hurt" data-act="wk-hurt"><i></i>Hurts</button>
      <button class="wk-btn main" data-act="wk-pause" id="wkPause">Pause</button>
      <button class="wk-btn" data-act="wk-skip">Skip ›</button>
    </div>
  </div>`;
}

function segHint(seg) {
  if (wk?.mode === 'bike') {
    const z = Bike.zoneOf(seg.type);
    if (wk.setup && seg.type === 'steady') return wk.unit === 'level'
      ? 'Find your steady level: <b>breathing harder, still talking in short sentences</b>, at 80–90 rpm. Remember the level.'
      : 'Find your steady effort: <b>breathing harder, still talking in short sentences</b>. Note the watts you settle on.';
    const w = zoneW(z, wk.power, wk.unit);
    return w ? `Aim for <b>${fmtP(w, wk.unit)}</b>${wk.unit === 'level' ? ' at 80–90 rpm' : ''} · ${Bike.ZONES[z].talk}` : Bike.ZONES[z].talk;
  }
  const t = state.treadmill;
  if (seg.fiveK) return `<b>${t.runSpeed} ${spUnit()}</b> · stop at <b>${imp() ? '3.11 mi' : '5.00 km'}</b> on the display, then tap Skip`;
  const sp = seg.type === 'run' ? t.runSpeed : t.walkSpeed;
  return `Treadmill <b>${sp} ${spUnit()}</b> · ${t.incline}% incline`;
}

const msToSec = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, Math.round(v / 1000)]));

async function startWorkout(c) {
  const segs = c.segs;
  const w = new Workout(segs, { scale: TIME_SCALE });
  wk = {
    w, mode: c.bike ? 'bike' : 'run', stage: c.prog.stage, segs, power: c.power || null, unit: c.unit || null, setup: !!c.setup,
    startedAt: Date.now(), maxPain: 0, where: new Set(), endedForPain: false, col: -1, clock: '', snapAt: 0, timer: null,
  };
  w.on('cue', onCue);
  w.on('segment', onSegment);
  w.on('done', () => finishWorkout(true));
  showScreen(workoutHTML());
  requestWakeLock();
  history.pushState({ wk: 1 }, '');
  try { await Promise.race([audio.unlock(), new Promise(r => setTimeout(r, 1500))]); } catch {}
  if (!wk || wk.w !== w) return;
  w.start();
  updateWorkoutUI();
  wk.timer = setInterval(loop, 100);
}

function loop() {
  if (!wk) return;
  wk.w.tick();
  if (!wk) return;
  updateWorkoutUI();
  if (Date.now() - wk.snapAt > 5000) {
    wk.snapAt = Date.now();
    store.saveActive(snapshot());
  }
}

function snapshot() {
  const w = wk.w;
  return {
    kind: 'workout', mode: wk.mode, stage: wk.stage, segs: wk.segs, power: wk.power, unit: wk.unit, setup: wk.setup, startedAt: wk.startedAt,
    spent: { ...w.spent }, byType: { ...w.byType }, pos: w.pos, maxPain: wk.maxPain, where: [...wk.where],
  };
}

function updateWorkoutUI() {
  const root = $('.wk');
  if (!wk || !root) return;
  const w = wk.w;
  const i = Math.min(w.idx, w.segs.length - 1);
  const clock = fmtClock(w.bounds[i + 1] - w.pos);
  if (clock !== wk.clock) {
    wk.clock = clock;
    $('#wkClock').innerHTML = clock.split('').map(ch => (ch === ':' ? '<i>:</i>' : `<span>${ch}</span>`)).join('');
  }
  $('#wkEl').textContent = fmtElapsed(w.pos);
  $('#wkLeft').textContent = `${fmtClock(w.total - w.pos)} left`;
  const k = wk.mode === 'bike'
    ? Bike.bikeKcal(msToSec(w.byType), wk.unit === 'watts' ? wk.power : null, state.profile.weight, units())
    : sessionTotals({ runSec: w.spent.run / 1000, walkSec: w.spent.walk / 1000 }, state.treadmill, state.profile.weight, units()).kcal;
  $('#wkKcal').textContent = `${k} kcal`;
  const col = matrixCol(wk.segs, w.pos);
  if (col !== wk.col) {
    wk.col = col;
    $('#wkProf').innerHTML = matrixHTML(wk.segs, w.pos);
  }
  root.classList.toggle('paused', w.paused);
  $('#wkPause').textContent = w.paused ? 'Resume' : 'Pause';
}

function onSegment(i) {
  const root = $('.wk');
  if (!wk || !root) return;
  const seg = wk.segs[i];
  root.dataset.type = seg.type;
  root.classList.remove('flashing');
  void root.offsetWidth;
  root.classList.add('flashing');
  $('#wkPhase').textContent = seg.fiveK ? 'Run 5K' : TYPE_LABEL[seg.type];
  $('#wkHint').innerHTML = segHint(seg);
  const nx = wk.segs[i + 1];
  const nxW = nx && wk.mode === 'bike' ? zoneW(Bike.zoneOf(nx.type), wk.power, wk.unit) : null;
  $('#wkNext').textContent = nx ? `Next · ${TYPE_LABEL[nx.type]} ${fmtClock(nx.sec * 1000)}${nxW ? ` · ${fmtP(nxW, wk.unit)}` : ''}` : 'Last block';
  setTheme({ run: THEME.run, walk: THEME.walk, steady: THEME.steady, strong: THEME.strong, hard: THEME.hard, easy: THEME.ezone }[seg.type] || THEME.easy);
  syncMetro();
}

function onCue(c) {
  if (c.kind === 'countdown') audio.countdown();
  else if (c.kind === 'vibe') audio.vibrate(WORK_TYPES.includes(c.type) ? [400, 150, 400] : [150, 100, 150, 100, 150]);
  else if (c.kind === 'voice') {
    if (c.update && !state.audio.updates) return;
    audio.say(c.clip);
  } else if (c.kind === 'done') {
    audio.say('done');
    audio.vibrate([700]);
  }
}

function syncMetro() {
  const m = state.metronome;
  const idx = wk?.w.idx;
  const inScope = m.scope === 'all' || idx === wk?.segs.findIndex(s => s.type === 'run');
  const on = !!wk && m.on && inScope && !wk.w.paused && wk.w.running && wk.segs[idx]?.type === 'run';
  if (on) audio.metroStart(m.bpm);
  else audio.metroStop();
  const label = $('#wkMetro');
  if (label) label.textContent = on ? `♩ ${m.bpm}` : '';
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {
    console.warn('Wake lock unavailable', e);
  }
}

function releaseWakeLock() {
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
}

function draftFrom(x) {
  const runSec = Math.round(x.spent.run / 1000);
  const walkSec = Math.round(x.spent.walk / 1000);
  const plannedRunSec = x.segs.filter(s => s.type === 'run').reduce((a, s) => a + s.sec, 0);
  return {
    id: uid(),
    at: new Date(x.startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    stage: x.stage,
    plannedSec: x.segs.reduce((a, s) => a + s.sec, 0),
    plannedRunSec,
    runSec,
    walkSec,
    completed: !x.endedForPain && runSec >= plannedRunSec * 0.9,
    endedForPain: !!x.endedForPain,
    pain: x.maxPain > 0 ? x.maxPain : null,
    where: x.where || [],
    worseDuring: false,
    limping: false,
    effort: null,
    notes: '',
    speeds: { ...state.treadmill },
    units: units(),
    weight: state.profile.weight,
  };
}

function bikeDraftFrom(x) {
  const byType = msToSec(x.byType);
  const workSec = Object.entries(byType).filter(([k]) => Bike.isWork(k)).reduce((a, [, v]) => a + v, 0);
  const plannedWorkSec = x.segs.filter(s => Bike.isWork(s.type)).reduce((a, s) => a + s.sec, 0);
  return {
    id: uid(),
    mode: 'bike',
    at: new Date(x.startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    stage: x.stage,
    plannedSec: x.segs.reduce((a, s) => a + s.sec, 0),
    plannedWorkSec,
    workSec,
    totalSec: Object.values(byType).reduce((a, v) => a + v, 0),
    byType,
    completed: !x.endedForPain && workSec >= plannedWorkSec * 0.9,
    endedForPain: !!x.endedForPain,
    pain: x.maxPain > 0 ? x.maxPain : null,
    where: x.where || [],
    worseDuring: false,
    limping: false,
    effort: null,
    notes: '',
    power: x.power || null,
    setup: !!x.setup,
    setPower: null,
    unit: x.unit || bunit(),
    watts: (x.unit || bunit()) === 'watts',
    units: units(),
    weight: state.profile.weight,
  };
}

const checkinFor = d => (d.mode === 'bike' ? bikeCheckinHTML() : checkinHTML());

function finishWorkout(natural) {
  if (!wk) return;
  const w = wk.w;
  if (!natural) w.end();
  clearInterval(wk.timer);
  audio.metroStop();
  releaseWakeLock();
  const x = { stage: wk.stage, segs: wk.segs, startedAt: wk.startedAt, spent: w.spent, byType: w.byType, power: wk.power, unit: wk.unit, setup: wk.setup, maxPain: wk.maxPain, where: [...wk.where], endedForPain: wk.endedForPain };
  draft = wk.mode === 'bike' ? bikeDraftFrom(x) : draftFrom(x);
  wk = null;
  store.saveActive({ kind: 'draft', startedAt: draft.at, draft });
  if (history.state?.wk) history.back();
  closeSheet();
  setTheme(THEME.base);
  showScreen(checkinFor(draft));
}

function hurtHTML() {
  const p = hurt.pain;
  const bike = wk?.mode === 'bike';
  return `<h3>${bike ? 'Ease right off' : 'Slow to a walk'}</h3>
    <p>${bike ? 'Drop the resistance and spin easy.' : 'Bring the treadmill down to walking speed.'} The timer is paused.</p>
    <span class="eyebrow">How bad is it right now?</span>
    <div class="painpad">${[...Array(11)].map((_, n) => `<button class="pp ${zone(n)}" data-act="hurt-pain" data-v="${n}" aria-pressed="${p === n}">${n}</button>`).join('')}</div>
    <span class="eyebrow">Where?</span>
    <div class="chips">${WHERE.map(x => `<button class="chip" data-act="hurt-where" data-v="${x}" aria-pressed="${hurt.where.has(x)}">${x}</button>`).join('')}</div>
    ${p >= 5 ? `<p class="stop">That’s a red day. Stop here${bike ? '' : ', walk it off,'} and log it.</p>` : ''}
    ${p >= 3 && p < 5 ? `<p class="note warn">${bike ? 'Spin easy' : 'Walk'} for a minute. If it settles, carry on. If it doesn’t, end it here.</p>` : ''}
    <div class="sheet-btns">
      ${p !== null && p < 5 ? '<button class="btn primary" data-act="hurt-resume">Carry on</button>' : ''}
      <button class="btn ${p >= 5 ? 'danger' : ''}" data-act="hurt-end" ${p === null ? 'disabled' : ''}>End workout</button>
    </div>`;
}

function recordHurt() {
  wk.maxPain = Math.max(wk.maxPain, hurt.pain);
  hurt.where.forEach(x => wk.where.add(x));
}

// ---- check-in & result -----------------------------------------------------

function checkinHTML() {
  const d = draft, L = limits();
  const tot = sessionTotals(d, d.speeds, d.weight, d.units);
  return `<div class="ci">
    <header class="ci-head">
      <span class="eyebrow">Stage ${d.stage} · ${fmtTime(d.at)}</span>
      <h1>How did that go?</h1>
      <dl class="stats">
        <div><dt>Time</dt><dd>${Math.round((d.runSec + d.walkSec) / 60)}<small>min</small></dd></div>
        <div><dt>Running</dt><dd>${fmtMins(Math.round(d.runSec / 6) * 6)}<small>min</small></dd></div>
        <div><dt>Burn</dt><dd id="ciK">${tot.kcal}<small>kcal</small></dd></div>
        <div><dt>Distance</dt><dd id="ciD">${distVal(tot.distKm).toFixed(2)}<small>${dUnit()}</small></dd></div>
      </dl>
      ${d.completed ? '' : '<p class="note warn" style="margin:14px 0 0">You stopped short, so this one can’t count as green. That’s fine.</p>'}
    </header>

    <section class="q"><h2>Worst pain during the run</h2>
      <p class="note">0 = nothing at all. Count any ache, not just “injury”.</p>
      <div class="painpad">${[...Array(11)].map((_, n) => `<button class="pp ${zone(n)}" data-act="ci-pain" data-v="${n}" aria-pressed="${d.pain === n}">${n}</button>`).join('')}</div>
      <div class="scale-key"><span class="g">0–2 fine</span><span class="a">3–4 careful</span><span class="r">5+ stop</span></div>
    </section>

    <section class="q" id="ciWhere" ${d.pain ? '' : 'hidden'}><h2>Where?</h2>
      <div class="chips">${WHERE.map(x => `<button class="chip" data-act="ci-where" data-v="${x}" aria-pressed="${d.where.includes(x)}">${x}</button>`).join('')}</div>
      <div class="chips flags">
        <button class="chip" data-act="ci-flag" data-v="worseDuring" aria-pressed="${d.worseDuring}">Got worse as I kept going</button>
        <button class="chip" data-act="ci-flag" data-v="limping" aria-pressed="${d.limping}">Limping or changed my stride</button>
      </div>
    </section>

    <section class="q"><h2>How hard did it feel?</h2>
      <div class="choices">
        <button class="choice" data-act="ci-effort" data-v="easy" aria-pressed="${d.effort === 'easy'}"><b>Easy</b><small>Could chat in full sentences</small></button>
        <button class="choice" data-act="ci-effort" data-v="ok" aria-pressed="${d.effort === 'ok'}"><b>OK</b><small>Short sentences</small></button>
        <button class="choice" data-act="ci-effort" data-v="hard" aria-pressed="${d.effort === 'hard'}"><b>Hard</b><small>A few words at a time</small></button>
      </div>
    </section>

    <details class="q more"><summary>Different treadmill numbers today?</summary>
      <div class="grid3">
        <label class="field"><span>Walk</span><div class="inp"><input id="ciWalk" type="number" inputmode="decimal" min="${L.walk[0]}" max="${L.walk[1]}" step="0.1" value="${d.speeds.walkSpeed}"><em>${spUnit()}</em></div></label>
        <label class="field"><span>Run</span><div class="inp"><input id="ciRun" type="number" inputmode="decimal" min="${L.run[0]}" max="${L.run[1]}" step="0.1" value="${d.speeds.runSpeed}"><em>${spUnit()}</em></div></label>
        <label class="field"><span>Incline</span><div class="inp"><input id="ciInc" type="number" inputmode="decimal" min="0" max="15" step="0.5" value="${d.speeds.incline}"><em>%</em></div></label>
      </div>
      <label class="check"><input type="checkbox" id="ciKeep" checked> Use these next time too</label>
    </details>

    <section class="q"><h2>Notes <small>optional</small></h2>
      <textarea id="ciNotes" rows="2" maxlength="500" placeholder="Left knee twinge at minute 12, new shoes…">${esc(d.notes)}</textarea>
    </section>

    <button class="start inline" data-act="ci-save"><span>Save</span></button>
  </div>`;
}

function bikeCheckinHTML() {
  const d = draft;
  const unit = Bike.sessionUnit(d), U = Bike.UNITS[unit];
  const p = d.setPower || d.power;
  const kcal = d.kcalBike ?? Bike.bikeKcal(d.byType, unit === 'watts' ? p : null, d.weight, d.units);
  const needW = d.setup && !!U;
  return `<div class="ci">
    <header class="ci-head">
      <span class="eyebrow">Ride · stage ${d.stage} · ${fmtTime(d.at)}</span>
      <h1>How did that go?</h1>
      <dl class="stats">
        <div><dt>Time</dt><dd>${Math.round(d.totalSec / 60)}<small>min</small></dd></div>
        <div><dt>Working</dt><dd>${fmtMins(Math.round(d.workSec / 6) * 6)}<small>min</small></dd></div>
        <div><dt>Burn</dt><dd id="ciK">${kcal}<small>kcal</small></dd></div>
        ${steadyStat(p, unit)}
      </dl>
      ${d.completed ? '' : '<p class="note warn" style="margin:14px 0 0">You stopped short, so this one can’t count as green. That’s fine.</p>'}
    </header>

    ${needW ? `<section class="q"><h2>Your steady ${unit === 'level' ? 'level' : 'watts'}</h2>
      <p class="note">${unit === 'level' ? 'The level you rode the steady part at, at 80–90 rpm.' : 'The watts you held in the steady part, from the bike’s screen.'} Every target from now on is set from this.</p>
      <div class="inp ci-w"><input id="ciW" type="number" inputmode="numeric" min="${U.min}" max="${U.max}" step="${U.step}" placeholder="${unit === 'level' ? 'e.g. 11' : 'e.g. 90'}" value="${d.setPower ?? ''}"><em>${unit === 'level' ? 'level' : 'W'}</em></div>
    </section>` : ''}

    <section class="q"><h2>Calories on the bike’s screen <small>optional</small></h2>
      <p class="note">Only if you entered your weight on the bike before starting. Otherwise leave it blank and the app estimates.</p>
      <div class="inp ci-w"><input id="ciCal" type="number" inputmode="numeric" min="10" max="2000" step="1" placeholder="e.g. 250" value="${d.kcalBike ?? ''}"><em>kcal</em></div>
    </section>

    <section class="q"><h2>Worst pain during the ride</h2>
      <p class="note">0 = nothing at all. Count any ache: knees, Achilles, hips, back.</p>
      <div class="painpad">${[...Array(11)].map((_, n) => `<button class="pp ${zone(n)}" data-act="ci-pain" data-v="${n}" aria-pressed="${d.pain === n}">${n}</button>`).join('')}</div>
      <div class="scale-key"><span class="g">0–2 fine</span><span class="a">3–4 careful</span><span class="r">5+ stop</span></div>
    </section>

    <section class="q" id="ciWhere" ${d.pain ? '' : 'hidden'}><h2>Where?</h2>
      <div class="chips">${WHERE.map(x => `<button class="chip" data-act="ci-where" data-v="${x}" aria-pressed="${d.where.includes(x)}">${x}</button>`).join('')}</div>
      <div class="chips flags">
        <button class="chip" data-act="ci-flag" data-v="worseDuring" aria-pressed="${d.worseDuring}">Got worse as I kept going</button>
      </div>
    </section>

    <section class="q"><h2>How did the targets feel?</h2>
      <div class="choices">
        <button class="choice" data-act="ci-effort" data-v="easy" aria-pressed="${d.effort === 'easy'}"><b>Easy</b><small>Could have pushed harder</small></button>
        <button class="choice" data-act="ci-effort" data-v="ok" aria-pressed="${d.effort === 'ok'}"><b>About right</b><small>Hard but doable</small></button>
        <button class="choice" data-act="ci-effort" data-v="hard" aria-pressed="${d.effort === 'hard'}"><b>Hard</b><small>Struggled to hold them</small></button>
      </div>
    </section>

    <section class="q"><h2>Notes <small>optional</small></h2>
      <textarea id="ciNotes" rows="2" maxlength="500" placeholder="Bike number, seat height, right Achilles fine…">${esc(d.notes)}</textarea>
    </section>

    <button class="start inline" data-act="ci-save"><span>Save</span></button>
  </div>`;
}

function bikeResultHTML(s, before) {
  const c = s.prelim;
  const unit = Bike.sessionUnit(s);
  let title, body;
  if (c === 'green') {
    const sim = JSON.parse(JSON.stringify(state));
    sim.sessions.find(x => x.id === s.id).morning = 'same';
    const after = Bike.bikeProgression(sim);
    title = 'Green';
    if (after.goal && !before.goal) body = 'If tomorrow morning feels normal, that’s your second green ride at stage 12. <b>Goal reached.</b>';
    else if (after.stage > before.stage) body = `If you feel normal tomorrow morning, you move up to <b>Stage ${after.stage}: ${esc(Bike.bikeStage(after.stage).name)}</b>.`;
    else body = 'Pain-free and on target. Tomorrow morning’s check-in confirms it, then one more green moves you up.';
    if (s.setPower) body += ` Your ${STEADY_WORD[unit]} is set at <b>${fmtP(s.setPower, unit)}</b>.`;
    else if (after.power && before.power && after.power > before.power) body += ` It felt easy, so your ${STEADY_WORD[unit]} goes up to <b>${fmtP(after.power, unit)}</b> once that’s confirmed.`;
  } else if (c === 'amber') {
    title = 'Amber';
    const why = !s.completed ? 'You stopped short of the full ride. ' : s.pain >= 3 ? `Pain reached ${s.pain}/10. ` : s.effort === 'hard' ? 'The targets felt hard. ' : '';
    body = `${why}You’ll repeat Stage ${s.stage} next time.${s.effort === 'hard' && !s.setPower && Bike.UNITS[unit] ? ` Your targets ease off ${unit === 'level' ? 'one level' : '5 W'} once tomorrow’s check is in.` : ''} That’s the plan working, not a setback.`;
    if (s.setPower) body += ` Your ${STEADY_WORD[unit]} is set at <b>${fmtP(s.setPower, unit)}</b>.`;
  } else {
    title = 'Red';
    body = `Take 2 days off the bike. Walking is fine. Your next ride drops back to <b>Stage ${Math.max(1, s.stage - 1)}</b>. If the pain lasts more than a few days or gets worse, get it checked by a physio.`;
  }
  const p = s.setPower || s.power;
  return `<div class="result ${c}">
    <div class="orb"></div>
    <span class="eyebrow">Ride · stage ${s.stage} logged</span>
    <h1>${title}</h1>
    <p>${body}</p>
    <dl class="stats">
      <div><dt>Working</dt><dd>${fmtMins(Math.round(s.workSec / 6) * 6)}<small>min</small></dd></div>
      <div><dt>Burn</dt><dd>${s.kcal}<small>kcal</small></dd></div>
      <div><dt>Pain</dt><dd>${s.pain}<small>/10</small></dd></div>
      ${steadyStat(p, unit)}
    </dl>
    ${afterRunHTML()}
  </div>`;
}

function resultHTML(s, before) {
  const c = s.prelim;
  let title, body;
  if (c === 'green') {
    const sim = JSON.parse(JSON.stringify(state));
    sim.sessions.find(x => x.id === s.id).morning = 'same';
    const after = progression(sim);
    title = 'Green';
    if (after.goal && !before.goal) body = 'If tomorrow morning feels normal, that’s your second green 5K in a row. <b>Goal reached.</b>';
    else if (after.stage > before.stage) body = `If you feel normal tomorrow morning, you move up to <b>Stage ${after.stage}: ${esc(stageInfo(after.stage).name)}</b>.`;
    else if (before.stage === MAX_STAGE) body = 'Another comfortable run at the top stage. Tomorrow morning’s check-in confirms it.';
    else body = 'Comfortable and pain-free. Tomorrow morning’s check-in confirms it, then one more green moves you up.';
  } else if (c === 'amber') {
    title = 'Amber';
    const why = !s.completed ? 'You stopped short of the full session. ' : s.pain >= 3 ? `Pain reached ${s.pain}/10. ` : s.effort === 'hard' ? 'It felt hard. ' : '';
    body = `${why}You’ll repeat Stage ${s.stage} next time. That’s the plan working, not a setback.`;
  } else {
    title = 'Red';
    body = `Take 2–3 days off running. Walking is fine. Your next run drops back to <b>Stage ${Math.max(1, s.stage - 1)}</b>. If the pain lasts more than a few days or gets worse, get it checked by a physio.`;
  }
  return `<div class="result ${c}">
    <div class="orb"></div>
    <span class="eyebrow">Stage ${s.stage} logged</span>
    <h1>${title}</h1>
    <p>${body}</p>
    <dl class="stats">
      <div><dt>Running</dt><dd>${fmtMins(Math.round(s.runSec / 6) * 6)}<small>min</small></dd></div>
      <div><dt>Distance</dt><dd>${distVal(s.distKm).toFixed(2)}<small>${dUnit()}</small></dd></div>
      <div><dt>Burn</dt><dd>${s.kcal}<small>kcal</small></dd></div>
      <div><dt>Pain</dt><dd>${s.pain}<small>/10</small></dd></div>
    </dl>
    ${afterRunHTML()}
  </div>`;
}

function celebrate(stage, bike = false) {
  if (stage) {
    openSheet(`<div class="celebrate">
      <span class="eyebrow">Unlocked</span>
      <div class="cel-num">Stage ${stage}</div>
      <p>${esc(bike ? Bike.bikeStage(stage).name : stageInfo(stage).name)}</p>
      ${matrixHTML(bike ? Bike.bikeSegments(stage) : buildSegments(stage, state.treadmill, units()))}
      <button class="btn primary wide" data-act="sheet-close">Let’s go</button>
    </div>`);
  } else {
    openSheet(`<div class="celebrate">
      <span class="eyebrow">Goal reached</span>
      <div class="cel-num">${bike ? '★' : '5K'}</div>
      <p>${bike ? 'Two green 35-minute strong rides. Pain-free.' : 'Two green 5Ks in a row. Comfortable, and pain-free.'}</p>
      <button class="btn primary wide" data-act="sheet-close">Nice</button>
    </div>`);
  }
  audio.vibrate([120, 80, 120, 80, 300]);
}

// ---- strength ----------------------------------------------------------------

const LEG_PAIN = ['Knee', 'Shin', 'Calf / Achilles', 'Hip'];
const STEP_LABEL = { ready: 'Get ready', hold: 'Hold', relax: 'Relax', rest: 'Rest', stretch: 'Stretch', manual: 'Your pace', test: 'As long as you can', warm: 'Warm up' };
const SIDE_LABEL = { left: 'Left side', right: 'Right side' };
const SHOULDER_TEXT = { fine: 'fine', sore: 'a bit sore', painful: 'painful' };
const MORNING_TEXT = { same: 'same or better', slightly: 'a bit worse', clearly: 'clearly worse' };

let ls = null;         // lift session in progress, or a stretch-only routine
let guide = null;      // primer / stretch step timer
let restT = null;      // rest between rounds
let lsTimer = null;
let tw = null;         // "something's tweaking" sheet state

const exName = id => EX[id]?.name ?? id;
const isLevel = id => EX[id].kind === 'level';
const fmtW = (id, w) => (w === null || w === undefined ? '?' : isLevel(id) ? `notch ${w}` : `${w} ${wUnit()}`);
const fmtSet = (id, s) => (EX[id].kind === 'reps' ? `${s.reps}` : EX[id].kind === 'carry' ? fmtW(id, s.w) : isLevel(id) ? `${s.reps} @ notch ${s.w}` : `${s.w} × ${s.reps}`);
const sortedCardio = () => [...state.sessions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
const activeItems = b => b.items.filter(i => !ls.skipped.includes(i.ex));
const stepsMin = steps => Math.round(Lift.stepsSeconds(steps) / 60);

function liftCtx(now = Date.now()) {
  const st = Lift.liftStatus(state, now);
  const r = sortedCardio().at(-1);
  st.legsRest = !!r && finalColor(r) === 'red' && (r.where || []).some(w => LEG_PAIN.includes(w));
  st.legsRestAfter = nounOf(r);
  return st;
}

function liftPlanFor(st, withRun) {
  const trim = withRun && cardioCtx().totalMin > 35;
  return { trim, plan: Lift.buildLift(state, st, { trim, noLegs: st.legsRest }) };
}

function backMorningHTML(s, ago) {
  return `<div class="card morning">
    <span class="eyebrow">Back check</span>
    <h3>How’s your back this morning?</h3>
    <p>Compared with before your lift ${ago === 1 ? 'yesterday' : 'on ' + fmtDay(s.at)}.</p>
    <div class="choices">
      <button class="choice green" data-act="lmorning" data-v="same"><b>Same or better</b><small>Usual stiffness</small></button>
      <button class="choice amber" data-act="lmorning" data-v="slightly"><b>Stiffer</b><small>Tighter than usual</small></button>
      <button class="choice red" data-act="lmorning" data-v="clearly"><b>Sore</b><small>Clearly worse</small></button>
    </div>
  </div>`;
}

// A bug in the lift card must never take the run screen down with it.
function safeHTML(fn) {
  try {
    return fn();
  } catch (e) {
    console.error(e);
    return card('red', 'Lift card error', 'Something went wrong showing today’s lift. Your runs are unaffected.');
  }
}

function liftCardHTML(st, block) {
  const saved = store.loadLift();
  if (saved) {
    return card('amber', 'Unfinished lift', `Day ${saved.day} from ${fmtTime(saved.startedAt)}. Pick up where you left off, or check in with what you did.`,
      `<button class="btn primary" data-act="lift-resume">Resume</button><button class="btn" data-act="lift-recover-ci">Check in</button><button class="btn ghost" data-act="lift-drop">Discard</button>`);
  }
  if (st.liftedToday) {
    const c = Lift.liftFinal(st.last);
    return `<section class="lift-card done"><span class="eyebrow">Lift · Day ${st.last.day}</span><h2>Done today</h2>
      <p>${(st.last.sets || []).length} sets · back ${st.last.back}/10${c === 'pending' ? ' · back check tomorrow morning' : ` · ${c}`}</p></section>`;
  }
  const { trim, plan } = liftPlanFor(st, true);
  const rows = plan.blocks.map((b, i) => `<li class="${b.optional ? 'opt' : ''}"><span class="lk">${b.optional ? '+' : i + 1}</span><span>${b.items.map(it => esc(exName(it.ex))).join(' <i>+</i> ')}${b.same ? ' <i>· same machine</i>' : ''}</span><em>${b.optional ? 'if time' : `${b.sets} sets`}</em></li>`).join('');
  const notes = [];
  if (st.reset) notes.push('<b class="r">Back reset day.</b> The primer plus seated, back-supported machines only.');
  else if (st.amber) notes.push('<b class="a">Amber back.</b> No weight increases on lifts that load your back.');
  if (st.shoulders === 'painful') notes.push('<b class="r">Shoulders painful.</b> Presses and raises swapped for the gentlest options.');
  else if (st.shoulders === 'sore') notes.push('<b class="a">Shoulders a bit sore.</b> No weight increases on presses and raises.');
  if (st.legsRest) notes.push(`<b class="a">Legs resting</b> after your red ${st.legsRestAfter}. Upper body only.`);
  if (st.plankDue) notes.push('<b>Side plank test</b> in today’s primer.');
  const setup = plan.blocks.flatMap(b => b.items).filter(i => Lift.target(state, i.ex, st).setup).length;
  if (setup) notes.push(`<b>Setup:</b> you’ll pick starting weights for ${setup} exercise${setup > 1 ? 's' : ''}.`);
  if (st.early) notes.push('First 2 weeks: finish every set with about 3 reps left in the tank.');
  if (trim) notes.push(`Long ${isBike() ? 'ride' : 'run'} today, so the lift is trimmed to 2 sets each.`);
  const days = Lift.ORDER.map(d => `<button data-act="lift-day" data-v="${d}" aria-pressed="${d === st.day}">${d}</button>`).join('');
  const primerMin = stepsMin(Lift.primerSteps({ weak: st.weak, test: st.plankDue }));
  const stretchMin = stepsMin(Lift.dayStretchSteps(st.day, st.weak));
  return `<section class="lift-card">
    <div class="hero-top"><span class="eyebrow">Lift · Day ${st.day}</span><div class="daypick" role="group" aria-label="Lift day">${days}</div></div>
    <ol class="lift-list">${rows}</ol>
    <p class="lift-meta">Primer ≈ ${primerMin} min · lift ≈ ${Lift.liftMinutes(plan)} min · stretch ≈ ${stretchMin} min</p>
    ${notes.length ? `<ul class="lift-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : ''}
    <div class="lift-only"><button class="btn" data-act="lift-only" ${block ? 'disabled' : ''}>Lift only</button><small>${isBike()
      ? 'Starts with 5 min of easy spinning on the bike.'
      : 'Starts with 5 min on the bike. Has leg work, so leave 48 h before your next run.'}</small></div>
  </section>`;
}

function afterRunHTML() {
  const st = liftCtx();
  if (st.liftedToday || store.loadLift()) return '<button class="start inline" data-act="result-done"><span>Done</span></button>';
  return `<button class="start inline lift-go" data-act="lift-go"><span>Lift</span><small>Day ${st.day} · primer, lift, stretch</small></button>
    <div class="row after-run"><button class="btn" data-act="run-stretch">Stretch · ${stepsMin(Lift.runStretchSteps())} min</button><button class="btn ghost" data-act="result-done">Done for today</button></div>`;
}

// -- session ---------------------------------------------------------------------

function saveLs() {
  if (ls && ls.kind !== 'stretch') store.saveLift(ls);
}

function startLsLoop() {
  clearInterval(lsTimer);
  lsTimer = setInterval(lsLoop, 200);
}

function stopLsLoop() {
  clearInterval(lsTimer);
  lsTimer = null;
}

function lsLoop() {
  if (!ls) return stopLsLoop();
  const el = $('#lsEl');
  if (el) el.textContent = fmtElapsed(Date.now() - ls.startedAt);
  if (guide) {
    guide.tick();
    const c = guide && $('#gdClock');
    if (c) c.textContent = clockText();
  }
  if (restT) restTick();
}

function startLift(withRun) {
  const st = liftCtx();
  const { trim, plan } = liftPlanFor(st, withRun);
  if (!plan.blocks.length) return toast('Nothing safe to lift today. Rest up.');
  const targets = {};
  for (const b of plan.blocks) for (const i of b.items) targets[i.ex] = Lift.target(state, i.ex, st);
  ls = {
    id: uid(), day: plan.day, withRun, warm: !withRun, startedAt: Date.now(), plan, trim, noLegs: !!st.legsRest, reset: st.reset,
    st: { backColor: st.backColor, shoulders: st.shoulders }, early: st.early,
    phase: 'primer', ptr: { b: 0, r: 0, k: 0 }, sets: [], skipped: [], setupList: [], tweak: null,
    primer: false, cooldown: false, test: st.plankDue ? {} : null, weak: st.weak, targets, next: {}, cur: null, ci: null,
  };
  history.pushState({ ls: 1 }, '');
  requestWakeLock();
  startLsLoop();
  startGuide('primer');
}

function startGuide(phase) {
  const steps = phase === 'primer' ? Lift.primerSteps({ weak: ls.weak, test: !!ls.test, warm: ls.warm })
    : ls.kind === 'stretch' ? Lift.runStretchSteps() : Lift.dayStretchSteps(ls.day, ls.weak);
  ls.phase = phase;
  restT = null;
  guide = new Guide(steps, { scale: TIME_SCALE });
  guide.on('step', st => {
    if (st.voice) audio.say(st.voice);
    if (['hold', 'stretch', 'warm'].includes(st.kind)) audio.vibrate([180]);
    showScreen(guideHTML());
  });
  guide.on('beep', () => audio.countdown());
  guide.on('cap', st => finishTest(st.side));
  guide.on('done', () => phaseDone(phase));
  saveLs();
  guide.start();
}

function phaseDone(phase) {
  guide = null;
  if (ls.kind === 'stretch') return finishRunStretch();
  if (phase === 'primer') {
    ls.primer = true;
    ls.phase = 'lift';
    saveLs();
    return showLift();
  }
  ls.cooldown = true;
  toCheckin();
}

function finishTest(side) {
  if (guide?.step?.kind !== 'test') return;
  ls.test[side] = Math.max(1, Math.round(guide.up / 1000));
  audio.vibrate([300]);
  if (ls.test.left && ls.test.right) {
    state.planks.push({ at: new Date().toISOString(), left: ls.test.left, right: ls.test.right });
    state.lift.plankDue = false;
    persist();
    ls.weak = Lift.weakSide(state);
    toast(`Left ${ls.test.left} s · right ${ls.test.right} s · gap ${Lift.plankGap(state.planks.at(-1))}%`, 4500);
  }
  guide.next();
}

function finishRunStretch() {
  guide = null;
  stopLsLoop();
  releaseWakeLock();
  ls = null;
  hideScreen();
  view = 'today';
  render();
  toast('Stretched. Nice work.');
}

function clockText() {
  const st = guide?.step;
  if (!st || st.kind === 'manual') return '';
  return st.kind === 'test' ? fmtElapsed(guide.up) : fmtClock(guide.left);
}

const lsTopHTML = title => `<header class="ls-top">
    <div class="wk-id"><b>${esc(title)}</b><span id="lsEl">${fmtElapsed(Date.now() - ls.startedAt)}</span></div>
    ${TIME_SCALE > 1 ? `<span class="wk-fast">×${TIME_SCALE} test</span>` : ''}
    <button class="wk-end" data-act="ls-end">${ls.kind === 'stretch' ? 'Stop' : 'End'}</button>
  </header>`;

function guideHTML() {
  const st = guide.step;
  const info = Lift.stepInfo(st);
  const title = ls.phase === 'primer' ? (st.kind === 'warm' ? 'Warm-up' : 'Primer') : 'Stretch';
  const ctrl = st.kind === 'test' ? '<button class="wk-btn main" data-act="gd-stop">Stop</button>'
    : st.kind === 'manual' ? '<button class="wk-btn main" data-act="gd-next">Done ✓</button>'
    : `<button class="wk-btn" data-act="gd-pause" id="gdPause">${guide.paused ? 'Resume' : 'Pause'}</button><button class="wk-btn" data-act="gd-next">Next ›</button>`;
  return `<div class="ls gd k-${st.kind}${guide.paused ? ' paused' : ''}">
    ${lsTopHTML(title)}
    <div class="gd-bar"><i style="width:${Math.round(guide.i / guide.steps.length * 100)}%"></i></div>
    <div class="gd-main">
      ${info.fig ? `<div class="gd-fig">${figure(info.fig)}</div>` : ''}
      <span class="eyebrow">${esc(st.side ? SIDE_LABEL[st.side] : st.kind === 'test' ? 'Side plank test' : title)}</span>
      <h1>${esc(info.name)}</h1>
      <div class="gd-row"><span class="gd-state">${STEP_LABEL[st.kind]}</span><span class="gd-clock" id="gdClock">${clockText()}</span></div>
      ${st.label ? `<p class="gd-label">${esc(st.label)}</p>` : ''}
      ${st.kind === 'test' ? '<p class="gd-label">Stop when your form starts to slip, or at any back discomfort. Caps at 90 s.</p>' : ''}
      <p class="gd-cue">${esc(info.cue)}</p>
      <p class="why"><b>Why it’s good for you:</b> ${esc(info.why)}</p>
    </div>
    <div class="ls-ctrl">${ctrl}</div>
    <button class="ls-skip" data-act="ls-skip-part">Skip ${ls.phase === 'primer' ? 'the primer' : 'the stretches'} ›</button>
  </div>`;
}

// -- lifting ---------------------------------------------------------------------

function curItem() {
  const b = ls.plan.blocks[ls.ptr.b];
  const items = activeItems(b);
  return { b, items, item: items[ls.ptr.k] };
}

function setDefaults(ex) {
  const t = ls.targets[ex] || {};
  const nx = ls.next[ex];
  const last = t.last?.[ls.ptr.r] || t.last?.at(-1);
  const w = EX[ex].kind === 'reps' ? null : nx?.w ?? t.w ?? null;
  let reps = nx?.reps ?? (t.setup ? 10 : t.change === 'same' && last ? last.reps : EX[ex].reps[0]);
  if (EX[ex].kind === 'carry') reps = 1;
  return { w, reps };
}

function syncCur() {
  if (!ls?.cur) return;
  const w = $('#ls_w'), r = $('#ls_r');
  if (w) ls.cur.w = w.value === '' ? null : parseFloat(w.value);
  if (r) ls.cur.reps = r.value === '' ? null : parseInt(r.value, 10);
}

const restOf = b => b.rest ?? Lift.mainRest(state);

function nextLabel() {
  const p = ls.ptr, blocks = ls.plan.blocks, b = blocks[p.b];
  const items = activeItems(b);
  if (p.k + 1 < items.length) return `Then ${exName(items[p.k + 1].ex)}`;
  if (p.r + 1 < b.sets) return `Then rest ${restOf(b)} s`;
  const nb = blocks.slice(p.b + 1).find(x => activeItems(x).length);
  return nb ? `Then: ${exName(activeItems(nb)[0].ex)}` : 'Then stretch';
}

const stepperHTML = (k, label, v, unit) => `<div class="stp"><span>${label}</span>
  <div class="stp-row">
    <button class="stp-b" data-act="ls-step" data-k="${k}" data-d="-1" aria-label="Less">−</button>
    <input id="ls_${k}" type="number" inputmode="decimal" step="any" min="0" value="${v ?? ''}" placeholder="?">
    <button class="stp-b" data-act="ls-step" data-k="${k}" data-d="1" aria-label="More">+</button>
  </div>${unit ? `<em>${unit}</em>` : ''}</div>`;

function planListHTML() {
  const p = ls.ptr;
  return `<ol class="ls-plan">${ls.plan.blocks.map((b, bi) => b.items.map((it, k) => {
    const done = ls.sets.filter(s => s.ex === it.ex).length;
    const skipped = ls.skipped.includes(it.ex);
    const now = bi === p.b && activeItems(b)[p.k]?.ex === it.ex && ls.phase !== 'rest';
    const dots = [...Array(b.sets)].map((_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('');
    return `<li class="${skipped ? 'skip' : ''}${now ? ' now' : ''}"><span class="lk">${b.optional ? '+' : bi + 1}</span><span>${esc(exName(it.ex))}</span><span class="dots">${dots}</span></li>`;
  }).join('')).join('')}</ol>`;
}

function liftHTML() {
  const { b, item } = curItem();
  const ex = item.ex, e = EX[ex], t = ls.targets[ex] || {};
  ls.cur ||= setDefaults(ex);
  const [lo, hi] = e.reps;
  const range = e.kind === 'carry' ? '30–40 m each hand' : `${lo}–${hi} reps${e.perSide ? ' each side' : ''}`;
  const extraTrip = e.kind === 'carry' && ls.weak ? ` + 1 extra trip with the weight in your ${ls.weak === 'left' ? 'right' : 'left'} hand` : '';
  let tgt;
  if (t.setup && e.kind === 'carry') tgt = `<b>Setup:</b> pick a dumbbell you can carry 30–40 m standing tall, without leaning. ${b.sets} trips each hand${extraTrip}.`;
  else if (t.setup) tgt = '<b>Setup:</b> pick a weight you think you could lift about 12 times, and do 10. You’ll rate it after.';
  else if (e.kind === 'reps') tgt = `Each set: <b>${range}</b>`;
  else {
    const held = t.change === 'held' ? (e.press && ls.st.shoulders !== 'fine' ? 'shoulders' : 'back') : '';
    const tag = t.change === 'up' ? ' <span class="up">↑ up from last time</span>' : t.change === 'best' ? ' <span class="up">↑ based on your best set</span>' : t.change === 'down' ? ' <span class="dn">↓ eased off</span>' : held ? ` <span class="held">held for your ${held}</span>` : '';
    tgt = `Each set: <b>${range}</b>${extraTrip} at <b>${fmtW(ex, t.w)}</b>${tag}`;
  }
  const today = ls.sets.filter(s => s.ex === ex).map(s => fmtSet(ex, s));
  const lastLine = [t.last ? `Last time: ${t.last.map(s => fmtSet(ex, s)).join(', ')}` : '', today.length ? `Today: ${today.join(', ')}` : ''].filter(Boolean).join(' · ');
  const note = state.lift.notes[ex];
  const effort = e.kind === 'carry' ? '' : ls.early ? 'Leave about 3 reps in the tank.' : 'Leave 1–3 reps in the tank.';
  return `<div class="ls lift">
    ${lsTopHTML(`Day ${ls.day}`)}
    <div class="ex">
      <div class="ex-head"><span class="eyebrow">Exercise ${ls.ptr.b + 1} of ${ls.plan.blocks.length}${b.optional ? ' · extra' : ''}</span>${e.alts?.length || EX[item.orig]?.alts?.length ? '<button class="btn small" data-act="ls-swap">Swap</button>' : ''}</div>
      <div class="setbar"><b>Set ${ls.ptr.r + 1}</b><span>of ${b.sets}</span><span class="dots">${[...Array(b.sets)].map((_, i) => `<i class="${i < ls.ptr.r ? 'on' : i === ls.ptr.r ? 'cur' : ''}"></i>`).join('')}</span></div>
      ${b.same && ls.ptr.r === 0 ? `<p class="ex-same">${esc(b.same)}</p>` : ''}
      <div class="ex-fig">${figure(e.fig)}</div>
      <h1>${esc(e.name)}</h1>
      <p class="why"><b>Why it’s good for you:</b> ${esc(e.why)}</p>
      <p class="ex-cue">${esc(e.cue)} ${effort}</p>
      <p class="ex-target">${tgt}</p>
      ${lastLine ? `<p class="ex-last">${lastLine}</p>` : ''}
      ${note ? `<p class="ex-note"><b>Your notes:</b> ${esc(note)}</p>` : ''}
      <div class="ex-in">
        ${e.kind !== 'reps' ? stepperHTML('w', isLevel(ex) ? 'Bar notch' : e.dir === -1 ? 'Assist' : 'Weight', ls.cur.w, isLevel(ex) ? 'lower = harder' : wUnit()) : ''}
        ${e.kind !== 'carry' ? stepperHTML('r', e.perSide ? 'Reps each side' : 'Reps', ls.cur.reps, '') : ''}
      </div>
      <button class="start inline" data-act="ls-done"><span>Done ✓</span><small>${esc(nextLabel())}</small></button>
      <div class="ex-tools">
        <button data-act="ls-note">${note ? 'Edit notes' : 'Machine notes'}</button>
        <button data-act="ls-skip">Skip exercise</button>
        <button class="tw" data-act="ls-tweak"><i></i>Something’s tweaking</button>
      </div>
    </div>
    ${planListHTML()}
  </div>`;
}

function showLift() {
  ls.phase = 'lift';
  showScreen(liftHTML());
}

function advance() {
  const p = ls.ptr, b = ls.plan.blocks[p.b];
  p.k++;
  ls.cur = null;
  if (p.k < activeItems(b).length) { saveLs(); return showLift(); }
  p.k = 0;
  p.r++;
  if (p.r < b.sets) { saveLs(); return startRest(restOf(b)); }
  nextBlock(restOf(b));
}

function nextBlock(restSec) {
  const p = ls.ptr, blocks = ls.plan.blocks;
  p.b++;
  p.r = 0;
  p.k = 0;
  ls.cur = null;
  while (p.b < blocks.length && !activeItems(blocks[p.b]).length) p.b++;
  saveLs();
  if (p.b >= blocks.length) return startGuide('cooldown');
  if (blocks[p.b].optional && !ls.optAsked) return askOptional();
  startRest(Math.min(restSec, 60));
}

function askOptional() {
  const opt = ls.plan.blocks.slice(ls.ptr.b).filter(x => x.optional && activeItems(x).length);
  const min = Lift.liftMinutes({ blocks: opt }, { optional: true });
  openSheet(`<h3>Got ${min} more minutes?</h3>
    <p>Optional: ${opt.map(x => esc(exName(activeItems(x)[0].ex))).join(', then ')}, ${opt[0].sets} sets each.</p>
    <div class="sheet-btns"><button class="btn" data-act="ls-opt" data-v="0">Skip, stretch</button><button class="btn primary" data-act="ls-opt" data-v="1">Do it</button></div>`, false);
}

function startRest(sec) {
  if (!sec) return showLift();
  restT = { end: Date.now() + sec * 1000 / TIME_SCALE, beeped: false };
  ls.phase = 'rest';
  showScreen(restHTML());
}

function restLeft() { return (restT.end - Date.now()) * TIME_SCALE; }

function restHTML() {
  const { b, item } = curItem();
  return `<div class="ls rest">
    ${lsTopHTML(`Day ${ls.day}`)}
    <div class="rest-main">
      <span class="eyebrow">Rest</span>
      <div class="rest-clock" id="restClock">${fmtClock(restLeft())}</div>
      <p class="rest-next">${ls.ptr.r === 0 && ls.ptr.k === 0
        ? `Next exercise: <b>${esc(exName(item.ex))}</b> · ${b.sets} sets${b.same ? `<br>${esc(b.same)}` : ''}`
        : `Next: <b>${esc(exName(item.ex))}</b> · set ${ls.ptr.r + 1} of ${b.sets}`}</p>
      <div class="row"><button class="btn" data-act="rest-add">+15 s</button><button class="btn primary" data-act="rest-skip">Skip rest</button></div>
    </div>
    ${planListHTML()}
  </div>`;
}

function restTick() {
  const left = restLeft();
  const c = $('#restClock');
  if (c) c.textContent = fmtClock(left);
  if (!restT.beeped && left <= 3000) {
    restT.beeped = true;
    audio.countdown();
  }
  if (left <= 0) {
    restT = null;
    setTimeout(() => audio.say('restover'), 700);
    audio.vibrate([300, 120, 300]);
    showLift();
  }
}

// Swap what's left of today for back- or shoulder-safe options.
function applySafe(area) {
  const p = ls.ptr;
  ls.plan.blocks.forEach((b, bi) => {
    if (bi < p.b) return;
    b.items = b.items.map(it => {
      const e = EX[it.ex];
      let to = it.ex;
      if (area === 'back' && e.back === 'load') to = e.safe ?? null;
      if (area === 'shoulder' && e.press && e.shSafe !== it.ex) to = e.shSafe ?? null;
      if (to === it.ex) return it;
      if (!to) {
        ls.skipped.push(it.ex);
        return it;
      }
      ls.targets[to] ||= Lift.target(state, to, ls.st);
      return { ...it, ex: to };
    });
  });
  ls.cur = null;
  afterRemoval();
}

// After skipping or swapping out the current exercise, carry on from the right place.
function afterRemoval() {
  const p = ls.ptr, items = activeItems(ls.plan.blocks[p.b]);
  if (!items.length) return nextBlock(0);
  if (p.k >= items.length) {
    p.k = items.length - 1;
    return advance();
  }
  saveLs();
  showLift();
}

function tweakHTML() {
  const t = tw;
  return `<h3>Stop this exercise</h3>
    <p>Put the weight down. Where is it, and how bad is it right now?</p>
    <div class="chips">${['back', 'shoulder'].map(a => `<button class="chip" data-act="tw-area" data-v="${a}" aria-pressed="${t.area === a}">${a === 'back' ? 'Back' : 'Shoulder'}</button>`).join('')}</div>
    <div class="painpad">${[...Array(11)].map((_, n) => `<button class="pp ${zone(n)}" data-act="tw-pain" data-v="${n}" aria-pressed="${t.pain === n}">${n}</button>`).join('')}</div>
    ${t.pain >= 5 ? '<p class="stop">That’s a red day. End the lift here and check in.</p>' : t.pain !== null ? `<p class="note">The rest of today switches to ${t.area === 'shoulder' ? 'shoulder' : 'back'}-safe options.</p>` : ''}
    <div class="sheet-btns">
      <button class="btn" data-act="tw-cancel">Cancel</button>
      ${t.pain !== null && t.pain < 5 ? `<button class="btn primary" data-act="tw-safe" ${t.area ? '' : 'disabled'}>Switch &amp; carry on</button>` : ''}
      ${t.pain >= 5 ? `<button class="btn danger" data-act="tw-end" ${t.area ? '' : 'disabled'}>End lift</button>` : ''}
    </div>`;
}

function recordTweak() {
  const ex = curItem().item?.ex || null;
  if (!ls.tweak || tw.pain >= ls.tweak.pain) ls.tweak = { area: tw.area, pain: tw.pain, ex };
}

// -- check-in ----------------------------------------------------------------

function dropLift() {
  guide = null;
  restT = null;
  stopLsLoop();
  releaseWakeLock();
  ls = null;
  store.clearLift();
  closeSheet();
  if (history.state?.ls) history.back();
  hideScreen();
  render();
}

function toCheckin() {
  guide = null;
  restT = null;
  closeSheet();
  ls.phase = 'checkin';
  ls.endedAt ||= Date.now();
  ls.ci ||= { back: null, catch: false, radiating: false, shoulders: null, notes: '' };
  saveLs();
  stopLsLoop();
  releaseWakeLock();
  if (history.state?.ls) history.back();
  showScreen(liftCheckinHTML());
}

function liftCheckinHTML() {
  const c = ls.ci;
  const sec = Math.round((ls.endedAt - ls.startedAt) / 1000);
  return `<div class="ci">
    <header class="ci-head">
      <span class="eyebrow">Day ${ls.day} · ${fmtTime(ls.startedAt)}</span>
      <h1>How’s your back?</h1>
      <dl class="stats">
        <div><dt>Time</dt><dd>${Math.round(sec / 60)}<small>min</small></dd></div>
        <div><dt>Sets</dt><dd>${ls.sets.length}</dd></div>
        <div><dt>Burn</dt><dd>${Lift.liftKcal(sec, state.profile.weight, units())}<small>kcal</small></dd></div>
        <div><dt>Primer</dt><dd>${ls.primer ? '✓' : '–'}</dd></div>
      </dl>
    </header>
    <section class="q"><h2>Back after lifting</h2>
      <p class="note">0 = nothing. Your usual after-workout stiffness counts as 1–2.</p>
      <div class="painpad">${[...Array(11)].map((_, n) => `<button class="pp ${zone(n)}" data-act="lci-back" data-v="${n}" aria-pressed="${c.back === n}">${n}</button>`).join('')}</div>
      <div class="scale-key"><span class="g">0–2 fine</span><span class="a">3–4 careful</span><span class="r">5+ red</span></div>
      <div class="chips flags">
        <button class="chip" data-act="lci-flag" data-v="catch" aria-pressed="${c.catch}">Felt a catch or twinge</button>
        <button class="chip" data-act="lci-flag" data-v="radiating" aria-pressed="${c.radiating}">Pain spreading into my butt or leg</button>
      </div>
    </section>
    <section class="q"><h2>Shoulders</h2>
      <div class="choices">
        <button class="choice" data-act="lci-sh" data-v="fine" aria-pressed="${c.shoulders === 'fine'}"><b>Fine</b><small>Nothing new</small></button>
        <button class="choice" data-act="lci-sh" data-v="sore" aria-pressed="${c.shoulders === 'sore'}"><b>A bit sore</b><small>Achy, not sharp</small></button>
        <button class="choice" data-act="lci-sh" data-v="painful" aria-pressed="${c.shoulders === 'painful'}"><b>Painful</b><small>Sharp or pinching</small></button>
      </div>
    </section>
    <section class="q"><h2>Notes <small>optional</small></h2>
      <textarea id="lciNotes" rows="2" maxlength="500" placeholder="Leg press seat felt off, left shoulder tight on pulldowns…">${esc(c.notes)}</textarea>
    </section>
    <button class="start inline" data-act="lci-save"><span>Save</span></button>
  </div>`;
}

function liftResultHTML(s) {
  const c = s.prelim;
  const st = liftCtx();
  const title = { green: 'Green', amber: 'Amber', red: 'Red' }[c];
  let body;
  if (c === 'green') body = 'Your back stayed quiet. If it feels normal tomorrow morning, weights can go up next time.';
  else if (c === 'amber') body = `Back ${s.back}/10${s.tweak?.area === 'back' ? ' and a tweak' : ''}. Next lift: no weight increases on lifts that load your back. Everything else carries on.`;
  else {
    body = 'Next lift is a back reset day: the primer plus seated, back-supported machines only. If you get numbness, tingling or weakness in a leg, or pain that wakes you at night, get it checked. Any change in bladder or bowel control: go to the ER the same day.';
    if (st.reds >= 2) body += ' <b>Two red back days in a row: worth seeing a physio.</b>';
  }
  const sh = s.shoulders === 'sore' ? '<p class="note warn">Shoulders a bit sore: no weight increases on presses and raises next time.</p>'
    : s.shoulders === 'painful' ? `<p class="note warn">Shoulders painful: presses and raises swap to the gentlest options until they’re fine.${st.painful >= 2 ? ' Twice in a row now: worth seeing a physio.' : ''}</p>` : '';
  const setup = s.setup?.length ? `<p class="note">Starting weights saved for ${s.setup.length} exercise${s.setup.length > 1 ? 's' : ''}.</p>` : '';
  return `<div class="result ${c}">
    <div class="orb"></div>
    <span class="eyebrow">Day ${s.day} logged</span>
    <h1>${title}</h1>
    <p>${body}</p>
    ${sh}${setup}
    <dl class="stats">
      <div><dt>Sets</dt><dd>${s.sets.length}</dd></div>
      <div><dt>Time</dt><dd>${Math.round(s.durSec / 60)}<small>min</small></dd></div>
      <div><dt>Burn</dt><dd>${s.kcal}<small>kcal</small></dd></div>
      <div><dt>Back</dt><dd>${s.back}<small>/10</small></dd></div>
    </dl>
    <button class="start inline" data-act="result-done"><span>Done</span></button>
  </div>`;
}

// -- progress ----------------------------------------------------------------

function sparkSVG(vals) {
  if (vals.length < 2) return '<span class="spark"></span>';
  const w = 84, h = 28, min = Math.min(...vals), max = Math.max(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 4 - (max === min ? 0.5 : (v - min) / (max - min)) * (h - 8)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

function topOf(id, sets) {
  const e = EX[id];
  if (e.kind === 'reps') return Math.max(...sets.map(s => s.reps));
  const ws = sets.map(s => s.w).filter(w => w !== null);
  return isLevel(id) || e.dir === -1 ? -Math.min(...ws) : Math.max(...ws);
}

function strengthHTML() {
  const lifts = [...state.lifts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const pk = state.planks.at(-1), first = state.planks[0];
  const plank = pk
    ? `<div class="plank">
        <div><small>Left</small><b>${pk.left}<i>s</i></b></div>
        <div><small>Right</small><b>${pk.right}<i>s</i></b></div>
        <div><small>Gap</small><b class="${Lift.plankGap(pk) <= 5 ? 'ok' : ''}">${Lift.plankGap(pk)}<i>%</i></b></div>
      </div>
      <p class="note">Goal: within about 5%. ${state.planks.length > 1 ? `First test, ${fmtDay(first.at)}: ${first.left} s / ${first.right} s (${Lift.plankGap(first)}% gap).` : 'Retested every 4 weeks in the primer.'}</p>`
    : '<p class="note">Your first side plank test happens in your first primer.</p>';

  const ids = [...new Set(lifts.flatMap(s => (s.sets || []).map(x => x.ex)))].filter(id => EX[id]);
  const exRows = ids.map(id => {
    const h = Lift.history(state, id);
    const last = h.at(-1);
    return `<li class="exr"><div><b>${esc(exName(id))}</b><small>${fmtDay(last.at)}: ${last.sets.map(s => fmtSet(id, s)).join(', ')}</small></div>${sparkSVG(h.slice(-10).map(x => topOf(id, x.sets)))}</li>`;
  }).join('');

  const rows = lifts.map(s => {
    const c = Lift.liftFinal(s);
    const byEx = [...new Set((s.sets || []).map(x => x.ex))].map(id => `${esc(exName(id))} ${s.sets.filter(x => x.ex === id).map(x => fmtSet(id, x)).join(', ')}`);
    return `<details class="hist">
      <summary><i class="dot ${c === 'pending' ? `pending ${s.prelim}` : c}"></i><span class="h-d">${fmtDay(s.at)}</span><span class="h-s">Day ${s.day}</span><span class="h-r">${(s.sets || []).length} sets</span><span class="h-k">${s.kcal} kcal</span></summary>
      <div class="h-b">
        <p>Back ${s.back}/10${s.catch ? ' · catch' : ''}${s.radiating ? ' · spreading pain' : ''} · shoulders ${SHOULDER_TEXT[s.shoulders] || '–'}${s.tweak ? ` · tweak: ${s.tweak.area} ${s.tweak.pain}/10` : ''}</p>
        <p>Next morning: ${s.morning ? MORNING_TEXT[s.morning] : s.prelim === 'red' ? 'n/a' : 'not answered yet'}</p>
        ${byEx.length ? `<p class="h-sets">${byEx.join('<br>')}</p>` : ''}
        ${s.notes ? `<p class="h-n">“${esc(s.notes)}”</p>` : ''}
        <button class="btn ghost small" data-act="ldel" data-id="${s.id}">Delete this lift</button>
      </div>
    </details>`;
  }).join('');

  return `
    <section class="group"><h2>Side plank balance</h2>${plank}</section>
    <section class="group"><h2>Strength</h2>
      ${exRows ? `<ul class="exlist">${exRows}</ul><p class="note" style="margin-top:10px">Lines show your best set per session. Holding steady while you lose weight counts as a win.</p>` : '<p class="note">No lifts yet. Your first one will show up here.</p>'}
    </section>
    ${rows ? `<section class="group"><h2>Lift history</h2>${rows}</section>` : ''}`;
}

// ---- settings helpers ------------------------------------------------------

// Right-foot landings in 30 s × 4 = total steps per minute.
function countReadHTML(natural) {
  if (!natural) return '<p class="note">Enter your count to get your target rhythm.</p>';
  const target = Math.min(200, Math.max(120, Math.round(natural * 1.05)));
  return `<div class="cr-row">
      <div><small>Natural</small><b>${natural}</b></div>
      <div><small>Target +5%</small><b>${target}</b></div>
      <button class="btn primary" data-act="count-use" data-n="${natural}">Use ${target}</button>
    </div>`;
}

function bpmRelHTML() {
  const { bpm, natural } = state.metronome;
  if (!natural) return '';
  const pct = Math.round((bpm / natural - 1) * 100);
  const txt = `${pct >= 0 ? '+' : ''}${pct}% vs your natural ${natural}`;
  return pct > 10 ? `<span class="warn">${txt}. That’s too big a jump.</span>` : txt;
}

function setUnits(u) {
  if (u === units()) return;
  const toImp = u === 'imperial';
  const p = state.profile, t = state.treadmill;
  if (p.weight) p.weight = round1(toImp ? p.weight * LB_PER_KG : p.weight / LB_PER_KG);
  t.walkSpeed = round1(toImp ? t.walkSpeed / KM_PER_MI : t.walkSpeed * KM_PER_MI);
  t.runSpeed = round1(toImp ? t.runSpeed / KM_PER_MI : t.runSpeed * KM_PER_MI);
  for (const s of state.lifts) {
    for (const x of s.sets || []) {
      if (x.w !== null && EX[x.ex] && !isLevel(x.ex)) x.w = round1(toImp ? x.w * LB_PER_KG : x.w / LB_PER_KG);
    }
  }
  p.units = u;
}

function commitBind(el, save = true) {
  let v = Number(el.value);
  if (el.type === 'number') {
    if (el.value === '' || !Number.isFinite(v) || v < +el.min || v > +el.max) {
      el.classList.add('bad');
      toast(`Enter a number from ${el.min} to ${el.max}`);
      return;
    }
    el.classList.remove('bad');
  }
  v /= Number(el.dataset.scale) || 1;
  setPath(state, el.dataset.bind, v);
  if (el.dataset.out) $('#' + el.dataset.out).textContent = `${Math.round(v * 100)}%`;
  if (save) persist();
}

async function changeStage(n, el) {
  const bike = isBike();
  const prog = bike ? Bike.bikeProgression(state) : progression(state);
  if (n === prog.stage) return;
  const name = bike ? Bike.bikeStage(n).name : stageInfo(n).name;
  const ok = await ask(`Move to stage ${n}?`, `${esc(name)}. Your green count starts again from zero.`,
    [{ label: 'Cancel', value: false }, { label: 'Move', value: true, cls: 'primary' }]);
  if (!ok) { el.value = String(prog.stage); return; }
  (bike ? state.bike.overrides : state.overrides).push({ at: new Date().toISOString(), stage: n });
  persist();
  render();
  toast(`Now on stage ${n}`);
}

async function importFile(file) {
  if (!file) return;
  try {
    const next = store.fromBackup(await file.text());
    const ok = await ask('Replace your data?', `This backup has ${next.sessions.length} runs and ${next.lifts.length} lifts. It replaces everything on this phone.`,
      [{ label: 'Cancel', value: false }, { label: 'Replace', value: true, cls: 'danger' }]);
    if (!ok) return;
    state = next;
    persist();
    render();
    toast('Backup restored');
  } catch {
    toast('That file isn’t a Run Coach backup');
  } finally {
    $('#importFile').value = '';
  }
}

function onboardUnits(u) {
  const f = $('#onboard');
  const toImp = u === 'imperial';
  const conv = (name, fn) => { const el = f.elements[name]; if (el.value !== '') el.value = round1(fn(+el.value)); };
  conv('weight', w => (toImp ? w * LB_PER_KG : w / LB_PER_KG));
  conv('walkSpeed', s => (toImp ? s / KM_PER_MI : s * KM_PER_MI));
  conv('runSpeed', s => (toImp ? s / KM_PER_MI : s * KM_PER_MI));
  $$('[data-u=w]', f).forEach(e => { e.textContent = toImp ? 'lb' : 'kg'; });
  $$('[data-u=s]', f).forEach(e => { e.textContent = toImp ? 'mph' : 'km/h'; });
}

// ---- actions ---------------------------------------------------------------

const actions = {
  async start() {
    audio.unlock();
    const now = Date.now();
    const c = cardioCtx(now);
    const rest = c.rest;
    if (c.bike) {
      if (rest) {
        const ok = await ask('Your body flagged pain', `Your last ride was a red day. The plan says rest until ${fmtDay(rest.until)}.`,
          [{ label: 'Rest instead', value: false, cls: 'primary' }, { label: 'Ride anyway', value: true }]);
        if (!ok) return;
      }
      return startWorkout(c);
    }
    if (rest) {
      const ok = await ask(
        rest.kind === 'red' ? 'Your body flagged pain' : 'Rest day?',
        rest.kind === 'red'
          ? `Your last run was a red day. The plan says rest until ${fmtDay(rest.until)}.`
          : `You ran ${rest.since === 0 ? 'today' : 'yesterday'}. Shins and Achilles do better with a day off between runs.`,
        [{ label: 'Rest instead', value: false, cls: 'primary' }, { label: 'Run anyway', value: true }]);
      if (!ok) return;
    } else {
      const st = liftCtx(now);
      if (st.last && !st.last.withRun && !st.last.noLegs && daysBetween(st.lastT, now) === 1) {
        const ok = await ask('Leg work yesterday', 'You lifted with leg work yesterday. Legs do better with 48 hours before a run.',
          [{ label: 'Rest instead', value: false, cls: 'primary' }, { label: 'Run anyway', value: true }]);
        if (!ok) return;
      }
    }
    startWorkout(c);
  },

  morning(el) {
    const s = state.sessions.find(needsMorning);
    if (!s) return;
    const bike = s.mode === 'bike';
    const prog = bike ? Bike.bikeProgression : progression;
    const before = prog(state);
    s.morning = el.dataset.v;
    s.morningAt = new Date().toISOString();
    persist();
    const after = prog(state);
    const c = finalColor(s);
    render();
    if (after.goal && !before.goal) celebrate(null, bike);
    else if (after.stage > before.stage) celebrate(after.stage, bike);
    else if (c === 'green') {
      const pw = bike && after.power && before.power && after.power > before.power ? (bunit() === 'level' ? ` Steady level up to ${after.power}.` : ` Steady power up to ${after.power} W.`) : '';
      toast(`<b>Green confirmed.</b>${after.streak === 1 ? ' One more to move up.' : ''}${pw}`);
    } else if (c === 'amber') toast('<b>Amber.</b> Same stage next time.');
    else toast(`<b>Red.</b> Rest ${bike ? '2 days' : '2–3 days'}. Dropping back one stage.`, 4500);
  },

  async install() {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch {}
    installEvt = null;
    render();
  },

  'recover-log'() {
    const a = store.loadActive();
    if (!a) return render();
    if (a.kind === 'draft') draft = a.draft;
    else {
      const x = { stage: a.stage, segs: a.segs, startedAt: a.startedAt, spent: a.spent, byType: a.byType, power: a.power, unit: a.unit, setup: a.setup, maxPain: a.maxPain, where: a.where, endedForPain: false };
      draft = a.mode === 'bike' ? bikeDraftFrom(x) : draftFrom(x);
      store.saveActive({ kind: 'draft', startedAt: draft.at, draft });
    }
    showScreen(checkinFor(draft));
  },

  async 'recover-drop'() {
    const ok = await ask('Discard it?', 'This workout won’t be logged.', [{ label: 'Keep', value: false, cls: 'primary' }, { label: 'Discard', value: true, cls: 'danger' }]);
    if (ok) { store.clearActive(); render(); }
  },

  // workout controls
  'wk-pause'() {
    if (!wk) return;
    const w = wk.w;
    if (w.paused) { w.resume(); audio.say('resumed'); } else { w.pause(); audio.say('paused'); }
    syncMetro();
    updateWorkoutUI();
  },

  'wk-skip'() {
    if (!wk) return;
    wk.w.skip();
    if (wk) updateWorkoutUI();
  },

  async 'wk-end'() {
    if (!wk) return;
    const ok = await ask('End workout?', 'What you’ve done so far still gets logged.',
      [{ label: 'Keep going', value: false, cls: 'primary' }, { label: 'End & log it', value: true, cls: 'danger' }]);
    if (ok && wk) finishWorkout(false);
  },

  'wk-hurt'() {
    if (!wk) return;
    if (!wk.w.paused) wk.w.pause();
    syncMetro();
    updateWorkoutUI();
    hurt = { pain: null, where: new Set() };
    openSheet(hurtHTML(), false);
  },

  'hurt-pain'(el) {
    hurt.pain = +el.dataset.v;
    $('#sheet .sheet-card').innerHTML = hurtHTML();
  },

  'hurt-where'(el) {
    const v = el.dataset.v;
    if (hurt.where.has(v)) hurt.where.delete(v); else hurt.where.add(v);
    el.setAttribute('aria-pressed', hurt.where.has(v));
  },

  'hurt-resume'() {
    if (!wk || hurt.pain === null) return;
    recordHurt();
    closeSheet();
    wk.w.resume();
    audio.say('resumed');
    syncMetro();
    updateWorkoutUI();
  },

  'hurt-end'() {
    if (!wk || hurt.pain === null) return;
    recordHurt();
    wk.endedForPain = hurt.pain >= 5;
    closeSheet();
    finishWorkout(false);
  },

  // check-in
  'ci-pain'(el) {
    draft.pain = +el.dataset.v;
    $$('[data-act=ci-pain]').forEach(b => b.setAttribute('aria-pressed', b === el));
    $('#ciWhere').hidden = draft.pain === 0;
  },

  'ci-where'(el) {
    const v = el.dataset.v;
    const i = draft.where.indexOf(v);
    if (i < 0) draft.where.push(v); else draft.where.splice(i, 1);
    el.setAttribute('aria-pressed', i < 0);
  },

  'ci-flag'(el) {
    const k = el.dataset.v;
    draft[k] = !draft[k];
    el.setAttribute('aria-pressed', draft[k]);
  },

  'ci-effort'(el) {
    draft.effort = el.dataset.v;
    $$('[data-act=ci-effort]').forEach(b => b.setAttribute('aria-pressed', b === el));
  },

  'ci-save'() {
    const d = draft;
    if (!d) return;
    if (d.pain === null) return toast('Pick your worst pain, 0 to 10');
    if (!d.effort) return toast('Pick how hard it felt');
    if (d.mode === 'bike') {
      const unit = Bike.sessionUnit(d), U = Bike.UNITS[unit];
      if (d.setup && U) {
        const v = Number($('#ciW').value);
        if (!(v >= U.min && v <= U.max)) return toast(unit === 'level' ? `Enter the level you rode, ${U.min} to ${U.max}` : `Enter the steady watts you held, ${U.min} to ${U.max}`);
        d.setPower = Math.round(v);
      }
      const calIn = $('#ciCal').value;
      const cal = calIn === '' ? null : Math.round(Number(calIn));
      if (cal !== null && !(cal >= 10 && cal <= 2000)) return toast('Bike calories should be 10 to 2,000, or leave it blank');
      d.kcalBike = cal;
      d.notes = $('#ciNotes').value.trim().slice(0, 500);
      if (d.pain === 0) { d.where = []; d.worseDuring = false; }
      d.kcal = cal ?? Bike.bikeKcal(d.byType, unit === 'watts' ? d.setPower || d.power : null, d.weight, d.units);
      d.prelim = prelimColor(d);
      const before = Bike.bikeProgression(state);
      state.sessions.push(d);
      persist();
      store.clearActive();
      draft = null;
      return showScreen(bikeResultHTML(d, before));
    }
    const L = limits();
    const walk = +$('#ciWalk').value, run = +$('#ciRun').value, inc = +$('#ciInc').value;
    const okNum = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
    if (!okNum(walk, L.walk) || !okNum(run, L.run) || !okNum(inc, [0, 15])) return toast('Check the treadmill numbers');
    d.speeds = { walkSpeed: walk, runSpeed: run, incline: inc };
    if ($('#ciKeep').checked) state.treadmill = { ...d.speeds };
    d.notes = $('#ciNotes').value.trim().slice(0, 500);
    if (d.pain === 0) { d.where = []; d.worseDuring = false; d.limping = false; }
    Object.assign(d, sessionTotals(d, d.speeds, d.weight, d.units));
    d.prelim = prelimColor(d);
    const before = progression(state);
    state.sessions.push(d);
    persist();
    store.clearActive();
    draft = null;
    showScreen(resultHTML(d, before));
  },

  'result-done'() {
    hideScreen();
    view = 'today';
    render();
    window.scrollTo(0, 0);
  },

  'sheet-close'() { closeSheet(); },

  // settings
  toggle(el) {
    const path = el.dataset.path;
    const v = !getPath(state, path);
    setPath(state, path, v);
    el.setAttribute('aria-checked', v);
    persist();
  },

  cardio(el) {
    state.cardio = el.dataset.v === 'run' ? 'run' : 'bike';
    persist();
    render();
    toast(isBike() ? 'Cardio: <b>bike</b>' : 'Cardio: <b>treadmill run</b>');
  },

  'bike-unit'(el) {
    state.bike.unit = el.dataset.v;
    persist();
    render();
    toast(state.bike.unit === 'feel' ? 'Bike: riding <b>by feel</b>' : `Bike targets in <b>${state.bike.unit === 'level' ? 'levels' : 'watts'}</b>`);
  },

  'power-set'() {
    const unit = bunit(), U = Bike.UNITS[unit];
    const v = Number($('#powerIn').value);
    if (!U || !(v >= U.min && v <= U.max)) return toast(unit === 'level' ? `Enter a level from ${U.min} to ${U.max}` : `Enter watts from ${U.min} to ${U.max}`);
    state.bike.overrides.push({ at: new Date().toISOString(), power: Math.round(v), unit });
    persist();
    render();
    toast(`${unit === 'level' ? 'Steady level' : 'Steady power'} set to <b>${fmtP(Math.round(v), unit)}</b>`);
  },

  async 'power-redo'() {
    const ok = await ask('Redo the setup ride?', bunit() === 'level' ? 'Your next ride finds your steady level again by feel, and you’ll enter the level afterwards.' : 'Your next ride finds your steady power again by feel, and you’ll enter the watts afterwards.',
      [{ label: 'Cancel', value: false }, { label: 'Redo it', value: true, cls: 'primary' }]);
    if (!ok) return;
    state.bike.overrides.push({ at: new Date().toISOString(), power: null, unit: bunit() });
    persist();
    render();
    toast('Next ride is a setup ride');
  },

  set(el) {
    setPath(state, el.dataset.path, el.dataset.v);
    $$(`[data-act=set][data-path="${el.dataset.path}"]`).forEach(b => b.setAttribute('aria-pressed', b === el));
    persist();
  },

  units(el) {
    setUnits(el.dataset.v);
    persist();
    render();
  },

  bpm(el) {
    const m = state.metronome;
    m.bpm = Math.min(200, Math.max(120, m.bpm + Number(el.dataset.d)));
    $('#bpmVal').textContent = m.bpm;
    $('#bpmRel').innerHTML = bpmRelHTML();
    persist();
  },

  'count-use'(el) {
    const m = state.metronome;
    m.natural = Number(el.dataset.n);
    m.bpm = Math.min(200, Math.max(120, Math.round(m.natural * 1.05)));
    persist();
    $('#bpmVal').textContent = m.bpm;
    $('#bpmRel').innerHTML = bpmRelHTML();
    toast(`Metronome set to <b>${m.bpm}</b>. Turn it on when you’re ready.`);
  },

  async 'test-sound'() {
    await audio.unlock();
    audio.say('test', true);
    setTimeout(() => audio.countdown(), 3000);
    setTimeout(() => audio.vibrate([400, 150, 400]), 6000);
  },

  async 'test-metro'() {
    await audio.unlock();
    audio.metroStart(state.metronome.bpm);
    setTimeout(() => { if (!wk) audio.metroStop(); }, 5000);
  },

  export() {
    const blob = new Blob([store.toBackup(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `run-coach-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  import() { $('#importFile').click(); },

  async reset() {
    const ok = await ask('Erase everything?', 'All runs and settings on this phone will be deleted. Export a backup first if you might want them.',
      [{ label: 'Cancel', value: false, cls: 'primary' }, { label: 'Erase', value: true, cls: 'danger' }]);
    if (!ok) return;
    store.wipe();
    state = store.load();
    view = 'today';
    $('#view').innerHTML = '';
    render();
  },

  async del(el) {
    const ok = await ask('Delete this run?', 'It’s removed from your history and the plan recalculates.',
      [{ label: 'Keep it', value: false, cls: 'primary' }, { label: 'Delete', value: true, cls: 'danger' }]);
    if (!ok) return;
    state.sessions = state.sessions.filter(s => s.id !== el.dataset.id);
    persist();
    render();
  },

  metric(el) {
    chartMetric = el.dataset.v;
    render();
  },

  'set-num'(el) {
    setPath(state, el.dataset.path, Number(el.dataset.v));
    $$(`[data-act=set-num][data-path="${el.dataset.path}"]`).forEach(b => b.setAttribute('aria-pressed', b === el));
    persist();
  },

  // strength: starting, recovering, today's choices
  'lift-go'() {
    hideScreen();
    render();
    startLift(true);
  },

  async 'lift-only'() {
    audio.unlock();
    const st = liftCtx();
    if (st.lastT !== null && daysBetween(st.lastT, Date.now()) === 1) {
      const ok = await ask('You lifted yesterday', 'Muscles do better with a day in between, and every lift works your whole body.',
        [{ label: 'Rest instead', value: false, cls: 'primary' }, { label: 'Lift anyway', value: true }]);
      if (!ok) return;
    }
    startLift(false);
  },

  'lift-day'(el) {
    state.lift.next = el.dataset.v;
    persist();
    render();
  },

  'run-stretch'() {
    hideScreen();
    render();
    audio.unlock();
    ls = { kind: 'stretch', startedAt: Date.now(), phase: 'cooldown' };
    requestWakeLock();
    startLsLoop();
    startGuide('cooldown');
  },

  'lift-resume'() {
    const a = store.loadLift();
    if (!a) return render();
    audio.unlock();
    ls = { ...a, cur: null };
    restT = null;
    guide = null;
    history.pushState({ ls: 1 }, '');
    requestWakeLock();
    startLsLoop();
    if (ls.phase === 'primer' || ls.phase === 'cooldown') return startGuide(ls.phase);
    if (ls.phase === 'checkin') return toCheckin();
    showLift();
  },

  'lift-recover-ci'() {
    const a = store.loadLift();
    if (!a) return render();
    ls = a;
    toCheckin();
  },

  async 'lift-drop'() {
    const ok = await ask('Discard this lift?', 'It won’t be logged.', [{ label: 'Keep', value: false, cls: 'primary' }, { label: 'Discard', value: true, cls: 'danger' }]);
    if (ok) { store.clearLift(); render(); }
  },

  lmorning(el) {
    const now = Date.now();
    const s = state.lifts.find(x => Lift.liftNeedsMorning(x) && daysBetween(x.at, now) >= 1);
    if (!s) return;
    s.morning = el.dataset.v;
    s.morningAt = new Date().toISOString();
    persist();
    render();
    const c = Lift.liftFinal(s);
    toast(c === 'green' ? '<b>Back: green.</b> Weights can go up next lift.'
      : c === 'amber' ? '<b>Back: amber.</b> No increases on back-loading lifts next time.'
      : '<b>Back: red.</b> Next lift is a back reset day.', 4000);
  },

  p2(el) {
    state.lift.phase2 = el.dataset.v === '1';
    persist();
    render();
    toast(state.lift.phase2 ? 'Phase 2 exercises added' : 'Staying with the current exercises. Change it any time in Settings.');
  },

  'plank-redo'() {
    state.lift.plankDue = true;
    persist();
    render();
    toast('Side plank test in your next primer');
  },

  'swaps-reset'() {
    state.lift.swaps = {};
    persist();
    render();
    toast('Back to the standard exercises');
  },

  async ldel(el) {
    const ok = await ask('Delete this lift?', 'It’s removed from your history, and weight suggestions recalculate.',
      [{ label: 'Keep it', value: false, cls: 'primary' }, { label: 'Delete', value: true, cls: 'danger' }]);
    if (!ok) return;
    state.lifts = state.lifts.filter(s => s.id !== el.dataset.id);
    persist();
    render();
  },

  // primer and stretches
  'gd-pause'() {
    if (!guide) return;
    if (guide.paused) guide.resume(); else guide.pause();
    $('#gdPause').textContent = guide.paused ? 'Resume' : 'Pause';
    $('.gd')?.classList.toggle('paused', guide.paused);
  },

  'gd-next'() { guide?.next(); },

  'gd-stop'() {
    if (guide?.step?.kind === 'test') finishTest(guide.step.side);
  },

  'ls-skip-part'() {
    if (!ls || !guide) return;
    const phase = ls.phase;
    guide = null;
    if (ls.kind === 'stretch') return finishRunStretch();
    if (phase === 'primer') { saveLs(); return showLift(); }
    toCheckin();
  },

  async 'ls-end'() {
    if (!ls) return;
    if (ls.kind === 'stretch') { guide = null; return finishRunStretch(); }
    const running = guide && !guide.paused;
    if (running) guide.pause();
    const btns = [{ label: 'Keep going', value: 'keep', cls: 'primary' }, { label: 'Check in', value: 'ci' }];
    if (!ls.sets.length) btns.push({ label: 'Discard', value: 'drop', cls: 'danger' });
    const v = await ask('End the session?', ls.sets.length ? 'You’ll check in with what you’ve done so far.' : 'Nothing logged yet.', btns);
    if (!ls) return;
    if (v === 'ci') return toCheckin();
    if (v === 'drop') return dropLift();
    if (running && guide) guide.resume();
  },

  // lifting
  'ls-step'(el) {
    if (!ls?.cur) return;
    syncCur();
    const ex = curItem().item.ex;
    const d = Number(el.dataset.d);
    if (el.dataset.k === 'w') {
      const inc = Lift.incOf(ex, units());
      ls.cur.w = Math.max(0, Math.round(((ls.cur.w ?? 0) + d * inc) * 100) / 100);
      $('#ls_w').value = ls.cur.w;
    } else {
      ls.cur.reps = Math.max(0, (ls.cur.reps ?? 0) + d);
      $('#ls_r').value = ls.cur.reps;
    }
  },

  'ls-done'() {
    if (!ls || ls.phase !== 'lift') return;
    syncCur();
    const { item } = curItem();
    const ex = item.ex, e = EX[ex];
    const w = e.kind === 'reps' ? null : ls.cur.w;
    const reps = e.kind === 'carry' ? 1 : ls.cur.reps;
    if (e.kind !== 'reps' && !(Number.isFinite(w) && w >= 0 && w <= 2000)) return toast(isLevel(ex) ? 'Enter the bar notch' : 'Enter the weight you used');
    if (!(Number.isInteger(reps) && reps >= 0 && reps <= 100)) return toast('Enter your reps');
    const set = { ex, orig: item.orig, w, reps, r: ls.ptr.r };
    ls.sets.push(set);
    ls.next[ex] = { w, reps };
    audio.vibrate([60]);
    if (ls.targets[ex]?.setup && e.kind !== 'carry') {
      if (!ls.setupList.includes(ex)) ls.setupList.push(ex);
      saveLs();
      openSheet(`<h3>How many more?</h3>
        <p>How many more reps could you have done with good form?</p>
        <div class="rir">${[0, 1, 2, 3, 4].map(n => `<button class="pp ${n <= 1 ? 'zr' : n >= 4 ? 'za' : ''}" data-act="ls-rir" data-v="${n}">${n === 4 ? '4+' : n}</button>`).join('')}</div>
        <p class="note">Most people guess about 1 rep low. Torn between two? Pick the higher one.</p>`, false);
      return;
    }
    saveLs();
    advance();
  },

  'ls-rir'(el) {
    const set = ls?.sets.at(-1);
    if (!set) return;
    set.rir = Number(el.dataset.v);
    if (set.w !== null) {
      const nw = Lift.setupNext(set.ex, set.w, set.rir, units());
      ls.next[set.ex] = { w: nw, reps: 10 };
      if (nw !== set.w) toast(`Next set: <b>${fmtW(set.ex, nw)}</b>`);
    }
    closeSheet();
    advance();
  },

  'ls-opt'(el) {
    closeSheet();
    ls.optAsked = true;
    if (el.dataset.v === '1') return startRest(45);
    ls.ptr.b = ls.plan.blocks.length;
    saveLs();
    startGuide('cooldown');
  },

  'ls-skip'() {
    if (!ls || ls.phase !== 'lift') return;
    ls.skipped.push(curItem().item.ex);
    ls.cur = null;
    afterRemoval();
  },

  'ls-swap'() {
    syncCur();
    const { item } = curItem();
    const opts = [...new Set([item.orig, ...(EX[item.orig]?.alts || []), ...(EX[item.ex].alts || [])])].filter(id => id !== item.ex && EX[id]);
    openSheet(`<h3>Swap exercise</h3>
      <p>Machine taken, or this one doesn’t agree with you? The app remembers your pick.</p>
      <div class="swaps">${opts.map(id => `<button class="swap-opt" data-act="ls-swap-to" data-v="${id}">${figure(EX[id].fig)}<span><b>${esc(EX[id].name)}</b><small>${esc(EX[id].why)}</small></span></button>`).join('')}</div>
      <button class="btn wide ghost" data-act="sheet-close">Cancel</button>`);
  },

  'ls-swap-to'(el) {
    const id = el.dataset.v;
    const { item } = curItem();
    if (id === item.orig) delete state.lift.swaps[item.orig]; else state.lift.swaps[item.orig] = id;
    persist();
    item.ex = id;
    ls.targets[id] ||= Lift.target(state, id, ls.st);
    ls.cur = null;
    closeSheet();
    saveLs();
    showLift();
    toast(`Swapped to ${esc(EX[id].name)}`);
  },

  'ls-note'() {
    syncCur();
    const ex = curItem().item.ex;
    openSheet(`<h3>Machine notes</h3>
      <p>${esc(EX[ex].name)}: seat height, pad position, which machine. Shown next time.</p>
      <textarea id="lsNote" rows="3" maxlength="200" placeholder="Seat 4, back pad 2">${esc(state.lift.notes[ex] || '')}</textarea>
      <div class="sheet-btns"><button class="btn" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="ls-note-save">Save</button></div>`);
  },

  'ls-note-save'() {
    const ex = curItem().item.ex;
    const v = $('#lsNote').value.trim().slice(0, 200);
    if (v) state.lift.notes[ex] = v; else delete state.lift.notes[ex];
    persist();
    closeSheet();
    showLift();
  },

  'ls-tweak'() {
    syncCur();
    tw = { area: null, pain: null };
    openSheet(tweakHTML(), false);
  },

  'tw-area'(el) {
    tw.area = el.dataset.v;
    $('#sheet .sheet-card').innerHTML = tweakHTML();
  },

  'tw-pain'(el) {
    tw.pain = Number(el.dataset.v);
    $('#sheet .sheet-card').innerHTML = tweakHTML();
  },

  'tw-cancel'() {
    tw = null;
    closeSheet();
  },

  'tw-safe'() {
    if (!tw?.area || tw.pain === null) return;
    recordTweak();
    const area = tw.area;
    tw = null;
    closeSheet();
    toast(`Switched the rest of today to ${area}-safe options`);
    applySafe(area);
  },

  'tw-end'() {
    if (!tw?.area) return;
    recordTweak();
    tw = null;
    toCheckin();
  },

  'rest-add'() {
    if (!restT) return;
    restT.end += 15000 / TIME_SCALE;
    if (restLeft() > 3000) restT.beeped = false;
  },

  'rest-skip'() {
    if (!restT) return;
    restT = null;
    showLift();
  },

  // lift check-in
  'lci-back'(el) {
    ls.ci.back = Number(el.dataset.v);
    $$('[data-act=lci-back]').forEach(b => b.setAttribute('aria-pressed', b === el));
  },

  'lci-flag'(el) {
    const k = el.dataset.v;
    ls.ci[k] = !ls.ci[k];
    el.setAttribute('aria-pressed', ls.ci[k]);
  },

  'lci-sh'(el) {
    ls.ci.shoulders = el.dataset.v;
    $$('[data-act=lci-sh]').forEach(b => b.setAttribute('aria-pressed', b === el));
  },

  'lci-save'() {
    if (!ls?.ci) return;
    const c = ls.ci;
    if (c.back === null) return toast('Pick your back score, 0 to 10');
    if (!c.shoulders) return toast('Pick how your shoulders feel');
    c.notes = $('#lciNotes').value.trim().slice(0, 500);
    const end = ls.endedAt || Date.now();
    const durSec = Math.round((end - ls.startedAt) / 1000);
    const s = {
      id: ls.id, at: new Date(ls.startedAt).toISOString(), endedAt: new Date(end).toISOString(),
      day: ls.day, withRun: !!ls.withRun, sets: ls.sets, skipped: ls.skipped, primer: !!ls.primer, cooldown: !!ls.cooldown, setup: ls.setupList || [],
      back: c.back, catch: c.catch, radiating: c.radiating, shoulders: c.shoulders, tweak: ls.tweak, notes: c.notes,
      durSec, kcal: Lift.liftKcal(durSec, state.profile.weight, units()), units: units(), weight: state.profile.weight,
      reset: !!ls.reset, trimmed: !!ls.trim, noLegs: !!ls.noLegs,
    };
    s.prelim = Lift.liftPrelim(s);
    state.lifts.push(s);
    state.lift.next = null;
    persist();
    store.clearLift();
    ls = null;
    showScreen(liftResultHTML(s));
  },
};

// ---- wiring ----------------------------------------------------------------

document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    view = tab.dataset.tab;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  actions[el.dataset.act]?.(el, e);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'stageSel') return changeStage(+el.value, el);
  if (el.id === 'importFile') return importFile(el.files[0]);
  if (el.name === 'units' && el.closest('#onboard')) return onboardUnits(el.value);
  if (el.dataset.bind) commitBind(el);
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.type === 'range' && el.dataset.bind) return commitBind(el, false);
  if (el.id === 'footCount') {
    const n = Math.round(Number(el.value));
    const ok = el.value !== '' && n >= 25 && n <= 55;
    el.classList.toggle('bad', el.value !== '' && !ok);
    $('#countRead').innerHTML = ok ? countReadHTML(n * 4)
      : el.value === '' ? countReadHTML(null) : '<p class="note warn">That’s outside the usual 25–55 range. Try counting again.</p>';
    return;
  }
  if (draft?.mode === 'bike' && (el.id === 'ciW' || el.id === 'ciCal')) {
    const unit = Bike.sessionUnit(draft);
    const calIn = $('#ciCal')?.value || '', cal = Number(calIn), v = Number($('#ciW')?.value);
    const k = calIn !== '' && cal >= 10 && cal <= 2000 ? Math.round(cal)
      : Bike.bikeKcal(draft.byType, unit === 'watts' ? (v >= 30 && v <= 400 ? v : draft.power) : null, draft.weight, draft.units);
    $('#ciK').innerHTML = `${k}<small>kcal</small>`;
    return;
  }
  if (draft && ['ciWalk', 'ciRun', 'ciInc'].includes(el.id)) {
    const sp = { walkSpeed: +$('#ciWalk').value || 0, runSpeed: +$('#ciRun').value || 0, incline: +$('#ciInc').value || 0 };
    const t = sessionTotals(draft, sp, draft.weight, draft.units);
    $('#ciK').innerHTML = `${t.kcal}<small>kcal</small>`;
    $('#ciD').innerHTML = `${distVal(t.distKm).toFixed(2)}<small>${dUnit()}</small>`;
  }
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'onboard') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const u = f.get('units') === 'metric' ? 'metric' : 'imperial';
  const L = LIMITS[u];
  const weight = +f.get('weight'), walk = +f.get('walkSpeed'), run = +f.get('runSpeed'), inc = +f.get('incline');
  const within = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
  const su = u === 'imperial' ? 'mph' : 'km/h';
  if (!within(weight, L.weight)) return toast(`Weight should be ${L.weight[0]}–${L.weight[1]} ${u === 'imperial' ? 'lb' : 'kg'}`);
  if (!within(walk, L.walk)) return toast(`Walk speed should be ${L.walk[0]}–${L.walk[1]} ${su}`);
  if (!within(run, L.run)) return toast(`Run speed should be ${L.run[0]}–${L.run[1]} ${su}`);
  if (run <= walk) return toast('Run speed should be faster than walk speed');
  if (!within(inc, [0, 15])) return toast('Incline should be 0–15%');
  state.profile = { units: u, weight };
  state.treadmill = { walkSpeed: walk, runSpeed: run, incline: inc };
  state.startStage = Math.min(MAX_STAGE, Math.max(1, +f.get('stage') || 1));
  state.onboarded = true;
  persist();
  hideScreen();
  render();
  navigator.storage?.persist?.().catch(() => {});
});

// Android back button mid-workout asks before leaving.
window.addEventListener('popstate', () => {
  if (wk) {
    history.pushState({ wk: 1 }, '');
    actions['wk-end']();
  } else if (ls && ls.kind !== 'stretch' && ls.phase !== 'checkin') {
    history.pushState({ ls: 1 }, '');
    actions['ls-end']();
  }
});

window.addEventListener('beforeunload', e => {
  if (wk) {
    store.saveActive(snapshot());
    e.preventDefault();
    e.returnValue = '';
  } else if (ls && ls.kind !== 'stretch') {
    saveLs();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (wk) {
      requestWakeLock();
      audio.resume();
      loop();
    } else if (ls && lsTimer) {
      requestWakeLock();
      audio.resume();
      lsLoop();
    } else if (state.onboarded && !$('#screen').classList.contains('on')) {
      render();
    }
  } else if (wk) {
    store.saveActive(snapshot());
  } else if (ls) {
    saveLs();
  }
});

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvt = e;
  if (state.onboarded && !wk) render();
});

window.addEventListener('appinstalled', () => {
  installEvt = null;
  toast('Installed. Open it from your home screen.');
  if (state.onboarded && !wk) render();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker failed', e));
}

render();
