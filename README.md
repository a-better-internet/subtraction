# SUBTRACTION

**An instrument for sculpting infinity.**

A browser-based sound-design instrument built on a single inversion of the
usual synthesizer philosophy: instead of generating sound, it removes sound
from an already infinite field.

There is no oscillator to choose, no melody to construct, no sequence to
accumulate. The field is already sounding, continuously and inexhaustibly,
before you touch anything. Every control is an act of subtraction.

You don't play it so much as excavate it.

```
SOURCE  →  CONTINUOUS FLUX  →  SUBTRACTION
```

---

## Running it

The instrument uses AudioWorklets, which browsers refuse to load over
`file://`. Serve the directory and open it over http:

```sh
python3 -m http.server 8099      # or:  npx http-server -p 8099
```

Then open <http://127.0.0.1:8099/> and press **ENTER**.

No build step, no dependencies, no bundler. It is plain ES modules and the
Web Audio API.

> Wear headphones, and turn the volume up rather than down. The instrument has
> no make-up gain anywhere: at low densities what survives is genuinely quiet,
> because that is the point.

---

## The rite

```
1 ENTER → 2 LISTEN → 3 IDENTIFY → 4 REMOVE → 5 WAIT → 6 REMOVE AGAIN → 7 PRESERVE → 8 RELEASE
```

Step 2 is not decoration. Enter the field and do nothing for a minute. The
source is dense and slow; what is worth removing only becomes apparent once
you have heard what is there.

---

## The field

The source is a continuously evolving system with no loop point and no start
or end. It is built from layered coloured noise, three band-limited streams on
drifting filters, a 24-mode inharmonic resonator bank that slowly re-tunes
itself, a low mode cluster, Lorenz chaos and LFOs at irrational frequency
ratios, and a granular layer that reads from a buffer the field writes its own
output into — the source feeds on itself, which is what makes it
inexhaustible.

It is deliberately too dense. The instrument's job is to make it less dense.

---

## The subtraction field

The large circle is the whole sonic spectrum. **Vertical is frequency**
(low at the bottom, high at the top); **horizontal is stereo position**. This
is not a picture of the sound next to the controls — it is the same space the
excavator subtracts from, so what you see is what you are carving.

Four **absences** exist in the field from the moment you enter. They remove
nothing until they are deepened. There is no button to create one.

| gesture | effect |
|---|---|
| drag | steer the selected absence through the field |
| hold still | press it deeper — excavation by pressure |
| shift + drag | set its depth directly |
| scroll | resize it |
| keys 1–4 | choose which absence you are steering |

What you see: the **ghost** of the source as it arrived (indigo), what
**survived** (bone white), **scar tissue** still refusing to return
(charcoal), and the absences themselves (true black). As you subtract, the
drawing empties out.

---

## The controls

Every parameter describes something being taken away. Zero always means
*nothing removed*.

| | |
|---|---|
| **INFINITY** | how much the field decides for itself. At maximum it is a self-generating system and your only intervention is deciding what is allowed to remain audible. |
| **TIME SCALE** | the rate at which subtraction operates: MICRO (milliseconds — clicks, grains, spectral tearing), HUMAN (seconds — phrases, breaths), GEOLOGICAL (minutes — erosion you can barely perceive). |
| **DENSITY** | how much of the source remains. Not a volume control: which material survives is decided per spectral bin by a drifting survival rank, so 10% gives moving ghosts rather than a quiet version of the same thing. 0% is absolute silence. |
| **ABSENCE** | size, focus (a band across the whole stereo field ↔ a localised hole inside it), and movement — static, drift, wander, orbit, walk, tidal, gravity, attractor. *The sound evolves not because you added modulation, but because the thing removing it moves.* |
| **SPECTRAL ABSENCE** | a void dragged through the spectrum. The readout says REMOVE 4.2 kHz, never "boost". Shapes: low, mid, high, notch, moving notch, multiple absences, and a comb that excavates the spectrum. |
| **TEMPORAL ABSENCE** | moments removed rather than frequencies. The field goes on evolving inside the gaps, so silence becomes active material. |
| **PERSISTENCE** | MEMORY decides whether a subtraction is temporary or permanent; DECAY OF ABSENCE how long removed material stays gone, from milliseconds to INDEFINITE. At the extreme the instrument progressively erodes itself and every interaction leaves a scar. |
| **GRAVITY** | what the subtraction is drawn toward: frequency, amplitude, transients, density, stereo position, rhythmic repetition, harmonic information, noise, or silence. Aim it at TRANSIENT and the field loses its definition and becomes an amorphous cloud; aim it at HARMONIC and tone dissolves into atmosphere. |
| **HARMONIC ABSENCE** | Everything out of tune with the root is taken away, and what is left is the field, in tune. `series` keeps one true harmonic series; the scales keep their degrees in every octave. This is the shortest route to something musical: it is a comb, not an oscillator, so nothing is ever added — the pitch was in the noise all along. |
| **PULSE** | A step sequencer made of absence. Each of the sixteen steps holds for one division of the tempo, and its bar is how much is taken out while it holds. Draw across the bars; LENGTH crops the pattern. |
| **ARPEGGIO** | The root steps with the pulse, so a different set of partials is left standing on each one. It plays no notes — it moves what survives. Needs HARMONIC ABSENCE to be heard. |
| **ROLL-OFF** | The top of the field taken off, for when it is too bright. Applied to the survivor and the residue alike, after the two are separated, so the air does not reappear as residue. |
| **THE PLEXUS** | A network of feedback paths the signal is already circulating through, after the Make Noise Soundhack Plexiphon. PLEXUS *removes paths*: at zero all eight are present and fully entangled, which is the reverb-like end; turning it up takes paths out and unpicks their connections until two discrete taps are left, which is the echo-like end. Everything in between is neither. SIZE is the temporal relation between the paths — a room at one end, a repeat rate at the other. DIFFUSE takes the edge off each path; COLOR decides which end of the spectrum the network forgets first; DECAY runs from a short room to all but infinite. COUPLE removes the separation between the two sides, from dual mono to interlaced; SKEW pulls them apart (or pushes them together) on PLEXUS, SIZE and COLOR. SEND is normalled high and decides whether the field is fed in at all — patch PULSE GATE into it at a negative depth and the feed is withheld on the removed steps while the paths keep circulating what they already hold. |
| **DEPTH & SPACE** | DIRECT REMOVAL pushes material backward — foreground, near, background, distant, buried, inaudible. Remove the centre and the peripheral material survives; remove the sides and a narrow phantom centre is left. |
| **THE VOID** | silence as a compositional material, with its own size, density, depth and memory. |
| **RESIDUE** | what subtraction leaves behind. The residue is literally the spectrum the absences removed; the control removes the veil over it. Kinds: harmonic, granular, spatial, transient, reverberant, phase. |

If you want somewhere to start: set HARMONIC ABSENCE to `series` with
SELECTIVITY at full, bring PULSE DEPTH up, and put ARPEGGIO on `up`. That is a
pitched, metrical, arpeggiating instrument — assembled entirely out of things
being taken away.

### The patch bay

Six cords. Each takes a control voltage from somewhere and moves one control
with it; DEPTH is an attenuverter, so a negative setting inverts the voltage.
Nothing in the patch bay makes sound — it only moves the things that take
sound away.

Alongside the usual shapes (sine, triangle, ramp, saw, square, sample-and-hold
and smoothed random, each with its own rate from 0.01 Hz to 20 Hz) the sources
include the instrument listening to itself:

| | |
|---|---|
| ENVELOPE FOLLOWER | the amplitude of the output, slewed by RATE — the Plexiphon's CV output, which exists to put the network back into its own controls |
| PULSE GATE · PULSE STEP CV · CLOCK RAMP | the step sequencer as a gate, as a stepped voltage, and as a ramp across each step |
| FIELD CHAOS X / Y | the Lorenz attractor the field is already using to decide what to do next |
| SPECTRAL CENTROID · STEREO DRIFT | where the surviving energy sits in the field, and how far to one side |
| REMOVED AMOUNT | how much of the field is gone right now |

Any control marked modulatable is a destination, and so are the first two
absences — a voltage steering *where* the excavation happens is the whole
point. A control being driven reads its live value in rust rather than where
its slider sits.

Three to try: ENVELOPE FOLLOWER into PLEXUS at a negative depth, so the
network unpicks itself as it gets louder. PULSE GATE into SEND at −100%, so
the feed is withheld in rhythm. FIELD CHAOS Y into ABSENCE I · FREQUENCY, and
the field decides what to excavate.

**PRESERVE** captures a state. **RELEASE** stops holding the absences open and
lets the field close over them. **EXTRACT** takes a span of time out of the
continuum and keeps it as an audio file. **WITHDRAW** holds the field — it does
not stop it.

---

## The rule

> There is no add operation anywhere in this interface.

You cannot add an oscillator, a sample, a layer, reverb, modulation or notes.
You can only *remove, suppress, erase, bury, obscure, isolate, silence,
constrain, or wait.*

Even the effects are subtractive. There is no reverb mix — there is DIRECT
SOUND REMOVAL, and the reverberant field that was always there is exposed as
you take the direct sound away. There is no filter cutoff, there is SPECTRAL
ABSENCE. There is no distortion, there is transient removal.

Internally, the reverberant field and all six residue processors run from the
moment you enter. They are never switched on; they are uncovered. The signal
path contains no make-up gain, and a test asserts that no control in the
interface is capable of adding material.

---

## How it works

```
FIELD ─▶ EXCAVATOR ─┬─▶ survivor ─┬─▶ direct ──────────┐
                    │             └─▶ THE PLEXUS ──────┤
                    │                                  ├─▶ saturator ─▶ limiter ─▶ out
                    └─▶ residue  ─▶ residue stage ─────┘
```

The Plexus sits where a reverb would, but it is never mixed in: like the
reverberant field it replaces, it runs from the moment the instrument is
entered, and DIRECT REMOVAL is the only thing standing between the player and
it. There is no wet/dry control anywhere in the instrument.

| file | |
|---|---|
| `worklets/field-processor.js` | the infinite field |
| `worklets/excavator-processor.js` | the subtraction itself |
| `worklets/plexus-processor.js` | the network of feedback paths |
| `js/modulation.js` | the patch bay: control voltage sources and cords |
| `js/engine.js` | audio graph: depth, space, residue, master |
| `js/visualizer.js` | the cartography |
| `js/params.js` | the parameter model the interface is generated from |
| `js/ui.js` · `js/main.js` | interface and wiring |

The excavator is the instrument's brain. It runs a short-time Fourier
transform over the field (4096-point window, 75% overlap) and places every bin
in the same two-dimensional space the player sees — frequency against stereo
position, the latter derived per bin from the ratio of its left and right
magnitudes. The absences are evaluated against that space:

```
bin gain = (product of every absence covering it) × (1 − its scar)
```

Scars are per-bin state: an absence writes into them in proportion to MEMORY,
and they recover at a rate set by DECAY OF ABSENCE, so a hole can outlive the
thing that made it — indefinitely, if you ask for that. Gravity computes a
weighted centroid of whichever spectral feature it has been aimed at and pulls
the absences toward it. Temporal absence and the void are applied
sample-accurately after resynthesis, which is what lets MICRO time scales tear
at the grain of the sound. The residue output carries `original × (1 − gain)`:
exactly the material that was removed.

HARMONIC ABSENCE is another term in the same product: each bin is measured in
semitones against the nearest partial of the root, and removed in proportion to
how far out of tune it is. The window is 4096 points because the comb has to
resolve it — at 2048 the bins are 23 Hz apart while A1's partials are 55 Hz
apart, and the comb smears into nothing. No comb is ever asked to pass a band
narrower than one bin; where a semitone is narrower than the analysis, in the
bass, the scale modes let go rather than smear a half-removal across it.

THE PULSE and the time-domain absences run after resynthesis, so they stay
sample-accurate no matter how long the analysis window is: the pulse measures
within 1% of the tempo it is given.

Nothing in the signal path is ever multiplied above unity.

### Two notes for anyone reading the DSP

Both of these were found by measurement, and both are the kind of thing that
silently destroys an instrument built this heavily on feedback:

- **The mixing matrix in the delay networks is `H/4`, not the textbook `H/2`.**
  With four incommensurate delays and a broadband field circulating, the worst
  case that actually occurs is the row sum of the Hadamard matrix (4), not its
  spectral norm (2). At `H/2` the networks sit above unity and grow without
  bound. Longer tails come from longer delays, never from hotter feedback. The
  loop filters are Butterworth for the same reason: a biquad's default `Q` of 1
  peaks about 1.25 dB at cutoff, and two of those inside a feedback loop are
  enough on their own to push it past unity.
- **The master saturator was amplifying everything it touched.** A `tanh`
  curve normalised to reach full scale has a slope of 2.25 at the origin: an
  input of 0.1 came out at 0.22. It applied about 7 dB of gain to the whole
  output and distorted continuously, which is both a lie about an instrument
  that claims to never amplify and a likely source of harshness. It is now
  linear below its knee and bends only above it.
- **A blur across the mask was removed after measurement, not added after
  argument.** Smoothing the gain function across frequency is the textbook fix
  for the fizz that spectral subtraction produces, so it went in — but measured
  against the real code path it slightly *raised* high-band chatter, and at its
  five-tap width an isolated removed bin only fell to 0.6, blunting the one
  operation this instrument exists to perform. What does demonstrably reduce
  the fizz is ROLL-OFF: 61% less high-band flux, 18 dB less high-frequency
  energy.
- **A feedback network decays if and only if its matrix has a spectral radius
  below one, and nothing weaker will do.** The Plexus blends between an
  identity matrix and a Hadamard as PLEXUS removes paths, scales every entry
  that crosses between the two sides by COUPLE, and fades paths in and out —
  and that blend is not orthogonal, so normalising each column's energy does
  not bound it. With SKEW set to inverse the network settled into a plateau
  and rang for ever at a steady level. The matrix is now scaled by its
  measured spectral radius, found by power iteration at control rate, with the
  ratio averaged in the log domain so a complex eigenvalue pair still
  converges. Normalising the columns by their *magnitudes* instead is the
  opposite mistake: it bounds the peak but costs about root-N of the decay,
  and the network dies long before DECAY says it should.
- **A worklet's parameters have to arrive with it, not after it.** In an
  `OfflineAudioContext` a `postMessage` races the render and may never be
  delivered, which made several measurements come back byte-identical and look
  like the controls did nothing. The Plexus takes its settings from
  `processorOptions` at construction as well as by message.
- **The field's band-limited streams use topology-preserving filters**, which
  are stable at any cutoff below Nyquist. A Chamberlin SVF is not: its
  coefficient reaches 1.96 at the top of the sweep the chaos modulation drives
  it through, and the resulting non-finite sample poisons every piece of
  long-lived state downstream — permanently, since the scar field never
  recovers on its own. Both worklets now detect a non-finite value and clear
  their state rather than pass it on.

---

## Tests

With the directory served on port 8099:

```sh
node tests/behaviour.mjs    # does it do what it claims?
node tests/patch.mjs        # the Plexus and the patch bay
node tests/sweep.mjs        # does any mode break it?
```

`behaviour.mjs` asserts that the field sounds, that DENSITY 0 is really silence,
that an absence's scar outlives the absence, that RELEASE closes it, that the
harmonic comb leaves partials standing against the gaps between them, that
ROLL-OFF takes the top off without eating the body, that the pulse steps at the
tempo it is given, that holding still presses an absence deeper, and that no
control in the interface is additive. `sweep.mjs` visits every movement mode, gravity target, spectral
shape and residue kind under load and asserts the output stays finite and
bounded — the failure that matters in a graph like this is not a wrong sound
but a single non-finite sample latching everything into silence.

`patch.mjs` renders the Plexus's impulse response offline and asserts that
PLEXUS takes paths out and decorrelates them, that DECAY spans a short room to
all but infinite while always decaying, that COUPLE interlaces the sides, that
DIFFUSE takes the edge off, and that SEND withholds the feed; then, live, it
patches all sixteen control voltage sources in turn and asserts each one moves
its destination, that the bipolar ones swing both ways, and that pulling the
cords puts the controls back.

They drive real Chromium via Playwright. Point `PLAYWRIGHT` at your install if
it is not resolvable by name:

```sh
PLAYWRIGHT=/path/to/playwright/index.js node tests/behaviour.mjs
```

---

*The infinite source contains everything. The musician creates meaning by
deciding what doesn't get to remain.*
