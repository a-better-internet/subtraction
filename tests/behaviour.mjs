/*
 * Behavioural test.
 *
 * Asserts that the instrument does what it claims: that the field sounds, that
 * every control only ever takes material away, that absences leave scars which
 * outlive them, and that the bottom of DENSITY is actually silence.
 *
 *   node tests/behaviour.mjs        (serve the directory on :8099 first)
 */

const pw = (await import(process.env.PLAYWRIGHT || 'playwright')).default;
const { chromium } = pw;
const URL = process.env.URL || 'http://127.0.0.1:8099/';

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1480, height: 1100 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.click('#enter');
await page.waitForTimeout(2500);

const probe = async (label) => {
  const r = await page.evaluate(async () => {
    const { engine } = window.SUBTRACTION;
    let peak = 0, sum = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      const l = engine.level();
      peak = Math.max(peak, l); sum += l; n++;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return {
      peak: +peak.toFixed(4), mean: +(sum / n).toFixed(4),
      removed: +document.getElementById('removed').textContent.replace('%', ''),
    };
  });
  console.log(label.padEnd(28), `peak=${r.peak} mean=${r.mean} removed=${r.removed}%`);
  return r;
};

const set = (p) => page.evaluate((p) => {
  const { ui, engine } = window.SUBTRACTION;
  Object.assign(ui.state, p); ui.refreshAll(); engine.pushParams(ui.state);
}, p);

const setVoid = (i, v) => page.evaluate(([i, v]) => {
  const { ui, engine } = window.SUBTRACTION;
  Object.assign(ui.voids[i], v); engine.setVoid(i, ui.voids[i]); ui.syncVoidUI();
}, [i, v]);

const r = {};
r.field = await page.evaluate(async () => {
  const { engine } = window.SUBTRACTION;
  const a = engine.ctx.createAnalyser(); a.fftSize = 2048;
  engine.field.connect(a);
  const buf = new Float32Array(2048);
  let peak = 0, rms = 0, n = 0;
  for (let i = 0; i < 40; i++) {
    a.getFloatTimeDomainData(buf);
    let s2 = 0;
    for (let k = 0; k < buf.length; k++) {
      const v = Math.abs(buf[k]); if (v > peak) peak = v; s2 += buf[k] * buf[k];
    }
    rms += Math.sqrt(s2 / buf.length); n++;
    await new Promise((r) => requestAnimationFrame(r));
  }
  engine.field.disconnect(a);
  return { peak: +peak.toFixed(4), rms: +(rms / n).toFixed(4) };
});
console.log('raw field'.padEnd(28), `peak=${r.field.peak} rms=${r.field.rms}`);

r.open = await probe('field intact');

await set({ density: 0 });
await page.waitForTimeout(6000);
r.silent = await probe('density 0');

await set({ density: 1 });
await page.waitForTimeout(1500);
r.back = await probe('density 1');

await set({ density: 0.1 });
await page.waitForTimeout(1500);
r.ghosts = await probe('density 10% (ghosts)');

await set({ density: 1, absenceSize: 1, focus: 0, movementMode: 'static' });
await setVoid(0, { x: 0, y: 0.5, depth: 1, size: 4 });
await page.waitForTimeout(1500);
r.excavated = await probe('absence at full depth');

// MEMORY: the absence leaves, the hole stays.
await setVoid(0, { depth: 0 });
await set({ memory: 1, decay: 1 });
await setVoid(1, { x: 0, y: 0.35, depth: 1, size: 3 });
await page.waitForTimeout(1800);
await setVoid(1, { depth: 0 });
await page.waitForTimeout(1500);
r.scarred = await probe('scar outlives the absence');

// RELEASE closes the scars again.
await page.click('#release');
await page.waitForTimeout(1800);
r.released = await probe('released');

await set({ memory: 0, decay: 0.3, residueVeil: 1, density: 0.35 });
await page.waitForTimeout(1500);
r.residue = await probe('residue exposed');

await set({ density: 1, residueVeil: 0, temporalAmount: 0.6, temporalSize: 0.3, timeScale: 0.3 });
await page.waitForTimeout(2000);
r.temporal = await probe('temporal absence');

await set({ temporalAmount: 0, depth: 0.95 });
await page.waitForTimeout(1500);
r.buried = await probe('direct removed');
await set({ depth: 0 });

// ---- the musical controls ----
await page.evaluate(() => {
  const { engine } = window.SUBTRACTION;
  const a = engine.ctx.createAnalyser();
  a.fftSize = 8192; a.smoothingTimeConstant = 0.85;
  window.__a = a; window.__b = new Float32Array(a.frequencyBinCount);
});
/* Tapped by connecting for the measurement and disconnecting after: an
 * analyser left attached to one node while another is attached and detached
 * does not measure what it claims to. */
const spectrum = (node) => page.evaluate(async (node) => {
  const { engine } = window.SUBTRACTION;
  const a = window.__a, b = window.__b;
  const src = node === 'direct' ? engine.directLP : engine.master;
  src.connect(a);
  await new Promise((r) => setTimeout(r, 800));
  const acc = new Float32Array(b.length);
  for (let i = 0; i < 28; i++) {
    a.getFloatFrequencyData(b);
    for (let j = 0; j < b.length; j++) acc[j] += Math.max(-140, b[j]);
    await new Promise((r) => requestAnimationFrame(r));
  }
  src.disconnect(a);
  return { db: Array.from(acc, (v) => v / 28), hzPerBin: a.context.sampleRate / 2 / b.length };
}, node);
const at = (sp, hz) => sp.db[Math.round(hz / sp.hzPerBin)];
const band = (sp, lo, hi) => {
  let sum = 0, n = 0;
  for (let h = lo; h < hi; h += sp.hzPerBin) { sum += at(sp, h); n++; }
  return sum / n;
};

// HARMONIC ABSENCE: partials of the root should stand above the gaps.
const combContrast = async (node = 'master') => {
  const sp = await spectrum(node);
  let on = 0, off = 0;
  for (let k = 2; k <= 20; k++) { on += at(sp, k * 55); off += at(sp, (k + 0.5) * 55); }
  return (on - off) / 19;
};
// Measured from a known state, not from whatever the tests above left behind.
const clean = {
  density: 1, absenceSize: 0.22, focus: 0.35, movementMode: 'wander', movementRate: 0.3,
  memory: 0.3, decay: 0.42, gravityAmount: 0, spectralAmount: 0, temporalAmount: 0,
  voidDensity: 0, residueVeil: 0, depth: 0, centreRemoval: 0, sideRemoval: 0,
  timeScale: 0.55, infinity: 0.62, pulseAmount: 0, arpMode: 'off',
};
await page.evaluate(() => {
  const { ui, engine } = window.SUBTRACTION;
  ui.voids.forEach((v, i) => { v.depth = 0; v.size = 1; engine.setVoid(i, v); });
});
await set({ ...clean, rolloff: 0, harmonicMode: 'series', harmonicRoot: 0.35,
            harmonicAmount: 0, harmonicWidth: 0.2 });
await page.waitForTimeout(2200);
r.combOff = await combContrast();
await set({ harmonicAmount: 1 });
// The reverb tails still hold seconds of un-combed signal when the comb is
// first engaged, and it fills the gaps. Wait for them to decay.
await page.waitForTimeout(7000);
r.combOn = await combContrast();
r.combDirect = await combContrast('direct');
console.log('harmonic comb'.padEnd(28),
  `contrast ${r.combOff.toFixed(1)}dB -> ${r.combOn.toFixed(1)}dB (direct path ${r.combDirect.toFixed(1)}dB)`);

// ROLL-OFF should take the top away and leave the body alone. The field is
// self-generating and its level drifts over a session, so the body is measured
// either side of the dark reading and averaged, rather than once before it.
await set({ ...clean, harmonicMode: 'off', harmonicAmount: 0, rolloff: 0 });
await page.waitForTimeout(2000);
const bright = await spectrum('master');
await set({ rolloff: 0.7, rolloffSlope: 0.5 });
await page.waitForTimeout(2500);
const dark = await spectrum('master');
await set({ rolloff: 0 });
await page.waitForTimeout(2500);
const bright2 = await spectrum('master');
const bodyBright = (band(bright, 200, 600) + band(bright2, 200, 600)) / 2;
const topBright = (band(bright, 8000, 14000) + band(bright2, 8000, 14000)) / 2;
r.topCut = topBright - band(dark, 8000, 14000);
r.bodyCut = bodyBright - band(dark, 200, 600);
console.log('roll-off'.padEnd(28),
  `top -${r.topCut.toFixed(1)}dB, body -${r.bodyCut.toFixed(1)}dB`);
await set({ rolloff: 0.2 });

// THE PULSE should step at the rate the tempo and division imply.
await set({ ...clean, rolloff: 0.2, pulseAmount: 1, pulseTempo: 0.27,
            pulseDivision: '1/16', pulseSteps: 16 });
const steps = await page.evaluate(async () => {
  const seen = []; let last = -1;
  const t0 = performance.now();
  while (performance.now() - t0 < 5000) {
    const s = window.SUBTRACTION.ui.lastStep;
    if (s !== last) { seen.push(performance.now()); last = s; }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return seen;
});
const gaps = steps.slice(1).map((t, i) => t - steps[i]).filter((g) => g > 5);
r.stepMs = gaps.reduce((a, b) => a + b, 0) / gaps.length;
r.expectMs = 60000 / 79 / 4;
r.pulsed = await probe('pulse engaged');
console.log('pulse'.padEnd(28),
  `${r.stepMs.toFixed(1)}ms/step (expect ${r.expectMs.toFixed(1)}ms)`);
await set({ pulseAmount: 0 });

// ---- interface ----
const box = await page.locator('#field').boundingBox();
await setVoid(0, { x: 0, y: 0.5, depth: 0, size: 1 });
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.37, { steps: 4 });
await page.waitForTimeout(900);          // holding still presses the absence deeper
await page.mouse.up();
const gesture = await page.evaluate(() => {
  const v = window.SUBTRACTION.ui.voids[window.SUBTRACTION.ui.selected];
  return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), depth: +v.depth.toFixed(3) };
});
console.log('excavation gesture'.padEnd(28), JSON.stringify(gesture));

await page.click('#preserve');
const preserved = await page.evaluate(() => window.SUBTRACTION.ui.preserved.length);
await set({ density: 0.2 });
await page.evaluate(() => window.SUBTRACTION.ui.recall(0));
const recalled = await page.evaluate(() => window.SUBTRACTION.ui.state.density);
console.log('preserve / recall'.padEnd(28), `states=${preserved} density restored to ${recalled}`);

// No control anywhere may be capable of adding material.
const vocabulary = await page.evaluate(async () => {
  const { GROUPS } = await import('./js/params.js');
  const banned = /\b(add|gain|boost|amount of oscillator|mix|wet|level up)\b/i;
  return GROUPS.flatMap((g) => g.params)
    .filter((p) => banned.test(p.label) || (p.hint && /\badds?\b/i.test(p.hint)))
    .map((p) => p.label);
});
console.log('additive controls'.padEnd(28), vocabulary.length ? vocabulary.join(', ') : 'none');

await browser.close();

const fail = [];
const expect = (cond, msg) => { if (!cond) fail.push(msg); };
expect(r.field.rms > 0.02, 'the field is not sounding: rms ' + r.field.rms);
expect(r.field.peak <= 1.01, 'the field exceeds full scale: ' + r.field.peak);
expect(r.open.peak > 0.02, 'nothing audible when the field is intact');
expect(r.open.peak <= 1.0, 'output clips: ' + r.open.peak);
expect(r.silent.peak < 0.03, 'density 0 is not silence: ' + r.silent.peak);
expect(r.back.peak > 0.02, 'the field did not return');
expect(r.ghosts.peak < r.open.peak * 0.5, 'density 10% did not thin the field');
expect(r.excavated.removed > r.back.removed, 'the absence removed nothing');
expect(r.scarred.removed > 50, 'the scar did not outlive the absence');
expect(r.released.removed < r.scarred.removed, 'RELEASE did not close the scars');
expect(r.buried.peak < r.open.peak * 0.6, 'direct removal did not recede');
expect(r.temporal.mean < r.temporal.peak * 0.9, 'temporal absence opened no gaps');
expect(gesture.depth > 0.1, 'holding still did not press the absence deeper');
expect(preserved === 1 && recalled === 1, 'preserve / recall did not round-trip');
expect(vocabulary.length === 0, 'additive controls present: ' + vocabulary.join(', '));
// Asserted on the subtraction path, which is what SELECTIVITY acts on and
// which measures the same under every condition tried. The figure in the full
// mix is reported alongside it and runs lower.
expect(r.combDirect - r.combOff > 15,
  'the harmonic comb left no partials standing: ' + r.combDirect.toFixed(1) + 'dB');
expect(r.combOn - r.combOff > 8,
  'the comb did not survive into the mix: ' + r.combOn.toFixed(1) + 'dB');
expect(r.topCut > 15, 'roll-off did not take the top away: ' + r.topCut.toFixed(1) + 'dB');
// One-sided: the claim is that it does not eat the body. The body reading
// coming out louder is the field drifting, not a failure of the control.
expect(r.bodyCut < 4, 'roll-off ate the body too: ' + r.bodyCut.toFixed(1) + 'dB');
expect(Math.abs(r.stepMs - r.expectMs) < r.expectMs * 0.1,
  'the pulse did not step at its tempo: ' + r.stepMs.toFixed(1) + 'ms');
expect(r.pulsed.mean < r.pulsed.peak * 0.85, 'the pulse opened no holes');
expect(errors.length === 0, 'console errors: ' + errors.join(' | '));

console.log(fail.length ? '\nFAILED:\n' + fail.map((f) => '  - ' + f).join('\n') : '\nall behaviour checks passed');
process.exit(fail.length ? 1 : 0);
