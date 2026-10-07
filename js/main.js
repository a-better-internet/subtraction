import { Engine } from './engine.js';
import { Visualizer } from './visualizer.js';
import { UI } from './ui.js';
import { ALL_PARAMS, VOID_DEST_BY_KEY } from './params.js';

const PARAM_BY_KEY = new Map(ALL_PARAMS.map((p) => [p.key, p]));

const root = document.body;
const engine = new Engine();
const viz = new Visualizer(
  document.getElementById('field'),
  document.getElementById('history'),
);
const ui = new UI(root, viz, engine);

const el = (id) => document.getElementById(id);
const enterBtn = el('enter');
const withdrawBtn = el('withdraw');
const preserveBtn = el('preserve');
const releaseBtn = el('release');
const extractBtn = el('extract');
const statusEl = el('status');
const removedEl = el('removed');
const meterEl = el('meter-fill');
const veilEl = el('veil');
const rootEl = el('root');

let last = performance.now();
let removed = 0;
let looping = false;

/* What the instrument knows about itself, handed to the patch bay each frame
 * so its own signals can be used as control voltage. */
const field = {
  level: 0, gate: 1, stepValue: 0, clock: 0,
  chaosX: 0, chaosY: 0, centroid: 0.5, stereo: 0, removed: 0,
};

engine.onFrame = (f) => {
  viz.setFrame(f);
  removed += (f.removed - removed) * 0.1;
  ui.markStep(f.step);
  field.gate = f.gate;
  field.clock = f.clock || 0;
  field.chaosX = f.chaosX || 0;
  field.chaosY = f.chaosY || 0;
  field.centroid = f.gravY;
  field.stereo = f.gravX;
  field.removed = f.removed;
  field.stepValue = f.step >= 0 ? (ui.pattern[f.step] || 0) : 0;
  // The root moves when the arpeggio steps it, so it is worth showing.
  rootEl.textContent = f.root
    ? (f.root >= 1000 ? (f.root / 1000).toFixed(2) + ' kHz' : f.root.toFixed(1) + ' Hz')
    : '\u2014';
};

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  ui.tickHold(dt);

  // ---- the patch bay ----
  field.level = engine.level();
  const offsets = ui.mod.evaluate(dt, field, ui.spans());
  if (ui.mod.cords.some((c) => c.source !== 'none' && c.dest !== 'none' && c.depth)) {
    applyModulation(offsets);
    ui.showModulated(offsets);
  } else if (Object.keys(ui.modValues).length) {
    ui.showModulated({});
    engine.pushParams(ui.state);
  }

  viz.draw({ voids: ui.voids, gravityAmount: ui.state.gravityAmount });
  removedEl.textContent = Math.round(removed * 100) + '%';
  // Decibels, not amplitude: this instrument spends most of its time quiet,
  // and a linear meter reads as broken when the field is mostly gone.
  const lvl = engine.level();
  const db = lvl > 1e-5 ? (20 * Math.log10(lvl) + 54) / 54 : 0;
  meterEl.style.width = (Math.max(0, Math.min(1, db)) * 100).toFixed(1) + '%';
  requestAnimationFrame(loop);
}

/* Cords move the controls; the controls are what remove things. The base
 * values the player set are never written over -- the offset is applied on
 * its way to the engine and the sliders stay where they were put. */
function applyModulation(offsets) {
  const keys = Object.keys(offsets);
  if (!keys.length) return;
  const state = { ...ui.state };
  let touchedVoid = false;
  for (const key of keys) {
    const vd = VOID_DEST_BY_KEY.get(key);
    if (vd) { touchedVoid = true; continue; }
    const p = PARAM_BY_KEY.get(key);
    if (!p) continue;
    state[key] = Math.max(p.min, Math.min(p.max, state[key] + offsets[key]));
  }
  engine.pushParams(state);

  if (touchedVoid) {
    for (const key of keys) {
      const vd = VOID_DEST_BY_KEY.get(key);
      if (!vd) continue;
      const base = ui.voids[vd.void];
      const lo = vd.field === 'x' ? -1 : 0;
      const v = Math.max(lo, Math.min(1, base[vd.field] + offsets[key]));
      engine.setVoid(vd.void, { ...base, [vd.field]: v });
    }
  }
}

function note(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
}

async function enter() {
  enterBtn.disabled = true;
  note('entering the field…');
  try {
    await engine.enter();
  } catch (err) {
    enterBtn.disabled = false;
    const insecure = location.protocol === 'file:';
    note(insecure
      ? 'the field needs a local server: run  python3 -m http.server  and open the page over http'
      : 'the field could not open: ' + err.message, 'error');
    console.error(err);
    return;
  }
  engine.pushParams(ui.state);
  engine.setPattern(ui.pattern);
  ui.voids.forEach((v, i) => engine.setVoid(i, v));
  veilEl.classList.add('gone');
  note('the field is open. listen before you remove anything.');
  withdrawBtn.disabled = false;
  preserveBtn.disabled = false;
  releaseBtn.disabled = false;
  extractBtn.disabled = false;
  if (!looping) { looping = true; last = performance.now(); requestAnimationFrame(loop); }
}

enterBtn.addEventListener('click', enter);

withdrawBtn.addEventListener('click', async () => {
  if (!engine.entered) return;
  if (engine.suspended) {
    await engine.enter();
    withdrawBtn.textContent = 'WITHDRAW';
    note('the field is open again. it did not wait for you.');
  } else {
    await engine.withdraw();
    withdrawBtn.textContent = 'RE-ENTER';
    note('withdrawn. the field is held, not stopped.');
  }
});

preserveBtn.addEventListener('click', () => {
  ui.preserve();
  note('state preserved. the field continues.');
});

releaseBtn.addEventListener('click', () => {
  engine.release();
  note('released. the scars are closing over.');
});

extractBtn.addEventListener('click', () => {
  if (engine.recorder) {
    engine.stopExtract();
    extractBtn.textContent = 'EXTRACT';
    extractBtn.classList.remove('rec');
    note('a span of time has been taken out of the continuum.');
  } else if (engine.startExtract()) {
    extractBtn.textContent = 'STOP';
    extractBtn.classList.add('rec');
    note('extracting…');
  } else {
    note('this browser will not let a span be taken out.', 'error');
  }
});

// Draw the empty field before anything is entered, so the page is not dead.
viz.draw({ voids: ui.voids, gravityAmount: 0 });

// A window into the running instrument, for the console and for tests.
window.SUBTRACTION = { engine, ui, viz, enter };
