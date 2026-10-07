/*
 * THE PATCH BAY
 *
 * Six cords. Each one takes a control voltage from somewhere and moves one
 * control with it. Nothing here makes sound: a cord moves a knob, and every
 * knob in this instrument only ever takes something away.
 *
 * Several of the sources are the instrument listening to itself -- the
 * envelope of its own output, the gate of its own pulse, the chaos the field
 * is already using to decide what to do next. Patching those back into the
 * controls closes the loop between the field and what is removing it.
 */

export const CORDS = 6;

export const SOURCES = [
  { key: 'none', label: '— unpatched —' },

  { key: 'sine', label: 'LFO SINE', bipolar: true, rate: true },
  { key: 'triangle', label: 'LFO TRIANGLE', bipolar: true, rate: true },
  { key: 'ramp', label: 'LFO RAMP', bipolar: true, rate: true },
  { key: 'saw', label: 'LFO SAW', bipolar: true, rate: true },
  { key: 'square', label: 'LFO SQUARE', bipolar: true, rate: true },
  { key: 'random', label: 'RANDOM S&H', bipolar: true, rate: true },
  { key: 'smooth', label: 'RANDOM SMOOTH', bipolar: true, rate: true },

  { key: 'envelope', label: 'ENVELOPE FOLLOWER', rate: true,
    hint: 'the amplitude of the output, slewed by RATE' },
  { key: 'pulseGate', label: 'PULSE GATE',
    hint: 'high while the step is letting sound through' },
  { key: 'pulseStep', label: 'PULSE STEP CV',
    hint: 'the current step of the pattern, as a stepped voltage' },
  { key: 'clock', label: 'CLOCK RAMP',
    hint: 'a ramp across each step of the pulse' },

  { key: 'chaosX', label: 'FIELD CHAOS X', bipolar: true },
  { key: 'chaosY', label: 'FIELD CHAOS Y', bipolar: true },
  { key: 'centroid', label: 'SPECTRAL CENTROID',
    hint: 'where the surviving energy sits in the field' },
  { key: 'stereo', label: 'STEREO DRIFT', bipolar: true },
  { key: 'removed', label: 'REMOVED AMOUNT',
    hint: 'how much of the field is gone right now' },
];

export const SOURCE_BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));

/* 0.01 Hz to 20 Hz, so one cord can be a slow tide and the next a flutter. */
export const cordHz = (v) => Math.pow(10, -2 + v * 3.3);
export const fmtRate = (v) => {
  const hz = cordHz(v);
  if (hz >= 1) return hz.toFixed(2) + ' Hz';
  const s = 1 / hz;
  return s < 90 ? s.toFixed(1) + ' s' : (s / 60).toFixed(1) + ' min';
};
export const fmtDepth = (v) =>
  (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v * 100)) + '%';

const TAU = Math.PI * 2;

export class Modulation {
  constructor() {
    this.cords = Array.from({ length: CORDS }, () => ({
      source: 'none', dest: 'none', rate: 0.35, depth: 0,
    }));
    this.phase = new Float32Array(CORDS);
    this.rndFrom = new Float32Array(CORDS);
    this.rndTo = new Float32Array(CORDS);
    this.env = 0;
    this.values = new Float32Array(CORDS);   // what each cord is putting out
    for (let i = 0; i < CORDS; i++) {
      this.rndFrom[i] = Math.random() * 2 - 1;
      this.rndTo[i] = Math.random() * 2 - 1;
    }
  }

  /* The envelope follower, fed from the output's own level. */
  trackEnvelope(level, dt, slew) {
    const up = 1 - Math.exp(-dt / Math.max(0.004, slew * 0.25));
    const down = 1 - Math.exp(-dt / Math.max(0.02, slew));
    this.env += (level - this.env) * (level > this.env ? up : down);
    return Math.min(1, this.env * 2.2);
  }

  /* One cord's voltage this frame. `field` is what the instrument knows about
   * itself: the pulse, the chaos, the shape of what survived. */
  read(i, dt, field) {
    const c = this.cords[i];
    const src = SOURCE_BY_KEY.get(c.source);
    if (!src || c.source === 'none') return 0;

    if (src.rate && c.source !== 'envelope') {
      const hz = cordHz(c.rate);
      const prev = this.phase[i];
      this.phase[i] = (prev + hz * dt) % 1;
      if (this.phase[i] < prev) {                 // wrapped: new random value
        this.rndFrom[i] = this.rndTo[i];
        this.rndTo[i] = Math.random() * 2 - 1;
      }
    }
    const ph = this.phase[i];

    switch (c.source) {
      case 'sine': return Math.sin(ph * TAU);
      case 'triangle': return 4 * Math.abs(ph - 0.5) - 1;
      case 'ramp': return ph * 2 - 1;
      case 'saw': return 1 - ph * 2;
      case 'square': return ph < 0.5 ? 1 : -1;
      case 'random': return this.rndTo[i];
      case 'smooth': {
        const t = ph * ph * (3 - 2 * ph);
        return this.rndFrom[i] + (this.rndTo[i] - this.rndFrom[i]) * t;
      }
      case 'envelope': return this.trackEnvelope(field.level, dt, cordHz(c.rate) > 0 ? 1 / cordHz(c.rate) : 1);
      case 'pulseGate': return field.gate;
      case 'pulseStep': return field.stepValue;
      case 'clock': return field.clock;
      case 'chaosX': return field.chaosX;
      case 'chaosY': return field.chaosY;
      case 'centroid': return field.centroid;
      case 'stereo': return field.stereo;
      case 'removed': return field.removed;
      default: return 0;
    }
  }

  /* Returns { dest: offset } for every patched cord, in parameter units. */
  evaluate(dt, field, ranges) {
    const out = {};
    for (let i = 0; i < CORDS; i++) {
      const c = this.cords[i];
      const v = this.read(i, dt, field);
      this.values[i] = v;
      if (c.source === 'none' || c.dest === 'none' || !c.depth) continue;
      const span = ranges[c.dest] || 1;
      out[c.dest] = (out[c.dest] || 0) + v * c.depth * span;
    }
    return out;
  }

  serialise() { return this.cords.map((c) => ({ ...c })); }
  restore(cords) {
    if (!Array.isArray(cords)) return;
    cords.forEach((c, i) => { if (i < CORDS) Object.assign(this.cords[i], c); });
  }
}
