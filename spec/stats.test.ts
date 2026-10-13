import { expect, inject, it } from "vitest";

// The landing page's stats strip shows real aggregate counts, not fabricated
// placeholders — this checks the endpoint answers with actual numbers and
// that creating a room is reflected in them, without needing a session
// (it's meant to be public).
const baseUrl = inject("baseUrl");
const uniqueEmail = () => `stats-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

it("answers /api/stats with numeric counts, no session required", async () => {
  const res = await fetch(new URL("/api/stats", baseUrl));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rooms: number; notesComposed: number; lyricsSheets: number };
  expect(typeof body.rooms).toBe("number");
  expect(typeof body.notesComposed).toBe("number");
  expect(typeof body.lyricsSheets).toBe("number");
});

it("reflects a newly created room in the room count", async () => {
  // Other spec files create rooms concurrently against this same database,
  // so this can only assert the count moved, not by exactly how much.
  const before = (await (await fetch(new URL("/api/stats", baseUrl))).json()) as { rooms: number };

  const signupRes = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail(), displayName: "Stats Check", password: "correct-horse-battery" }),
  });
  const cookie = (signupRes.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  await fetch(new URL("/api/rooms", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Stats check room", password: "correct-horse-battery-room" }),
  });

  const after = (await (await fetch(new URL("/api/stats", baseUrl))).json()) as { rooms: number };
  expect(after.rooms).toBeGreaterThan(before.rooms);
});
