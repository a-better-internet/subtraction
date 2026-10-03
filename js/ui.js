/*
 * The interface.
 *
 * Every slider's zero means "nothing removed". Nothing in here adds a layer,
 * a voice, an effect or a note. The field arrives complete and the only
 * available gesture is refusal.
 */

import { GROUPS, defaults, defaultPattern, PATTERN_STEPS } from './params.js';

const NUMERALS = ['I', 'II', 'III', 'IV'];

export class UI {
  constructor(root, viz, engine) {
    this.root = root;
    this.viz = viz;
    this.engine = engine;
    this.state = defaults();
    this.voids = [
      { x: 0, y: 0.5, depth: 0, size: 1 },
      { x: -0.55, y: 0.3, depth: 0, size: 1 },
      { x: 0.55, y: 0.72, depth: 0, size: 1 },
      { x: 0, y: 0.9, depth: 0, size: 1 },
    ];
    this.selected = 0;
    this.preserved = [];
    this.controls = new Map();
    this.pattern = defaultPattern();
    this.drag = null;
    this.holdSince = 0;

    this.buildAbsencePanel();
    this.buildStepGrid();
    this.buildGroups();
    this.bindField();
    this.bindKeys();
    this.syncVoidUI();
  }

  /* ---------------- the four absences ---------------- */

  buildAbsencePanel() {
    const host = this.root.querySelector('#absences');
    this.voidRows = this.voids.map((v, i) => {
      const row = document.createElement('div');
      row.className = 'absence';
      row.innerHTML = `
        <button class="num" data-i="${i}">${NUMERALS[i]}</button>
        <input class="depth" type="range" min="0" max="1" step="0.001" value="0"
               aria-label="absence ${NUMERALS[i]} depth">
        <span class="depthv">0%</span>`;
      const num = row.querySelector('.num');
      const depth = row.querySelector('.depth');
      num.addEventListener('click', () => this.select(i));
      depth.addEventListener('input', () => {
        this.voids[i].depth = +depth.value;
        this.select(i);
        this.pushVoid(i);
      });
      host.appendChild(row);
      return { row, num, depth, value: row.querySelector('.depthv') };
    });
  }

  select(i) {
    this.selected = i;
    this.viz.selected = i;
    this.voidRows.forEach((r, k) => r.row.classList.toggle('on', k === i));
  }

  pushVoid(i) {
    this.engine.setVoid(i, this.voids[i]);
    this.syncVoidUI();
  }

  syncVoidUI() {
    this.voidRows.forEach((r, i) => {
      const d = this.voids[i].depth;
      if (+r.depth.value !== d) r.depth.value = d;
      r.value.textContent = Math.round(d * 100) + '%';
      r.row.classList.toggle('engaged', d > 0.002);
      r.row.classList.toggle('on', i === this.selected);
    });
  }

  /* ---------------- the step editor ---------------- */

  buildStepGrid() {
    const host = this.root.querySelector('#steps');
    this.stepCells = [];
    for (let i = 0; i < PATTERN_STEPS; i++) {
      const cell = document.createElement('div');
      cell.className = 'step';
      cell.innerHTML = `<div class="step-fill"></div><span>${i + 1}</span>`;
      host.appendChild(cell);
      this.stepCells.push(cell);
    }

    const depthAt = (ev, cell) => {
      const r = cell.getBoundingClientRect();
      return Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
    };
    const cellAt = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = el && el.closest('.step');
      return cell ? this.stepCells.indexOf(cell) : -1;
    };

    let painting = false;
    const paint = (ev) => {
      const i = cellAt(ev);
      if (i < 0) return;
      this.setStep(i, depthAt(ev, this.stepCells[i]));
    };

    host.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      painting = true;
      host.setPointerCapture(ev.pointerId);
      paint(ev);
    });
    host.addEventListener('pointermove', (ev) => { if (painting) paint(ev); });
    const stop = (ev) => {
      painting = false;
      try { host.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
    };
    host.addEventListener('pointerup', stop);
    host.addEventListener('pointercancel', stop);

    this.syncStepGrid();
    this.syncStepLength();
  }

  setStep(i, depth) {
    this.pattern[i] = depth;
    this.engine.setPattern(this.pattern);
    this.syncStepGrid();
  }

  syncStepGrid() {
    this.stepCells.forEach((cell, i) => {
      cell.querySelector('.step-fill').style.height = (this.pattern[i] * 100).toFixed(1) + '%';
    });
  }

  /* Steps past LENGTH are never reached, so they are shown as inactive. */
  syncStepLength() {
    const n = Math.round(this.state.pulseSteps);
    this.stepCells.forEach((cell, i) => cell.classList.toggle('unused', i >= n));
  }

  markStep(step) {
    if (step === this.lastStep || !this.stepCells) return;
    this.lastStep = step;
    this.stepCells.forEach((cell, i) => cell.classList.toggle('now', i === step));
  }

  /* ---------------- generated parameter controls ---------------- */

  buildGroups() {
    const left = this.root.querySelector('#rail-left');
    const right = this.root.querySelector('#rail-right');
    GROUPS.forEach((g) => {
      const sec = document.createElement('section');
      sec.className = 'group';
      const h = document.createElement('h2');
      h.textContent = g.name;
      sec.appendChild(h);
      if (g.note) {
        const n = document.createElement('p');
        n.className = 'note';
        n.textContent = g.note;
        sec.appendChild(n);
      }
      for (const p of g.params) sec.appendChild(this.buildControl(p));
      (g.rail === 'right' ? right : left).appendChild(sec);
    });
  }

  buildControl(p) {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';

    const head = document.createElement('div');
    head.className = 'ctl-head';
    const label = document.createElement('span');
    label.className = 'ctl-label';
    label.textContent = p.label;
    const readout = document.createElement('span');
    readout.className = 'ctl-read';
    head.appendChild(label);
    head.appendChild(readout);
    wrap.appendChild(head);

    let input;
    if (p.type === 'select') {
      input = document.createElement('select');
      for (const o of p.options) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o.toUpperCase();
        input.appendChild(opt);
      }
      input.value = this.state[p.key];
      readout.textContent = '';
    } else {
      input = document.createElement('input');
      input.type = 'range';
      input.min = p.min; input.max = p.max;
      input.step = p.int ? 1 : 0.001;
      input.value = this.state[p.key];
    }
    input.className = 'ctl-input';
    input.setAttribute('aria-label', p.label);
    input.addEventListener('input', () => {
      const raw = p.type === 'select' ? input.value : +input.value;
      this.state[p.key] = p.int ? Math.round(raw) : raw;
      this.refresh(p.key);
      if (p.key === 'pulseSteps') this.syncStepLength();
      this.engine.pushParams(this.state);
    });
    wrap.appendChild(input);

    if (p.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = p.hint;
      wrap.appendChild(hint);
    }

    this.controls.set(p.key, { p, input, readout });
    this.refresh(p.key);
    return wrap;
  }

  refresh(key) {
    const c = this.controls.get(key);
    if (!c) return;
    const v = this.state[key];
    if (c.p.type !== 'select') {
      c.readout.textContent = c.p.fmt ? c.p.fmt(v) : String(v);
      // the track fills from the left as more is taken away
      const t = (v - c.p.min) / (c.p.max - c.p.min);
      c.input.style.setProperty('--fill', (t * 100).toFixed(1) + '%');
    }
    if (c.input.value !== String(v)) c.input.value = v;
  }

  refreshAll() {
    for (const key of this.controls.keys()) this.refresh(key);
    this.syncVoidUI();
    this.syncStepGrid();
    this.syncStepLength();
  }

  /* ---------------- excavation gesture ---------------- */

  bindField() {
    const c = this.viz.canvas;

    const pick = (ev) => {
      const r = c.getBoundingClientRect();
      return { px: ev.clientX - r.left, py: ev.clientY - r.top };
    };

    const nearest = (px, py) => {
      let best = 0, bd = Infinity;
      this.voids.forEach((v, i) => {
        const p = this.viz.toCanvas(v.x, v.y);
        const d = (p.px - px) ** 2 + (p.py - py) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };

    c.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      c.setPointerCapture(ev.pointerId);
      const { px, py } = pick(ev);
      this.select(nearest(px, py));
      this.drag = { px, py, mode: ev.shiftKey ? 'depth' : 'move', startDepth: this.voids[this.selected].depth };
      this.holdSince = performance.now();
      if (this.drag.mode === 'move') this.moveSelected(px, py);
    });

    c.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      const { px, py } = pick(ev);
      if (this.drag.mode === 'depth') {
        // vertical drag with shift sets how deep the absence cuts
        const dy = (this.drag.py - py) / 220;
        const v = this.voids[this.selected];
        v.depth = Math.max(0, Math.min(1, this.drag.startDepth + dy));
        this.pushVoid(this.selected);
      } else {
        const moved = Math.hypot(px - this.drag.px, py - this.drag.py);
        if (moved > 2) this.holdSince = performance.now();
        this.moveSelected(px, py);
      }
      this.drag.px = px; this.drag.py = py;
    });

    const end = (ev) => {
      if (!this.drag) return;
      this.drag = null;
      this.holdSince = 0;
      try { c.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const v = this.voids[this.selected];
      v.size = Math.max(0.1, Math.min(4, v.size * Math.exp(-ev.deltaY * 0.0014)));
      this.pushVoid(this.selected);
    }, { passive: false });

    c.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  moveSelected(px, py) {
    const f = this.viz.toField(px, py);
    const v = this.voids[this.selected];
    v.x = f.x; v.y = f.y;
    this.pushVoid(this.selected);
  }

  /* Pressure: holding an absence still presses it deeper into the field. */
  tickHold(dt) {
    if (!this.drag || this.drag.mode !== 'move' || !this.holdSince) return;
    if (performance.now() - this.holdSince < 140) return;
    const v = this.voids[this.selected];
    if (v.depth >= 1) return;
    v.depth = Math.min(1, v.depth + dt * 0.55);
    this.pushVoid(this.selected);
  }

  bindKeys() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
      if (ev.key >= '1' && ev.key <= '4') this.select(+ev.key - 1);
    });
  }

  /* ---------------- preserved states ---------------- */

  preserve() {
    if (this.preserved.length >= 8) this.preserved.shift();
    this.preserved.push({
      state: { ...this.state },
      voids: this.voids.map((v) => ({ ...v })),
      pattern: [...this.pattern],
      at: new Date(),
    });
    this.renderPreserved();
  }

  recall(i) {
    const s = this.preserved[i];
    if (!s) return;
    this.state = { ...s.state };
    this.voids = s.voids.map((v) => ({ ...v }));
    this.pattern = [...(s.pattern || this.pattern)];
    this.refreshAll();
    this.engine.pushParams(this.state);
    this.engine.setPattern(this.pattern);
    this.voids.forEach((_, k) => this.engine.setVoid(k, this.voids[k]));
  }

  renderPreserved() {
    const host = this.root.querySelector('#preserved');
    host.innerHTML = '';
    this.preserved.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'state';
      const t = s.at.toTimeString().slice(0, 8);
      const removed = Math.round((1 - s.state.density) * 100);
      b.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b> ${t}<i>−${removed}%</i>`;
      b.addEventListener('click', () => this.recall(i));
      host.appendChild(b);
    });
  }
}
