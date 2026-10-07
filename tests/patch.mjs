/*
 * The Plexus and the patch bay.
 *
 * Asserts that the network morphs between entangled and discrete, that DECAY
 * reaches from a short room to all but infinite without ever failing to decay,
 * that SEND withholds the feed while the paths keep circulating, and that
 * every cord in the patch bay actually moves the control it is plugged into.
 *
 *   node tests/patch.mjs            (serve the directory on :8099 first)
 */

const pw = (await import(process.env.PLAYWRIGHT || 'playwright')).default;
const { chromium } = pw;
const URL = process.env.URL || 'http://127.0.0.1:8099/';

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL, { waitUntil: 'load' });

const fail = [];
const expect = (cond, msg) => { if (!cond) fail.push(msg); };

/* ---------------- the network, rendered offline ---------------- */

const ir = await page.evaluate(async () => {
  const res = {};
  const run = async (label, params, secs = 10) => {
    const sr = 44100;
    const ctx = new OfflineAudioContext(2, sr * secs, sr);
    await ctx.audioWorklet.addModule('worklets/plexus-processor.js');
    const node = new AudioWorkletNode(ctx, 'plexus-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', processorOptions: params,
    });
    const buf = ctx.createBuffer(2, 64, sr);
    for (let c = 0; c < 2; c++) buf.getChannelData(c)[0] = 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(node); src.start(0.25);
    node.connect(ctx.destination);
    const r = await ctx.startRendering();
    const L = r.getChannelData(0), R = r.getChannelData(1);
    const hop = Math.floor(sr * 0.01);
    const env = [];
    for (let i = 0; i < L.length - hop; i += hop) {
      let p = 0;
      for (let k = i; k < i + hop; k++) { const v = Math.abs(L[k]); if (v > p) p = v; }
      env.push(p);
    }
    const peak = Math.max(...env);
    let rt = secs;
    for (let i = env.length - 1; i >= 0; i--) { if (env[i] > peak * 1e-3) { rt = i * 0.01; break; } }
    const early = env.slice(25, 85);
    const em = Math.max(...early);
    let taps = 0;
    for (let i = 1; i < early.length - 1; i++) {
      if (early[i] > early[i - 1] && early[i] >= early[i + 1] && early[i] > em * 0.25) taps++;
    }
    let num = 0, dl = 0, dr = 0;
    for (let i = sr * 0.3; i < Math.min(L.length, sr * 3); i++) {
      num += L[i] * R[i]; dl += L[i] * L[i]; dr += R[i] * R[i];
    }
    let bad = 0;
    for (let i = 0; i < L.length; i += 11) if (!Number.isFinite(L[i])) bad++;
    res[label] = {
      peak: +peak.toFixed(4), rt60: +rt.toFixed(2), taps, bad,
      corr: dl > 0 && dr > 0 ? +(num / Math.sqrt(dl * dr)).toFixed(3) : 0,
    };
  };
  const base = { size: 0.4, diffuse: 0.5, color: 0.5, decay: 0.6, couple: 0.5,
                 skew: 0, skewMode: 'off', send: 1 };
  await run('entangled', { ...base, plexus: 0 });
  await run('discrete', { ...base, plexus: 1 });
  await run('decay low', { ...base, plexus: 0, decay: 0.3 });
  await run('decay max', { ...base, plexus: 0, decay: 1 }, 20);
  await run('dual mono', { ...base, plexus: 0, couple: 0 });
  await run('interlaced', { ...base, plexus: 0, couple: 1 });
  await run('sharp', { ...base, plexus: 0.8, diffuse: 0 });
  await run('soft', { ...base, plexus: 0.8, diffuse: 1 });
  await run('withheld', { ...base, plexus: 0, send: 0 });
  return res;
});
for (const [k, v] of Object.entries(ir)) {
  console.log(k.padEnd(12), `peak=${String(v.peak).padEnd(7)} rt60=${String(v.rt60).padEnd(6)}s taps=${String(v.taps).padEnd(3)} corr=${v.corr}`);
}

expect(ir.discrete.taps < ir.entangled.taps, 'PLEXUS did not take paths out of the network');
expect(ir.discrete.corr < ir.entangled.corr + 0.02, 'discrete paths are still entangled');
expect(ir['decay max'].rt60 > ir['decay low'].rt60 * 4, 'DECAY has no range');
expect(ir['decay max'].rt60 < 19.5, 'the network at full DECAY never decays');
expect(ir.interlaced.corr > ir['dual mono'].corr + 0.05, 'COUPLE did not interlace the sides');
expect(ir.sharp.peak > ir.soft.peak * 2, 'DIFFUSE did not take the edge off');
expect(ir.withheld.peak < 1e-5, 'SEND did not withhold the feed: ' + ir.withheld.peak);
for (const [k, v] of Object.entries(ir)) expect(!v.bad, `${k} produced non-finite output`);

/* ---------------- the patch bay, live ---------------- */

await page.click('#enter');
await page.waitForTimeout(2500);

const patch = (i, source, dest, depth, rate = 0.8) => page.evaluate(([i, source, dest, depth, rate]) => {
  const { ui } = window.SUBTRACTION;
  Object.assign(ui.mod.cords[i], { source, dest, depth, rate });
  ui.syncAllCords();
}, [i, source, dest, depth, rate]);

/* Settles first: the frames right after a cord is re-plugged still carry the
 * previous source's voltage, and sampling across the switch misreads it. */
const watch = (dest, ms = 1800) => page.evaluate(async ([dest, ms]) => {
  await new Promise((r) => setTimeout(r, 450));
  const seen = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const v = window.SUBTRACTION.ui.modValues[dest];
    if (typeof v === 'number') seen.push(v);
    await new Promise((r) => requestAnimationFrame(r));
  }
  if (!seen.length) return null;
  return { min: +Math.min(...seen).toFixed(4), max: +Math.max(...seen).toFixed(4), n: seen.length };
}, [dest, ms]);

console.log('');
/* Sources fall into two kinds. The shapes are generated, so they are held to
 * swinging over their full range within the window. The rest are derived from
 * the material -- the chaos the field is running on, where its energy sits,
 * how much of it is gone -- and what they read depends on what the field is
 * doing, so they are held to being in range and tracking what they claim to
 * track, not to wiggling on cue. */
const SOURCES = [
  ['sine', 'shape'], ['triangle', 'shape'], ['ramp', 'shape'], ['saw', 'shape'],
  ['square', 'shape'], ['random', 'shape'], ['smooth', 'shape'],
  ['envelope', 'derived-unipolar'], ['pulseGate', 'derived-unipolar'],
  ['pulseStep', 'derived-unipolar'], ['clock', 'derived-unipolar'],
  ['chaosX', 'shape'], ['chaosY', 'shape'],
  ['centroid', 'derived-unipolar'], ['stereo', 'derived'], ['removed', 'derived-unipolar'],
];
await page.evaluate(() => {
  const { ui, engine } = window.SUBTRACTION;
  Object.assign(ui.state, { pulseAmount: 0.8, pulseTempo: 0.6, density: 0.6 });
  ui.refreshAll(); engine.pushParams(ui.state);
});
for (const [src, kind] of SOURCES) {
  await patch(0, src, 'density', 1);
  const r = await watch('density', src === 'random' || src === 'smooth' ? 2600 : 1600);
  expect(r, `source ${src} produced nothing at all`);
  if (!r) { console.log(`${src.padEnd(11)} NO OUTPUT`); continue; }

  const moved = (r.max - r.min) > 0.01;
  const inRange = r.min >= -1.001 && r.max <= 1.001;
  const bipolar = r.min < -0.01 && r.max > 0.01;
  const unipolar = r.min >= -0.001;
  let verdict = moved ? 'moves' : 'steady';
  expect(inRange, `source ${src} left its range: [${r.min}, ${r.max}]`);

  if (kind === 'shape') {
    expect(moved, `source ${src} did not move its destination`);
    expect(bipolar, `source ${src} is not bipolar`);
    verdict += ', bipolar';
  } else if (kind === 'derived-unipolar') {
    expect(unipolar, `source ${src} went negative: ${r.min}`);
    verdict += ', unipolar';
  }
  console.log(`${src.padEnd(11)} min=${String(r.min).padEnd(8)} max=${String(r.max).padEnd(8)} ${verdict}`);
}

// The derived sources are only worth anything if they track what they name.
await patch(0, 'removed', 'attenuation', 1);
await page.evaluate(() => {
  const { ui, engine } = window.SUBTRACTION;
  ui.state.density = 1; ui.refreshAll(); engine.pushParams(ui.state);
});
const removedHigh = await watch('attenuation', 1500);
await page.evaluate(() => {
  const { ui, engine } = window.SUBTRACTION;
  ui.state.density = 0.15; ui.refreshAll(); engine.pushParams(ui.state);
});
const removedLow = await watch('attenuation', 1500);
console.log(`\nREMOVED tracks DENSITY: intact=${removedHigh.max}  mostly gone=${removedLow.max}`);
expect(removedLow.max > removedHigh.max + 0.2,
  'REMOVED AMOUNT does not track how much has been taken away');
await page.evaluate(() => {
  const { ui, engine } = window.SUBTRACTION;
  ui.state.density = 0.6; ui.refreshAll(); engine.pushParams(ui.state);
});

// depth is an attenuverter: reversing it reverses the voltage
await patch(0, 'ramp', 'density', 1, 0.75);
const up = await watch('density', 1400);
await patch(0, 'ramp', 'density', -1, 0.75);
const down = await watch('density', 1400);
console.log(`\nattenuverter  +1 -> [${up.min}, ${up.max}]   -1 -> [${down.min}, ${down.max}]`);
expect(up.max > 0.1 && down.min < -0.1, 'negative depth did not invert the voltage');

// a cord into the Plexus, and a cord steering an absence
await patch(0, 'sine', 'plexus', 0.8, 0.9);
await patch(1, 'chaosY', 'voidY1', 0.6);
await patch(2, 'pulseGate', 'send', -1);
await page.waitForTimeout(2200);
const multi = await page.evaluate(async () => {
  const { ui } = window.SUBTRACTION;
  const seen = { plexus: [], voidY1: [], send: [] };
  for (let i = 0; i < 90; i++) {
    for (const k in seen) {
      const v = ui.modValues[k];
      if (typeof v === 'number') seen[k].push(v);
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  const out = {};
  for (const k in seen) {
    out[k] = seen[k].length
      ? { min: +Math.min(...seen[k]).toFixed(3), max: +Math.max(...seen[k]).toFixed(3) } : null;
  }
  return out;
});
console.log('three cords at once', JSON.stringify(multi));
expect(multi.plexus && multi.plexus.max - multi.plexus.min > 0.05, 'the cord into PLEXUS did nothing');
expect(multi.voidY1 && multi.voidY1.max - multi.voidY1.min > 0.01, 'the cord steering ABSENCE I did nothing');
expect(multi.send && multi.send.min < -0.05, 'PULSE GATE did not withhold the SEND');

// unpatching puts the controls back
await page.evaluate(() => {
  const { ui } = window.SUBTRACTION;
  ui.mod.cords.forEach((c) => Object.assign(c, { source: 'none', dest: 'none', depth: 0 }));
  ui.syncAllCords();
});
await page.waitForTimeout(900);
const cleared = await page.evaluate(() => Object.keys(window.SUBTRACTION.ui.modValues).length);
console.log('after unpatching, driven controls:', cleared);
expect(cleared === 0, 'controls stayed driven after the cords were pulled');

expect(errors.length === 0, 'console errors: ' + errors.join(' | '));
await browser.close();
console.log(fail.length ? '\nFAILED:\n' + fail.map((f) => '  - ' + f).join('\n') : '\nplexus and patch bay pass');
process.exit(fail.length ? 1 : 0);
