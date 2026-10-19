# Run Coach

A personal cardio and strength coach for the gym: a stationary-bike plan (or
the original treadmill run/walk plan) with a strength plan alongside. It's a
single-user Progressive Web App: no accounts and no server. Your rides, runs
and lifts are stored only on your phone.

**Bike (the default cardio; switch in Settings)**

- 12 stages from 15 minutes steady up to 35 minutes strong, non-stop, with
  tempo and 1-minute hard intervals in between. Stages unlock after two green
  rides in a row, repeat on amber, and drop back on red
- Targets in resistance levels (the default, ridden at 80–90 rpm), watts, or by
  feel. Your steady level or power is set on the first (setup) ride. On levels,
  easy is 4 below steady, strong 2 above and hard 4 above; on watts they're 60%,
  100%, 115% and 135%. Rides that feel easy move you up a level (or 5 W), and
  hard ones move you down
- Calories from the ACSM leg-cycling equation, typical rates per effort zone
  when the bike shows no watts, or the bike's own number if you type it in

**Run (treadmill)**

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

- Three whole-body days (A → B → C) built from machines and dumbbells you've
  approved, done as straight sets (every set of one exercise, then the next) in
  about 28 minutes. The screen shows "Set 1 of 3" and what comes next
- A guided back and shoulder primer (front plank, McGill's side plank and bird
  dog, plus cable external rotations) and guided cooldown stretches, with voice cues
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
