import { expect, inject, it } from "vitest";
import { WebSocket } from "ws";

// The "up next" list behind the karaoke video (server/video-queue.ts): real
// backpressure worth locking down is that every room member can affect it
// (no owner-only gating, unlike library/lobby), that voting actually
// reorders it, and that an end-of-video report only ever advances the
// queue once — a bug in any of these would be easy to introduce silently.
const baseUrl = inject("baseUrl");
const wsBaseUrl = baseUrl.replace(/^http/, "ws");
const uniqueEmail = () => `queue-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const ROOM_PASSWORD = "correct-horse-battery-room";

async function signUp(): Promise<string> {
  const res = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail(), displayName: "Queue Check", password: "correct-horse-battery" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function createRoom(cookie: string): Promise<string> {
  const res = await fetch(new URL("/api/rooms", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Queue check room", password: ROOM_PASSWORD }),
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

function nextMessage(ws: WebSocket, predicate: (msg: Record<string, unknown>) => boolean, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

async function joinAsNonOwner(ownerWs: WebSocket, roomId: string, cookie: string): Promise<void> {
  const ownerSeesRequest = nextMessage(ownerWs, (m) => m.type === "lobby.request");
  const joinRequest = fetch(new URL(`/api/rooms/${roomId}/join-request`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ password: ROOM_PASSWORD }),
  });
  const request = await ownerSeesRequest;
  ownerWs.send(JSON.stringify({ type: "lobby.admit", userId: request.userId }));
  const res = await joinRequest;
  const body = (await res.json()) as { admitted?: boolean };
  if (!body.admitted) throw new Error("expected to be admitted");
}

it("adds an item to the queue and broadcasts it to every room member", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "queue.sync");

  const update = nextMessage(ownerWs, (m) => m.type === "queue.update");
  const res = await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Test song" }),
  });
  expect(res.status).toBe(201);

  const message = await update;
  const items = message.items as { youtubeId: string; title: string }[];
  expect(items).toHaveLength(1);
  expect(items[0]?.youtubeId).toBe("dQw4w9WgXcQ");
  expect(items[0]?.title).toBe("Test song");

  ownerWs.close();
});

it("rejects a POST that isn't a YouTube link", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const res = await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ url: "not a youtube link" }),
  });
  expect(res.status).toBe(400);
});

it("a late joiner's queue.sync reflects the current queue", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "queue.sync");

  await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "dQw4w9WgXcQ" }),
  });

  const lateCookie = await signUp();
  await joinAsNonOwner(ownerWs, roomId, lateCookie);
  const lateWs = await connect(roomId, lateCookie);
  const sync = await nextMessage(lateWs, (m) => m.type === "queue.sync");
  expect((sync.items as unknown[]).length).toBe(1);

  ownerWs.close();
  lateWs.close();
});

it("voting changes net score and reorders the queue", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);

  const addA = await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "dQw4w9WgXcQ", title: "Song A" }),
  });
  const { item: itemA } = (await addA.json()) as { item: { id: string } };

  await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "jNQXAC9IVRw", title: "Song B" }),
  });

  // Upvote Song A (added first, would otherwise sort after Song B by
  // created_at tiebreak only if scores were equal) so it jumps ahead.
  const voteRes = await fetch(new URL(`/api/queue/${itemA.id}/vote`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ value: 1 }),
  });
  expect(voteRes.status).toBe(200);
  const { items } = (await voteRes.json()) as { items: { title: string; score: number; myVote: number }[] };
  expect(items[0]?.title).toBe("Song A");
  expect(items[0]?.score).toBe(1);
  expect(items[0]?.myVote).toBe(1);

  // Clicking the same direction again toggles the vote off.
  const toggleOffRes = await fetch(new URL(`/api/queue/${itemA.id}/vote`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ value: 1 }),
  });
  const toggled = (await toggleOffRes.json()) as { items: { id: string; score: number; myVote: number }[] };
  const toggledA = toggled.items.find((i) => i.id === itemA.id);
  expect(toggledA?.score).toBe(0);
  expect(toggledA?.myVote).toBe(0);
});

it("any room member — not just the one who added it — can vote and remove an item", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "queue.sync");

  const addRes = await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "dQw4w9WgXcQ" }),
  });
  const { item } = (await addRes.json()) as { item: { id: string } };

  const otherCookie = await signUp();
  await joinAsNonOwner(ownerWs, roomId, otherCookie);
  // Room membership (room_members) is recorded when the WS actually
  // connects (server/ws.ts), not at the password-gate step above — in the
  // real app a client always does this immediately after being admitted,
  // so the test does too, to exercise "a real member" rather than someone
  // who's only passed the gate.
  const otherWs = await connect(roomId, otherCookie);

  const voteRes = await fetch(new URL(`/api/queue/${item.id}/vote`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: otherCookie },
    body: JSON.stringify({ value: 1 }),
  });
  expect(voteRes.status).toBe(200);

  const removeRes = await fetch(new URL(`/api/queue/${item.id}`, baseUrl), {
    method: "DELETE",
    headers: { Cookie: otherCookie },
  });
  expect(removeRes.status).toBe(200);

  ownerWs.close();
  otherWs.close();
});

it("rejects a vote from someone who isn't a member of that room", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const addRes = await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "dQw4w9WgXcQ" }),
  });
  const { item } = (await addRes.json()) as { item: { id: string } };

  const strangerCookie = await signUp(); // never joins this room
  const res = await fetch(new URL(`/api/queue/${item.id}/vote`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: strangerCookie },
    body: JSON.stringify({ value: 1 }),
  });
  expect(res.status).toBe(403);
});

it("video.ended pops the next queued item into 'now playing' and broadcasts both updates", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "queue.sync");

  const added = nextMessage(ownerWs, (m) => m.type === "queue.update");
  await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "dQw4w9WgXcQ", title: "Next song" }),
  });
  await added;

  const nowPlaying = nextMessage(ownerWs, (m) => m.type === "video.update");
  await fetch(new URL(`/api/rooms/${roomId}/video`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "xvFZjo5PgG0" }),
  });
  await nowPlaying;

  const videoUpdate = nextMessage(ownerWs, (m) => m.type === "video.update");
  const queueUpdate = nextMessage(ownerWs, (m) => m.type === "queue.update");
  ownerWs.send(JSON.stringify({ type: "video.ended", youtubeId: "xvFZjo5PgG0" }));

  const video = await videoUpdate;
  expect(video.youtubeId).toBe("dQw4w9WgXcQ");
  const queue = await queueUpdate;
  expect(queue.items).toHaveLength(0);

  ownerWs.close();
});

it("a second video.ended report for the same video is a no-op (idempotent advance)", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "queue.sync");

  const addedA = nextMessage(ownerWs, (m) => m.type === "queue.update");
  await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "dQw4w9WgXcQ", title: "Song A" }),
  });
  await addedA;

  const addedB = nextMessage(ownerWs, (m) => m.type === "queue.update");
  await fetch(new URL(`/api/rooms/${roomId}/queue`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "jNQXAC9IVRw", title: "Song B" }),
  });
  await addedB;

  const nowPlaying = nextMessage(ownerWs, (m) => m.type === "video.update");
  await fetch(new URL(`/api/rooms/${roomId}/video`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "xvFZjo5PgG0" }),
  });
  await nowPlaying;

  const firstAdvance = nextMessage(ownerWs, (m) => m.type === "video.update");
  ownerWs.send(JSON.stringify({ type: "video.ended", youtubeId: "xvFZjo5PgG0" }));
  ownerWs.send(JSON.stringify({ type: "video.ended", youtubeId: "xvFZjo5PgG0" })); // duplicate report
  const advanced = await firstAdvance;
  expect(advanced.youtubeId).toBe("dQw4w9WgXcQ"); // Song A, not skipped past to Song B

  // Give the (incorrect, hopefully absent) second advance a moment to fire
  // before confirming the state settled on Song A, not Song B.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const res = await fetch(new URL(`/api/rooms/${roomId}/video`, baseUrl), {
    headers: { Cookie: ownerCookie },
  });
  const state = (await res.json()) as { youtubeId: string | null };
  expect(state.youtubeId).toBe("dQw4w9WgXcQ");

  ownerWs.close();
});

it("video.ended with an empty queue clears the video instead of leaving the stale id", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "queue.sync");

  const nowPlaying = nextMessage(ownerWs, (m) => m.type === "video.update");
  await fetch(new URL(`/api/rooms/${roomId}/video`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ url: "xvFZjo5PgG0" }),
  });
  await nowPlaying;

  const cleared = nextMessage(ownerWs, (m) => m.type === "video.update");
  ownerWs.send(JSON.stringify({ type: "video.ended", youtubeId: "xvFZjo5PgG0" }));
  const video = await cleared;
  expect(video.youtubeId).toBeNull();

  ownerWs.close();
});
