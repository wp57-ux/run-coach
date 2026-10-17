// Voice cues, countdown beeps, vibration and the cadence metronome.
//
// Cues are short recorded clips (under 5 s). In "duck" mode they play through
// an <audio> element, which Chrome on Android treats as a brief interruption:
// your music dips and comes back. In "mix" mode they go through Web Audio and
// play over the top of your music.

// Keep in sync with tools/make-audio.ps1
export const CLIPS = {
  warmup: 'Warm up. Brisk walk.',
  run: 'Run. Easy pace.',
  run5k: 'Run. Easy pace, all the way to five K.',
  walk: 'Walk.',
  cooldown: 'Cool down. Easy walk.',
  halfway: 'Halfway there.',
  oneminute: 'One minute to go.',
  done: 'Workout complete. Nice work.',
  paused: 'Paused.',
  resumed: 'Resuming.',
  test: 'Voice check. This is how loud your cues will be.',
  m5: 'Five minutes.',
  m10: 'Ten minutes.',
  m15: 'Fifteen minutes.',
  m20: 'Twenty minutes.',
  m25: 'Twenty-five minutes.',
  m30: 'Thirty minutes.',
  m35: 'Thirty-five minutes.',
  m40: 'Forty minutes.',
  hold: 'Hold.',
  relax: 'Relax.',
  switch: 'Switch sides.',
  next: 'Next exercise.',
  restover: 'Rest over. Next set.',
  bikewarm: 'Warm up. Easy spin.',
  bikecool: 'Cool down. Easy spin.',
  easy: 'Easy. Spin it out.',
  steady: 'Steady pace.',
  strong: 'Strong. Pick it up.',
  hard: 'Hard. Big effort.',
};

const RATE = 22050;

export class AudioCoach {
  constructor(getState) {
    this.get = getState;
    this.ctx = null;
    this.buf = {};
    this.url = {};
    this.el = {};
    this.loading = null;
    this.metro = null;
  }

  // Call from a tap so the browser allows sound.
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      this.resume();
    } catch (e) {
      console.warn('Audio unavailable', e);
    }
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  async load() {
    this.addPcm('countdown', countdownPcm());
    await Promise.all(Object.keys(CLIPS).map(async name => {
      try {
        const res = await fetch(`audio/${name}.wav`);
        if (!res.ok) throw new Error(res.status);
        const ab = await res.arrayBuffer();
        this.url[name] = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
        if (this.ctx) this.buf[name] = await this.ctx.decodeAudioData(ab.slice(0));
      } catch (e) {
        console.warn('Clip missing, will use the phone voice:', name, e);
      }
    }));
  }

  addPcm(name, pcm) {
    this.url[name] = URL.createObjectURL(new Blob([wav(pcm, RATE)], { type: 'audio/wav' }));
    if (this.ctx) {
      const b = this.ctx.createBuffer(1, pcm.length, RATE);
      b.copyToChannel(pcm, 0);
      this.buf[name] = b;
    }
  }

  play(name) {
    const a = this.get().audio;
    const vol = Math.max(0, Math.min(1, a.volume));
    if (vol === 0) return true;
    if (a.style === 'mix' && this.ctx && this.buf[name]) {
      this.resume();
      const src = this.ctx.createBufferSource();
      src.buffer = this.buf[name];
      const g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(g);
      g.connect(this.ctx.destination);
      src.start();
      return true;
    }
    if (this.url[name]) {
      let el = this.el[name];
      if (!el) {
        el = this.el[name] = new Audio(this.url[name]);
        el.preload = 'auto';
      }
      el.volume = vol;
      try { el.currentTime = 0; } catch {}
      el.play().catch(e => console.warn('Could not play', name, e));
      return true;
    }
    return false;
  }

  say(name, force = false) {
    if (!force && !this.get().audio.voice) return;
    if (!this.play(name)) this.speak(CLIPS[name]);
  }

  speak(text) {
    if (!text || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.volume = this.get().audio.volume;
    speechSynthesis.speak(u);
  }

  countdown() {
    if (this.get().audio.beeps) this.play('countdown');
  }

  vibrate(pattern) {
    if (this.get().audio.vibrate && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch {}
    }
  }

  metroStart(bpm) {
    if (!this.ctx) return;
    if (this.metro && this.metro.bpm === bpm) return;
    this.metroStop();
    this.resume();
    const m = (this.metro = { bpm, next: this.ctx.currentTime + 0.08 });
    m.timer = setInterval(() => {
      const now = this.ctx.currentTime;
      if (m.next < now - 0.1) m.next = now + 0.05;
      const vol = this.get().metronome.volume;
      while (m.next < now + 0.2) {
        this.click(m.next, vol);
        m.next += 60 / bpm;
      }
    }, 30);
  }

  metroStop() {
    if (this.metro) {
      clearInterval(this.metro.timer);
      this.metro = null;
    }
  }

  click(t, vol) {
    if (vol <= 0) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 1750;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.06);
  }
}

// Three short beeps, then a long high one that lands exactly on the switch.
function countdownPcm() {
  const pcm = new Float32Array(Math.round(RATE * 3.6));
  const tone = (at, dur, f, amp) => {
    const s0 = Math.round(at * RATE), n = Math.round(dur * RATE);
    const att = 0.004 * RATE, rel = 0.03 * RATE;
    for (let i = 0; i < n && s0 + i < pcm.length; i++) {
      const env = Math.min(1, i / att, (n - i) / rel);
      const t = i / RATE;
      pcm[s0 + i] += amp * env * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
    }
  };
  tone(0, 0.13, 880, 0.55);
  tone(1, 0.13, 880, 0.55);
  tone(2, 0.13, 880, 0.55);
  tone(3, 0.5, 1320, 0.6);
  return pcm;
}

function wav(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  }
  return buf;
}
