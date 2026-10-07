import { expect, inject, it } from "vitest";

// crit 10 asks for server-side activity logging with a live view. This checks
// the mechanical half — the endpoints exist and answer — not whether the log
// actually tells a useful story under load, which is a crit judgement call.
const baseUrl = inject("baseUrl");

it("answers /api/activity/recent with a list of events", async () => {
  const res = await fetch(new URL("/api/activity/recent", baseUrl));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { events: unknown[] };
  expect(Array.isArray(body.events)).toBe(true);
  // The server logs its own boot, so a freshly-started app always has at
  // least one event to show.
  expect(body.events.length).toBeGreaterThan(0);
});

it("serves /api/activity/stream as an event stream", async () => {
  const controller = new AbortController();
  const res = await fetch(new URL("/api/activity/stream", baseUrl), { signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  controller.abort();
});
