// Step timer for the primer and the stretches. Like the workout timer it
// runs off the wall clock, so a stalled phone doesn't stretch a hold.
//
// Timed steps count down and move on by themselves. Manual steps wait for
// next(). Test steps count up until next() or their cap.

export class Guide {
  constructor(steps, { scale = 1 } = {}) {
    this.steps = steps;
    this.scale = scale;
    this.i = -1;
    this.left = 0;
    this.up = 0;
    this.paused = false;
    this.running = false;
    this.handlers = {};
  }

  on(evt, fn) {
    (this.handlers[evt] ||= []).push(fn);
    return this;
  }

  emit(evt, arg) {
    for (const fn of this.handlers[evt] || []) fn(arg);
  }

  get step() { return this.steps[this.i]; }

  start() {
    this.running = true;
    this.go(0);
  }

  go(i) {
    this.i = i;
    this.last = Date.now();
    if (i >= this.steps.length) {
      this.running = false;
      this.emit('done');
      return;
    }
    const st = this.steps[i];
    this.left = (st.sec || 0) * 1000;
    this.up = 0;
    this.beeped = false;
    this.capped = false;
    this.emit('step', st);
  }

  next() {
    if (this.running) this.go(this.i + 1);
  }

  pause() {
    this.tick();
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.last = Date.now();
  }

  tick() {
    if (!this.running) return;
    const now = Date.now();
    const dt = (now - this.last) * this.scale;
    this.last = now;
    if (this.paused) return;
    const st = this.step;
    if (st.kind === 'test') {
      this.up = Math.min(this.up + dt, st.cap * 1000);
      if (this.up >= st.cap * 1000 && !this.capped) {
        this.capped = true;
        this.emit('cap', st);
      }
      return;
    }
    if (!st.sec) return;
    this.left -= dt;
    if (st.beep && !this.beeped && st.sec >= 8 && this.left <= 3000) {
      this.beeped = true;
      this.emit('beep');
    }
    if (this.left <= 0) this.go(this.i + 1);
  }
}
