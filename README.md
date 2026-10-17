# Run Coach

A personal run/walk interval coach for the treadmill, with a strength plan
alongside. It's a single-user Progressive Web App: no accounts and no
server. Your runs and lifts are stored only on your phone.

- 12 stages from 5 × (run 3 / walk 2) up to a non-stop 5K
- You move up after two pain-free ("green") runs in a row, repeat the stage
  on amber, and drop back one stage on red
- A pain check-in after each run and a one-tap check the next morning
- Voice cues, countdown beeps and vibration, with adjustable volume that
  either lowers your music or plays over it
- An optional cadence metronome
- Calorie and distance estimates from treadmill speed and incline (ACSM equations)
- Works offline once installed

**Strength (after the run, or on its own)**

- Three whole-body days (A → B → C) built from machines and dumbbells, with
  push/pull supersets to fit about 28 minutes
- A guided back and shoulder primer (McGill's curl-up, side plank and bird dog,
  plus cable external rotations) and guided cooldown stretches, with voice cues
- Every exercise shows a simple drawing, a form cue and a "why it's good for
  you" line
- Setup sessions find your starting weights from "how many more could you have
  done"; after that, weights go up when you hit the top of the rep range on a
  green day
- A back check-in (0–10, catches, spreading pain) and a shoulder check-in after
  each lift, plus a next-morning back check. Amber holds back-loading lifts, red
  makes the next lift a back reset day, and sore shoulders hold presses
- Swaps for busy machines, machine notes, a "something's tweaking" button, a side
  plank balance test every 4 weeks, and Phase 2 exercises after 6 green weeks

## Install on Android

1. Open the site in Chrome.
2. Tap **Install app** (or ⋮ → *Add to Home screen*).
3. Launch it from the home-screen icon. It opens full-screen and keeps the
   screen on during workouts.

## Develop

```bash
node tools/serve.mjs          # http://localhost:5173  (add ?fast=30 to speed up workouts)
```

Regenerate the voice clips (Windows): `powershell -ExecutionPolicy Bypass -File tools\make-audio.ps1` (add `-Only hold,relax` for just some)
Regenerate the icons (Windows): `powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1`
Preview the exercise drawings: http://localhost:5173/tools/figures.html

The strength plan lives in `js/lift-data.js` (exercises, days, primer, stretches)
and `js/lift.js` (rules). The drawings are in `js/drawings.js`.

When you publish changes, bump `VERSION` in `sw.js` so phones pick up the new files.

*Not medical advice. If something keeps hurting, see a physio.*
