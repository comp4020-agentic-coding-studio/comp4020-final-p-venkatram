// A lookahead scheduler for the shared grid, adapted from comp4020-crit4's
// audio.ts Instrument class (same LOOKAHEAD_MS / SCHEDULE_AHEAD_SEC shape, the
// classic "Tale of Two Clocks" fix for setInterval-driven audio). That
// version scheduled one shape's vertices for one player; this one schedules
// a shared grid's cells, and plays locally for whoever presses play — the
// grid itself, not the playhead, is what's synced across people (see
// PROCESS.md's crit 9 ADR on why this app doesn't promise synced playback).
import {
  clampBpm,
  type Cell,
  DURATION_RELEASE_MULTIPLIERS,
  DURATION_STEPS,
  midiToFrequency,
  pitchIndexToMidi,
} from "../../shared/grid";
import { DEFAULT_INSTRUMENT, type InstrumentId } from "../../shared/composition";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;
const START_DELAY_SEC = 0.05;
const BASE_RELEASE_SEC = 0.3; // a quarter note's release tail; other durations scale from here
const ATTACK_SEC = 0.01;
const PEAK_GAIN = 0.25;

// One oscillator+gain voice, with a proper Attack-Hold-Release envelope: the
// gain ramps up over ATTACK_SEC, then holds at PEAK_GAIN for the note's
// actual sustain (its on-grid duration, tempo-dependent), and only then
// releases over `releaseSec` — the "release" was previously the entire
// audible note (no hold stage at all), so a note decayed to silence almost
// immediately regardless of how long it was drawn to last. Exported so the
// virtual piano (a standalone practice instrument, not grid-driven) can
// reuse the same envelope shape instead of a second, divergent audio path.
export function scheduleOscillatorNote(
  ctx: AudioContext,
  freq: number,
  instrument: InstrumentId,
  onTime: number,
  sustainSec: number,
  releaseSec: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = instrument ?? DEFAULT_INSTRUMENT;
  osc.frequency.setValueAtTime(freq, onTime);

  const attackEnd = onTime + ATTACK_SEC;
  const releaseStart = Math.max(attackEnd, onTime + sustainSec);

  gain.gain.setValueAtTime(0, onTime);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, attackEnd);
  gain.gain.setValueAtTime(PEAK_GAIN, releaseStart); // holds here until the release ramp below
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseStart + releaseSec); // can't target 0 directly

  osc.connect(gain).connect(ctx.destination);
  osc.start(onTime);
  osc.stop(releaseStart + releaseSec + 0.02);
}

// Same Attack-Hold envelope as scheduleOscillatorNote, but for a note whose
// length isn't known up front — a key held on the virtual piano, played for
// as long as the player keeps it down rather than a fixed grid duration.
// Returns a release() callback that starts the same release ramp
// scheduleOscillatorNote uses, called on key-up.
export function startHeldNote(ctx: AudioContext, freq: number, instrument: InstrumentId): { release: () => void } {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = instrument ?? DEFAULT_INSTRUMENT;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);

  const attackEnd = ctx.currentTime + ATTACK_SEC;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, attackEnd);

  osc.connect(gain).connect(ctx.destination);
  osc.start();

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      const releaseStart = Math.max(ctx.currentTime, attackEnd);
      gain.gain.cancelScheduledValues(releaseStart);
      gain.gain.setValueAtTime(gain.gain.value, releaseStart);
      gain.gain.exponentialRampToValueAtTime(0.0001, releaseStart + BASE_RELEASE_SEC);
      osc.stop(releaseStart + BASE_RELEASE_SEC + 0.02);
    },
  };
}

export type StepCallback = (step: number) => void;

// One voice's cells plus which oscillator waveform plays them — a voice's
// instrument choice (shared/composition.ts's INSTRUMENTS) only ever affects
// its own notes, never anyone else's in the same room.
export interface PlayableVoice {
  cells: Cell[];
  instrument: InstrumentId;
}

export class CompositionPlayer {
  private ctx: AudioContext | null = null;
  private timerId: number | null = null;
  private nextStepTime = 0;
  private currentStep = 0;
  private playing = false;

  constructor(
    private readonly getVoices: () => PlayableVoice[],
    private readonly getBpm: () => number,
    // The loop length in steps — the longest voice's bar count × 16, not a
    // fixed GRID_STEPS, now that a voice can span more than one bar. A voice
    // with fewer bars just has nothing to play once the step passes its own
    // length; the loop as a whole still runs to whoever has the most.
    private readonly getLoopLength: () => number,
    private readonly onStep?: StepCallback,
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.start();
  }

  start(): void {
    if (this.playing) return;
    if (!this.ctx) this.ctx = new AudioContext();
    void this.ctx.resume();
    this.playing = true;
    this.currentStep = 0;
    this.nextStepTime = this.ctx.currentTime + START_DELAY_SEC;
    this.timerId = window.setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    this.playing = false;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const stepDuration = 60 / clampBpm(this.getBpm()) / 4; // 16th notes
    const loopLength = Math.max(1, this.getLoopLength());
    while (this.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      const step = this.currentStep % loopLength;
      for (const voice of this.getVoices()) {
        for (const [cellStep, pitch, duration] of voice.cells) {
          if (cellStep === step) {
            this.playNote(pitchIndexToMidi(pitch), this.nextStepTime, duration, voice.instrument, stepDuration);
          }
        }
      }
      this.onStep?.(step);
      this.nextStepTime += stepDuration;
      this.currentStep += 1;
    }
  }

  private playNote(midi: number, time: number, duration: Cell[2], instrument: InstrumentId, stepDuration: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const release = BASE_RELEASE_SEC * (DURATION_RELEASE_MULTIPLIERS[duration] ?? 1);
    const sustain = (DURATION_STEPS[duration] ?? 4) * stepDuration;
    scheduleOscillatorNote(ctx, midiToFrequency(midi), instrument ?? DEFAULT_INSTRUMENT, time, sustain, release);
  }
}
