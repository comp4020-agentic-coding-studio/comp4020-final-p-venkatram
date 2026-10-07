import { expect, inject, it } from "vitest";
import { WebSocket } from "ws";

// Upload, parsing (real LRC timestamps vs. the plain-text fallback), and the
// leader-driven transport broadcast are all mechanically checkable. Whether
// the cursor actually looks right following along a real song is a person's
// call at the crit.
const baseUrl = inject("baseUrl");
const wsBaseUrl = baseUrl.replace(/^http/, "ws");
const uniqueEmail = () => `lyrics-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

async function signUp(): Promise<string> {
  const res = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail(), displayName: "Lyricist", password: "correct-horse-battery" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function createRoom(cookie: string): Promise<string> {
  const res = await fetch(new URL("/api/rooms", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Lyrics check" }),
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

it("parses real LRC timestamps on upload", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const res = await fetch(new URL(`/api/rooms/${roomId}/lyrics`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: "Round", raw: "[00:00.00]Row row row your boat\n[00:04.50]Gently down the stream" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { lyrics: { title: string; lines: { time: number; text: string }[] } };
  expect(body.lyrics.title).toBe("Round");
  expect(body.lyrics.lines).toEqual([
    { time: 0, text: "Row row row your boat" },
    { time: 4500, text: "Gently down the stream" },
  ]);
});

it("falls back to evenly-spaced lines for plain text with no timestamps", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const res = await fetch(new URL(`/api/rooms/${roomId}/lyrics`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: "Plain", raw: "Line one\nLine two\nLine three" }),
  });
  const body = (await res.json()) as { lyrics: { lines: { time: number; text: string }[] } };
  expect(body.lyrics.lines.map((l) => l.text)).toEqual(["Line one", "Line two", "Line three"]);
  expect(body.lyrics.lines[0]?.time).toBe(0);
  expect(body.lyrics.lines[1]!.time).toBeGreaterThan(body.lyrics.lines[0]!.time);
});

it("broadcasts lyrics.update to everyone when one person uploads", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "lyrics.sync");

  const viewerCookie = await signUp();
  const viewerWs = await connect(roomId, viewerCookie);
  await nextMessage(viewerWs, (m) => m.type === "lyrics.sync");

  const viewerSeesUpdate = nextMessage(viewerWs, (m) => m.type === "lyrics.update");
  await fetch(new URL(`/api/rooms/${roomId}/lyrics`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ title: "Shared", raw: "[00:01.00]Hello" }),
  });
  const update = await viewerSeesUpdate;
  expect(update.title).toBe("Shared");

  ownerWs.close();
  viewerWs.close();
});

it("drives the lyrics transport for everyone when one person presses play", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);
  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "lyrics.sync");

  const viewerCookie = await signUp();
  const viewerWs = await connect(roomId, viewerCookie);
  await nextMessage(viewerWs, (m) => m.type === "lyrics.sync");

  const viewerSeesPlay = nextMessage(viewerWs, (m) => m.type === "lyrics.transport" && m.playing === true);
  ownerWs.send(JSON.stringify({ type: "lyrics.play" }));
  const transport = await viewerSeesPlay;
  expect(transport.playing).toBe(true);
  expect(typeof transport.positionMs).toBe("number");

  ownerWs.close();
  viewerWs.close();
});
