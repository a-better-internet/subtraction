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

export const fmtInfinity = (v) =>
  v < 0.1 ? 'HELD'
    : v < 0.45 ? 'CONSTRAINED'
    : v < 0.8 ? 'AUTONOMOUS'
    : 'SELF-GENERATING';

/* ------------------------------------------------------------------ */

export const GROUPS = [
  {
    name: 'FIELD',
    note: 'The source is already complete. These decide how much of it is its own.',
    params: [
      { key: 'infinity', label: 'INFINITY', min: 0, max: 1, def: 0.62, fmt: fmtInfinity,
        hint: 'how much the field decides for itself' },
      { key: 'timeScale', label: 'TIME SCALE', min: 0, max: 1, def: 0.55, fmt: fmtTimeScale,
        hint: 'the rate at which subtraction operates' },
    ],
  },
  {
    name: 'DENSITY',
    note: 'How much of the source is allowed to remain.',
    params: [
      { key: 'density', label: 'REMAINS', min: 0, max: 1, def: 1, fmt: fmtPct,
        hint: '100% infinite · 50% partly revealed · 10% ghosts · 0% silence' },
    ],
  },
  {
    name: 'ABSENCE',
    note: 'Four absences exist in the field. They remove nothing until they are deepened.',
    params: [
      { key: 'absenceSize', label: 'SIZE', min: 0, max: 1, def: 0.22, fmt: fmtPct,
        hint: 'how large a hole each absence makes' },
      { key: 'focus', label: 'FOCUS', min: 0, max: 1, def: 0.35, fmt: fmtPct,
        hint: 'spectral band ← → localised hole in the stereo field' },
      { key: 'movementMode', label: 'MOVEMENT', type: 'select', def: 'wander',
        options: ['static', 'drift', 'wander', 'orbit', 'walk', 'tidal', 'gravity', 'attractor'],
        hint: 'the sound evolves because the thing removing it moves' },
      { key: 'movementRate', label: 'RATE', min: 0, max: 1, def: 0.3, fmt: fmtPct },
    ],
  },
  {
    name: 'SPECTRAL ABSENCE',
    note: 'A void dragged through the spectrum.',
    params: [
      { key: 'spectralMode', label: 'SHAPE', type: 'select', def: 'notch',
        options: ['off', 'low', 'mid', 'high', 'notch', 'moving', 'multiple', 'excavate'],
        hint: 'which part of the spectrum is erased' },
      { key: 'spectralCentre', label: 'REMOVE', min: 0, max: 1, def: 0.5, fmt: fmtHz,
        hint: 'not a boost — the frequency that is taken out' },
      { key: 'spectralWidth', label: 'WIDTH', min: 0, max: 1, def: 0.2, fmt: fmtPct },
      { key: 'spectralAmount', label: 'AMOUNT', min: 0, max: 1, def: 0, fmt: fmtPct },
    ],
  },
  {
    name: 'TEMPORAL ABSENCE',
    note: 'Moments removed. The field goes on evolving inside the gaps.',
    params: [
      { key: 'temporalAmount', label: 'AMOUNT', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'how much time is taken out' },
      { key: 'temporalSize', label: 'SIZE', min: 0, max: 1, def: 0.35, fmt: fmtPct,
        hint: 'microscopic deletion ← → enormous regions of silence' },
      { key: 'temporalShape', label: 'EDGE', min: 0, max: 1, def: 0.5, fmt: fmtPct,
        hint: 'stutter ← → breathing' },
    ],
  },
  {
    name: 'PERSISTENCE',
    note: 'Whether subtraction is temporary or permanent.',
    params: [
      { key: 'memory', label: 'MEMORY', min: 0, max: 1, def: 0.3, fmt: fmtMemory,
        hint: 'at maximum the instrument progressively erodes itself' },
      { key: 'decay', label: 'DECAY OF ABSENCE', min: 0, max: 1, def: 0.42, fmt: fmtDecay,
        hint: 'how long removed material stays gone' },
    ],
  },
  {
    name: 'GRAVITY',
    note: 'What the subtraction is drawn toward.',
    params: [
      { key: 'gravityTarget', label: 'TARGET', type: 'select', def: 'frequency',
        options: ['frequency', 'amplitude', 'transient', 'density', 'stereo',
                  'rhythm', 'harmonic', 'noise', 'silence'],
        hint: 'transient → definition dissolves · harmonic → tone becomes atmosphere' },
      { key: 'gravityAmount', label: 'PULL', min: 0, max: 1, def: 0, fmt: fmtPct },
    ],
  },
  {
    name: 'DEPTH & SPACE',
    note: 'Sound is not silenced but made inaccessible.',
    params: [
      { key: 'depth', label: 'DIRECT REMOVAL', min: 0, max: 1, def: 0, fmt: fmtDepth, node: true,
        hint: 'remove the direct sound and the reverberant field is exposed' },
      { key: 'centreRemoval', label: 'CENTRE', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'remove the centre and the peripheral material survives' },
      { key: 'sideRemoval', label: 'SIDES', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'remove the sides and a narrow phantom centre is left' },
    ],
  },
  {
    name: 'THE VOID',
    note: 'Silence treated as material.',
    params: [
      { key: 'voidDensity', label: 'DENSITY', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'how frequently silence arrives' },
      { key: 'voidSize', label: 'SIZE', min: 0, max: 1, def: 0.4, fmt: fmtPct,
        hint: 'how much silence exists' },
      { key: 'voidDepth', label: 'DEPTH', min: 0, max: 1, def: 1, fmt: fmtPct,
        hint: 'complete silence ← → merely perceived' },
      { key: 'voidMemory', label: 'MEMORY', min: 0, max: 1, def: 0.2, fmt: fmtPct,
        hint: 'how long the silence refuses to leave' },
    ],
  },
  {
    name: 'RESIDUE',
    note: 'What subtraction leaves behind, once the veil over it is removed.',
    params: [
      { key: 'residueVeil', label: 'VEIL REMOVED', min: 0, max: 1, def: 0, fmt: fmtPct,
        hint: 'exposes the material the absences took out' },
      { key: 'residueType', label: 'KIND', type: 'select', def: 'reverberant', node: true,
        options: ['harmonic', 'granular', 'spatial', 'transient', 'reverberant', 'phase'],
        hint: 'which kind of residue survives' },
    ],
  },
  {
    name: 'OUTPUT',
    params: [
      { key: 'attenuation', label: 'ATTENUATION', min: 0, max: 1, def: 0, fmt: fmtPct, node: true,
        hint: 'level removed from the output' },
    ],
  },
];

export const ALL_PARAMS = GROUPS.flatMap((g) => g.params);

export const defaults = () => {
  const o = {};
  for (const p of ALL_PARAMS) o[p.key] = p.def;
  return o;
};

export const NODE_KEYS = new Set(ALL_PARAMS.filter((p) => p.node).map((p) => p.key));
