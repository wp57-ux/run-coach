# Run Coach

A personal run/walk interval coach for the treadmill. It's a single-user
Progressive Web App: no accounts and no server. Your runs are stored only
on your phone.

- 12 stages from 5 × (run 3 / walk 2) up to a non-stop 5K
- You move up after two pain-free ("green") runs in a row, repeat the stage
  on amber, and drop back one stage on red
- A pain check-in after each run and a one-tap check the next morning
- Voice cues, countdown beeps and vibration, with adjustable volume that
  either lowers your music or plays over it
- An optional cadence metronome
- Calorie and distance estimates from treadmill speed and incline (ACSM equations)
- Works offline once installed

## Install on Android

1. Open the site in Chrome.
2. Tap **Install app** (or ⋮ → *Add to Home screen*).
3. Launch it from the home-screen icon. It opens full-screen and keeps the
   screen on during workouts.

## Develop

```bash
node tools/serve.mjs          # http://localhost:5173  (add ?fast=30 to speed up workouts)
```

Regenerate the voice clips (Windows): `powershell -ExecutionPolicy Bypass -File tools\make-audio.ps1`
Regenerate the icons (Windows): `powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1`

When you publish changes, bump `VERSION` in `sw.js` so phones pick up the new files.

*Not medical advice. If something keeps hurting, see a physio.*
