import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the SAME running app instance (spec/global-setup.ts
// finds one shared server, matching this app's own single-process constraint — there's
// never a second instance to spread load across, in CI or in production). Vitest's
// default runs test *files* in parallel worker threads, which means several files'
// worth of signups/rooms/WebSocket traffic all land on that one process at once —
// under a loaded CI runner this delayed WebSocket broadcasts past the
// `nextMessage` helpers' ~1s timeout (spec/lyrics.test.ts, composition.test.ts,
// signaling.test.ts, videos.test.ts), causing a different file to fail each run.
// fileParallelism: false runs spec files one after another against that one
// server instead, removing the self-inflicted contention — this is a small, fast
// suite, so the serialized wall-clock cost is negligible.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    fileParallelism: false,
  },
});
