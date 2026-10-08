import { expect, inject, it } from "vitest";
import { WebSocket } from "ws";
import { extractYouTubeId } from "../shared/youtube.ts";

// The id extraction is pure logic — worth checking directly, since it's the
// one thing standing between a pasted URL and what gets embedded.
it("extracts a YouTube video id from the URL shapes people actually paste", () => {
  expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(extractYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(extractYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ"); // a bare id works too
  expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s")).toBe("dQw4w9WgXcQ");
});

it("rejects anything that isn't a recognizable YouTube video", () => {
  expect(extractYouTubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  expect(extractYouTubeId("not a url at all")).toBeNull();
  expect(extractYouTubeId("https://www.youtube.com/")).toBeNull();
  expect(extractYouTubeId("<script>alert(1)</script>")).toBeNull();
});

// The server-side set/sync/broadcast path, over a real WebSocket round-trip —
// same pattern as composition and lyrics.
const baseUrl = inject("baseUrl");
const wsBaseUrl = baseUrl.replace(/^http/, "ws");
const uniqueEmail = () => `video-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

async function signUp(): Promise<string> {
  const res = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail(), displayName: "Video Check", password: "correct-horse-battery" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function createRoom(cookie: string): Promise<string> {
  const res = await fetch(new URL("/api/rooms", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Video check room" }),
  });
  const body = (await res.json()) as { room: { id: string } };
  return body.room.id;
}

function connect(roomId: string, cookie: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws?room=${roomId}`, { headers: { Cookie: cookie } });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket, predicate: (msg: Record<string, unknown>) => boolean, timeoutMs = 1000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      if (predicate(msg)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

it("rejects a POST that isn't a YouTube link", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const res = await fetch(new URL(`/api/rooms/${roomId}/video`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ url: "not a youtube link" }),
  });
  expect(res.status).toBe(400);
});

it("sets a video and broadcasts it to everyone else in the room", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "video.sync");

  const viewerCookie = await signUp();
  const viewerWs = await connect(roomId, viewerCookie);
  await nextMessage(viewerWs, (m) => m.type === "video.sync" && m.youtubeId === null);

  const viewerSeesUpdate = nextMessage(viewerWs, (m) => m.type === "video.update");
  const setRes = await fetch(new URL(`/api/rooms/${roomId}/video`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
  });
  expect(setRes.status).toBe(200);

  const update = await viewerSeesUpdate;
  expect(update.youtubeId).toBe("dQw4w9WgXcQ");

  // A late joiner sees the persisted video immediately, not an empty state.
  const lateCookie = await signUp();
  const lateWs = await connect(roomId, lateCookie);
  const sync = await nextMessage(lateWs, (m) => m.type === "video.sync");
  expect(sync.youtubeId).toBe("dQw4w9WgXcQ");

  ownerWs.close();
  viewerWs.close();
  lateWs.close();
});
