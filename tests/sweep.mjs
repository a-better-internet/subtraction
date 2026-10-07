/*
 * Robustness sweep.
 *
 * This instrument is built almost entirely out of feedback -- a field that
 * granulates its own output, three delay networks, resonant combs and a
 * spectral mask with persistent memory. The failure mode that matters is not
 * "sounds wrong", it is a single non-finite sample latching the whole graph
 * into silence. So: visit every mode of every control and assert that the
 * output stays finite and bounded throughout.
 *
 *   node tests/sweep.mjs            (serve the directory on :8099 first)
 */

const pw = (await import(process.env.PLAYWRIGHT || 'playwright')).default;
const { chromium } = pw;

const URL = process.env.URL || 'http://127.0.0.1:8099/';
const MODES = ['static', 'drift', 'wander', 'orbit', 'walk', 'tidal', 'gravity', 'attractor'];
const TARGETS = ['frequency', 'amplitude', 'transient', 'density', 'stereo',
                 'rhythm', 'harmonic', 'noise', 'silence'];
const SPECTRAL = ['off', 'low', 'mid', 'high', 'notch', 'moving', 'multiple', 'excavate'];
const RESIDUE = ['harmonic', 'granular', 'spatial', 'transient', 'reverberant', 'phase'];
const HARMONIC = ['off', 'series', 'octaves', 'fifths', 'major', 'minor', 'pentatonic', 'whole'];
const ARP = ['off', 'up', 'down', 'updown', 'random'];
const DIVISION = ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'];
const SKEW = ['off', 'inverse', 'tandem'];

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.click('#enter');
await page.waitForTimeout(2000);

// Everything engaged at once, so each mode is exercised under load.
await page.evaluate(() => {
  const { ui, engine } = window.SUBTRACTION;
  Object.assign(ui.state, {
    density: 0.6, absenceSize: 0.4, focus: 0.6, movementRate: 0.8,
    memory: 0.7, decay: 0.7, gravityAmount: 0.8, spectralAmount: 0.8,
    temporalAmount: 0.4, temporalSize: 0.3, voidDensity: 0.3, voidSize: 0.3,
    residueVeil: 0.8, depth: 0.4, centreRemoval: 0.3, sideRemoval: 0.2,
    timeScale: 0.35, infinity: 0.85,
    harmonicAmount: 0.8, harmonicRoot: 0.4, harmonicWidth: 0.3,
    rolloff: 0.3, rolloffSlope: 0.5,
    pulseAmount: 0.8, pulseTempo: 0.5, pulseSteps: 16, pulseSwing: 0.3, pulseEdge: 0.2,
    arpRange: 0.5,
    plexus: 0.4, plexSize: 0.5, plexDiffuse: 0.6, plexColor: 0.4, plexDecay: 0.8,
    couple: 0.6, skew: 0.5, send: 1,
  });
  ui.refreshAll(); engine.pushParams(ui.state);
  ui.voids.forEach((v, i) => {
    Object.assign(v, { depth: 0.7, size: 1 + i * 0.3 });
    engine.setVoid(i, v);
  });
});

const check = async (label) => {
  const r = await page.evaluate(async () => {
    const { engine } = window.SUBTRACTION;
    const a = engine.ctx.createAnalyser();
    a.fftSize = 2048;
    engine.master.connect(a);           // before the saturator hides anything
    const buf = new Float32Array(2048);
    let peak = 0, bad = 0;
    for (let i = 0; i < 18; i++) {
      a.getFloatTimeDomainData(buf);
      for (let j = 0; j < buf.length; j++) {
        const v = buf[j];
        if (!Number.isFinite(v)) bad++;
        else if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    engine.master.disconnect(a);
    const removed = document.getElementById('removed').textContent;
    return { peak: +peak.toFixed(3), bad, removed };
  });
  const ok = r.bad === 0 && r.peak < 8 && /^\d+%$/.test(r.removed);
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label.padEnd(34)} peak=${String(r.peak).padEnd(7)} removed=${r.removed}${r.bad ? '  NON-FINITE x' + r.bad : ''}`);
  return ok;
};

const set = (p) => page.evaluate((p) => {
  const { ui, engine } = window.SUBTRACTION;
  Object.assign(ui.state, p); ui.refreshAll(); engine.pushParams(ui.state);
}, p);

let failures = 0;
const visit = async (key, values, label) => {
  for (const v of values) {
    await set({ [key]: v });
    await page.waitForTimeout(900);
    if (!(await check(`${label} ${v}`))) failures++;
  }
};

await visit('movementMode', MODES, 'movement');
await set({ movementMode: 'wander' });
await visit('gravityTarget', TARGETS, 'gravity');
await set({ gravityTarget: 'frequency' });
await visit('spectralMode', SPECTRAL, 'spectral');
await set({ spectralMode: 'notch' });
await visit('residueType', RESIDUE, 'residue');
await set({ residueType: 'reverberant' });
await visit('harmonicMode', HARMONIC, 'harmonic');
await set({ harmonicMode: 'series' });
await visit('arpMode', ARP, 'arpeggio');
await set({ arpMode: 'up' });
await visit('pulseDivision', DIVISION, 'division');
await set({ pulseDivision: '1/16' });
await visit('skewMode', SKEW, 'skew');
await set({ skewMode: 'inverse' });

// The Plexus at the ends of its own controls, with the direct sound removed
// so the network is what is being heard.
await set({ depth: 0.75 });
for (const [label, p] of Object.entries({
  'plexus entangled': { plexus: 0 },
  'plexus discrete': { plexus: 1 },
  'plexus size min': { plexus: 0.3, plexSize: 0 },
  'plexus size max': { plexus: 0.3, plexSize: 1 },
  'plexus decay max': { plexus: 0.2, plexDecay: 1 },
  'plexus color dark': { plexColor: 0 },
  'plexus color bright': { plexColor: 1 },
  'plexus dual mono': { couple: 0 },
  'plexus interlaced': { couple: 1 },
  'plexus send withheld': { send: 0 },
})) {
  await set(p);
  await page.waitForTimeout(1400);
  if (!(await check(label))) failures++;
}
await set({ depth: 0.4, plexus: 0.4, plexSize: 0.5, plexDecay: 0.8, couple: 0.6, send: 1,
            plexColor: 0.5 });

// Every cord patched at once, into the things most likely to interact badly.
await page.evaluate(() => {
  const { ui } = window.SUBTRACTION;
  const cords = [
    { source: 'sine', dest: 'plexDecay', depth: 1, rate: 0.9 },
    { source: 'random', dest: 'plexSize', depth: 1, rate: 0.85 },
    { source: 'envelope', dest: 'plexus', depth: -1, rate: 0.8 },
    { source: 'square', dest: 'send', depth: -1, rate: 0.9 },
    { source: 'chaosX', dest: 'couple', depth: 1, rate: 0.5 },
    { source: 'pulseStep', dest: 'density', depth: -1, rate: 0.5 },
  ];
  cords.forEach((c, i) => Object.assign(ui.mod.cords[i], c));
  ui.syncAllCords();
});
await page.waitForTimeout(6000);
if (!(await check('every cord patched'))) failures++;
await page.evaluate(() => {
  const { ui } = window.SUBTRACTION;
  ui.mod.cords.forEach((c) => Object.assign(c, { source: 'none', dest: 'none', depth: 0 }));
  ui.syncAllCords();
});

// Pattern edges: nothing removed at all, and everything removed on every step.
for (const [label, pattern] of Object.entries({
  'pattern empty': new Array(16).fill(0),
  'pattern full': new Array(16).fill(1),
})) {
  await page.evaluate((p) => {
    const { ui, engine } = window.SUBTRACTION;
    ui.pattern = p; engine.setPattern(p); ui.syncStepGrid();
  }, pattern);
  await page.waitForTimeout(1200);
  if (!(await check(label))) failures++;
}
// Back to the default pattern, so the extremes below are not trivially silent.
await page.evaluate(async () => {
  const { ui, engine } = window.SUBTRACTION;
  const { defaultPattern } = await import('../js/params.js');
  ui.pattern = defaultPattern(); engine.setPattern(ui.pattern); ui.syncStepGrid();
});

// Extremes, held long enough for any slow divergence to show.
for (const [label, p] of Object.entries({
  'everything at maximum': { density: 1, absenceSize: 1, focus: 1, memory: 1, decay: 1,
    gravityAmount: 1, spectralAmount: 1, temporalAmount: 1, voidDensity: 1, voidSize: 1,
    residueVeil: 1, depth: 1, centreRemoval: 1, sideRemoval: 1, infinity: 1, timeScale: 0,
    harmonicAmount: 1, harmonicWidth: 1, rolloff: 1, rolloffSlope: 1, pulseAmount: 1,
    pulseTempo: 1, pulseSwing: 1, pulseEdge: 1, arpRange: 1,
    plexus: 1, plexSize: 1, plexDiffuse: 1, plexColor: 1, plexDecay: 1,
    couple: 1, skew: 1, send: 1 },
  'everything at minimum': { density: 1, absenceSize: 0, focus: 0, memory: 0, decay: 0,
    gravityAmount: 0, spectralAmount: 0, temporalAmount: 0, voidDensity: 0,
    residueVeil: 0, depth: 0, centreRemoval: 0, sideRemoval: 0, infinity: 0, timeScale: 1,
    harmonicAmount: 0, harmonicWidth: 0, rolloff: 0, pulseAmount: 0,
    pulseTempo: 0, pulseSwing: 0, pulseEdge: 0, arpRange: 0,
    plexus: 0, plexSize: 0, plexDiffuse: 0, plexColor: 0, plexDecay: 0,
    couple: 0, skew: 0, send: 0 },
  'fastest pulse, tightest comb': { pulseAmount: 1, pulseTempo: 1, pulseDivision: '1/32',
    pulseEdge: 0, harmonicAmount: 1, harmonicWidth: 0, harmonicMode: 'series', arpMode: 'random' },
  'geological, self-generating': { timeScale: 1, infinity: 1, memory: 1, decay: 1, density: 0.5 },
})) {
  await set(p);
  await page.waitForTimeout(3500);
  if (!(await check(label))) failures++;
}

if (errors.length) { failures++; console.log('\nconsole errors:\n' + errors.map(e => '  ' + e).join('\n')); }
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nsweep clean');
process.exit(failures ? 1 : 0);
