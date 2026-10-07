// A lookahead scheduler for the shared grid, adapted from comp4020-crit4's
// audio.ts Instrument class (same LOOKAHEAD_MS / SCHEDULE_AHEAD_SEC shape, the
// classic "Tale of Two Clocks" fix for setInterval-driven audio). That
// version scheduled one shape's vertices for one player; this one schedules
// a shared grid's cells, and plays locally for whoever presses play — the
// grid itself, not the playhead, is what's synced across people (see
// PROCESS.md's crit 9 ADR on why this app doesn't promise synced playback).
import { clampBpm, type Cell, GRID_STEPS, midiToFrequency, pitchIndexToMidi } from "../../shared/grid";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;
const START_DELAY_SEC = 0.05;
const NOTE_RELEASE_SEC = 0.3;

export type StepCallback = (step: number) => void;

export class CompositionPlayer {
  private ctx: AudioContext | null = null;
  private timerId: number | null = null;
  private nextStepTime = 0;
  private currentStep = 0;
  private playing = false;

  constructor(
    private readonly getCells: () => Cell[],
    private readonly getBpm: () => number,
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
    while (this.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      const step = this.currentStep % GRID_STEPS;
      for (const [cellStep, pitch] of this.getCells()) {
        if (cellStep === step) this.playNote(pitchIndexToMidi(pitch), this.nextStepTime);
      }
      this.onStep?.(step);
      this.nextStepTime += stepDuration;
      this.currentStep += 1;
    }
  }

  private playNote(midi: number, time: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const freq = midiToFrequency(midi);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.25, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + NOTE_RELEASE_SEC);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + NOTE_RELEASE_SEC + 0.02);
  }
}
