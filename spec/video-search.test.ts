import { expect, inject, it } from "vitest";

// Only the parts that don't require a real YouTube Data API call: request
// validation, auth, and the "not configured" path. No live network call
// here — the test server never has YOUTUBE_API_KEY set, there's no mocking
// infrastructure in this repo, and hitting the real API in CI would be
// flaky and burn quota for no benefit. The happy path (an actual search
// returning real results) is verified manually.
const baseUrl = inject("baseUrl");
const uniqueEmail = () => `search-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

async function signUp(): Promise<string> {
  const res = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail(), displayName: "Search Check", password: "correct-horse-battery" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

it("rejects an unauthenticated search", async () => {
  const res = await fetch(new URL("/api/youtube-search?q=test", baseUrl));
  expect(res.status).toBe(401);
});

it("rejects an empty query", async () => {
  const cookie = await signUp();
  const res = await fetch(new URL("/api/youtube-search?q=", baseUrl), { headers: { Cookie: cookie } });
  expect(res.status).toBe(400);
});

it("reports 503 when the server has no YouTube API key configured", async () => {
  const cookie = await signUp();
  const res = await fetch(new URL("/api/youtube-search?q=test+song", baseUrl), { headers: { Cookie: cookie } });
  expect(res.status).toBe(503);
});
