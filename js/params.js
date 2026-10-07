/*
 * Every parameter in this instrument describes something being taken away.
 * There is no control here whose increase adds material to the field.
 */

export const NYQ_DISPLAY = 20000;

export const hz = (t) => 25 * Math.pow(NYQ_DISPLAY / 25, t);

export const fmtHz = (t) => {
  const f = hz(t);
  return f >= 1000 ? (f / 1000).toFixed(f < 10000 ? 2 : 1) + ' kHz' : Math.round(f) + ' Hz';
};

export const fmtPct = (v) => Math.round(v * 100) + '%';

/* TIME SCALE reads as a place on a continuum, not a number. */
export const fmtTimeScale = (v) => {
  const span = Math.pow(10, -2.4 + 3.4 * v);
  const name = v < 0.3 ? 'MICRO' : v < 0.72 ? 'HUMAN' : 'GEOLOGICAL';
  const t = span < 1 ? Math.round(span * 1000) + ' ms'
    : span < 90 ? span.toFixed(1) + ' s'
    : (span / 60).toFixed(1) + ' min';
  return name + ' · ' + t;
};

export const fmtDecay = (v) => {
  if (v > 0.985) return 'INDEFINITE';
  const s = Math.pow(10, -2 + 4.2 * v);
  if (s < 1) return Math.round(s * 1000) + ' ms';
  if (s < 90) return s.toFixed(1) + ' s';
  return (s / 60).toFixed(1) + ' min';
};

export const fmtMemory = (v) =>
  v < 0.02 ? 'NONE · material returns at once'
    : v > 0.985 ? 'TOTAL · every absence scars'
    : fmtPct(v);

export const fmtDepth = (v) =>
  v < 0.02 ? 'FOREGROUND'
    : v < 0.3 ? 'NEAR'
    : v < 0.55 ? 'BACKGROUND'
    : v < 0.8 ? 'DISTANT'
    : v < 0.96 ? 'BURIED'
    : 'INAUDIBLE';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/* ROOT spans C0 to C5: the register where partials are far enough apart for
 * the comb to actually separate them. */
export const rootMidi = (v) => Math.round(12 + v * 60);
export const rootHz = (v) => 440 * Math.pow(2, (rootMidi(v) - 69) / 12);
export const fmtRoot = (v) => {
  const m = rootMidi(v);
  const f = rootHz(v);
  return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1) + ' · '
    + (f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : f.toFixed(1) + ' Hz');
};

export const fmtCents = (v) => '\u00b1' + Math.round(8 + v * 192) + ' cents';

/* ROLL-OFF reads as the corner above which the field is taken away. */
export const rolloffHz = (v) => 20000 * Math.pow(800 / 20000, v);
export const fmtRolloff = (v) => {
  if (v < 0.01) return 'NOTHING REMOVED';
  const f = rolloffHz(v);
  return 'ABOVE ' + (f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz');
};
export const fmtSlope = (v) => Math.round(6 + v * 30) + ' dB/oct';

export const bpm = (v) => Math.round(20 + v * 220);
export const fmtBpm = (v) => bpm(v) + ' BPM';
export const fmtSteps = (v) => Math.round(v) + ' steps';
export const fmtOctaves = (v) => (1 + Math.round(v * 3)) + ' oct';

/* SIZE reads as the temporal distance between the paths. */
export const plexSizeSec = (v) => 0.008 * Math.pow(1.2 / 0.008, v);
export const fmtPlexSize = (v) => {
  const t = plexSizeSec(v);
  return (t < 1 ? Math.round(t * 1000) + ' ms' : t.toFixed(2) + ' s')
    + (v < 0.33 ? ' \u00b7 ROOM' : v < 0.66 ? '' : ' \u00b7 ECHO');
};

export const fmtPlexus = (v) => {
  const paths = Math.round(8 - v * 6);
  return paths + ' paths \u00b7 ' + (v < 0.25 ? 'ENTANGLED' : v < 0.7 ? 'NEITHER' : 'DISCRETE');
};

export const fmtColor = (v) =>
  v < 0.47 ? 'DARKENING \u00b7 loses highs'
    : v > 0.53 ? 'BRIGHTENING \u00b7 loses lows'
    : 'NEUTRAL';

export const fmtCouple = (v) =>
  v < 0.02 ? 'DUAL MONO \u00b7 sides never meet'
    : v > 0.98 ? 'INTERLACED' : fmtPct(v);

export const fmtDecaySec = (v) => {
  if (v > 0.985) return 'ALL BUT INFINITE';
  return fmtPct(v);
};

export const fmtSend = (v) =>
  v > 0.98 ? 'OPEN \u00b7 normalled high' : v < 0.02 ? 'WITHHELD' : fmtPct(v);

export const fmtInfinity = (v) =>
  v < 0.1 ? 'HELD'
    : v < 0.45 ? 'CONSTRAINED'
    : v < 0.8 ? 'AUTONOMOUS'
    : 'SELF-GENERATING';

/* ------------------------------------------------------------------ */

export const GROUPS = [
  {
    name: 'FIELD',
    tab: 'field',
    note: 'The source is already complete. These decide how much of it is its own.',
    params: [
      { key: 'infinity', mod: true, label: 'INFINITY', min: 0, max: 1, def: 0.62, fmt: fmtInfinity,
        hint: 'how much the field decides for itself' },
      { key: 'timeScale', mod: true, label: 'TIME SCALE', min: 0, max: 1, def: 0.55, fmt: fmtTimeScale,
        hint: 'the rate at which subtraction operates' },
    ],
  },
  {
    name: 'DENSITY',
    tab: 'field',
    note: 'How much of the source is allowed to remain.',
    params: [
      { key: 'density', mod: true, label: 'REMAINS', min: 0, max: 1, def: 1, fmt: fmtPct,
        hint: '100% infinite · 50% partly revealed · 10% ghosts · 0% silence' },
    ],
  },
  {
    name: 'ABSENCE',
    tab: 'absence',
    note: 'Four absences exist in the field. They remove nothing until they are deepened.',
    params: [
      { key: 'absenceSize', mod: true, label: 'SIZE', min: 0, max: 1, def: 0.22, fmt: fmtPct,
        hint: 'how large a hole each absence makes' },
      { key: 'focus', mod: true, label: 'FOCUS', min: 0, max: 1, def: 0.35, fmt: fmtPct,
        hint: 'spectral band ← → localised hole in the stereo field' },
      { key: 'movementMode', label: 'MOVEMENT', type: 'select', def: 'wander',
        options: ['static', 'drift', 'wander', 'orbit', 'walk', 'tidal', 'gravity', 'attractor'],
        hint: 'the sound evolves because the thing removing it moves' },
      { key: 'movementRate', mod: true, label: 'RATE', min: 0, max: 1, def: 0.3, fmt: fmtPct },
    ],
  },
  {
    name: 'SPECTRAL ABSENCE',
    tab: 'spectrum',
    note: 'A void dragged through the spectrum.',
    params: [
      { key: 'spectralMode', label: 'SHAPE', type: 'select', def: 'notch',
        options: ['off', 'low', 'mid', 'high', 'notch', 'moving', 'multiple', 'excavate'],
        hint: 'which part of the spectrum is erased' },
      { key: 'spectralCentre', mod: true, label: 'REMOVE', min: 0, max: 1, def: 0.5, fmt: fmtHz,
        hint: 'not a boost — the frequency that is taken out' },
      { key: 'spectralWidth', mod: true, label: 'WIDTH', min: 0, max: 1, def: 0.2, fmt: fmtPct },
      { key: 'spectralAmount', mod: true, label: 'AMOUNT', min: 0, max: 1, def: 0, fmt: fmtPct },
    ],
  },
  {
    name: 'TEMPORAL ABSENCE',
    tab: 'time',
    note: 'Moments removed. The field goes on evolving inside the gaps.',
    params: [
      { key: 'temporalAmount', mod: true, label: 'AMOUNT', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'how much time is taken out' },
      { key: 'temporalSize', mod: true, label: 'SIZE', min: 0, max: 1, def: 0.35, fmt: fmtPct,
        hint: 'microscopic deletion ← → enormous regions of silence' },
      { key: 'temporalShape', label: 'EDGE', min: 0, max: 1, def: 0.5, fmt: fmtPct,
        hint: 'stutter ← → breathing' },
    ],
  },
  {
    name: 'PERSISTENCE',
    tab: 'time',
    note: 'Whether subtraction is temporary or permanent.',
    params: [
      { key: 'memory', mod: true, label: 'MEMORY', min: 0, max: 1, def: 0.3, fmt: fmtMemory,
        hint: 'at maximum the instrument progressively erodes itself' },
      { key: 'decay', mod: true, label: 'DECAY OF ABSENCE', min: 0, max: 1, def: 0.42, fmt: fmtDecay,
        hint: 'how long removed material stays gone' },
    ],
  },
  {
    name: 'GRAVITY',
    tab: 'absence',
    note: 'What the subtraction is drawn toward.',
    params: [
      { key: 'gravityTarget', label: 'TARGET', type: 'select', def: 'frequency',
        options: ['frequency', 'amplitude', 'transient', 'density', 'stereo',
                  'rhythm', 'harmonic', 'noise', 'silence'],
        hint: 'transient → definition dissolves · harmonic → tone becomes atmosphere' },
      { key: 'gravityAmount', mod: true, label: 'PULL', min: 0, max: 1, def: 0, fmt: fmtPct },
    ],
  },
  {
    name: 'HARMONIC ABSENCE',
    tab: 'harmony',
    note: 'Everything out of tune with the root is taken away. What is left is '
        + 'the field, in tune.',
    params: [
      { key: 'harmonicMode', label: 'ALLOWED', type: 'select', def: 'off',
        options: ['off', 'series', 'octaves', 'fifths', 'major', 'minor', 'pentatonic', 'whole'],
        hint: 'series keeps a harmonic series all the way down · the scales keep their '
             + 'degrees in every octave, and let the bass alone where a semitone '
             + 'is narrower than the analysis' },
      { key: 'harmonicRoot', mod: true, label: 'ROOT', min: 0, max: 1, def: 0.35, fmt: fmtRoot },
      { key: 'harmonicAmount', mod: true, label: 'SELECTIVITY', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'how much of the out-of-tune material is removed' },
      { key: 'harmonicWidth', mod: true, label: 'TOLERANCE', min: 0, max: 1, def: 0.28, fmt: fmtCents,
        hint: 'how far from a partial a frequency may sit and still survive' },
    ],
  },
  {
    name: 'PULSE',
    tab: 'pulse',
    note: 'A pulse of absence. Each step decides how much is taken out while it '
        + 'is the step that holds.',
    params: [
      { key: 'pulseAmount', mod: true, label: 'DEPTH', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'how much a step removes' },
      { key: 'pulseTempo', label: 'TEMPO', min: 0, max: 1, def: 0.27, fmt: fmtBpm },
      { key: 'pulseDivision', label: 'DIVISION', type: 'select', def: '1/16',
        options: ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'] },
      { key: 'pulseSteps', label: 'LENGTH', min: 2, max: 16, def: 16, int: true, fmt: fmtSteps },
      { key: 'pulseSwing', mod: true, label: 'SWING', min: 0, max: 1, def: 0, fmt: fmtPct },
      { key: 'pulseEdge', label: 'EDGE', min: 0, max: 1, def: 0.12, fmt: fmtPct,
        hint: 'hard gate ... breathing' },
    ],
  },
  {
    name: 'ARPEGGIO',
    tab: 'harmony',
    note: 'The root steps with the pulse, so a different set of partials is left '
        + 'standing on each one. Needs HARMONIC ABSENCE to be heard.',
    params: [
      { key: 'arpMode', label: 'MOTION', type: 'select', def: 'off',
        options: ['off', 'up', 'down', 'updown', 'random'] },
      { key: 'arpRange', mod: true, label: 'RANGE', min: 0, max: 1, def: 0.34, fmt: fmtOctaves },
    ],
  },
  {
    name: 'ROLL-OFF',
    tab: 'spectrum',
    note: 'The top of the field taken away, for when it is too bright.',
    params: [
      { key: 'rolloff', mod: true, label: 'ROLL-OFF', min: 0, max: 1, def: 0.2, fmt: fmtRolloff,
        hint: 'removes the air above a corner that falls as you turn it' },
      { key: 'rolloffSlope', label: 'SLOPE', min: 0, max: 1, def: 0.4, fmt: fmtSlope,
        hint: 'how steeply the top is taken off' },
    ],
  },
  {
    name: 'THE PLEXUS',
    tab: 'plexus',
    note: 'A network of feedback paths the signal is already circulating '
        + 'through. Remove the direct sound under DEPTH & SPACE to hear it.',
    params: [
      { key: 'plexus', label: 'PLEXUS', min: 0, max: 1, def: 0.35, fmt: fmtPlexus, mod: true,
        hint: 'paths taken out of the network · all eight entangled ... two discrete taps' },
      { key: 'plexSize', label: 'SIZE', min: 0, max: 1, def: 0.4, fmt: fmtPlexSize, mod: true,
        hint: 'the temporal relation between the paths — a room, or a repeat rate' },
      { key: 'plexDiffuse', label: 'DIFFUSE', min: 0, max: 1, def: 0.5, fmt: fmtPct, mod: true,
        hint: 'how much of the edge is taken off each path' },
      { key: 'plexColor', label: 'COLOR', min: 0, max: 1, def: 0.5, fmt: fmtColor, mod: true,
        hint: 'which end of the spectrum the network forgets first' },
      { key: 'plexDecay', label: 'DECAY', min: 0, max: 1, def: 0.55, fmt: fmtDecaySec, mod: true,
        hint: 'how long sound keeps going round' },
      { key: 'couple', label: 'COUPLE', min: 0, max: 1, def: 0.5, fmt: fmtCouple, mod: true,
        hint: 'how much of the separation between the two sides is removed' },
      { key: 'skewMode', label: 'SKEW', type: 'select', def: 'off',
        options: ['off', 'inverse', 'tandem'],
        hint: 'inverse pulls the sides apart on PLEXUS, SIZE and COLOR · tandem moves them together' },
      { key: 'skew', label: 'SKEW AMOUNT', min: 0, max: 1, def: 0.3, fmt: fmtPct, mod: true },
      { key: 'send', label: 'SEND', min: 0, max: 1, def: 1, fmt: fmtSend, mod: true,
        hint: 'whether the field is fed into the network · patch PULSE GATE here at a '
            + 'negative depth and the feed is withheld on the removed steps' },
    ],
  },
  {
    name: 'DEPTH & SPACE',
    tab: 'space',
    note: 'Sound is not silenced but made inaccessible.',
    params: [
      { key: 'depth', mod: true, label: 'DIRECT REMOVAL', min: 0, max: 1, def: 0, fmt: fmtDepth, node: true,
        hint: 'remove the direct sound and the reverberant field is exposed' },
      { key: 'centreRemoval', mod: true, label: 'CENTRE', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'remove the centre and the peripheral material survives' },
      { key: 'sideRemoval', mod: true, label: 'SIDES', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'remove the sides and a narrow phantom centre is left' },
    ],
  },
  {
    name: 'THE VOID',
    tab: 'time',
    note: 'Silence treated as material.',
    params: [
      { key: 'voidDensity', mod: true, label: 'DENSITY', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'how frequently silence arrives' },
      { key: 'voidSize', mod: true, label: 'SIZE', min: 0, max: 1, def: 0.4, fmt: fmtPct,
        hint: 'how much silence exists' },
      { key: 'voidDepth', label: 'DEPTH', min: 0, max: 1, def: 1, fmt: fmtPct,
        hint: 'complete silence ← → merely perceived' },
      { key: 'voidMemory', label: 'MEMORY', min: 0, max: 1, def: 0.2, fmt: fmtPct,
        hint: 'how long the silence refuses to leave' },
    ],
  },
  {
    name: 'RESIDUE',
    tab: 'space',
    note: 'What subtraction leaves behind, once the veil over it is removed.',
    params: [
      { key: 'residueVeil', mod: true, label: 'VEIL REMOVED', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'exposes the material the absences took out' },
      { key: 'residueType', label: 'KIND', type: 'select', def: 'reverberant', node: true,
        options: ['harmonic', 'granular', 'spatial', 'transient', 'reverberant', 'phase'],
        hint: 'which kind of residue survives' },
    ],
  },
  {
    name: 'OUTPUT',
    tab: 'space',
    params: [
      { key: 'attenuation', mod: true, label: 'ATTENUATION', min: 0, max: 1, def: 0, fmt: fmtPct, node: true,
        hint: 'level removed from the output' },
    ],
  },
];

/* The console is tabbed, not a scroll: the field has to stay in view while a
 * control is being moved, because the field is what the control is acting on. */
export const TABS = [
  { key: 'field', n: '01', label: 'FIELD', glyph: 'circle' },
  { key: 'absence', n: '02', label: 'ABSENCE', glyph: 'hole' },
  { key: 'spectrum', n: '03', label: 'SPECTRUM', glyph: 'bars' },
  { key: 'time', n: '04', label: 'TIME', glyph: 'gap' },
  { key: 'harmony', n: '05', label: 'HARMONY', glyph: 'comb' },
  { key: 'pulse', n: '06', label: 'PULSE', glyph: 'steps' },
  { key: 'plexus', n: '07', label: 'PLEXUS', glyph: 'net' },
  { key: 'space', n: '08', label: 'SPACE', glyph: 'depth' },
  { key: 'patch', n: '09', label: 'PATCH', glyph: 'cord' },
];

export const ALL_PARAMS = GROUPS.flatMap((g) => g.params);

export const defaults = () => {
  const o = {};
  for (const p of ALL_PARAMS) o[p.key] = p.def;
  return o;
};

/* The pulse pattern is per-step removal depth, not a note list: a step at 1
 * takes everything out for as long as it holds. The default leaves the field
 * standing on each quarter and removes it in between. */
export const defaultPattern = () =>
  Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 0 : 1));

export const PATTERN_STEPS = 16;

export const NODE_KEYS = new Set(ALL_PARAMS.filter((p) => p.node).map((p) => p.key));

/* Controls a patch cord may be plugged into, plus the absences themselves --
 * a voltage steering where the excavation happens is the whole point. */
export const VOID_DESTS = [
  { key: 'voidX1', label: 'ABSENCE I \u00b7 STEREO', void: 0, field: 'x', span: 2 },
  { key: 'voidY1', label: 'ABSENCE I \u00b7 FREQUENCY', void: 0, field: 'y', span: 1 },
  { key: 'voidD1', label: 'ABSENCE I \u00b7 DEPTH', void: 0, field: 'depth', span: 1 },
  { key: 'voidX2', label: 'ABSENCE II \u00b7 STEREO', void: 1, field: 'x', span: 2 },
  { key: 'voidY2', label: 'ABSENCE II \u00b7 FREQUENCY', void: 1, field: 'y', span: 1 },
  { key: 'voidD2', label: 'ABSENCE II \u00b7 DEPTH', void: 1, field: 'depth', span: 1 },
];
export const VOID_DEST_BY_KEY = new Map(VOID_DESTS.map((d) => [d.key, d]));

export const DESTINATIONS = [
  { key: 'none', label: '— unpatched —' },
  ...ALL_PARAMS.filter((p) => p.mod).map((p) => ({ key: p.key, label: p.label })),
  ...VOID_DESTS,
];

/* How far a full-depth cord swings each destination, in its own units. */
export const DEST_SPANS = (() => {
  const o = {};
  for (const p of ALL_PARAMS) if (p.mod) o[p.key] = (p.max - p.min);
  for (const d of VOID_DESTS) o[d.key] = d.span;
  return o;
})();
