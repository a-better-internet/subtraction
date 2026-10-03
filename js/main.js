import { Engine } from './engine.js';
import { Visualizer } from './visualizer.js';
import { UI } from './ui.js';

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

let last = performance.now();
let removed = 0;
let looping = false;

engine.onFrame = (f) => {
  viz.setFrame(f);
  removed += (f.removed - removed) * 0.1;
};

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  ui.tickHold(dt);
  viz.draw({ voids: ui.voids, gravityAmount: ui.state.gravityAmount });
  removedEl.textContent = Math.round(removed * 100) + '%';
  meterEl.style.width = (Math.min(1, engine.level()) * 100).toFixed(1) + '%';
  requestAnimationFrame(loop);
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
