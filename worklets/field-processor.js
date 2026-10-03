/*
 * THE INFINITE FIELD
 *
 * A continuously self-generating source. It is deliberately too dense.
 * Nothing here is meant to be heard on its own -- the instrument's job is
 * to remove material until something becomes audible.
 *
 * Construction:
 *   - layered coloured noise (white / pink / brown)
 *   - three band-limited noise streams on drifting state-variable filters
 *   - a 24-mode inharmonic resonator bank that slowly re-tunes itself
 *   - a low mode cluster (rumble / room tone)
 *   - Lorenz chaos + LFOs at irrational frequency ratios, so no modulation
 *     cycle ever repeats
 *   - a granular layer that reads from a buffer the field writes its own
 *     output into: the source feeds on itself and is therefore inexhaustible
 *
 * There is no loop point and no start or end. INFINITY governs how much of
 * the field's behaviour is decided by the field rather than by the player.
 */

const MODES = 24;
const LOW_MODES = 3;
const GRAINS = 10;
const BUF_SECONDS = 8;

// Irrational ratios: these LFOs never return to a common phase.
const LFO_RATIOS = [1, 1.6180339887, 2.4142135623, 3.3027756377, 5.0489173395];

function softclip(x) {
  // Cheap tanh-alike. Keeps the self-feeding path bounded.
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

class Rng {
  constructor(seed) { this.s = seed | 0 || 0x9e3779b9; }
  next() {
    let x = this.s;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.s = x | 0;
    return (x >>> 0) / 4294967296;
  }
  bi() { return this.next() * 2 - 1; }
  range(a, b) { return a + (b - a) * this.next(); }
}

class FieldProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.rng = new Rng(0x5b7ac70d);

    // --- player-facing state (smoothed per block) ---
    this.infinity = 0.62;
    this.timeScale = 0.55;
    this.targetInfinity = 0.62;
    this.targetTimeScale = 0.55;

    // --- noise colouring state ---
    this.pink = new Float32Array(7);
    this.brown = 0;
    // Three drifting band-limited streams. Topology-preserving state-variable
    // filters: unconditionally stable at any cutoff below Nyquist, which a
    // Chamberlin SVF is not -- and the chaos modulation sweeps these cutoffs
    // far enough that the difference is the whole instrument going silent.
    this.svf = new Float32Array(3 * 2 * 2); // [ic1, ic2] x 3 bands x 2 ch

    // --- resonator bank ---
    // Inharmonic by construction: stretched partials with irrational spread.
    this.modeFreq = new Float32Array(MODES);
    this.modeTarget = new Float32Array(MODES);
    this.modeQ = new Float32Array(MODES);
    this.modeGain = new Float32Array(MODES);
    this.modePan = new Float32Array(MODES);
    this.modeY1 = new Float32Array(MODES);
    this.modeY2 = new Float32Array(MODES);
    for (let i = 0; i < MODES; i++) {
      const f = this.seedModeFreq(i);
      this.modeFreq[i] = f;
      this.modeTarget[i] = f;
      this.modeQ[i] = this.rng.range(0.9988, 0.99985);
      this.modeGain[i] = this.rng.range(0.25, 1) / Math.sqrt(1 + i * 0.35);
      this.modePan[i] = this.rng.bi();
    }

    // --- low mode cluster ---
    this.lowFreq = new Float32Array(LOW_MODES);
    this.lowY1 = new Float32Array(LOW_MODES);
    this.lowY2 = new Float32Array(LOW_MODES);
    for (let i = 0; i < LOW_MODES; i++) this.lowFreq[i] = this.rng.range(24, 58);

    // --- chaos + LFOs ---
    this.lx = 0.1; this.ly = 0; this.lz = 0;
    this.lfoPhase = new Float32Array(LFO_RATIOS.length);
    for (let i = 0; i < LFO_RATIOS.length; i++) this.lfoPhase[i] = this.rng.next();
    this.mod = new Float32Array(8);

    // --- self-feeding granular buffer ---
    this.bufLen = Math.floor(BUF_SECONDS * sr);
    this.bufL = new Float32Array(this.bufLen);
    this.bufR = new Float32Array(this.bufLen);
    this.writeIdx = 0;
    this.grainPos = new Float32Array(GRAINS);
    this.grainRate = new Float32Array(GRAINS);
    this.grainLen = new Float32Array(GRAINS);
    this.grainAge = new Float32Array(GRAINS);
    this.grainPanL = new Float32Array(GRAINS);
    this.grainPanR = new Float32Array(GRAINS);
    for (let g = 0; g < GRAINS; g++) {
      this.seedGrain(g);
      this.grainAge[g] = this.rng.next() * this.grainLen[g];
    }

    this.dcL = 0; this.dcR = 0;
    this.blockPhase = 0;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.type === 'params') {
        if (typeof d.infinity === 'number') this.targetInfinity = d.infinity;
        if (typeof d.timeScale === 'number') this.targetTimeScale = d.timeScale;
      }
    };
  }

  seedModeFreq(i) {
    // Stretched, irrational partial spacing -- never a harmonic series.
    const base = 46 + 14 * this.rng.next();
    return base * Math.pow(i + 1, 1.0 + 0.19 * this.rng.next()) * (1 + 0.04 * this.rng.bi());
  }

  seedGrain(g) {
    const inf = this.infinity;
    const ts = this.timeScale;
    // Grain length follows TIME SCALE: micro -> seeds of dust, geological -> slabs.
    const minLen = 0.004 * sampleRate;
    const maxLen = (0.08 + 2.2 * ts) * sampleRate;
    this.grainLen[g] = this.rng.range(minLen, maxLen);
    this.grainAge[g] = 0;
    // Read from somewhere behind the write head; never a fixed offset.
    const back = this.rng.range(0.02, BUF_SECONDS * 0.94) * sampleRate;
    this.grainPos[g] = (this.writeIdx - back + this.bufLen * 2) % this.bufLen;
    // Rate spread widens with INFINITY: the field decides more of its own pitch.
    const spread = 0.12 + 0.95 * inf;
    this.grainRate[g] = Math.pow(2, this.rng.bi() * spread);
    const pan = this.rng.bi();
    this.grainPanL[g] = Math.cos((pan + 1) * Math.PI / 4);
    this.grainPanR[g] = Math.sin((pan + 1) * Math.PI / 4);
  }

  /* Control-rate: chaos, LFOs, mode re-seeding. Runs once per render block. */
  updateModulation(blocks) {
    const inf = this.infinity;
    const ts = this.timeScale;
    const dt = blocks * 128 / sampleRate;

    // Lorenz attractor -- aperiodic, bounded, and audibly "alive".
    // Rate scales with INFINITY: an autonomous field moves on its own.
    const speed = (0.08 + 1.5 * inf) * (0.25 + 1.6 * (1 - ts));
    const h = Math.min(0.02, dt * speed);
    const a = 10, b = 28, c = 8 / 3;
    const dx = a * (this.ly - this.lx);
    const dy = this.lx * (b - this.lz) - this.ly;
    const dz = this.lx * this.ly - c * this.lz;
    this.lx += h * dx; this.ly += h * dy; this.lz += h * dz;
    this.mod[0] = Math.max(-1, Math.min(1, this.lx / 18));
    this.mod[1] = Math.max(-1, Math.min(1, this.ly / 24));
    this.mod[2] = Math.max(-1, Math.min(1, (this.lz - 24) / 24));

    // LFO bank at irrational ratios, base period tied to TIME SCALE.
    const baseHz = Math.pow(10, -0.2 - 2.4 * ts);
    for (let i = 0; i < LFO_RATIOS.length; i++) {
      this.lfoPhase[i] = (this.lfoPhase[i] + baseHz * LFO_RATIOS[i] * dt) % 1;
      this.mod[3 + i] = Math.sin(this.lfoPhase[i] * Math.PI * 2);
    }

    // Mode re-seeding: at high INFINITY the field continually re-tunes itself,
    // so the tonal pockets a player finds will not be there forever.
    const reseedChance = dt * (0.02 + 1.4 * inf * inf);
    if (this.rng.next() < reseedChance) {
      const i = (this.rng.next() * MODES) | 0;
      this.modeTarget[i] = this.seedModeFreq(i);
      this.modeGain[i] = this.rng.range(0.2, 1) / Math.sqrt(1 + i * 0.35);
      this.modePan[i] = this.rng.bi();
    }
    // Glide toward targets so re-tuning is a drift, not a click.
    const glide = Math.min(1, dt * (0.35 + 2.2 * inf));
    for (let i = 0; i < MODES; i++) {
      this.modeFreq[i] += (this.modeTarget[i] - this.modeFreq[i]) * glide;
    }
  }

  /* Clear every piece of filter state. Called only if something has gone
   * non-finite, so one bad sample cannot silence the field for good. */
  panic() {
    this.svf.fill(0);
    this.pink.fill(0);
    this.brown = 0;
    this.modeY1.fill(0); this.modeY2.fill(0);
    this.lowY1.fill(0); this.lowY2.fill(0);
    this.bufL.fill(0); this.bufR.fill(0);
    this.dcL = 0; this.dcR = 0;
    this.lx = 0.1; this.ly = 0; this.lz = 0;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1];
    const n = L.length;
    const sr = sampleRate;

    // Smooth the two field parameters.
    this.infinity += (this.targetInfinity - this.infinity) * 0.05;
    this.timeScale += (this.targetTimeScale - this.timeScale) * 0.05;
    this.updateModulation(1);

    const inf = this.infinity;
    const m = this.mod;
    const rng = this.rng;

    // Drifting cutoffs for the band-limited noise streams.
    const bandF = [
      180 * Math.pow(2, m[0] * 1.6 + m[3] * 0.9),
      900 * Math.pow(2, m[1] * 1.4 + m[4] * 1.1),
      4200 * Math.pow(2, m[2] * 1.1 + m[5] * 0.8),
    ];
    const svfA1 = new Float32Array(3);
    const svfA2 = new Float32Array(3);
    const svfA3 = new Float32Array(3);
    const svfK = new Float32Array(3);
    for (let i = 0; i < 3; i++) {
      const f = Math.max(20, Math.min(sr * 0.45, bandF[i]));
      const g = Math.tan(Math.PI * f / sr);
      const k = 0.5 + 1.4 * (1 - inf);   // 1/Q
      const a1 = 1 / (1 + g * (g + k));
      svfA1[i] = a1;
      svfA2[i] = g * a1;
      svfA3[i] = g * g * a1;
      svfK[i] = k;
    }

    // Resonator coefficients for this block.
    const mc = new Float32Array(MODES * 2);
    for (let i = 0; i < MODES; i++) {
      const f = Math.max(20, Math.min(sr * 0.47, this.modeFreq[i] * (1 + 0.006 * m[(i % 5) + 3])));
      const r = this.modeQ[i];
      mc[i * 2] = 2 * r * Math.cos(2 * Math.PI * f / sr);
      mc[i * 2 + 1] = r * r;
    }
    const lc = new Float32Array(LOW_MODES * 2);
    for (let i = 0; i < LOW_MODES; i++) {
      const f = this.lowFreq[i] * (1 + 0.02 * m[i]);
      const r = 0.99988;
      lc[i * 2] = 2 * r * Math.cos(2 * Math.PI * f / sr);
      lc[i * 2 + 1] = r * r;
    }

    // Layer balance breathes with the chaos, so density is never static.
    const gNoise = 0.055 * (0.6 + 0.4 * m[3]);
    const gPink = 0.085 * (0.6 + 0.4 * m[4]);
    const gBrown = 0.28 * (0.6 + 0.4 * m[0]);
    const gBand = 0.14;
    const gMode = 0.9;
    const gLow = 0.46;
    const gGrain = 0.10 + 0.30 * inf;

    for (let s = 0; s < n; s++) {
      // --- noise layers (decorrelated per channel) ---
      const wL = rng.bi(), wR = rng.bi();

      // Pink (Paul Kellett), driven by the left white stream.
      const p = this.pink;
      p[0] = 0.99886 * p[0] + wL * 0.0555179;
      p[1] = 0.99332 * p[1] + wL * 0.0750759;
      p[2] = 0.96900 * p[2] + wL * 0.1538520;
      p[3] = 0.86650 * p[3] + wL * 0.3104856;
      p[4] = 0.55000 * p[4] + wL * 0.5329522;
      p[5] = -0.7616 * p[5] - wL * 0.0168980;
      const pinkOut = (p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + wL * 0.5362) * 0.11;
      p[6] = wL * 0.115926;

      this.brown = (this.brown * 0.9992) + wR * 0.008;

      let dL = wL * gNoise + pinkOut * gPink + this.brown * gBrown;
      let dR = wR * gNoise + pinkOut * 0.7 * gPink - this.brown * 0.8 * gBrown;

      // --- band-limited streams (bandpass output of each svf) ---
      for (let i = 0; i < 3; i++) {
        const a1 = svfA1[i], a2 = svfA2[i], a3 = svfA3[i];
        for (let c = 0; c < 2; c++) {
          const o = (i * 2 + c) * 2;
          const x = c === 0 ? wL : wR;
          const ic1 = this.svf[o], ic2 = this.svf[o + 1];
          const v3 = x - ic2;
          const v1 = a1 * ic1 + a2 * v3;
          const v2 = ic2 + a2 * ic1 + a3 * v3;
          this.svf[o] = 2 * v1 - ic1;
          this.svf[o + 1] = 2 * v2 - ic2;
          if (c === 0) dL += v1 * gBand; else dR += v1 * gBand;
        }
      }

      // --- resonator bank: pockets of tone buried in the noise ---
      const exc = (wL + wR) * 0.5;
      let modeL = 0, modeR = 0;
      for (let i = 0; i < MODES; i++) {
        const b1 = mc[i * 2], b2 = mc[i * 2 + 1];
        const y = exc * (1 - b2) * 0.5 + b1 * this.modeY1[i] - b2 * this.modeY2[i];
        this.modeY2[i] = this.modeY1[i];
        this.modeY1[i] = y;
        const g = this.modeGain[i];
        const pan = this.modePan[i];
        modeL += y * g * (1 - pan) * 0.5;
        modeR += y * g * (1 + pan) * 0.5;
      }
      dL += modeL * gMode; dR += modeR * gMode;

      // --- low cluster ---
      let lowSum = 0;
      for (let i = 0; i < LOW_MODES; i++) {
        const b1 = lc[i * 2], b2 = lc[i * 2 + 1];
        const y = exc * (1 - b2) * 0.5 + b1 * this.lowY1[i] - b2 * this.lowY2[i];
        this.lowY2[i] = this.lowY1[i];
        this.lowY1[i] = y;
        lowSum += y;
      }
      dL += lowSum * gLow; dR += lowSum * gLow * 0.92;

      // --- granular layer reading the field's own past ---
      let gL = 0, gR = 0;
      for (let g = 0; g < GRAINS; g++) {
        const age = this.grainAge[g];
        const len = this.grainLen[g];
        if (age >= len) { this.seedGrain(g); continue; }
        // Hann window: grains fade in and out, so no edges are ever heard.
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * age / len);
        let pos = this.grainPos[g];
        const i0 = pos | 0;
        const frac = pos - i0;
        const i1 = (i0 + 1) % this.bufLen;
        const sL = this.bufL[i0] + (this.bufL[i1] - this.bufL[i0]) * frac;
        const sR = this.bufR[i0] + (this.bufR[i1] - this.bufR[i0]) * frac;
        gL += sL * w * this.grainPanL[g];
        gR += sR * w * this.grainPanR[g];
        pos += this.grainRate[g];
        if (pos >= this.bufLen) pos -= this.bufLen;
        this.grainPos[g] = pos;
        this.grainAge[g] = age + 1;
      }
      dL += gL * gGrain; dR += gR * gGrain;

      // --- DC block, soft limit, and write back into the buffer ---
      let oL = dL - this.dcL; this.dcL += (dL - this.dcL) * 0.00008;
      let oR = dR - this.dcR; this.dcR += (dR - this.dcR) * 0.00008;
      oL = softclip(oL * 0.6);
      oR = softclip(oR * 0.6);

      // The field feeds on itself: this is what makes it inexhaustible.
      this.bufL[this.writeIdx] = oL * 0.62;
      this.bufR[this.writeIdx] = oR * 0.62;
      this.writeIdx = (this.writeIdx + 1) % this.bufLen;

      if (!(oL === oL) || !(oR === oR) || oL === Infinity || oL === -Infinity
          || oR === Infinity || oR === -Infinity) {
        this.panic();
        oL = 0; oR = 0;
      }

      L[s] = oL;
      R[s] = oR;
    }

    return true;
  }
}

registerProcessor('field-processor', FieldProcessor);
