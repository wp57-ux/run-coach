// Workout timer. Position is driven by the wall clock, not by counting
// ticks, so it stays accurate even if the phone stalls for a moment.

export class Workout {
  constructor(segs, { scale = 1 } = {}) {
    this.segs = segs;
    this.bounds = [0];
    for (const s of segs) this.bounds.push(this.bounds[this.bounds.length - 1] + s.sec * 1000);
    this.total = this.bounds[this.bounds.length - 1];
    this.scale = scale;
    this.pos = 0;
    this.idx = 0;
    this.spent = { run: 0, walk: 0 };
    this.byType = {};
    this.paused = false;
    this.running = false;
    this.done = false;
    this.cues = buildCues(segs, this.bounds);
    this.ci = 0;
    this.handlers = {};
  }

  on(evt, fn) {
    (this.handlers[evt] ||= []).push(fn);
    return this;
  }

  emit(evt, arg) {
    for (const fn of this.handlers[evt] || []) fn(arg);
  }

  start() {
    this.running = true;
    this.last = Date.now();
    this.emit('segment', 0);
  }

  pause() {
    if (!this.running || this.paused) return;
    this.tick();
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.last = Date.now();
  }

  skip() {
    if (!this.running) return;
    this.tick();
    if (!this.running) return;
    this.idx++;
    this.pos = this.bounds[this.idx];
    while (this.ci < this.cues.length && this.cues[this.ci].at < this.pos) this.ci++;
    this.last = Date.now();
    if (this.idx >= this.segs.length) return this.finish();
    this.emit('segment', this.idx);
  }

  end() {
    if (!this.running) return;
    this.tick();
    this.running = false;
  }

  finish() {
    this.running = false;
    this.done = true;
    this.emit('done');
  }

  tick() {
    if (!this.running) return;
    const now = Date.now();
    if (!this.paused) {
      let dt = (now - this.last) * this.scale;
      while (dt > 0 && this.idx < this.segs.length) {
        const end = this.bounds[this.idx + 1];
        const room = end - this.pos;
        const type = this.segs[this.idx].type;
        const kind = type === 'run' ? 'run' : 'walk';
        if (dt >= room) {
          this.spent[kind] += room;
          this.byType[type] = (this.byType[type] || 0) + room;
          this.pos = end;
          dt -= room;
          this.idx++;
          if (this.idx < this.segs.length) this.emit('segment', this.idx);
        } else {
          this.spent[kind] += dt;
          this.byType[type] = (this.byType[type] || 0) + dt;
          this.pos += dt;
          dt = 0;
        }
      }
      this.fireCues();
      if (this.idx >= this.segs.length) {
        this.last = now;
        return this.finish();
      }
    }
    this.last = now;
  }

  fireCues() {
    const due = [];
    while (this.ci < this.cues.length && this.cues[this.ci].at <= this.pos) due.push(this.cues[this.ci++]);
    if (!due.length) return;
    // After a stall, drop stale beeps but still announce where you are now.
    const staleMs = 4000 * this.scale;
    const out = due.filter(c => this.pos - c.at <= staleMs);
    const latestSeg = [...due].reverse().find(c => c.segStart);
    if (latestSeg && !out.includes(latestSeg)) out.push(latestSeg);
    const done = due.find(c => c.kind === 'done');
    if (done && !out.includes(done)) out.push(done);
    for (const c of out) this.emit('cue', c);
  }
}

function buildCues(segs, bounds) {
  const cues = [];
  const total = bounds[bounds.length - 1];
  segs.forEach((s, i) => {
    const start = bounds[i], end = bounds[i + 1], dur = end - start;
    cues.push({ at: start + 600, kind: 'voice', clip: s.clip || (s.fiveK ? 'run5k' : s.type), segStart: true });
    if (i > 0) cues.push({ at: start, kind: 'vibe', type: s.type });
    if (dur >= 8000) cues.push({ at: end - 3000, kind: 'countdown' });
    if (dur >= 180000) cues.push({ at: end - 60000, kind: 'voice', clip: 'oneminute' });
    if (['run', 'steady', 'strong'].includes(s.type) && dur >= 600000) {
      for (let m = 5; m <= 40 && m * 60000 <= dur - 90000; m += 5) {
        cues.push({ at: start + m * 60000, kind: 'voice', clip: 'm' + m, update: true });
      }
    }
  });
  // "Halfway" slides a few seconds later if it would talk over another cue.
  const busy = t => cues.some(c => (c.kind === 'voice' || c.kind === 'countdown') && Math.abs(c.at - t) < 3500);
  for (let t = total / 2; t < total / 2 + 20000; t += 1000) {
    if (!busy(t)) { cues.push({ at: t, kind: 'voice', clip: 'halfway' }); break; }
  }
  cues.push({ at: total, kind: 'done' });
  return cues.sort((a, b) => a.at - b.at);
}
