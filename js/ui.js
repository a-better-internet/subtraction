/*
 * The interface.
 *
 * Every slider's zero means "nothing removed". Nothing in here adds a layer,
 * a voice, an effect or a note. The field arrives complete and the only
 * available gesture is refusal.
 */

import {
  GROUPS, TABS, ALL_PARAMS, defaults, defaultPattern, PATTERN_STEPS,
  DESTINATIONS, DEST_SPANS,
} from './params.js';
import { Modulation, SOURCES, CORDS, fmtRate, fmtDepth } from './modulation.js';

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
    this.mod = new Modulation();
    this.modValues = {};
    this.drag = null;
    this.holdSince = 0;

    this.buildAbsencePanel();
    this.buildGroups();
    this.buildStepGrid();
    this.buildPatchBay();
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
    const panel = this.panels.get('pulse');
    const block = document.createElement('section');
    block.className = 'group';
    block.innerHTML =
      '<h3>THE PATTERN</h3>'
      + '<p class="note">each step holds for one division. its bar is how much is '
      + 'taken out while it holds &mdash; draw across them, and set LENGTH to crop.</p>'
      + '<div id="steps"></div>';
    panel.appendChild(block);
    const host = block.querySelector('#steps');
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
    if (this.cordRows) this.syncAllCords();
    this.markTabs();
  }

  setStep(i, depth) {
    this.pattern[i] = depth;
    this.engine.setPattern(this.pattern);
    this.syncStepGrid();
    this.markTabs();
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

  /* ---------------- the patch bay ---------------- */

  buildPatchBay() {
    const panel = this.panels.get('patch');
    const block = document.createElement('section');
    block.className = 'group';
    block.innerHTML =
      '<h3>THE PATCH BAY</h3>'
      + '<p class="note">six cords. a voltage from somewhere, moving one control. '
      + 'nothing here makes sound &mdash; it only moves the things that take sound '
      + 'away. depth is an attenuverter: negative inverts the voltage.</p>'
      + '<div id="cord-head"><span></span><span>SOURCE</span><span>INTO</span>'
      + '<span>RATE</span><span>DEPTH</span><span></span></div>'
      + '<div id="cords"></div>';
    panel.appendChild(block);
    const host = block.querySelector('#cords');
    this.cordRows = [];
    for (let i = 0; i < CORDS; i++) {
      const row = document.createElement('div');
      row.className = 'cord';

      const n = document.createElement('span');
      n.className = 'cord-n';
      n.textContent = String(i + 1);

      const src = document.createElement('select');
      src.className = 'cord-src';
      src.setAttribute('aria-label', `cord ${i + 1} source`);
      for (const o of SOURCES) {
        const opt = document.createElement('option');
        opt.value = o.key; opt.textContent = o.label;
        src.appendChild(opt);
      }

      const dst = document.createElement('select');
      dst.className = 'cord-dst';
      dst.setAttribute('aria-label', `cord ${i + 1} destination`);
      for (const o of DESTINATIONS) {
        const opt = document.createElement('option');
        opt.value = o.key; opt.textContent = o.label;
        dst.appendChild(opt);
      }

      const rate = document.createElement('input');
      rate.type = 'range'; rate.min = 0; rate.max = 1; rate.step = 0.001;
      rate.className = 'cord-rate';
      rate.setAttribute('aria-label', `cord ${i + 1} rate`);

      const depth = document.createElement('input');
      depth.type = 'range'; depth.min = -1; depth.max = 1; depth.step = 0.001;
      depth.className = 'cord-depth';
      depth.setAttribute('aria-label', `cord ${i + 1} depth`);

      const read = document.createElement('span');
      read.className = 'cord-read';

      row.append(n, src, dst, rate, depth, read);
      host.appendChild(row);

      const cord = this.mod.cords[i];
      src.value = cord.source; dst.value = cord.dest;
      rate.value = cord.rate; depth.value = cord.depth;

      const sync = () => {
        cord.source = src.value;
        cord.dest = dst.value;
        cord.rate = +rate.value;
        cord.depth = +depth.value;
        this.syncCord(i);
      };
      [src, dst, rate, depth].forEach((el) => el.addEventListener('input', sync));

      this.cordRows.push({ row, src, dst, rate, depth, read });
      this.syncCord(i);
    }
  }

  syncCord(i) {
    const r = this.cordRows[i];
    const c = this.mod.cords[i];
    const patched = c.source !== 'none' && c.dest !== 'none' && c.depth !== 0;
    r.row.classList.toggle('patched', patched);
    this.markTabs();
    r.read.textContent = `${fmtDepth(c.depth)} · ${fmtRate(c.rate)}`;
    r.rate.style.setProperty('--fill', (c.rate * 100).toFixed(1) + '%');
    // Depth is an attenuverter: the track fills out from the centre.
    const d = c.depth;
    r.depth.style.setProperty('--from', (d < 0 ? 50 + d * 50 : 50).toFixed(1) + '%');
    r.depth.style.setProperty('--to', (d < 0 ? 50 : 50 + d * 50).toFixed(1) + '%');
    if (r.src.value !== c.source) r.src.value = c.source;
    if (r.dst.value !== c.dest) r.dst.value = c.dest;
    if (+r.rate.value !== c.rate) r.rate.value = c.rate;
    if (+r.depth.value !== c.depth) r.depth.value = c.depth;
  }

  syncAllCords() { for (let i = 0; i < CORDS; i++) this.syncCord(i); }

  /* Called every frame with what the cords are doing, so a control that is
   * being driven reads its live value rather than where its slider sits. */
  showModulated(values) {
    for (const key in this.modValues) {
      if (!(key in values)) this.refresh(key);
    }
    this.modValues = values;
    for (const key in values) {
      const c = this.controls.get(key);
      if (!c || c.p.type === 'select') continue;
      const v = Math.max(c.p.min, Math.min(c.p.max, this.state[key] + values[key]));
      c.readout.textContent = c.p.fmt ? c.p.fmt(v) : String(v);
      c.readout.classList.add('driven');
      const t = (v - c.p.min) / (c.p.max - c.p.min);
      c.input.style.setProperty('--mod', (t * 100).toFixed(1) + '%');
    }
  }

  spans() { return DEST_SPANS; }

  /* ---------------- generated parameter controls ---------------- */

  buildGroups() {
    const tabHost = this.root.querySelector('#tabs');
    const panelHost = this.root.querySelector('#panel');
    this.panels = new Map();
    this.tabButtons = new Map();

    TABS.forEach((t, i) => {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `panel-${t.key}`);
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.innerHTML =
        `<span class="tab-n">${t.n}</span>`
        + `<span class="tab-glyph" data-glyph="${t.glyph}"></span>`
        + `<span class="tab-label">${t.label}</span>`;
      btn.addEventListener('click', () => this.selectTab(t.key));
      tabHost.appendChild(btn);
      this.tabButtons.set(t.key, btn);

      const panel = document.createElement('div');
      panel.className = 'panel-page';
      panel.id = `panel-${t.key}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-label', `${t.n} ${t.label}`);
      panel.innerHTML =
        `<div class="panel-head"><span class="panel-n">${t.n}</span>`
        + `<h2>${t.label}</h2><span class="panel-cat">SBTR/001&thinsp;&middot;&thinsp;${t.n}</span></div>`;
      panelHost.appendChild(panel);
      this.panels.set(t.key, panel);

      if (i === 0) { btn.classList.add('on'); panel.classList.add('on'); }
    });

    for (const g of GROUPS) {
      const panel = this.panels.get(g.tab);
      if (!panel) continue;
      panel.appendChild(this.buildGroup(g));
    }
    this.activeTab = TABS[0].key;

    // Which tab each control lives under, so the rail can show where something
    // has been engaged without the player having to open all nine.
    this.tabOfParam = new Map();
    for (const g of GROUPS) {
      for (const p of g.params) this.tabOfParam.set(p.key, g.tab);
    }
    this.markTabs();
  }

  /* A tab is marked when anything under it has been moved off its default, or
   * when a cord is plugged into one of its controls. */
  markTabs() {
    if (!this.tabButtons) return;
    const live = new Set();
    for (const p of ALL_PARAMS) {
      if (this.state[p.key] !== p.def) {
        const tab = this.tabOfParam.get(p.key);
        if (tab) live.add(tab);
      }
    }
    for (const c of this.mod.cords) {
      if (c.source === 'none' || c.dest === 'none' || !c.depth) continue;
      live.add('patch');
      const tab = this.tabOfParam.get(c.dest);
      if (tab) live.add(tab);
    }
    if (this.pattern.some((v, i) => v !== (i % 4 === 0 ? 0 : 1))) live.add('pulse');
    for (const [k, btn] of this.tabButtons) btn.classList.toggle('live', live.has(k));
  }

  buildGroup(g) {
    const sec = document.createElement('section');
    sec.className = 'group';
    const h = document.createElement('h3');
    h.textContent = g.name;
    sec.appendChild(h);
    if (g.note) {
      const n = document.createElement('p');
      n.className = 'note';
      n.textContent = g.note;
      sec.appendChild(n);
    }
    for (const p of g.params) sec.appendChild(this.buildControl(p));
    return sec;
  }

  selectTab(key) {
    if (!this.panels.has(key)) return;
    this.activeTab = key;
    for (const [k, btn] of this.tabButtons) {
      const on = k === key;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const [k, p] of this.panels) p.classList.toggle('on', k === key);
    const panel = this.panels.get(key);
    if (panel) panel.scrollTop = 0;
    this.root.querySelector('#panel').scrollTop = 0;
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
      this.markTabs();
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
      c.readout.classList.remove('driven');
      c.input.style.removeProperty('--mod');
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
    if (this.cordRows) this.syncAllCords();
    this.markTabs();
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
      cords: this.mod.serialise(),
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
    if (s.cords) this.mod.restore(s.cords);
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
