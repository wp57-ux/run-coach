// The strength plan: exercises, the three whole-body days, the back and
// shoulder primer, and the cooldown stretches. Rules live in lift.js.
//
// Exercise fields
//   kind     'weight' (default), 'level' (push-up bar notch, lower = harder),
//            'carry' (weight only, no auto progression) or 'reps' (bodyweight)
//   reps     [low, high] target range
//   perSide  reps are per side / per arm / per leg
//   back     'load' = loads or bends the low back; swapped out on a back reset day
//   safe     back-safe replacement on a reset day (null = leave it out)
//   press    a press or raise: held back when shoulders are sore
//   shSafe   shoulder-safe replacement when shoulders are painful (null = leave it out)
//   dir      -1 when a bigger number makes it easier (assisted machines, bar notches)
//   alts     choices behind the Swap button

export const EX = {
  chestpress: {
    name: 'Chest press machine', fig: 'chestpress', reps: [8, 12], press: true, shSafe: 'pushup', alts: ['pushup'],
    cue: 'Neutral grip if it has one. Elbows about 45° from your body. Stop when your hands are level with your chest.',
    why: 'Chest and triceps: a fuller chest and pushing strength. On a machine you control the range, so your shoulders stay comfortable.',
  },
  csrow: {
    name: 'Chest-supported row', fig: 'csrow', reps: [8, 12], alts: ['cablerow'],
    cue: 'Chest stays on the pad. Pull your elbows back past your body, then lower slowly.',
    why: 'A thicker mid-back and better posture. It pulls your shoulders back and balances all the pressing, which your rotator cuffs need. The pad keeps your low back out of it.',
  },
  legpress: {
    name: 'Leg press', fig: 'legpress', reps: [10, 15], back: 'load', safe: 'legext', alts: ['legext'],
    cue: 'Feet mid-to-high on the plate. Only go as deep as you can without your tailbone curling off the seat.',
    why: 'Quads and glutes. Strong quads help with front-of-knee pain, one of your running trouble spots.',
  },
  latraise: {
    name: 'Lateral raise', fig: 'latraise', reps: [12, 15], press: true, shSafe: null, alts: ['latraisem'],
    cue: 'Go light. Thumbs slightly up, arms a little in front of you. Stop at shoulder height.',
    why: 'Builds the side of your shoulders. Wider shoulders make your waist look smaller.',
  },
  calfpress: {
    name: 'Calf raise on the leg press', fig: 'calfpress', reps: [12, 15], alts: ['slcalf'],
    cue: 'Knees straight, balls of your feet on the bottom edge of the plate. Full stretch, then rise up high.',
    why: 'Calves and Achilles, which take a big share of the load in every running stride.',
  },
  pallof: {
    name: 'Pallof press', fig: 'pallof', reps: [10, 12], perSide: true, alts: ['bandpallof'],
    cue: 'Stand side-on to the cable. Press the handle straight out from your chest, hold a breath, bring it back. Don’t let it twist you.',
    why: 'Teaches your trunk to resist twisting, which is the core’s main job in protecting your back.',
  },
  shoulderpress: {
    name: 'Seated shoulder press machine', fig: 'shoulderpress', reps: [8, 12], press: true, shSafe: null, alts: ['landmine'],
    cue: 'Set the seat so the handles start at shoulder height. Back on the pad. If it pinches, swap to the landmine press.',
    why: 'Front and side shoulders, for fuller shoulders and overhead strength.',
  },
  pulldown: {
    name: 'Lat pulldown', fig: 'pulldown', reps: [8, 12], alts: ['assistpullup'],
    cue: 'Pull the bar to your upper chest, elbows down toward your ribs. Don’t lean way back.',
    why: 'Lats, the muscles that give your back a V-shape and make your waist look narrower. Builds pulling strength.',
  },
  hipthrust: {
    name: 'Hip thrust', fig: 'hipthrust', reps: [8, 12], back: 'load', safe: null, alts: ['glutebridge'],
    cue: 'Upper back on the bench, chin tucked. Finish with your glutes and keep your ribs down. Don’t arch at the top.',
    why: 'Glutes: the biggest muscles supporting your pelvis and low back. They shape your backside and help your running.',
  },
  facepull: {
    name: 'Face pull', fig: 'facepull', reps: [12, 15], alts: ['revpec'],
    cue: 'Rope at face height. Pull toward your eyes with your elbows high, and finish with your hands turned out.',
    why: 'Rear shoulders and the rotator cuff muscles that turn your arm out. Directly good for your shoulders and your posture.',
  },
  legcurl: {
    name: 'Seated leg curl', fig: 'legcurl', reps: [10, 12], alts: ['lyingcurl'],
    cue: 'Pad just above your heels. Curl down and under, then let it up slowly.',
    why: 'Hamstrings, which balance your quads and help keep your knees stable.',
  },
  suitcase: {
    name: 'Suitcase carry', fig: 'suitcase', kind: 'carry', reps: [1, 1], back: 'load', safe: null, alts: [],
    cue: 'One dumbbell, walk tall for 30–40 m, then switch hands. Don’t lean toward or away from the weight.',
    why: 'Trains the side of your back to hold you upright under load. With the weight in your right hand, that’s your left side. Builds grip too.',
  },
  pushup: {
    name: 'Push-up on a bar or bench', fig: 'pushup', kind: 'level', dir: -1, reps: [8, 15], back: 'load', safe: 'chestpress', press: true, shSafe: 'pushup', alts: ['chestpress'],
    cue: 'Hands a little wider than your shoulders, elbows about 45°, body straight. At the top, push the floor away so your shoulder blades spread.',
    why: 'Chest, shoulders, triceps and core in one move. Your hands stay planted while your shoulder blades move freely, which is usually kinder to rotator cuffs than dumbbell presses.',
  },
  cablerow: {
    name: 'Seated cable row', fig: 'cablerow', reps: [8, 12], back: 'load', safe: 'csrow', alts: ['csrow'],
    cue: 'Sit tall and keep your torso still. Pull the handle to your belly, elbows back. No rocking.',
    why: 'Mid-back and rear shoulders, for posture and a thicker-looking back.',
  },
  splitsquat: {
    name: 'Split squat', fig: 'splitsquat', reps: [8, 12], perSide: true, back: 'load', safe: 'legext', alts: ['legpress'],
    cue: 'One foot forward, torso tall, hold a rail or dumbbells. Lower your back knee to just above the floor.',
    why: 'Each leg works on its own, like in running. Evens out left/right strength and improves balance.',
  },
  hipabd: {
    name: 'Hip abduction machine', fig: 'hipabd', reps: [12, 15], alts: ['sidelyingraise'],
    cue: 'Sit tall, push your knees out against the pads, pause, and come back slowly.',
    why: 'Works the side glute (glute medius), which keeps your knee from caving in when you land. Good for the knee and the IT band.',
  },
  seatedcalf: {
    name: 'Seated calf raise', fig: 'seatedcalf', reps: [12, 15], alts: ['slcalfbent'],
    cue: 'Knees under the pad. Lower your heels all the way, then rise up high.',
    why: 'Works the soleus, the deep calf muscle that does much of the work when you run and protects your Achilles.',
  },
  hammercurl: {
    name: 'Hammer curl', fig: 'hammercurl', reps: [10, 15], alts: ['cablecurl'],
    cue: 'Palms facing each other, elbows at your sides. No swinging.',
    why: 'Biceps, forearms and grip.',
  },
  pushdown: {
    name: 'Cable triceps pushdown', fig: 'pushdown', reps: [10, 15], alts: ['sapushdown'],
    cue: 'Elbows pinned to your sides. Push the rope down until your arms are straight, then spread it apart.',
    why: 'Triceps make up about two-thirds of your upper arm, so they matter most for arm size.',
  },

  // ---- alternates ----
  latraisem: {
    name: 'Lateral raise machine', fig: 'latraise', reps: [12, 15], press: true, shSafe: null, alts: ['latraise'],
    cue: 'Pads just above your elbows. Raise to shoulder height, no higher, and lower slowly.',
    why: 'Builds the side of your shoulders. Wider shoulders make your waist look smaller.',
  },
  bandpallof: {
    name: 'Band Pallof press', fig: 'pallof', reps: [10, 12], perSide: true, alts: ['pallof'],
    cue: 'Band anchored at chest height, stand side-on. Press straight out and don’t let it twist you.',
    why: 'Teaches your trunk to resist twisting, which is the core’s main job in protecting your back.',
  },
  landmine: {
    name: 'Half-kneeling landmine press', fig: 'landmine', reps: [8, 12], perSide: true, press: true, shSafe: null, alts: ['shoulderpress'],
    cue: 'One knee down, squeeze that glute. Press the end of the bar up and forward, not straight overhead.',
    why: 'Shoulders and upper chest at an angle most rotator cuffs handle better than straight overhead.',
  },
  assistpullup: {
    name: 'Assisted pull-up machine', fig: 'assistpullup', reps: [8, 12], dir: -1, alts: ['pulldown'],
    cue: 'Knees on the pad. Pull your chest toward the bar, elbows down. The weight is the help: less weight is harder.',
    why: 'Lats, the muscles that give your back a V-shape and make your waist look narrower. Builds pulling strength.',
  },
  glutebridge: {
    name: 'Glute bridge', fig: 'glutebridge', reps: [10, 15], back: 'load', safe: null, alts: ['hipthrust'],
    cue: 'On your back, dumbbell on your hips, feet flat. Drive your hips up with your glutes and keep your ribs down.',
    why: 'Glutes: the biggest muscles supporting your pelvis and low back. They shape your backside and help your running.',
  },
  revpec: {
    name: 'Reverse pec deck', fig: 'revpec', reps: [12, 15], alts: ['facepull'],
    cue: 'Chest on the pad, arms slightly bent. Sweep your arms back and out at shoulder height, then return slowly.',
    why: 'Rear shoulders and upper back, for posture and healthier shoulders.',
  },
  lyingcurl: {
    name: 'Lying leg curl', fig: 'lyingcurl', reps: [10, 12], alts: ['legcurl'],
    cue: 'Hips pressed into the pad. Curl your heels toward your glutes and lower slowly.',
    why: 'Hamstrings, which balance your quads and help keep your knees stable.',
  },
  legext: {
    name: 'Leg extension machine', fig: 'legext', reps: [10, 15], alts: ['legpress'],
    cue: 'Pad on your lower shins. Straighten your knees, pause, lower slowly. Stop short of any knee pain.',
    why: 'Quads on their own, with no load on your back.',
  },
  slcalf: {
    name: 'Single-leg calf raise', fig: 'slcalf', reps: [10, 15], perSide: true, alts: ['calfpress'],
    cue: 'Ball of your foot on a step, hold a rail, dumbbell in the other hand. Full stretch, then rise up high.',
    why: 'Calves and Achilles, which take a big share of the load in every running stride.',
  },
  slcalfbent: {
    name: 'Single-leg calf raise, knee bent', fig: 'slcalf', reps: [10, 15], perSide: true, alts: ['seatedcalf'],
    cue: 'Same as the calf raise, with your knee slightly bent the whole time.',
    why: 'Works the soleus, the deep calf muscle that does much of the work when you run and protects your Achilles.',
  },
  sidelyingraise: {
    name: 'Side-lying leg raise', fig: 'sidelyingraise', kind: 'reps', reps: [12, 20], perSide: true, alts: ['hipabd'],
    cue: 'Lie on your side, bottom knee bent. Lift the top leg slightly behind you, toes pointing forward.',
    why: 'Works the side glute (glute medius), which keeps your knee from caving in when you land.',
  },
  cablecurl: {
    name: 'Cable curl', fig: 'hammercurl', reps: [10, 15], alts: ['hammercurl'],
    cue: 'Elbows at your sides. Curl up, lower slowly.',
    why: 'Biceps, forearms and grip.',
  },
  sapushdown: {
    name: 'Single-arm cable pushdown', fig: 'pushdown', reps: [10, 15], perSide: true, alts: ['pushdown'],
    cue: 'Elbow pinned to your side. Push down until your arm is straight.',
    why: 'Triceps make up about two-thirds of your upper arm, so they matter most for arm size.',
  },

  // ---- phase 2 ----
  rdl: {
    name: 'Dumbbell Romanian deadlift', fig: 'rdl', reps: [8, 12], back: 'load', safe: 'legcurl', alts: ['legcurl'],
    cue: 'Soft knees, push your hips back, keep your back flat. Lower the dumbbells to about knee height, then stand by squeezing your glutes.',
    why: 'Hamstrings and glutes through a hip hinge, the same movement that protects your back when you pick things up.',
  },
  bss: {
    name: 'Bulgarian split squat', fig: 'bss', reps: [8, 12], perSide: true, back: 'load', safe: 'legext', alts: ['splitsquat'],
    cue: 'Back foot up on a bench. Torso tall, lower straight down, front knee over your foot.',
    why: 'Each leg works on its own, like in running. The harder version of the split squat.',
  },
  backext: {
    name: '45° back extension', fig: 'backext', reps: [10, 15], back: 'load', safe: null, alts: ['calfpress'],
    cue: 'Hips on the pad. Hinge down with a flat back, rise until your body is straight, no further. Bodyweight first: enter 0.',
    why: 'Endurance for the muscles along your spine, which helps guard against back pain.',
  },
};

// Straight sets: every set of one exercise, then the next. No supersets (a
// busy gym), except back-to-back on the same machine. Every exercise here was
// approved by you on Oct 19. 3-set exercises rest 90 s (Settings), 2-set ones 60 s.
// same = stays on the machine from the exercise before.
export const DAYS = {
  A: {
    stretch: 'doorchest',
    list: [
      { ex: 'chestpress', sets: 3 },
      { ex: 'csrow', sets: 3 },
      { ex: 'legpress', sets: 3 },
      { ex: 'calfpress', sets: 2, same: 'Stay on the leg press' },
      { ex: 'latraise', sets: 2 },
    ],
  },
  B: {
    stretch: 'latstretch',
    list: [
      { ex: 'shoulderpress', sets: 3 },
      { ex: 'pulldown', sets: 3 },
      { ex: 'legcurl', sets: 3 },
      { ex: 'facepull', sets: 2 },
      { ex: 'suitcase', sets: 2 },
    ],
  },
  C: {
    stretch: 'hamstrap',
    list: [
      { ex: 'pushup', sets: 3 },
      { ex: 'cablerow', sets: 3 },
      { ex: 'splitsquat', sets: 2 },
      { ex: 'hipabd', sets: 2 },
      { ex: 'seatedcalf', sets: 2 },
      { ex: 'hammercurl', sets: 2, optional: true },
      { ex: 'pushdown', sets: 2, optional: true },
    ],
  },
};

// Offered after 6 weeks with no red back days.
export const PHASE2 = {
  A: { calfpress: 'backext' },
  B: { legcurl: 'rdl' },
  C: { splitsquat: 'bss' },
};

// ---- primer ----------------------------------------------------------------

export const PRIMER = {
  warm: {
    name: 'Easy warm-up', fig: null,
    cue: '5 minutes on the bike or a brisk treadmill walk, easy enough to chat.',
    why: 'Warms your muscles and joints up before any weight goes on.',
  },
  plank: {
    name: 'Front plank', fig: 'plank',
    cue: 'On your elbows and toes, elbows under your shoulders. Squeeze your glutes and brace like someone’s about to poke your belly. Body in one straight line, no sagging hips.',
    why: 'Trains the front of your core to hold your trunk stiff, which protects your low back, with no strain on your neck.',
  },
  // No longer in the primer (Oct 19): kept so old sessions still display.
  curlup: {
    name: 'Curl-up', fig: 'curlup',
    cue: 'On your back, one knee bent, hands under your low back. Lift your head and shoulders just off the floor, chin tucked. Switch the bent knee each set.',
    why: 'Builds endurance in the front of your core with almost no load on your spine.',
  },
  sideplank: {
    name: 'Side plank', fig: 'sideplank',
    cue: 'On your elbow and knees, body straight, hips up. Move to your feet once 10 s feels easy. If a shoulder complains, stay on your knees.',
    why: 'Trains the deep side muscles that keep your pelvis level, on the side that went into spasm.',
  },
  birddog: {
    name: 'Bird dog', fig: 'birddog',
    cue: 'On hands and knees, reach the opposite arm and leg out, back flat. Make a fist and squeeze.',
    why: 'Builds endurance in the muscles along your spine while it stays still.',
  },
  extrot: {
    name: 'Cable external rotation', fig: 'extrot',
    cue: 'Side-on to a cable at elbow height, elbow tucked at your side (a rolled towel helps). Slowly turn your forearm out and back. Light weight.',
    why: 'Strengthens the rotator cuff, the small muscles that keep the ball of your shoulder centered in its socket.',
  },
};

// ---- stretches -------------------------------------------------------------

export const STRETCH = {
  calfwall: {
    name: 'Calf stretch, knee straight', fig: 'calfwall',
    cue: 'Hands on a wall, back leg straight, heel down. Lean in until you feel the calf.',
    why: 'Eases the big calf muscle after running.',
  },
  soleuswall: {
    name: 'Calf stretch, knee bent', fig: 'soleuswall',
    cue: 'Same position, now bend the back knee and keep the heel down.',
    why: 'Reaches the soleus, the deeper calf muscle that takes running load near your Achilles.',
  },
  hipflexor: {
    name: 'Half-kneeling hip flexor', fig: 'hipflexor',
    cue: 'Back knee down. Squeeze that glute and ease your hips forward. Don’t arch your back.',
    why: 'Opens up the front of your hip, which gets tight from sitting and running.',
  },
  figure4: {
    name: 'Figure-4 glute stretch', fig: 'figure4',
    cue: 'On your back, ankle over the opposite knee. Pull that thigh gently toward you.',
    why: 'Loosens your glutes and outer hip, where the IT band starts.',
  },
  catcamel: {
    name: 'Cat-camel', fig: 'catcamel',
    cue: 'On hands and knees, slowly round your back up, then let it sag gently. About 6 slow reps.',
    why: 'Moves each part of your back gently. It eases stiffness without stretching the back.',
  },
  sidereach: {
    name: 'Side reach', fig: 'sidereach',
    cue: 'Stand tall, one arm up only as high as your shoulder is comfortable, and lean gently away.',
    why: 'A gentle stretch for the tight side of your low back and your lats.',
  },
  doorchest: {
    name: 'Doorway chest stretch', fig: 'doorchest',
    cue: 'Forearm on the door frame, elbow below shoulder height. Step through gently.',
    why: 'Eases your chest after pressing.',
  },
  latstretch: {
    name: 'Lat stretch', fig: 'latstretch',
    cue: 'Hold a rack upright at chest-to-head height. Push your hips back and away.',
    why: 'Eases your lats after pulling.',
  },
  hamstrap: {
    name: 'Lying hamstring stretch', fig: 'hamstrap',
    cue: 'On your back, strap around one foot. Raise the straight leg until you feel the back of the thigh.',
    why: 'Eases your hamstrings after leg work.',
  },
};
