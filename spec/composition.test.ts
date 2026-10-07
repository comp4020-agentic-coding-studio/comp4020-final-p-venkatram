import { expect, inject, it } from "vitest";
import { WebSocket } from "ws";

// The shared composition space: a toggle from one person must reach everyone
// else in the room (crit 9's real-time bar again), and a third person joining
// later must see the state as it stands, not an empty grid — the server is
// authoritative (server/compositions.ts), so this is really testing that
// authority is actually shared, not just held by whoever happened to edit.
const baseUrl = inject("baseUrl");
const wsBaseUrl = baseUrl.replace(/^http/, "ws");
const uniqueEmail = () => `comp-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

async function signUp(): Promise<string> {
  const res = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail(), displayName: "Composer", password: "correct-horse-battery" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function createRoom(cookie: string): Promise<string> {
  const res = await fetch(new URL("/api/rooms", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Composition check" }),
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

it("broadcasts a composition edit to everyone, and persists it for a late joiner", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);

  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "composition.sync");

  const otherCookie = await signUp();
  const otherWs = await connect(roomId, otherCookie);
  await nextMessage(otherWs, (m) => m.type === "composition.sync");

  const otherSeesUpdate = nextMessage(otherWs, (m) => m.type === "composition.update");
  ownerWs.send(JSON.stringify({ type: "composition.toggle", step: 3, pitch: 5, duration: 2 }));
  const update = await otherSeesUpdate;
  expect(update.cells).toContainEqual([3, 5, 2]);

  // A late joiner sees the persisted state immediately, not an empty staff.
  const lateCookie = await signUp();
  const lateWs = await connect(roomId, lateCookie);
  const sync = await nextMessage(lateWs, (m) => m.type === "composition.sync");
  expect(sync.cells).toContainEqual([3, 5, 2]);

  ownerWs.close();
  otherWs.close();
  lateWs.close();
});

it("ignores a toggle with an out-of-range cell", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const ws = await connect(roomId, cookie);
  await nextMessage(ws, (m) => m.type === "composition.sync");

  ws.send(JSON.stringify({ type: "composition.toggle", step: 999, pitch: 999, duration: 2 }));
  await expect(nextMessage(ws, (m) => m.type === "composition.update", 300)).rejects.toThrow();

  ws.close();
});

it("ignores a toggle with an invalid duration", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const ws = await connect(roomId, cookie);
  await nextMessage(ws, (m) => m.type === "composition.sync");

  ws.send(JSON.stringify({ type: "composition.toggle", step: 1, pitch: 1, duration: 99 }));
  await expect(nextMessage(ws, (m) => m.type === "composition.update", 300)).rejects.toThrow();

  ws.close();
});
