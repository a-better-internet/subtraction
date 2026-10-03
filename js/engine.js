/*
 * The audio graph.
 *
 * FIELD  ->  EXCAVATOR  ->  survivor  ->  depth stage  -\
 *                        \                               >-  master
 *                         -> residue  ->  residue stage -/
 *
 * The reverberant field and all six residue processors run from the moment
 * the instrument is entered. They are never switched on; they are uncovered.
 * The only thing any control does is remove something that was masking them.
 */

import { NODE_KEYS } from './params.js';

const RESIDUE_KINDS = ['harmonic', 'granular', 'spatial', 'transient', 'reverberant', 'phase'];

/* A feedback delay network. Four damped delays mixed by a unitary matrix:
 * a dense tail with no impulse response to download. */
function makeFDN(ctx, times, feedback, damp, width) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delays = [], lps = [], fbs = [];

  for (let i = 0; i < 4; i++) {
    const d = ctx.createDelay(2);
    d.delayTime.value = times[i];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = damp;
    // Butterworth. A biquad's default Q of 1 peaks ~1.25 dB at cutoff, and two
    // of those inside a feedback loop push its gain above unity -- the network
    // then grows without bound instead of decaying.
    lp.Q.value = Math.SQRT1_2;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    hp.Q.value = Math.SQRT1_2;
    const fb = ctx.createGain();
    fb.gain.value = feedback;
    const pan = ctx.createStereoPanner();
    pan.pan.value = [(-width), width, -width * 0.5, width * 0.5][i];

    input.connect(d);
    d.connect(lp); lp.connect(hp); hp.connect(fb);
    hp.connect(pan); pan.connect(output);

    delays.push(d); lps.push(lp); fbs.push(fb);
  }

  // Hadamard mixing at H/4, not the textbook H/2. With four incommensurate
  // delays and a broadband field circulating, the worst case that actually
  // occurs is the row sum (4), not the spectral norm (2) -- measured loop gain
  // of this graph is feedback * 4 * scale * filter loss. At H/2 the network
  // sits above unity and grows without bound; at H/4 it decays.
  // Longer tails come from longer delays here, never from hotter feedback.
  const H = [[1, 1, 1, 1], [1, -1, 1, -1], [1, 1, -1, -1], [1, -1, -1, 1]];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const g = ctx.createGain();
      g.gain.value = H[i][j] * 0.25;
      fbs[i].connect(g);
      g.connect(delays[j]);
    }
  }
  return { input, output, lps, fbs };
}

/* A looping buffer of random grain windows, used to drive a gain parameter.
 * Nothing is synthesised by it -- it only lets material through in bursts. */
function makeGrainGateBuffer(ctx, seconds) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(seconds * sr), sr);
  const d = buf.getChannelData(0);
  let i = 0;
  while (i < d.length) {
    const len = Math.floor((0.004 + Math.random() * 0.09) * sr);
    const gap = Math.floor((0.002 + Math.random() * 0.07) * sr);
    const amp = 0.4 + Math.random() * 0.6;
    for (let k = 0; k < len && i < d.length; k++, i++) {
      d[i] = amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / len));
    }
    i += gap;
  }
  return buf;
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.onFrame = null;
    this.recorder = null;
    this.residueKind = 'reverberant';
  }

  get entered() { return !!this.ctx; }
  get suspended() { return this.ctx ? this.ctx.state === 'suspended' : true; }

  async enter() {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;

    await ctx.audioWorklet.addModule('worklets/field-processor.js');
    await ctx.audioWorklet.addModule('worklets/excavator-processor.js');

    // ---------------- the source ----------------
    this.field = new AudioWorkletNode(ctx, 'field-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // ---------------- the subtraction ----------------
    this.excavator = new AudioWorkletNode(ctx, 'excavator-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 2,
      outputChannelCount: [2, 2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    this.excavator.port.onmessage = (e) => {
      if (e.data && e.data.type === 'frame' && this.onFrame) this.onFrame(e.data);
    };
    // The field is dense and loud by design. Trim it here so that the
    // instrument's whole point -- ghosts at low density being genuinely
    // quiet -- is not flattened by the limiter.
    this.fieldTrim = ctx.createGain();
    this.fieldTrim.gain.value = 0.5;
    this.field.connect(this.fieldTrim);
    this.fieldTrim.connect(this.excavator);

    this.survivor = ctx.createGain();
    this.residueIn = ctx.createGain();
    this.excavator.connect(this.survivor, 0);
    this.excavator.connect(this.residueIn, 1);

    this.master = ctx.createGain();
    this.master.gain.value = 1;

    this.buildDepthStage();
    this.buildResidueStage();

    // ---------------- master ----------------
    // A bounded saturator, then a limiter with no make-up gain. Neither can
    // make anything louder than it arrived; together they guarantee that a
    // feedback path cannot run away.
    this.saturator = ctx.createWaveShaper();
    this.saturator.curve = (() => {
      const n = 2048, c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = Math.tanh((i / (n - 1) * 2 - 1) * 2.2) / Math.tanh(2.2);
      return c;
    })();
    this.saturator.oversample = '4x';

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 2;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.12;

    this.outGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.meterBuf = new Float32Array(this.analyser.fftSize);

    this.master.connect(this.saturator);
    this.saturator.connect(this.limiter);
    this.limiter.connect(this.outGain);
    this.outGain.connect(this.analyser);
    this.outGain.connect(ctx.destination);

    this.tap = ctx.createMediaStreamDestination();
    this.outGain.connect(this.tap);

    await ctx.resume();
    this.running = true;
  }

  /* DEPTH: the direct sound is removed, which is what exposes the
   * reverberant field that was there the whole time. */
  buildDepthStage() {
    const ctx = this.ctx;
    this.directGain = ctx.createGain();
    this.directLP = ctx.createBiquadFilter();
    this.directLP.type = 'lowpass';
    this.directLP.frequency.value = 18000;
    this.preDelay = ctx.createDelay(0.5);
    this.preDelay.delayTime.value = 0.012;
    this.space = makeFDN(ctx, [0.0873, 0.1181, 0.1523, 0.1931], 0.95, 6500, 0.85);
    this.spaceGain = ctx.createGain();

    this.survivor.connect(this.directGain);
    this.directGain.connect(this.directLP);
    this.directLP.connect(this.master);

    this.survivor.connect(this.preDelay);
    this.preDelay.connect(this.space.input);
    this.space.output.connect(this.spaceGain);
    this.spaceGain.connect(this.master);

    this.setDepth(0);
  }

  setDepth(d) {
    const t = this.ctx.currentTime;
    const ramp = 0.08;
    // foreground -> background -> distant -> buried -> inaudible
    this.directGain.gain.setTargetAtTime(Math.pow(1 - d, 1.5), t, ramp);
    this.directLP.frequency.setTargetAtTime(18000 * Math.exp(-3.4 * d), t, ramp);
    this.preDelay.delayTime.setTargetAtTime(0.012 + 0.1 * d, t, ramp);
    // The reverberant field survives until the material is buried outright.
    const burial = Math.max(0, (d - 0.78) / 0.22);
    this.spaceGain.gain.setTargetAtTime(0.5 * (1 - burial * burial), t, ramp);
    this.space.lps.forEach((lp) =>
      lp.frequency.setTargetAtTime(6500 * Math.exp(-1.9 * d), t, ramp));
  }

  /* All six residue processors run in parallel, always. The KIND control
   * chooses which one is not being suppressed. */
  buildResidueStage() {
    const ctx = this.ctx;
    this.residueSum = ctx.createGain();
    this.residueSum.gain.value = 0.5;
    this.residueSum.connect(this.master);
    this.residueGains = {};

    for (const kind of RESIDUE_KINDS) {
      const g = ctx.createGain();
      g.gain.value = kind === this.residueKind ? 1 : 0;
      g.connect(this.residueSum);
      this.residueGains[kind] = g;
      this.buildResidueChain(kind, this.residueIn, g);
    }
  }

  buildResidueChain(kind, input, output) {
    const ctx = this.ctx;

    switch (kind) {
      case 'harmonic': {
        // Resonant combs: when broadband material goes, tiny resonances remain.
        const sum = ctx.createGain();
        sum.gain.value = 0.3;
        for (const f of [96, 144.5, 193, 289.7, 387.1]) {
          const d = ctx.createDelay(0.1);
          d.delayTime.value = 1 / f;
          const fb = ctx.createGain();
          fb.gain.value = 0.8;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 5200;
          lp.Q.value = Math.SQRT1_2;
          input.connect(d);
          d.connect(lp); lp.connect(fb); fb.connect(d);
          lp.connect(sum);
        }
        sum.connect(output);
        break;
      }
      case 'granular': {
        // The residue is let through only in grains.
        const d = ctx.createDelay(0.2);
        d.delayTime.value = 0.03;
        const gate = ctx.createGain();
        gate.gain.value = 0;
        const src = ctx.createBufferSource();
        src.buffer = makeGrainGateBuffer(ctx, 6);
        src.loop = true;
        src.connect(gate.gain);
        src.start();
        this.grainSrc = src;
        input.connect(d); d.connect(gate); gate.connect(output);
        break;
      }
      case 'spatial': {
        // Decorrelated and thrown wide: position without a source.
        const split = ctx.createChannelSplitter(2);
        const merge = ctx.createChannelMerger(2);
        const dl = ctx.createDelay(0.1); dl.delayTime.value = 0.0113;
        const dr = ctx.createDelay(0.1); dr.delayTime.value = 0.0191;
        input.connect(split);
        split.connect(dl, 0); split.connect(dr, 1);
        dl.connect(merge, 0, 1); dr.connect(merge, 0, 0);
        const wide = makeFDN(ctx, [0.0237, 0.0411, 0.0613, 0.0817], 0.90, 9000, 1);
        merge.connect(wide.input);
        const g = ctx.createGain(); g.gain.value = 0.9;
        wide.output.connect(g); g.connect(output);
        break;
      }
      case 'transient': {
        // Sustain flattened away, leaving only edges.
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 1400;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -46; comp.knee.value = 0; comp.ratio.value = 20;
        comp.attack.value = 0.0008; comp.release.value = 0.035;
        const g = ctx.createGain(); g.gain.value = 0.8;
        input.connect(hp); hp.connect(comp); comp.connect(g); g.connect(output);
        break;
      }
      case 'reverberant': {
        // Sustained spectral ghosts of material that is no longer present.
        const tail = makeFDN(ctx, [0.1277, 0.1831, 0.2393, 0.3019], 0.97, 5200, 0.7);
        const pre = ctx.createDelay(0.5); pre.delayTime.value = 0.04;
        input.connect(pre); pre.connect(tail.input);
        const g = ctx.createGain(); g.gain.value = 0.95;
        tail.output.connect(g); g.connect(output);
        break;
      }
      case 'phase': {
        // Phase smeared until the material has no location in time.
        let node = input;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.037;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 320;
        lfo.connect(lfoGain);
        lfo.start();
        for (let i = 0; i < 6; i++) {
          const ap = ctx.createBiquadFilter();
          ap.type = 'allpass';
          ap.frequency.value = 180 * Math.pow(2.1, i);
          ap.Q.value = 0.6;
          lfoGain.connect(ap.frequency);
          node.connect(ap);
          node = ap;
        }
        const g = ctx.createGain(); g.gain.value = 0.9;
        node.connect(g); g.connect(output);
        break;
      }
    }
  }

  setResidueKind(kind) {
    if (!this.residueGains) return;
    this.residueKind = kind;
    const t = this.ctx.currentTime;
    for (const k of RESIDUE_KINDS) {
      this.residueGains[k].gain.setTargetAtTime(k === kind ? 1 : 0, t, 0.09);
    }
  }

  /* ---------------- parameter routing ---------------- */

  pushParams(state) {
    if (!this.ctx) return;
    const worklet = {};
    for (const k in state) {
      if (!NODE_KEYS.has(k)) worklet[k] = state[k];
    }
    this.excavator.port.postMessage({ type: 'params', values: worklet });
    this.field.port.postMessage({
      type: 'params', infinity: state.infinity, timeScale: state.timeScale,
    });
    this.setDepth(state.depth);
    if (state.residueType !== this.residueKind) this.setResidueKind(state.residueType);
    this.outGain.gain.setTargetAtTime(1 - state.attenuation, this.ctx.currentTime, 0.05);
  }

  setVoid(index, values) {
    if (!this.ctx) return;
    this.excavator.port.postMessage({ type: 'void', index, values });
  }

  /* RELEASE: stop holding the absences open and let the field close over them. */
  release() {
    if (!this.ctx) return;
    this.excavator.port.postMessage({ type: 'heal' });
  }

  async withdraw() {
    if (this.ctx) await this.ctx.suspend();
  }

  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const a = Math.abs(this.meterBuf[i]);
      if (a > peak) peak = a;
    }
    return peak;
  }

  /* EXTRACT: take a span of time out of the continuum and keep it. */
  startExtract() {
    if (!this.ctx || this.recorder) return false;
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mimeType) return false;
    const rec = new MediaRecorder(this.tap.stream, { mimeType });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `subtraction-${stamp}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    rec.start();
    this.recorder = rec;
    return true;
  }

  stopExtract() {
    if (!this.recorder) return;
    this.recorder.stop();
    this.recorder = null;
  }
}
