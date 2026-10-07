/*
 * THE PLEXUS
 *
 * A network of feedback paths the signal is already circulating through. It is
 * not an effect that gets switched on and mixed in: like the reverberant field
 * it replaces, it runs from the moment the instrument is entered, and the only
 * way to hear it is to remove the direct sound standing in front of it.
 *
 * PLEXUS removes paths. At zero the whole network is intact -- eight paths,
 * fully entangled, which is the reverb-like end. Turning it up takes paths out
 * and unpicks their connections until only a couple of discrete taps are left,
 * which is the echo-like end. Everything between is neither.
 *
 * Paths alternate between the two sides: even paths carry the left, odd the
 * right. COUPLE scales every matrix entry that crosses between them, so at
 * zero the two sides never meet (dual mono) and at one they are interlaced.
 *
 * Stability is by construction. Each column of the mixing matrix is normalised
 * so the magnitudes arriving at a path sum to one, which bounds the round-trip
 * gain by DECAY times whatever the damping filters take out. That is the row
 * sum, not the spectral norm: with incommensurate delays and a broadband field
 * circulating, the row sum is the case that actually occurs.
 */

const PATHS = 8;
const MAX_DELAY = 2.6;
const AP = 4;                       // input diffusion stages per side

/* Incommensurate spread around SIZE, so the paths never line up. */
const RATIO = [1.0, 0.618034, 1.414214, 0.809017, 1.732051, 1.118034, 0.707107, 1.618034];
const AP_TIME = [0.00473, 0.00731, 0.01129, 0.01787];

/* 8x8 Hadamard: the fully entangled end of PLEXUS. */
const H = (() => {
  const m = [[1]];
  let n = 1;
  while (n < PATHS) {
    const out = [];
    for (let i = 0; i < n * 2; i++) out.push(new Array(n * 2));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = m[i][j];
        out[i][j] = v; out[i][j + n] = v;
        out[i + n][j] = v; out[i + n][j + n] = -v;
      }
    }
    for (let i = 0; i < n * 2; i++) m[i] = out[i];
    n *= 2;
  }
  return m;
})();

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const onePole = (hz) => 1 - Math.exp(-2 * Math.PI * clamp(hz, 1, sampleRate * 0.49) / sampleRate);

class PlexusProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const len = Math.ceil(MAX_DELAY * sampleRate);
    this.len = len;
    this.buf = [];
    for (let i = 0; i < PATHS; i++) this.buf.push(new Float32Array(len));
    this.write = 0;

    this.lp = new Float32Array(PATHS);      // damping state
    this.hpState = new Float32Array(PATHS);
    this.out = new Float32Array(PATHS);
    this.inject = new Float32Array(PATHS);
    this.delaySamples = new Float32Array(PATHS);
    this.active = new Float32Array(PATHS);
    this.matrix = new Float32Array(PATHS * PATHS);
    this.lpCoef = new Float32Array(PATHS);
    this.hpCoef = new Float32Array(PATHS);
    this.active.fill(1);
    this.live = PATHS;
    this.powV = new Float32Array(PATHS);
    this.powW = new Float32Array(PATHS);
    for (let i = 0; i < PATHS; i++) this.powV[i] = 1 / Math.sqrt(PATHS);

    // input diffusion, one chain per side
    this.apBuf = [];
    this.apIdx = [];
    for (let c = 0; c < 2; c++) {
      const chain = [], idx = [];
      for (let a = 0; a < AP; a++) {
        chain.push(new Float32Array(Math.ceil(AP_TIME[a] * sampleRate) + 2));
        idx.push(0);
      }
      this.apBuf.push(chain);
      this.apIdx.push(idx);
    }

    this.p = {
      plexus: 0.35, size: 0.4, diffuse: 0.5, color: 0.5, decay: 0.55,
      couple: 0.5, skew: 0, skewMode: 'off', send: 1,
    };
    // Taken at construction as well as by message: a postMessage races the
    // render in an OfflineAudioContext and may never arrive at all.
    const init = options && options.processorOptions;
    if (init) Object.assign(this.p, init);
    this.s = { ...this.p };          // smoothed, starting where it is told

    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'params') Object.assign(this.p, e.data.values);
    };
  }

  /* Control rate: delay lengths, damping, which paths remain, and how much
   * each one is tangled with the others. */
  updateTopology() {
    const s = this.s;
    const sk = s.skewMode === 'off' ? 0 : s.skew;
    const tandem = s.skewMode === 'tandem';

    // PLEXUS removes paths from the far end first, and unpicks the matrix.
    const count = 8 - clamp(s.plexus, 0, 1) * 6;      // 8 paths -> 2
    const entangle = 1 - clamp(s.plexus, 0, 1);

    const sizeSec = 0.008 * Math.pow(1.2 / 0.008, clamp(s.size, 0, 1));
    const decay = clamp(s.decay, 0, 1) * 0.985;

    for (let i = 0; i < PATHS; i++) {
      const left = (i & 1) === 0;
      // SKEW pulls the two sides apart (or pushes them the same way) on the
      // size, the colour and how many paths each side keeps.
      const dir = tandem ? 1 : (left ? 1 : -1);
      const skewOct = sk * dir * 0.6;
      const skewCount = sk * dir * 1.6;
      const skewColor = sk * dir * 0.3;

      this.delaySamples[i] = clamp(
        sizeSec * RATIO[i] * Math.pow(2, skewOct) * sampleRate, 2, this.len - 4);
      this.active[i] = i < 2 ? 1 : clamp(count + skewCount - i, 0, 1);

      const color = clamp(s.color + skewColor, 0, 1);
      // Below centre the network forgets its highs first, above it its lows.
      // At centre only the gentle damping that keeps the thing finite remains.
      const lpHz = color < 0.5 ? 400 * Math.pow(16000 / 400, color * 2) : 16000;
      const hpHz = color > 0.5 ? 20 * Math.pow(2000 / 20, (color - 0.5) * 2) : 20;
      this.lpCoef[i] = onePole(lpHz);
      this.hpCoef[i] = onePole(hpHz);
    }

    // The mixing matrix: identity at one end, Hadamard at the other, with
    // every crossing between the two sides scaled by COUPLE.
    const couple = clamp(s.couple, 0, 1);
    const m = this.matrix;
    let live = 0;
    for (let i = 0; i < PATHS; i++) live += this.active[i];
    this.live = Math.max(1, live);

    for (let j = 0; j < PATHS; j++) {
      for (let i = 0; i < PATHS; i++) {
        let v = (i === j ? 1 - entangle : 0) + entangle * H[i][j] / Math.sqrt(PATHS);
        if (((i ^ j) & 1) === 1) v *= couple;      // crosses between sides
        v *= this.active[i] * this.active[j];
        m[i * PATHS + j] = v;
      }
    }
    // Scale the whole matrix so its spectral radius is exactly DECAY. This is
    // what makes the network decay; normalising columns is not sufficient.
    const rho = this.spectralRadius(m);
    const g = rho > 1e-9 ? decay / rho : 0;
    for (let k = 0; k < PATHS * PATHS; k++) m[k] *= g;
  }

  /* The spectral radius of the mixing matrix, by power iteration.
   *
   * What actually governs whether a feedback network decays is the largest
   * eigenvalue magnitude of its matrix. Normalising each column's energy is
   * not enough: the blend between identity and Hadamard is not orthogonal,
   * and COUPLE and the fading of paths pull it further out of shape, so a
   * matrix with unit columns can still have a radius above one and ring for
   * ever. Measuring it costs a few hundred operations per control update and
   * makes DECAY mean exactly what it says at every setting.
   *
   * The ratio is averaged over the later iterations in the log domain, so a
   * complex eigenvalue pair -- which makes a single ratio oscillate -- still
   * converges to the right answer.
   */
  spectralRadius(m) {
    const v = this.powV, w = this.powW;
    let acc = 0, n = 0;
    for (let it = 0; it < 32; it++) {
      for (let j = 0; j < PATHS; j++) {
        let sum = 0;
        for (let i = 0; i < PATHS; i++) sum += m[i * PATHS + j] * v[i];
        w[j] = sum;
      }
      let norm = 0;
      for (let j = 0; j < PATHS; j++) norm += w[j] * w[j];
      norm = Math.sqrt(norm);
      if (!(norm > 1e-12)) {
        for (let i = 0; i < PATHS; i++) v[i] = 1 / Math.sqrt(PATHS);
        return 0;
      }
      for (let j = 0; j < PATHS; j++) v[j] = w[j] / norm;
      if (it >= 16) { acc += Math.log(norm); n++; }
    }
    return n > 0 ? Math.exp(acc / n) : 0;
  }

  diffuse(x, c, amount) {
    if (amount <= 0.001) return x;
    let v = x;
    for (let a = 0; a < AP; a++) {
      const buf = this.apBuf[c][a];
      const n = buf.length;
      let idx = this.apIdx[c][a];
      const g = 0.62 * amount;
      const d = buf[idx];
      const w = v + g * d;
      v = d - g * w;
      buf[idx] = w;
      this.apIdx[c][a] = (idx + 1) % n;
    }
    return x + (v - x) * amount;
  }

  panic() {
    for (let i = 0; i < PATHS; i++) this.buf[i].fill(0);
    this.lp.fill(0); this.hpState.fill(0); this.out.fill(0);
    for (let c = 0; c < 2; c++) for (let a = 0; a < AP; a++) this.apBuf[c][a].fill(0);
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const oL = out[0], oR = out[1];
    const n = oL.length;
    const iL = inp && inp[0] ? inp[0] : null;
    const iR = inp && inp[1] ? inp[1] : iL;

    // smooth the controls once per block
    const s = this.s, p = this.p;
    for (const k in p) {
      if (typeof p[k] === 'number') s[k] += (p[k] - s[k]) * 0.08;
      else s[k] = p[k];
    }
    this.updateTopology();

    const m = this.matrix;
    const len = this.len;
    const send = clamp(s.send, 0, 1);
    const diffuseAmt = clamp(s.diffuse, 0, 1);

    for (let k = 0; k < n; k++) {
      const xl = iL ? iL[k] : 0;
      const xr = iR ? iR[k] : 0;
      // SEND withholds the signal from the network without silencing it: the
      // paths keep circulating whatever is already in them.
      const dl = this.diffuse(Number.isFinite(xl) ? xl : 0, 0, diffuseAmt) * send * 0.4;
      const dr = this.diffuse(Number.isFinite(xr) ? xr : 0, 1, diffuseAmt) * send * 0.4;

      // read every path
      for (let i = 0; i < PATHS; i++) {
        const d = this.delaySamples[i];
        let r = this.write - d;
        while (r < 0) r += len;
        const i0 = r | 0;
        const frac = r - i0;
        const i1 = i0 + 1 >= len ? 0 : i0 + 1;
        const b = this.buf[i];
        let v = b[i0] + (b[i1] - b[i0]) * frac;

        // COLOR: what the network loses on each pass round
        this.lp[i] += (v - this.lp[i]) * this.lpCoef[i];
        v = this.lp[i];
        this.hpState[i] += (v - this.hpState[i]) * this.hpCoef[i];
        v -= this.hpState[i];
        this.out[i] = v * this.active[i];
      }

      // mix and write back
      let sumL = 0, sumR = 0;
      for (let j = 0; j < PATHS; j++) {
        let acc = 0;
        for (let i = 0; i < PATHS; i++) acc += this.out[i] * m[i * PATHS + j];
        const injected = acc + ((j & 1) === 0 ? dl : dr);
        this.inject[j] = injected > 1.6 ? 1.6 : injected < -1.6 ? -1.6 : injected;
      }
      for (let j = 0; j < PATHS; j++) {
        this.buf[j][this.write] = this.inject[j];
        if ((j & 1) === 0) sumL += this.out[j]; else sumR += this.out[j];
      }

      this.write = this.write + 1 >= len ? 0 : this.write + 1;

      if (!Number.isFinite(sumL) || !Number.isFinite(sumR)) { this.panic(); sumL = 0; sumR = 0; }
      const norm = 1.4 / Math.sqrt(this.live);
      oL[k] = sumL * norm;
      oR[k] = sumR * norm;
    }
    return true;
  }
}

registerProcessor('plexus-processor', PlexusProcessor);
