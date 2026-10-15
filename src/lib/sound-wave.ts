// Used by index.astro to compute the landing page's sound-wave bar strip.
// Build-time only (called from Astro frontmatter) — there's no runtime cost
// to this, and no client JS needed just to draw it.
export interface WaveBar {
  duration: string;
  delay: string;
  peak: number;
}

// Every bar shares one animation duration, and delay is derived from its
// position (not randomized) — a fixed phase offset per bar, increasing
// left to right across one full up-and-back (alternate) cycle. That
// coherent phase gradient is what reads as a single wave sweeping across
// the row, rather than each bar bobbing to its own random clock.
const HALF_CYCLE_SECONDS = 1.2; // one direction of the alternate animation
const FULL_CYCLE_SECONDS = HALF_CYCLE_SECONDS * 2; // up and back

export function generateWaveBars(count: number): WaveBar[] {
  return Array.from({ length: count }, (_, i) => ({
    duration: HALF_CYCLE_SECONDS.toFixed(2),
    // Each bar's delay pre-seeds its phase by an amount that *decreases*
    // left to right — verified by simulation: the opposite assignment
    // (delay decreasing with i) produces a right-to-left sweep instead.
    delay: (-((count - i) / count) * FULL_CYCLE_SECONDS).toFixed(2),
    peak: Math.round(25 + Math.random() * 65),
  }));
}
