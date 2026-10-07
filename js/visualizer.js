/*
 * SONIC CARTOGRAPHY
 *
 * The field is drawn as a circle. Vertical is frequency, horizontal is
 * stereo position -- the same space the absences move through, so what the
 * player sees and what the excavator subtracts are one map.
 *
 *   - what is in the source but has been removed  : deep indigo ghost
 *   - what survived                               : bone white
 *   - scar tissue, material still refusing to return : charcoal mottling
 *   - the absences                                : holes of true black
 *
 * As the player subtracts, the drawing empties out.
 */

const TAU = Math.PI * 2;
const V_SPAN = 0.88;   // fraction of the circle's height the spectrum occupies
const DB_RANGE = 46;   // decibels shown below the running peak
const TILT_DB = 30;    // display tilt across the range: noise-like material
                       // falls with frequency, and without this the drawing is
                       // a single mass at the bottom of the field

export class Visualizer {
  constructor(canvas, historyCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hCanvas = historyCanvas;
    this.hCtx = historyCanvas.getContext('2d');
    this.frame = null;
    this.norm = 1;
    this.selected = 0;
    this.pointer = null;
    this.dpr = 1;
    this.w = 0; this.h = 0;
    this.hw = 0; this.hh = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(240, r.width);
    this.h = Math.max(240, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const hr = this.hCanvas.getBoundingClientRect();
    this.hw = Math.max(240, hr.width);
    this.hh = Math.max(24, hr.height);
    this.hCanvas.width = Math.round(this.hw * dpr);
    this.hCanvas.height = Math.round(this.hh * dpr);
    this.hCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.hCtx.fillStyle = '#05070a';
    this.hCtx.fillRect(0, 0, this.hCanvas.width, this.hCanvas.height);
  }

  setFrame(f) { this.frame = f; }

  /* geometry shared with the pointer handling in ui.js */
  geom() {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const r = Math.min(this.w, this.h) * 0.46;
    return { cx, cy, r };
  }

  /* field space: x in [-1,1] stereo, y in [0,1] frequency (0 = low).
   * Frequency uses the full height of the circle, so the map the player
   * reads is the map the excavator subtracts from. */
  toField(px, py) {
    const { cx, cy, r } = this.geom();
    return {
      x: Math.max(-1, Math.min(1, (px - cx) / r)),
      y: Math.max(0, Math.min(1, (cy - py) / (2 * r * V_SPAN) + 0.5)),
    };
  }

  toCanvas(x, y) {
    const { cx, cy, r } = this.geom();
    return { px: cx + x * r, py: cy - (y - 0.5) * 2 * r * V_SPAN };
  }

  draw(state) {
    const ctx = this.ctx;
    const { cx, cy, r } = this.geom();
    const f = this.frame;

    ctx.clearRect(0, 0, this.w, this.h);

    // ---- the field's edge ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();

    // ground
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    bg.addColorStop(0, '#101319');
    bg.addColorStop(1, '#08090b');
    ctx.fillStyle = bg;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // graticule: decade frequency lines and the stereo axis
    ctx.strokeStyle = 'rgba(190,196,180,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const y = i / 10;
      const py = cy - (y - 0.5) * r;
      ctx.beginPath(); ctx.moveTo(cx - r, py); ctx.lineTo(cx + r, py); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();

    if (f) {
      const VB = f.bands.length / 5;
      const b = f.bands;

      // adaptive normalisation: the picture stays readable as material leaves
      let peak = 1e-6;
      for (let i = 0; i < VB * 2; i++) if (b[i] > peak) peak = b[i];
      this.norm += (peak - this.norm) * (peak > this.norm ? 0.3 : 0.02);
      const inv = 1 / (this.norm + 1e-9);
      const amp = r * 0.98;
      const comp = (v, i) => {
        const db = 20 * Math.log10(Math.max(1e-12, v * inv)) + (i / (VB - 1)) * TILT_DB;
        return Math.max(0, Math.min(1, (db + DB_RANGE) / DB_RANGE));
      };
      this.comp = comp;

      const yOf = (i) => cy - ((i / (VB - 1)) - 0.5) * 2 * r * V_SPAN;

      // ---- ghost: the source as it arrived, before subtraction ----
      // the source as it arrived, before anything was taken out of it
      this.ribbon(ctx, b, 0, VB, VB, yOf, cx, amp, comp,
        'rgba(58,62,50,0.30)', 'rgba(104,112,82,0.34)');

      // ---- scar tissue ----
      for (let i = 0; i < VB; i++) {
        const sc = b[VB * 4 + i];
        if (sc < 0.02) continue;
        ctx.fillStyle = `rgba(4,5,8,${Math.min(0.92, sc * 0.95)})`;
        const y = yOf(i);
        const bh = (2 * r * V_SPAN) / VB;
        ctx.fillRect(cx - r, y - bh * 0.5, r * 2, bh + 1);
      }

      // ---- survivor ----
      this.ribbon(ctx, b, VB * 2, VB * 3, VB, yOf, cx, amp, comp,
        'rgba(233,233,226,0.10)', 'rgba(210,242,77,0.92)');
    }

    // ---- the absences: holes of true black ----
    const voids = f ? f.voids : state.voids;
    voids.forEach((v, i) => {
      if (v.depth <= 0.002 && i !== this.selected) return;
      const p = this.toCanvas(v.x, v.y);
      const rad = Math.max(6, v.size * r * 0.9);
      if (v.depth > 0.002) {
        const g = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, rad);
        g.addColorStop(0, `rgba(0,0,0,${0.5 + 0.5 * v.depth})`);
        g.addColorStop(0.72, `rgba(2,3,5,${0.42 * v.depth})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.px, p.py, rad, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = i === this.selected
        ? 'rgba(210,242,77,0.8)' : `rgba(190,196,180,${0.12 + 0.2 * v.depth})`;
      ctx.lineWidth = i === this.selected ? 1.3 : 1;
      ctx.beginPath(); ctx.arc(p.px, p.py, rad, 0, TAU); ctx.stroke();

      ctx.fillStyle = i === this.selected ? 'rgba(210,242,77,0.92)' : 'rgba(190,196,180,0.38)';
      ctx.font = '8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(['I', 'II', 'III', 'IV'][i], p.px, p.py + 3);
    });

    // ---- where gravity is pulling ----
    if (f && state.gravityAmount > 0.01) {
      const p = this.toCanvas(f.gravX, f.gravY);
      ctx.strokeStyle = `rgba(255,90,43,${0.3 + 0.55 * state.gravityAmount})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.px - 7, p.py); ctx.lineTo(p.px + 7, p.py);
      ctx.moveTo(p.px, p.py - 7); ctx.lineTo(p.px, p.py + 7);
      ctx.stroke();
    }

    // ---- temporal absence darkens the whole field ----
    if (f && f.gate < 0.995) {
      ctx.fillStyle = `rgba(0,0,0,${(1 - f.gate) * 0.88})`;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

    ctx.restore();

    // rim
    ctx.strokeStyle = 'rgba(190,196,180,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();

    this.labels(ctx, cx, cy, r);
    if (f) this.pushHistory(f);
  }

  /* Drawn as separate runs of surviving bands. A band with nothing left in it
   * is a gap in the ribbon, not a zero-width pinch at the centre line -- which
   * would otherwise stroke an unbroken bright seam down an emptied field. */
  ribbon(ctx, b, offL, offR, VB, yOf, cx, amp, comp, fill, stroke) {
    const FLOOR = 0.02;
    const at = (i) => Math.max(comp(b[offL + i], i), comp(b[offR + i], i));
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;

    let i = 0;
    while (i < VB) {
      while (i < VB && at(i) <= FLOOR) i++;
      if (i >= VB) break;
      const start = i;
      while (i < VB && at(i) > FLOOR) i++;
      const end = i;

      ctx.beginPath();
      ctx.moveTo(cx - comp(b[offL + start], start) * amp, yOf(start));
      for (let k = start + 1; k < end; k++) {
        ctx.lineTo(cx - comp(b[offL + k], k) * amp, yOf(k));
      }
      for (let k = end - 1; k >= start; k--) {
        ctx.lineTo(cx + comp(b[offR + k], k) * amp, yOf(k));
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  labels(ctx, cx, cy, r) {
    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(123,129,145,0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('HIGH', cx, cy - r - 8);
    ctx.fillText('LOW', cx, cy + r + 16);
    ctx.textAlign = 'left';
    ctx.fillText('LEFT', cx - r, cy - r * 0.5);
    ctx.textAlign = 'right';
    ctx.fillText('RIGHT', cx + r, cy - r * 0.5);
  }

  /* TEMPORAL EROSION: a slow scroll of what has been allowed to remain. */
  pushHistory(f) {
    const hc = this.hCtx;
    const H = this.hCanvas.height;
    const W = this.hCanvas.width;
    const VB = f.bands.length / 5;

    hc.globalCompositeOperation = 'copy';
    hc.drawImage(this.hCanvas, -1, 0);
    hc.globalCompositeOperation = 'source-over';
    hc.fillStyle = '#08090b';
    hc.fillRect(W - 1, 0, 1, H);

    for (let py = 0; py < H; py++) {
      const i = Math.min(VB - 1, Math.floor((1 - py / H) * VB));
      const pre = (f.bands[i] + f.bands[VB + i]) * 0.5;
      const post = (f.bands[VB * 2 + i] + f.bands[VB * 3 + i]) * 0.5 * f.gate;
      const n = 1 / (this.norm + 1e-9);
      const tilt = (i / (VB - 1)) * TILT_DB;
      const db = (v) => Math.max(0, Math.min(1,
        (20 * Math.log10(Math.max(1e-12, v * n)) + tilt + DB_RANGE) / DB_RANGE));
      const a = db(post);
      const ghost = db(pre) * 0.3;
      // bone through to acid, so the strip reads as the same instrument
      const v = Math.pow(a, 1.25);
      const red = Math.round(Math.min(255, 8 + ghost * 60 + v * 202));
      const grn = Math.round(Math.min(255, 9 + ghost * 66 + v * 234));
      const blu = Math.round(Math.min(255, 11 + ghost * 44 + v * 96));
      hc.fillStyle = `rgb(${red},${grn},${blu})`;
      hc.fillRect(W - 1, py, 1, 1);
    }
  }
}
