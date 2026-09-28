import * as store from './store.js';
import {
  STAGES, MAX_STAGE, stageInfo, buildSegments, progression, prelimColor, finalColor,
  needsMorning, daysBetween, dayStart,
} from './plan.js';
import { planTotals, sessionTotals } from './calories.js';
import { AudioCoach } from './audio.js';
import { Workout } from './workout.js';

// ?fast=60 runs workouts 60× faster, for testing.
const TIME_SCALE = Math.min(120, Math.max(1, Number(new URLSearchParams(location.search).get('fast')) || 1));
const LB_PER_KG = 2.20462262, KM_PER_MI = 1.609344;
const WHERE = ['Knee', 'Shin', 'Calf / Achilles', 'Hip', 'Back', 'Other'];
const TYPE_LABEL = { warmup: 'Warm up', run: 'Run', walk: 'Walk', cooldown: 'Cool down' };
const THEME = { base: '#0c0e0d', run: '#c9f23a', walk: '#1a47d1', easy: '#27313b' };
const LIMITS = {
  imperial: { weight: [60, 700], walk: [1, 5], run: [2.5, 12] },
  metric: { weight: [30, 320], walk: [1.5, 8], run: [4, 20] },
};

let state = store.load();
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

function roadHTML(stage, goal) {
  let cells = '';
  for (let n = 1; n <= MAX_STAGE; n++) {
    const cls = goal || n < stage ? 'done' : n === stage ? 'now' : '';
    cells += `<span class="${cls}">${n === MAX_STAGE ? '5K' : n}</span>`;
  }
  return `<div class="road-wrap">
    <div class="road-head"><span class="eyebrow">Road to 5K</span><span class="eyebrow">Stage ${stage} of ${MAX_STAGE}</span></div>
    <div class="road">${cells}</div>
  </div>`;
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
    const h = type === 'run' ? 7 : type === 'walk' ? 3 : 2;
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

function streakHTML(prog) {
  if (prog.goal) return '';
  const dots = [0, 1].map(i => `<i class="${i < prog.streak ? 'on' : ''}"></i>`).join('');
  const text = prog.stage === MAX_STAGE
    ? (prog.streak ? '1 more green 5K and you’ve done it' : '2 green 5Ks in a row and you’ve done it')
    : (prog.streak ? '1 more green run to move up' : '2 green runs in a row to move up');
  return `<div class="streak">${dots}<span>${text}</span></div>`;
}

function morningHTML(s, ago) {
  return `<div class="card morning">
    <span class="eyebrow">Morning check</span>
    <h3>How does your body feel?</h3>
    <p>Compared with before your run ${ago === 1 ? 'yesterday' : 'on ' + fmtDay(s.at)}: knees, shins, hips, back.</p>
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
  const prog = progression(state, now);
  const st = stageInfo(prog.stage);
  const segs = buildSegments(prog.stage, state.treadmill, units());
  const plan = planTotals(segs);
  const est = sessionTotals(plan, state.treadmill, state.profile.weight, units());
  const pending = state.sessions.find(needsMorning);
  const rest = restInfo(prog, now);
  const active = store.loadActive();
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
    } else {
      block ||= 'Your next run unlocks after tomorrow morning’s check-in.';
      cards.push(card('info', 'Check in tomorrow morning', 'Open the app tomorrow and say how your body feels. That decides whether today counts as green.'));
    }
  }
  if (prog.goal) cards.push(card('green', '5K. Done.', 'Two green 5Ks in a row. Keep running stage 12 two or three times a week to hold onto it.'));
  if (prog.reds >= 2) cards.push(card('red', 'Two red days in a row', 'Worth getting this looked at by a physio before you push on. The plan keeps you at an easier stage in the meantime.'));
  if (rest?.kind === 'red') {
    cards.push(card('red', 'Rest up', `Your last run was a red day. Take it easy until <b>${fmtDay(rest.until)}</b>. Walking is fine.`));
  } else if (rest?.kind === 'b2b' && !pending) {
    cards.push(card('info', 'Rest day', `You ran ${rest.since === 0 ? 'today' : 'yesterday'}. Leave a day between runs. Shins and Achilles need about 48 hours to recover.`));
  }
  if (prog.layoff) {
    cards.push(card('amber', 'Welcome back', `It’s been ${daysBetween(prog.lastT, now)} days since your last run, so you’ve stepped back one stage. Easy does it.`));
  }
  if (installEvt && !isStandalone()) {
    cards.push(card('info', 'Put it on your home screen', 'Opens full-screen and works offline at the gym.', `<button class="btn primary" data-act="install">Install app</button>`));
  }

  return `
    ${headerHTML(fmtDay(now))}
    ${roadHTML(prog.stage, prog.goal)}
    ${cards.join('')}
    <section class="hero">
      <div class="hero-top"><span class="eyebrow">Next run · Stage ${prog.stage}</span>${st.milestone ? `<span class="tag">${esc(st.milestone)}</span>` : ''}</div>
      <h1>${esc(st.name)}</h1>
      ${matrixHTML(segs)}
      <div class="legend"><span class="run">Run</span><span class="walk">Walk</span><span class="easy">Warm-up / cool-down</span></div>
      <dl class="stats">
        <div><dt>Total</dt><dd>${Math.round(plan.totalSec / 60)}<small>min</small></dd></div>
        <div><dt>Running</dt><dd>${fmtMins(plan.runSec)}<small>min</small></dd></div>
        <div><dt>Burn</dt><dd>${est.kcal}<small>kcal</small></dd></div>
        <div><dt>Distance</dt><dd>${distVal(est.distKm).toFixed(1)}<small>${dUnit()}</small></dd></div>
      </dl>
      ${streakHTML(prog)}
      <p class="hint">Treadmill: walk <b>${state.treadmill.walkSpeed} ${spUnit()}</b> · run <b>${state.treadmill.runSpeed} ${spUnit()}</b> · incline <b>${state.treadmill.incline}%</b>. Run at an easy pace: you should be able to talk in full sentences.</p>
    </section>
    <div class="startbar">
      ${block ? `<p class="blocked">${block}</p>` : ''}
      <button class="start" data-act="start" ${block ? 'disabled' : ''}><span>Start</span><small>Stage ${prog.stage} · ${Math.round(plan.totalSec / 60)} min</small></button>
    </div>`;
}

function weekStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const sumOf = arr => ({
  n: arr.length,
  run: arr.reduce((a, s) => a + (s.runSec || 0), 0),
  km: arr.reduce((a, s) => a + (s.distKm || 0), 0),
  kcal: arr.reduce((a, s) => a + (s.kcal || 0), 0),
});

function progressHTML() {
  const now = Date.now();
  const prog = progression(state, now);
  const list = [...state.sessions].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const ws = weekStart(now);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const s = new Date(ws); s.setDate(s.getDate() - 7 * i);
    const e = new Date(s); e.setDate(e.getDate() + 7);
    const inWeek = list.filter(x => { const t = Date.parse(x.at); return t >= s.getTime() && t < e.getTime(); });
    weeks.push({ start: s.getTime(), ...sumOf(inWeek) });
  }
  const cur = weeks[weeks.length - 1];
  const all = sumOf(list);
  const val = w => (chartMetric === 'kcal' ? w.kcal : Math.round(w.run / 60));
  const max = Math.max(1, ...weeks.map(val));
  const bars = weeks.map((w, i) => {
    const v = val(w);
    const label = new Date(w.start).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
    return `<div class="bar${i === weeks.length - 1 ? ' cur' : ''}"><span class="bv">${v || ''}</span><i style="--p:${v / max}"></i><span class="bl">${label}</span></div>`;
  }).join('');

  const morningText = { same: 'same or better', slightly: 'a bit worse', clearly: 'clearly worse' };
  const rows = list.map(s => {
    const c = finalColor(s);
    const dot = c === 'pending' ? `pending ${s.prelim}` : c;
    return `<details class="hist">
      <summary><i class="dot ${dot}"></i><span class="h-d">${fmtDay(s.at)}</span><span class="h-s">S${s.stage}</span><span class="h-r">${fmtMins(Math.round(s.runSec / 6) * 6)}′ run</span><span class="h-k">${s.kcal} kcal</span></summary>
      <div class="h-b">
        <p>${fmtDist(s.distKm)} · ${Math.round((s.runSec + s.walkSec) / 60)} min total${s.completed ? '' : ' · <b>stopped early</b>'}</p>
        <p>Pain ${s.pain}/10${s.where?.length ? ` (${s.where.map(esc).join(', ')})` : ''}${s.worseDuring ? ' · got worse' : ''}${s.limping ? ' · limping' : ''} · felt ${esc(s.effort)}</p>
        <p>Next morning: ${s.morning ? morningText[s.morning] : s.prelim === 'red' ? 'n/a' : 'not answered yet'}</p>
        ${s.notes ? `<p class="h-n">“${esc(s.notes)}”</p>` : ''}
        <button class="btn ghost small" data-act="del" data-id="${s.id}">Delete this run</button>
      </div>
    </details>`;
  }).join('');

  const planRows = STAGES.map(s => {
    const cls = prog.goal || s.n < prog.stage ? 'done' : s.n === prog.stage ? 'now' : '';
    const mins = Math.round(planTotals(buildSegments(s.n, state.treadmill, units())).totalSec / 60);
    return `<li class="${cls}"><b>${s.n}</b><span>${esc(s.name)}</span><em>${mins} min</em></li>`;
  }).join('');

  return `
    ${headerHTML('Progress')}
    <section class="big-stage">
      <div class="bs-num">${prog.stage}<small>/${MAX_STAGE}</small></div>
      <div><span class="eyebrow">Current stage</span><p>${esc(stageInfo(prog.stage).name)}</p></div>
    </section>
    ${roadHTML(prog.stage, prog.goal)}
    <section class="group"><h2>This week</h2>
      <dl class="stats">
        <div><dt>Runs</dt><dd>${cur.n}</dd></div>
        <div><dt>Running</dt><dd>${Math.round(cur.run / 60)}<small>min</small></dd></div>
        <div><dt>Distance</dt><dd>${distVal(cur.km).toFixed(1)}<small>${dUnit()}</small></dd></div>
        <div><dt>Burn</dt><dd>${cur.kcal}<small>kcal</small></dd></div>
      </dl>
    </section>
    <section class="group">
      <div class="gh"><h2>Last 8 weeks</h2>
        <div class="seg small">
          <button data-act="metric" data-v="kcal" aria-pressed="${chartMetric === 'kcal'}">kcal</button>
          <button data-act="metric" data-v="run" aria-pressed="${chartMetric === 'run'}">run min</button>
        </div>
      </div>
      <div class="chart">${bars}</div>
    </section>
    <section class="group"><h2>All time</h2>
      <p class="alltime"><b>${all.n}</b> ${all.n === 1 ? 'run' : 'runs'} ·<b>${Math.round(all.run / 60)}</b> min running · <b>${distVal(all.km).toFixed(1)}</b> ${dUnit()} · <b>${all.kcal.toLocaleString()}</b> kcal</p>
    </section>
    <section class="group"><h2>History</h2>
      ${rows || '<p class="note">No runs yet. Your first one will show up here.</p>'}
    </section>
    <section class="group"><h2>The plan</h2>
      <p class="note">Every run starts with a 5-minute brisk walk. You move up after 2 green runs in a row, repeat on amber, and drop back one on red.</p>
      <ol class="planlist">${planRows}</ol>
    </section>`;
}

function settingsHTML() {
  const a = state.audio, m = state.metronome, t = state.treadmill, L = limits();
  const prog = progression(state);
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

    <section class="group"><h2>Treadmill</h2>
      <div class="grid3">
        ${numField('Walk', 'treadmill.walkSpeed', t.walkSpeed, spUnit(), L.walk[0], L.walk[1], 0.1)}
        ${numField('Run', 'treadmill.runSpeed', t.runSpeed, spUnit(), L.run[0], L.run[1], 0.1)}
        ${numField('Incline', 'treadmill.incline', t.incline, '%', 0, 15, 0.5)}
      </div>
      <p class="note">0–1% incline is kindest to calves and Achilles. Stage 12’s length is worked out from your run speed.</p>
    </section>

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

    <section class="group"><h2>Cadence metronome</h2>
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
    </section>

    <section class="group"><h2>Plan</h2>
      <label class="field"><span>Current stage</span>
        <select id="stageSel">${STAGES.map(s => `<option value="${s.n}" ${s.n === prog.stage ? 'selected' : ''}>Stage ${s.n}: ${esc(s.name)}</option>`).join('')}</select>
        <small>Moving yourself by hand resets the green-run count.</small></label>
    </section>

    <section class="group"><h2>Your data</h2>
      <p class="note">Your runs are stored only on this phone. Export a backup now and then, because clearing Chrome’s data would wipe them.</p>
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
      <div class="wk-id"><b>Stage ${wk.stage}</b><span id="wkEl">0:00</span></div>
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
  const t = state.treadmill;
  if (seg.fiveK) return `<b>${t.runSpeed} ${spUnit()}</b> · stop at <b>${imp() ? '3.11 mi' : '5.00 km'}</b> on the display, then tap Skip`;
  const sp = seg.type === 'run' ? t.runSpeed : t.walkSpeed;
  return `Treadmill <b>${sp} ${spUnit()}</b> · ${t.incline}% incline`;
}

async function startWorkout(stage) {
  const segs = buildSegments(stage, state.treadmill, units());
  const w = new Workout(segs, { scale: TIME_SCALE });
  wk = { w, stage, segs, startedAt: Date.now(), maxPain: 0, where: new Set(), endedForPain: false, col: -1, clock: '', snapAt: 0, timer: null };
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
  return { kind: 'workout', stage: wk.stage, segs: wk.segs, startedAt: wk.startedAt, spent: { ...w.spent }, pos: w.pos, maxPain: wk.maxPain, where: [...wk.where] };
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
  const k = sessionTotals({ runSec: w.spent.run / 1000, walkSec: w.spent.walk / 1000 }, state.treadmill, state.profile.weight, units()).kcal;
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
  $('#wkNext').textContent = nx ? `Next · ${TYPE_LABEL[nx.type]} ${fmtClock(nx.sec * 1000)}` : 'Last block';
  setTheme(seg.type === 'run' ? THEME.run : seg.type === 'walk' ? THEME.walk : THEME.easy);
  syncMetro();
}

function onCue(c) {
  if (c.kind === 'countdown') audio.countdown();
  else if (c.kind === 'vibe') audio.vibrate(c.type === 'run' ? [400, 150, 400] : [150, 100, 150, 100, 150]);
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

function finishWorkout(natural) {
  if (!wk) return;
  const w = wk.w;
  if (!natural) w.end();
  clearInterval(wk.timer);
  audio.metroStop();
  releaseWakeLock();
  draft = draftFrom({ stage: wk.stage, segs: wk.segs, startedAt: wk.startedAt, spent: w.spent, maxPain: wk.maxPain, where: [...wk.where], endedForPain: wk.endedForPain });
  wk = null;
  store.saveActive({ kind: 'draft', startedAt: draft.at, draft });
  if (history.state?.wk) history.back();
  closeSheet();
  setTheme(THEME.base);
  showScreen(checkinHTML());
}

function hurtHTML() {
  const p = hurt.pain;
  return `<h3>Slow to a walk</h3>
    <p>Bring the treadmill down to walking speed. The timer is paused.</p>
    <span class="eyebrow">How bad is it right now?</span>
    <div class="painpad">${[...Array(11)].map((_, n) => `<button class="pp ${zone(n)}" data-act="hurt-pain" data-v="${n}" aria-pressed="${p === n}">${n}</button>`).join('')}</div>
    <span class="eyebrow">Where?</span>
    <div class="chips">${WHERE.map(x => `<button class="chip" data-act="hurt-where" data-v="${x}" aria-pressed="${hurt.where.has(x)}">${x}</button>`).join('')}</div>
    ${p >= 5 ? '<p class="stop">That’s a red day. Stop here, walk it off, and log it.</p>' : ''}
    ${p >= 3 && p < 5 ? '<p class="note warn">Walk for a minute. If it settles, carry on. If it doesn’t, end it here.</p>' : ''}
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
    <button class="start inline" data-act="result-done"><span>Done</span></button>
  </div>`;
}

function celebrate(stage) {
  if (stage) {
    openSheet(`<div class="celebrate">
      <span class="eyebrow">Unlocked</span>
      <div class="cel-num">Stage ${stage}</div>
      <p>${esc(stageInfo(stage).name)}</p>
      ${matrixHTML(buildSegments(stage, state.treadmill, units()))}
      <button class="btn primary wide" data-act="sheet-close">Let’s go</button>
    </div>`);
  } else {
    openSheet(`<div class="celebrate">
      <span class="eyebrow">Goal reached</span>
      <div class="cel-num">5K</div>
      <p>Two green 5Ks in a row. Comfortable, and pain-free.</p>
      <button class="btn primary wide" data-act="sheet-close">Nice</button>
    </div>`);
  }
  audio.vibrate([120, 80, 120, 80, 300]);
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
  const prog = progression(state);
  if (n === prog.stage) return;
  const ok = await ask(`Move to stage ${n}?`, `${esc(stageInfo(n).name)}. Your green-run count starts again from zero.`,
    [{ label: 'Cancel', value: false }, { label: 'Move', value: true, cls: 'primary' }]);
  if (!ok) { el.value = String(prog.stage); return; }
  state.overrides.push({ at: new Date().toISOString(), stage: n });
  persist();
  render();
  toast(`Now on stage ${n}`);
}

async function importFile(file) {
  if (!file) return;
  try {
    const next = store.fromBackup(await file.text());
    const ok = await ask('Replace your data?', `This backup has ${next.sessions.length} runs. It replaces everything on this phone.`,
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
    const prog = progression(state, now);
    const rest = restInfo(prog, now);
    if (rest) {
      const ok = await ask(
        rest.kind === 'red' ? 'Your body flagged pain' : 'Rest day?',
        rest.kind === 'red'
          ? `Your last run was a red day. The plan says rest until ${fmtDay(rest.until)}.`
          : `You ran ${rest.since === 0 ? 'today' : 'yesterday'}. Shins and Achilles do better with a day off between runs.`,
        [{ label: 'Rest instead', value: false, cls: 'primary' }, { label: 'Run anyway', value: true }]);
      if (!ok) return;
    }
    startWorkout(prog.stage);
  },

  morning(el) {
    const s = state.sessions.find(needsMorning);
    if (!s) return;
    const before = progression(state);
    s.morning = el.dataset.v;
    s.morningAt = new Date().toISOString();
    persist();
    const after = progression(state);
    const c = finalColor(s);
    render();
    if (after.goal && !before.goal) celebrate(null);
    else if (after.stage > before.stage) celebrate(after.stage);
    else if (c === 'green') toast(`<b>Green confirmed.</b>${after.streak === 1 ? ' One more to move up.' : ''}`);
    else if (c === 'amber') toast('<b>Amber.</b> Same stage next time.');
    else toast('<b>Red.</b> Rest 2–3 days. Dropping back one stage.', 4500);
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
    draft = a.kind === 'draft'
      ? a.draft
      : draftFrom({ stage: a.stage, segs: a.segs, startedAt: a.startedAt, spent: a.spent, maxPain: a.maxPain, where: a.where, endedForPain: false });
    if (a.kind !== 'draft') store.saveActive({ kind: 'draft', startedAt: draft.at, draft });
    showScreen(checkinHTML());
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
  }
});

window.addEventListener('beforeunload', e => {
  if (wk) {
    store.saveActive(snapshot());
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (wk) {
      requestWakeLock();
      audio.resume();
      loop();
    } else if (state.onboarded && !$('#screen').classList.contains('on')) {
      render();
    }
  } else if (wk) {
    store.saveActive(snapshot());
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
