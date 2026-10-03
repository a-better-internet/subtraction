/*
 * THE EXCAVATOR
 *
 * Everything the player does happens here, and everything it does is removal.
 *
 * The field is analysed with a short-time Fourier transform. Each bin is
 * placed in a two-dimensional field -- vertical axis frequency, horizontal
 * axis stereo position -- and a set of absences is subtracted from it.
 *
 *   bin gain = (product of every absence covering it) x (1 - its scar)
 *
 * Nothing is ever multiplied above unity. There is no path in this file that
 * makes a bin louder than it arrived.
 *
 * Output 0 carries what survived. Output 1 carries the residue: literally the
 * spectrum that was removed, which the node graph can expose once the
 * material masking it is gone.
 */

const N = 4096;          // analysis window: fine enough to resolve a
                         // harmonic comb on a low root
const HOP = 1024;        // 75% overlap
const NB = N / 2 + 1;    // bins
const VOIDS = 4;
const DISPLAY_BANDS = 160;
const GROUPS = 16;       // band groups for rhythm detection
const RING = 192;        // frames of group-energy history (~2.2 s)
const F_MIN = 25;
const PATTERN_STEPS = 16;

/* Scale degrees in semitones. 'series' is not a scale -- it keeps one true
 * harmonic series, whose partials are not tempered at all. */
const SCALES = {
  octaves: [0],
  fifths: [0, 7],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  whole: [0, 2, 4, 6, 8, 10],
};
const ARP_FALLBACK = [0, 4, 7];
const DIVISIONS = { '1/4': 1, '1/8': 2, '1/8T': 3, '1/16': 4, '1/16T': 6, '1/32': 8 };
const MAX_PARTIAL = 64;

/* ------------------------------------------------------------------ */

class FFT {
  constructor(n) {
    this.n = n;
    this.levels = Math.log2(n) | 0;
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos(2 * Math.PI * i / n);
      this.sin[i] = Math.sin(2 * Math.PI * i / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let x = i, r = 0;
      for (let j = 0; j < this.levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
  }

  forward(re, im) {
    const n = this.n, rev = this.rev, cos = this.cos, sin = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  }

  inverse(re, im) {
    const n = this.n;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.forward(re, im);
    const s = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= -s; }
  }
}

class Rng {
  constructor(seed) { this.s = seed | 0 || 0x1f123bb5; }
  next() {
    let x = this.s;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.s = x | 0;
    return (x >>> 0) / 4294967296;
  }
  bi() { return this.next() * 2 - 1; }
  range(a, b) { return a + (b - a) * this.next(); }
}

const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};

/* Finite-support absence kernel: a clean hole with soft walls. */
const kernel = (d) => d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * d));

/* ------------------------------------------------------------------ */

class ExcavatorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rng = new Rng(0x2c9f71a3);
    this.fft = new FFT(N);
    this.frameTime = HOP / sampleRate;

    // Hann window; Hann analysis + Hann synthesis at 75% overlap sums to 1.5.
    this.win = new Float32Array(N);
    for (let i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    this.olaNorm = 1 / 1.5;

    // --- input / output plumbing ---
    this.inL = new Float32Array(N);
    this.inR = new Float32Array(N);
    this.pendL = new Float32Array(HOP);
    this.pendR = new Float32Array(HOP);
    this.pendFill = 0;
    this.olaL = new Float32Array(N);
    this.olaR = new Float32Array(N);
    this.olaResL = new Float32Array(N);
    this.olaResR = new Float32Array(N);
    const qCap = N * 4;
    this.qCap = qCap;
    this.qL = new Float32Array(qCap);
    this.qR = new Float32Array(qCap);
    this.qResL = new Float32Array(qCap);
    this.qResR = new Float32Array(qCap);
    this.qRead = 0;
    this.qWrite = 0;
    this.qCount = 0;

    // --- fft scratch ---
    this.reL = new Float32Array(N); this.imL = new Float32Array(N);
    this.reR = new Float32Array(N); this.imR = new Float32Array(N);
    this.rsL = new Float32Array(N); this.isL = new Float32Array(N);
    this.rsR = new Float32Array(N); this.isR = new Float32Array(N);

    // --- per-bin analysis state ---
    this.mag = new Float32Array(NB);
    this.magL = new Float32Array(NB);
    this.magR = new Float32Array(NB);
    this.prevMag = new Float32Array(NB);
    this.flux = new Float32Array(NB);
    this.pos = new Float32Array(NB);
    this.prom = new Float32Array(NB);
    this.weight = new Float32Array(NB);

    // --- per-bin subtraction state ---
    this.scar = new Float32Array(NB);     // persistent absence (MEMORY)
    this.gate = new Float32Array(NB);     // smoothed mask, avoids bin clicks
    this.rank = new Float32Array(NB);     // drifting survival rank (DENSITY)
    this.finalGain = new Float32Array(NB);
    for (let b = 0; b < NB; b++) { this.gate[b] = 1; this.rank[b] = this.rng.next(); }

    // --- bin geometry: frequency -> normalised vertical position ---
    this.binY = new Float32Array(NB);
    this.binFreq = new Float32Array(NB);
    this.binLog2 = new Float32Array(NB);
    this.binGroup = new Uint8Array(NB);
    const fMax = sampleRate * 0.5;
    const lmin = Math.log(F_MIN), lspan = Math.log(fMax) - lmin;
    for (let b = 0; b < NB; b++) {
      const f = Math.max(F_MIN, b * sampleRate / N);
      this.binFreq[b] = f;
      this.binLog2[b] = Math.log2(f);
      this.binY[b] = clamp((Math.log(f) - lmin) / lspan, 0, 1);
      this.binGroup[b] = Math.min(GROUPS - 1, (this.binY[b] * GROUPS) | 0);
    }

    // --- display band mapping ---
    this.bandStart = new Uint16Array(DISPLAY_BANDS + 1);
    for (let i = 0; i <= DISPLAY_BANDS; i++) {
      const y = i / DISPLAY_BANDS;
      const f = Math.exp(lmin + y * lspan);
      this.bandStart[i] = clamp(Math.round(f * N / sampleRate), 1, NB - 1);
    }

    // log2 of each partial number, so the series needs no logarithm per bin
    this.log2k = new Float32Array(MAX_PARTIAL + 1);
    for (let k = 1; k <= MAX_PARTIAL; k++) this.log2k[k] = Math.log2(k);

    this.binMinSemis = new Float32Array(NB);
    const binHz = sampleRate / N;
    for (let b = 0; b < NB; b++) {
      this.binMinSemis[b] = 12 * Math.log2(1 + 1.15 * binHz / this.binFreq[b]);
    }

    // --- the harmonic comb and the roll-off curve ---
    this.harmKeep = new Float32Array(NB);
    this.harmKeep.fill(1);
    this.tilt = new Float32Array(NB);
    this.tilt.fill(1);

    // --- rhythm detection ---
    this.groupRing = new Float32Array(GROUPS * RING);
    this.ringIdx = 0;
    this.rhythm = new Float32Array(GROUPS);

    // --- absences ---
    this.vx = new Float32Array(VOIDS);
    this.vy = new Float32Array(VOIDS);
    this.ox = new Float32Array(VOIDS);   // motion offset
    this.oy = new Float32Array(VOIDS);
    this.wx = new Float32Array(VOIDS);   // random-walk velocity
    this.wy = new Float32Array(VOIDS);
    this.phase = new Float32Array(VOIDS);
    for (let v = 0; v < VOIDS; v++) {
      this.phase[v] = this.rng.next();
      this.vy[v] = 0.5;
    }
    this.lx = 0.1; this.ly = 0; this.lz = 0;   // attractor for 'attractor' mode
    this.sweep = 0;                            // moving-notch sweep phase
    this.gravX = 0; this.gravY = 0.5;

    // --- time-domain absence engines ---
    this.tGate = 1; this.tTarget = 1; this.tCount = 0; this.tIn = false; this.tCoef = 0.3;
    this.vGate = 1; this.vTarget = 1; this.vCount = 0; this.vIn = false; this.vCoef = 0.3;
    this.duck = 0;

    // --- the pulse and its arpeggio ---
    this.pattern = new Float32Array(PATTERN_STEPS);
    for (let i = 0; i < PATTERN_STEPS; i++) this.pattern[i] = i % 4 === 0 ? 0 : 1;
    this.pulseStep = -1;
    this.pulseCount = 0;
    this.pulseGate = 1;
    this.pulseTarget = 1;
    this.pulseCoef = 0.3;
    this.arpIndex = 0;
    this.arpDir = 1;
    this.arpOffset = 0;

    this.frames = 0;
    this.removedFrac = 0;

    // --- parameters (all default to "nothing removed") ---
    this.p = {
      density: 1,
      absenceSize: 0.22, focus: 0.35,
      movementMode: 'static', movementRate: 0.3,
      memory: 0, decay: 0.3,
      gravityTarget: 'frequency', gravityAmount: 0,
      spectralMode: 'off', spectralCentre: 0.5, spectralWidth: 0.2, spectralAmount: 0,
      temporalAmount: 0, temporalSize: 0.35, temporalShape: 0.5,
      voidSize: 0.4, voidDensity: 0, voidDepth: 1, voidMemory: 0, voidMovement: 0.3,
      centreRemoval: 0, sideRemoval: 0,
      residueVeil: 0, timeScale: 0.55, infinity: 0.62,
      harmonicMode: 'off', harmonicRoot: 0.35, harmonicAmount: 0, harmonicWidth: 0.28,
      rolloff: 0.2, rolloffSlope: 0.4,
      pulseAmount: 0, pulseTempo: 0.27, pulseDivision: '1/16', pulseSteps: 16,
      pulseSwing: 0, pulseEdge: 0.12,
      arpMode: 'off', arpRange: 0.34,
      voids: [
        { x: 0, y: 0.5, depth: 0, size: 1 },
        { x: -0.55, y: 0.3, depth: 0, size: 1 },
        { x: 0.55, y: 0.72, depth: 0, size: 1 },
        { x: 0, y: 0.9, depth: 0, size: 1 },
      ],
    };

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.type === 'params') {
        Object.assign(this.p, d.values);
      } else if (d.type === 'void') {
        const v = this.p.voids[d.index];
        if (v) Object.assign(v, d.values);
      } else if (d.type === 'pattern') {
        for (let i = 0; i < PATTERN_STEPS; i++) this.pattern[i] = d.values[i] || 0;
      } else if (d.type === 'heal') {
        // RELEASE: let the scars close. Not an addition -- just ceasing to remove.
        this.scar.fill(0);
      }
    };
  }

  /* ---------------- motion of the absences ---------------- */

  /* TIME SCALE: micro (tens of Hz) through human (Hz) to geological (hours). */
  motionHz() {
    return Math.pow(10, 1.7 - 4.7 * clamp(this.p.timeScale, 0, 1));
  }

  updateVoids(dt) {
    const p = this.p;
    const base = this.motionHz() * (0.15 + 1.85 * p.movementRate);
    const inf = p.infinity;
    const mode = p.movementMode;

    // The attractor path, shared by 'attractor' mode and high INFINITY drift.
    const h = Math.min(0.02, dt * base * 12);
    const a = 10, bb = 28, c = 8 / 3;
    this.lx += h * (a * (this.ly - this.lx));
    this.ly += h * (this.lx * (bb - this.lz) - this.ly);
    this.lz += h * (this.lx * this.ly - c * this.lz);

    for (let v = 0; v < VOIDS; v++) {
      const ph = this.phase[v] = (this.phase[v] + dt * base) % 1;
      const tau = ph * Math.PI * 2;
      const seed = v * 1.7 + 0.4;
      let ox = 0, oy = 0;

      switch (mode) {
        case 'static':
          break;
        case 'drift': {
          // Slow unidirectional travel; reflects at the edges of the field.
          const dir = v % 2 ? 1 : -1;
          ox = Math.asin(Math.sin(tau * 0.31 + seed)) * (2 / Math.PI) * dir;
          oy = Math.asin(Math.sin(tau * 0.21 + seed * 2)) * (2 / Math.PI) * 0.6;
          break;
        }
        case 'wander': {
          // Smooth 2-D noise from irrational-ratio sines: never repeats.
          ox = (Math.sin(tau + seed) + 0.6 * Math.sin(tau * 1.618 + seed * 3)
                + 0.35 * Math.sin(tau * 2.414 + seed * 5)) / 1.95;
          oy = (Math.sin(tau * 0.83 + seed * 2) + 0.6 * Math.sin(tau * 1.414 + seed)
                + 0.35 * Math.sin(tau * 2.236 + seed * 7)) / 1.95 * 0.7;
          break;
        }
        case 'orbit':
          ox = Math.cos(tau + seed);
          oy = Math.sin(tau + seed) * 0.5;
          break;
        case 'walk': {
          // Random walk with momentum.
          const step = dt * base * 6;
          this.wx[v] += this.rng.bi() * step;
          this.wy[v] += this.rng.bi() * step;
          this.wx[v] *= 0.985; this.wy[v] *= 0.985;
          this.ox[v] = clamp(this.ox[v] + this.wx[v], -1, 1);
          this.oy[v] = clamp(this.oy[v] + this.wy[v], -1, 1);
          ox = this.ox[v]; oy = this.oy[v];
          break;
        }
        case 'tidal': {
          // A tide: the whole spectrum floods and drains.
          const t = Math.sin(tau * 0.25 + v * 0.15);
          oy = t;
          ox = Math.sin(tau * 0.11 + seed) * 0.35;
          break;
        }
        case 'gravity':
          // Motion is almost entirely the pull, applied below.
          break;
        case 'attractor':
          ox = clamp(this.lx / 18, -1, 1);
          oy = clamp((this.lz - 24) / 26, -1, 1) * (v % 2 ? 1 : -1);
          break;
      }

      if (mode !== 'walk') {
        // Smooth toward the computed offset so mode changes do not jump.
        const g = Math.min(1, dt * 12);
        this.ox[v] += (ox - this.ox[v]) * g;
        this.oy[v] += (oy - this.oy[v]) * g;
        ox = this.ox[v]; oy = this.oy[v];
      }

      // INFINITY adds autonomous drift: the field moves the absences itself.
      const auto = inf * inf * 0.45;
      const ax = ox + auto * Math.sin(tau * 0.37 + seed * 11);
      const ay = oy + auto * Math.sin(tau * 0.29 + seed * 13);

      const anchor = this.p.voids[v];
      const spread = 0.55;
      let tx = clamp(anchor.x + ax * spread, -1, 1);
      let ty = clamp(anchor.y + ay * spread * 0.5, 0, 1);

      // GRAVITY: the absence is drawn toward whatever it has been told to seek.
      const pull = this.p.gravityAmount * (mode === 'gravity' ? 1 : 0.55);
      if (pull > 0.001) {
        const k = Math.min(1, dt * (0.4 + 6 * this.p.gravityAmount) * 3);
        tx += (this.gravX - tx) * k * pull;
        ty += (this.gravY - ty) * k * pull;
      }

      const follow = Math.min(1, dt * 18);
      this.vx[v] += (tx - this.vx[v]) * follow;
      this.vy[v] += (ty - this.vy[v]) * follow;
    }
  }

  /* ---------------- what the subtraction is attracted to ---------------- */

  computeGravity() {
    const p = this.p;
    const w = this.weight;
    const mag = this.mag, flux = this.flux, prom = this.prom, pos = this.pos;
    const target = p.gravityTarget;

    let peak = 1e-9;
    for (let b = 1; b < NB; b++) if (mag[b] > peak) peak = mag[b];
    const inv = 1 / peak;

    for (let b = 1; b < NB; b++) {
      const m = mag[b] * inv;
      let x;
      switch (target) {
        case 'amplitude': x = m * m * m; break;
        case 'transient': x = flux[b] * inv * 3; break;
        case 'density': {
          // Local population of significant bins.
          let c = 0;
          for (let k = Math.max(1, b - 6); k < Math.min(NB, b + 7); k++) {
            if (mag[k] * inv > 0.06) c++;
          }
          x = (c / 13) * m;
          break;
        }
        case 'stereo': x = m * Math.abs(pos[b]); break;
        case 'rhythm': x = m * this.rhythm[this.binGroup[b]]; break;
        case 'harmonic': x = m * clamp(prom[b] - 1, 0, 6) / 6; break;
        case 'noise': x = m * (1 - clamp(prom[b] - 1, 0, 3) / 3); break;
        case 'silence': x = 1 / (1 + m * 40); break;
        case 'frequency':
        default: x = m; break;
      }
      w[b] = x < 0 ? 0 : x;
    }

    let sum = 0, sx = 0, sy = 0;
    for (let b = 1; b < NB; b++) {
      const q = w[b];
      sum += q; sx += q * pos[b]; sy += q * this.binY[b];
    }
    if (sum > 1e-7) {
      const gx = sx / sum, gy = sy / sum;
      // Glide so the target point is a place, not a jitter.
      this.gravX += (gx - this.gravX) * 0.12;
      this.gravY += (gy - this.gravY) * 0.12;
    }
  }

  /* ---------------- the spectral absence shapes ---------------- */

  spectralMask(y) {
    const p = this.p;
    const amt = p.spectralAmount;
    if (amt <= 0.001 || p.spectralMode === 'off') return 1;
    const c = p.spectralCentre;
    const w = 0.02 + p.spectralWidth * 0.5;
    let k = 0;

    switch (p.spectralMode) {
      case 'low':    k = 1 - smoothstep(c - w * 0.5, c + w * 0.5, y); break;
      case 'high':   k = smoothstep(c - w * 0.5, c + w * 0.5, y); break;
      case 'mid':    k = kernel(Math.abs(y - c) / Math.max(0.02, w * 1.6)); break;
      case 'notch':  k = kernel(Math.abs(y - c) / Math.max(0.008, w * 0.4)); break;
      case 'moving': {
        const cc = (c + this.sweep) % 1;
        k = kernel(Math.abs(y - cc) / Math.max(0.008, w * 0.45));
        break;
      }
      case 'multiple': {
        // Four absences spaced through the spectrum.
        for (let i = 0; i < 4; i++) {
          const cc = (c + i * 0.25) % 1;
          k = Math.max(k, kernel(Math.abs(y - cc) / Math.max(0.008, w * 0.3)));
        }
        break;
      }
      case 'excavate': {
        // A comb of narrow voids: spectral excavation.
        const period = 0.02 + w * 0.22;
        const d = Math.abs(((y / period) % 1) - 0.5) * 2;
        k = kernel(d / 0.55);
        break;
      }
    }
    return 1 - amt * k;
  }

  /* ---------------- what is in tune, and what is air ---------------- */

  /* The root in Hz, including whatever step of the arpeggio is standing. */
  rootHz() {
    const midi = Math.round(12 + this.p.harmonicRoot * 60) + this.arpOffset;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /* Per-bin survival under HARMONIC ABSENCE: 1 where a frequency is in tune
   * with the root, 0 where it is not. Everything between is taken away in
   * proportion to SELECTIVITY. */
  buildHarmonic(keep) {
    const p = this.p;
    const mode = p.harmonicMode;
    if (mode === 'off' || p.harmonicAmount <= 0.001) { keep.fill(1); return; }

    const amount = p.harmonicAmount;
    const widthSemis = (8 + p.harmonicWidth * 192) / 100;
    const f0 = this.rootHz();
    const l0 = Math.log2(f0);
    const minSemis = this.binMinSemis;

    if (mode === 'series') {
      // A true harmonic series: partial k sits at k * f0, untempered.
      for (let b = 1; b < NB; b++) {
        let k = Math.round(this.binFreq[b] / f0);
        if (k < 1) k = 1;
        // Above MAX_PARTIAL the partials are closer together than any
        // tolerance could separate, so nothing up there is out of tune.
        const d = k > MAX_PARTIAL ? 0
          : Math.abs(12 * (this.binLog2[b] - (l0 + this.log2k[k])));
        const w = Math.max(minSemis[b], widthSemis);
        keep[b] = 1 - amount * (1 - kernel(d / w));
      }
    } else {
      // A scale: its degrees survive in every octave. Down where a bin is as
      // wide as the gap between two degrees, no comb can separate them -- so
      // rather than smear a half-removal across the bass, the comb lets go.
      const degrees = SCALES[mode] || SCALES.octaves;
      for (let b = 1; b < NB; b++) {
        const resolvable = 1 - smoothstep(0.45, 0.8, minSemis[b]);
        if (resolvable <= 0.001) { keep[b] = 1; continue; }
        const semis = 12 * (this.binLog2[b] - l0);
        let pc = semis % 12;
        if (pc < 0) pc += 12;
        let best = 12;
        for (let i = 0; i < degrees.length; i++) {
          let d = Math.abs(pc - degrees[i]);
          if (d > 6) d = 12 - d;            // wrap around the octave
          if (d < best) best = d;
        }
        const w = Math.max(minSemis[b], widthSemis);
        keep[b] = 1 - amount * resolvable * (1 - kernel(best / w));
      }
    }
    keep[0] = keep[1];
  }

  /* ROLL-OFF. Applied to the survivor and the residue alike, after the two are
   * separated -- it is the air taken off the whole output, not an excavation,
   * so it must not reappear in the residue as material that was 'removed'. */
  buildTilt() {
    const p = this.p;
    const t = this.tilt;
    if (p.rolloff < 0.01) { t.fill(1); return; }
    const corner = Math.log2(20000 * Math.pow(800 / 20000, p.rolloff));
    const perOct = -(6 + p.rolloffSlope * 30) / 6;   // octaves of halving
    for (let b = 0; b < NB; b++) {
      const above = this.binLog2[b] - corner;
      t[b] = above <= 0 ? 1 : Math.pow(2, perOct * above);
    }
  }

  /* ---------------- the pulse ---------------- */

  schedulePulse() {
    const p = this.p;
    const steps = clamp(Math.round(p.pulseSteps), 2, PATTERN_STEPS);
    this.pulseStep = (this.pulseStep + 1) % steps;

    const stepsPerSec = (20 + p.pulseTempo * 220) / 60 * (DIVISIONS[p.pulseDivision] || 4);
    let len = sampleRate / stepsPerSec;
    // Swing lengthens every other step and shortens the one after it.
    const sw = p.pulseSwing * 0.66;
    len *= (this.pulseStep & 1) ? 1 - sw * 0.5 : 1 + sw * 0.5;
    this.pulseCount = Math.max(32, len);

    const depth = this.pattern[this.pulseStep] * p.pulseAmount;
    this.pulseTarget = 1 - depth;
    const ramp = Math.max(1, p.pulseEdge * len * 0.4);
    this.pulseCoef = 1 - Math.exp(-1 / ramp);

    this.advanceArp();
  }

  /* The arpeggio does not play notes. It moves the root, so a different set of
   * partials is the one left standing on each step. */
  advanceArp() {
    const p = this.p;
    if (p.arpMode === 'off') { this.arpOffset = 0; return; }
    const degrees = SCALES[p.harmonicMode] || ARP_FALLBACK;
    const octaves = 1 + Math.round(p.arpRange * 3);
    const n = Math.max(1, degrees.length * octaves);

    switch (p.arpMode) {
      case 'up': this.arpIndex = (this.arpIndex + 1) % n; break;
      case 'down': this.arpIndex = (this.arpIndex - 1 + n) % n; break;
      case 'updown':
        this.arpIndex += this.arpDir;
        if (this.arpIndex >= n) { this.arpIndex = Math.max(0, n - 2); this.arpDir = -1; }
        else if (this.arpIndex < 0) { this.arpIndex = Math.min(1, n - 1); this.arpDir = 1; }
        break;
      case 'random': this.arpIndex = (this.rng.next() * n) | 0; break;
    }
    const i = clamp(this.arpIndex, 0, n - 1);
    this.arpOffset = degrees[i % degrees.length] + Math.floor(i / degrees.length) * 12;
  }

  /* ---------------- one STFT frame ---------------- */

  runFrame() {
    const p = this.p;
    const fft = this.fft;
    const win = this.win;
    const reL = this.reL, imL = this.imL, reR = this.reR, imR = this.imR;

    for (let i = 0; i < N; i++) {
      reL[i] = this.inL[i] * win[i]; imL[i] = 0;
      reR[i] = this.inR[i] * win[i]; imR[i] = 0;
    }
    fft.forward(reL, imL);
    fft.forward(reR, imR);

    // ---- analysis ----
    const mag = this.mag, magL = this.magL, magR = this.magR;
    const pos = this.pos, flux = this.flux, prom = this.prom;
    for (let b = 0; b < NB; b++) {
      const al = Math.hypot(reL[b], imL[b]);
      const ar = Math.hypot(reR[b], imR[b]);
      magL[b] = al; magR[b] = ar;
      const m = (al + ar) * 0.5;
      mag[b] = m;
      pos[b] = (ar - al) / (ar + al + 1e-9);
      const f = m - this.prevMag[b];
      flux[b] = f > 0 ? f : 0;
      this.prevMag[b] = m;
    }
    for (let b = 2; b < NB - 2; b++) {
      const nbh = (mag[b - 2] + mag[b - 1] + mag[b + 1] + mag[b + 2]) * 0.25;
      prom[b] = mag[b] / (nbh + 1e-9);
    }
    prom[0] = prom[1] = prom[NB - 1] = prom[NB - 2] = 1;

    // group energies -> rhythm periodicity
    const gi = this.ringIdx;
    for (let g = 0; g < GROUPS; g++) this.groupRing[g * RING + gi] = 0;
    for (let b = 1; b < NB; b++) {
      this.groupRing[this.binGroup[b] * RING + gi] += mag[b];
    }
    this.ringIdx = (gi + 1) % RING;
    if (p.gravityTarget === 'rhythm' && this.frames % 24 === 0) this.computeRhythm();

    this.computeGravity();

    const dt = this.frameTime;
    this.sweep = (this.sweep + dt * this.motionHz() * (0.3 + 2 * p.movementRate)) % 1;
    this.updateVoids(dt);

    // ---- build the mask ----
    const size = (0.035 + p.absenceSize * 0.95);
    const focus = p.focus;
    const scar = this.scar, gate = this.gate, fg = this.finalGain, rank = this.rank;

    // DENSITY: a drifting survival rank. Which fragments survive changes with
    // time, so low density gives moving ghosts rather than a fixed filter.
    const rstep = (0.12 + 6.4 * (1 - p.timeScale)) * dt * (0.3 + 1.4 * p.infinity);
    const thresh = p.density * 1.15 - 0.08;

    let peak = 1e-9;
    for (let b = 1; b < NB; b++) if (mag[b] > peak) peak = mag[b];
    const invPeak = 1 / peak;

    // MEMORY / DECAY OF ABSENCE: instant -> seconds -> minutes -> indefinite.
    const decaySec = Math.pow(10, -2 + 4.2 * p.decay);
    const indefinite = p.decay > 0.985;
    const recov = indefinite ? 1 : Math.exp(-dt / decaySec);

    let removedSum = 0;

    this.buildHarmonic(this.harmKeep);
    this.buildTilt();
    const harm = this.harmKeep;

    for (let b = 1; b < NB; b++) {
      const y = this.binY[b];
      const px = pos[b];
      let m = this.spectralMask(y) * harm[b];

      // the four absences in the two-dimensional field
      for (let v = 0; v < VOIDS; v++) {
        const vd = p.voids[v].depth;
        if (vd <= 0.001) continue;
        const r = Math.max(0.02, size * p.voids[v].size);
        const dy = (y - this.vy[v]) / r;
        // FOCUS decides whether an absence is a band across the whole stereo
        // field or a localised hole somewhere inside it.
        const dx = (px - this.vx[v]) * 0.5 * focus / r;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1) m *= 1 - vd * kernel(d);
      }

      // density
      let rk = rank[b] + this.rng.bi() * rstep;
      if (rk < 0) rk = -rk; else if (rk > 1) rk = 2 - rk;
      rank[b] = rk;
      if (p.density < 0.999) {
        // Loud material is favoured to survive, but the bonus is scaled by
        // DENSITY itself -- otherwise the loudest bins outlive density 0 and
        // the bottom of the control is not silence.
        const t = thresh + 0.3 * p.density * (mag[b] * invPeak);
        m *= smoothstep(rk - 0.05, rk + 0.05, t);
      }

      // smooth the per-bin mask so bins never switch in a single frame
      gate[b] += (m - gate[b]) * 0.38;
      const gm = gate[b];

      // scar tissue: once removed, material takes time to return
      const absence = 1 - gm;
      let sc = scar[b] * recov;
      const written = p.memory * absence;
      if (written > sc) sc = written;
      scar[b] = sc;

      const g = gm * (1 - sc);
      fg[b] = g < 0 ? 0 : g;
      removedSum += 1 - fg[b];
    }
    fg[0] = fg[1];
    this.removedFrac = removedSum / (NB - 1);
    // The scar field is long-lived state: a single non-finite value in it
    // would silence the instrument permanently rather than for one frame.
    if (!Number.isFinite(this.removedFrac)) { this.panic(); return; }

    // ---- apply: survivor and residue, with mid/side subtraction ----
    const rsL = this.rsL, isL = this.isL, rsR = this.rsR, isR = this.isR;
    const gMid = 1 - p.centreRemoval;
    const gSide = 1 - p.sideRemoval;
    const veil = p.residueVeil;

    const tilt = this.tilt;
    for (let b = 0; b < NB; b++) {
      const g = fg[b];
      const tl = tilt[b];
      // mid / side decomposition per bin
      const mre = (reL[b] + reR[b]) * 0.5, mim = (imL[b] + imR[b]) * 0.5;
      const sre = (reL[b] - reR[b]) * 0.5, sim = (imL[b] - imR[b]) * 0.5;
      const MRe = mre * gMid, MIm = mim * gMid;
      const SRe = sre * gSide, SIm = sim * gSide;

      const kl = (MRe + SRe) * g, kli = (MIm + SIm) * g;
      const kr = (MRe - SRe) * g, kri = (MIm - SIm) * g;

      // the residue is exactly what did not survive
      const rl = (reL[b] - kl) * tl, rli = (imL[b] - kli) * tl;
      const rr = (reR[b] - kr) * tl, rri = (imR[b] - kri) * tl;

      rsL[b] = kl * tl; isL[b] = kli * tl;
      rsR[b] = kr * tl; isR[b] = kri * tl;

      if (b > 0 && b < N / 2) {
        const c = N - b;
        rsL[c] = kl * tl; isL[c] = -kli * tl;
        rsR[c] = kr * tl; isR[c] = -kri * tl;
      }
      // stash residue in the mirrored half of the fft arrays we are done with
      reL[b] = rl * veil; imL[b] = rli * veil;
      reR[b] = rr * veil; imR[b] = rri * veil;
    }
    // hermitian completion for the residue spectra
    for (let b = 1; b < N / 2; b++) {
      const c = N - b;
      reL[c] = reL[b]; imL[c] = -imL[b];
      reR[c] = reR[b]; imR[c] = -imR[b];
    }

    fft.inverse(rsL, isL);
    fft.inverse(rsR, isR);
    fft.inverse(reL, imL);
    fft.inverse(reR, imR);

    // ---- overlap-add ----
    const nrm = this.olaNorm;
    for (let i = 0; i < N; i++) {
      const w = win[i] * nrm;
      this.olaL[i] += rsL[i] * w;
      this.olaR[i] += rsR[i] * w;
      this.olaResL[i] += reL[i] * w;
      this.olaResR[i] += reR[i] * w;
    }

    // push the finished hop into the output queue
    this.pushOut(this.olaL, this.olaR, this.olaResL, this.olaResR, HOP);
    this.olaL.copyWithin(0, HOP); this.olaL.fill(0, N - HOP);
    this.olaR.copyWithin(0, HOP); this.olaR.fill(0, N - HOP);
    this.olaResL.copyWithin(0, HOP); this.olaResL.fill(0, N - HOP);
    this.olaResR.copyWithin(0, HOP); this.olaResR.fill(0, N - HOP);

    // ---- transient removal, when gravity seeks attacks ----
    if (p.gravityTarget === 'transient' && p.gravityAmount > 0.001) {
      let tf = 0;
      for (let b = 1; b < NB; b++) tf += flux[b];
      tf *= invPeak / NB * 1000;
      if (tf > 0.55) this.duck = 1;
    }

    this.frames++;
    if (this.frames % 2 === 0) this.postSnapshot();
  }

  /* Discard all accumulated subtraction state. Only reached if something has
   * gone non-finite; the absences themselves are untouched. */
  panic() {
    this.scar.fill(0);
    this.gate.fill(1);
    this.prevMag.fill(0);
    this.olaL.fill(0); this.olaR.fill(0);
    this.olaResL.fill(0); this.olaResR.fill(0);
    this.qL.fill(0); this.qR.fill(0);
    this.qResL.fill(0); this.qResR.fill(0);
    this.inL.fill(0); this.inR.fill(0);
    this.removedFrac = 0;
    this.pulseGate = 1;
  }

  computeRhythm() {
    for (let g = 0; g < GROUPS; g++) {
      const off = g * RING;
      let mean = 0;
      for (let i = 0; i < RING; i++) mean += this.groupRing[off + i];
      mean /= RING;
      let energy = 0;
      for (let i = 0; i < RING; i++) {
        const d = this.groupRing[off + i] - mean;
        energy += d * d;
      }
      if (energy < 1e-12) { this.rhythm[g] = 0; continue; }
      let best = 0;
      for (let lag = 6; lag < 96; lag++) {
        let acc = 0;
        for (let i = 0; i < RING - lag; i++) {
          const a = this.groupRing[off + i] - mean;
          const b = this.groupRing[off + i + lag] - mean;
          acc += a * b;
        }
        const r = acc / energy;
        if (r > best) best = r;
      }
      this.rhythm[g] = clamp(best, 0, 1);
    }
  }

  pushOut(l, r, rl, rr, count) {
    for (let i = 0; i < count; i++) {
      const w = (this.qWrite + i) % this.qCap;
      this.qL[w] = l[i]; this.qR[w] = r[i];
      this.qResL[w] = rl[i]; this.qResR[w] = rr[i];
    }
    this.qWrite = (this.qWrite + count) % this.qCap;
    this.qCount = Math.min(this.qCap, this.qCount + count);
  }

  /* ---------------- temporal absence and the void ---------------- */

  scheduleTemporal() {
    const p = this.p;
    const sr = sampleRate;
    const inf = p.infinity;
    // Absence length follows TIME SCALE and ABSENCE SIZE together:
    // micro -> a few milliseconds, geological -> minutes of nothing.
    const lenSec = Math.pow(10, -2.4 + 3.4 * p.timeScale) * (0.15 + 1.85 * p.temporalSize);
    const jitter = 1 + inf * this.rng.bi() * 0.6;

    if (this.tIn) {
      this.tIn = false;
      const amt = Math.max(0.001, p.temporalAmount);
      const present = lenSec * (1 / amt - 1);
      this.tCount = Math.max(32, clamp(present, 0.002, 600) * sr * jitter);
      this.tTarget = 1;
    } else {
      this.tIn = true;
      this.tCount = Math.max(32, lenSec * sr * jitter);
      this.tTarget = 0;
    }
    const ramp = Math.max(1, p.temporalShape * lenSec * 0.45 * sr);
    this.tCoef = 1 - Math.exp(-1 / ramp);
  }

  scheduleVoid() {
    const p = this.p;
    const sr = sampleRate;
    // VOID SIZE is how much silence exists; VOID DENSITY how often it arrives;
    // VOID MEMORY how long it refuses to leave.
    const lenSec = Math.pow(10, -1.5 + 2.6 * p.timeScale) * (0.1 + 3.9 * p.voidSize);

    if (this.vIn) {
      this.vIn = false;
      const amt = Math.max(0.001, p.voidDensity);
      const present = lenSec * (1 / amt - 1);
      this.vCount = Math.max(64, clamp(present, 0.01, 1200) * sr);
      this.vTarget = 1;
      this.vCoef = 1 - Math.exp(-1 / Math.max(1, 0.02 * sr));
    } else {
      this.vIn = true;
      const linger = 1 + p.voidMemory * this.rng.range(0, 8);
      this.vCount = Math.max(64, lenSec * sr * linger);
      // VOID DEPTH: whether the silence is absolute or merely perceived.
      this.vTarget = 1 - p.voidDepth;
      this.vCoef = 1 - Math.exp(-1 / Math.max(1, 0.004 * sr));
    }
  }

  /* ---------------- the UI's window into the field ---------------- */

  postSnapshot() {
    const VB = DISPLAY_BANDS;
    const data = new Float32Array(VB * 5);
    const magL = this.magL, magR = this.magR, fg = this.finalGain, scar = this.scar;
    for (let i = 0; i < VB; i++) {
      const s = this.bandStart[i];
      const e = Math.max(s + 1, this.bandStart[i + 1]);
      let al = 0, ar = 0, sc = 0, g = 0;
      for (let b = s; b < e; b++) { al += magL[b]; ar += magR[b]; sc += scar[b]; g += fg[b]; }
      const n = e - s;
      al /= n; ar /= n; sc /= n; g /= n;
      data[i] = al;
      data[VB + i] = ar;
      data[VB * 2 + i] = al * g;
      data[VB * 3 + i] = ar * g;
      data[VB * 4 + i] = sc;
    }
    const voids = [];
    for (let v = 0; v < VOIDS; v++) {
      voids.push({
        x: this.vx[v], y: this.vy[v],
        depth: this.p.voids[v].depth,
        size: Math.max(0.02, (0.035 + this.p.absenceSize * 0.95) * this.p.voids[v].size),
      });
    }
    this.port.postMessage({
      type: 'frame', bands: data, voids,
      gate: this.tGate * this.vGate * this.pulseGate,
      step: this.pulseStep,
      root: this.p.harmonicMode === 'off' ? 0 : this.rootHz(),
      gravX: this.gravX, gravY: this.gravY,
      removed: this.removedFrac,
    }, [data.buffer]);
  }

  /* ---------------- audio callback ---------------- */

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const res = outputs[1];
    const n = out[0].length;

    const iL = inp && inp[0] ? inp[0] : null;
    const iR = inp && inp[1] ? inp[1] : iL;

    // --- collect input into hop-sized chunks ---
    for (let i = 0; i < n; i++) {
      const xl = iL ? iL[i] : 0;
      const xr = iR ? iR[i] : 0;
      this.pendL[this.pendFill] = Number.isFinite(xl) ? xl : 0;
      this.pendR[this.pendFill] = Number.isFinite(xr) ? xr : 0;
      this.pendFill++;
      if (this.pendFill === HOP) {
        this.pendFill = 0;
        this.inL.copyWithin(0, HOP); this.inL.set(this.pendL, N - HOP);
        this.inR.copyWithin(0, HOP); this.inR.set(this.pendR, N - HOP);
        this.runFrame();
      }
    }

    // --- read survivor and residue, applying the time-domain absences ---
    const p = this.p;
    const oL = out[0], oR = out[1];
    const rL = res[0], rR = res[1];
    const temporalOn = p.temporalAmount > 0.001;
    const voidOn = p.voidDensity > 0.001;
    const pulseOn = p.pulseAmount > 0.001;
    const duckDecay = Math.exp(-1 / (0.045 * sampleRate));
    const duckAmt = p.gravityTarget === 'transient' ? p.gravityAmount : 0;

    for (let i = 0; i < n; i++) {
      let sl = 0, sr = 0, dl = 0, dr = 0;
      if (this.qCount > 0) {
        sl = this.qL[this.qRead]; sr = this.qR[this.qRead];
        dl = this.qResL[this.qRead]; dr = this.qResR[this.qRead];
        this.qRead = (this.qRead + 1) % this.qCap;
        this.qCount--;
      }

      // TEMPORAL ABSENCE: moments removed while the field keeps evolving.
      if (temporalOn) {
        if (--this.tCount <= 0) this.scheduleTemporal();
        this.tGate += (this.tTarget - this.tGate) * this.tCoef;
      } else {
        this.tGate += (1 - this.tGate) * 0.0008;
        this.tIn = false; this.tCount = 0;
      }

      // THE VOID: silence as material.
      if (voidOn) {
        if (--this.vCount <= 0) this.scheduleVoid();
        this.vGate += (this.vTarget - this.vGate) * this.vCoef;
      } else {
        this.vGate += (1 - this.vGate) * 0.0008;
        this.vIn = false; this.vCount = 0;
      }

      // THE PULSE: metrical removal, as against the free-running gaps above.
      if (pulseOn) {
        if (--this.pulseCount <= 0) this.schedulePulse();
        this.pulseGate += (this.pulseTarget - this.pulseGate) * this.pulseCoef;
      } else {
        this.pulseGate += (1 - this.pulseGate) * 0.0008;
        this.pulseCount = 0;
      }

      // attacks removed, sustain left behind
      if (duckAmt > 0.001) {
        this.duck *= duckDecay;
      } else if (this.duck > 0) {
        this.duck *= duckDecay;
      }
      const dk = 1 - this.duck * duckAmt;

      const gs = this.tGate * this.vGate * this.pulseGate * dk;
      // the residue continues through temporal gaps; the void silences all
      const gr = (0.35 + 0.65 * this.tGate) * this.vGate
        * (0.3 + 0.7 * this.pulseGate);

      oL[i] = sl * gs; oR[i] = sr * gs;
      rL[i] = dl * gr; rR[i] = dr * gr;
    }

    return true;
  }
}

registerProcessor('excavator-processor', ExcavatorProcessor);
