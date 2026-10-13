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
const ROOM_PASSWORD = "correct-horse-battery-room";

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
    body: JSON.stringify({ name: "Composition check", password: ROOM_PASSWORD }),
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

// The room gate (server/routes/rooms.ts's join-request, server/ws.ts's
// lobby.admit) means a non-owner can't just open /ws — they have to submit
// the password and be admitted by the live owner first. This drives that
// whole round-trip so the rest of a test can `connect()` normally afterward.
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

interface VoiceLike {
  id: string;
  cells: unknown[];
}

async function addVoiceAndGetId(ws: WebSocket): Promise<string> {
  const seesUpdate = nextMessage(ws, (m) => m.type === "composition.update");
  ws.send(JSON.stringify({ type: "composition.add-voice" }));
  const update = await seesUpdate;
  const voices = update.voices as VoiceLike[];
  return voices[voices.length - 1]!.id;
}

it("broadcasts a composition edit to everyone, and persists it for a late joiner", async () => {
  const ownerCookie = await signUp();
  const roomId = await createRoom(ownerCookie);

  const ownerWs = await connect(roomId, ownerCookie);
  await nextMessage(ownerWs, (m) => m.type === "composition.sync");
  const voiceId = await addVoiceAndGetId(ownerWs);

  const otherCookie = await signUp();
  await joinAsNonOwner(ownerWs, roomId, otherCookie);
  const otherWs = await connect(roomId, otherCookie);
  await nextMessage(otherWs, (m) => m.type === "composition.sync");

  const otherSeesUpdate = nextMessage(otherWs, (m) => m.type === "composition.update");
  ownerWs.send(JSON.stringify({ type: "composition.toggle", voiceId, step: 3, pitch: 5, duration: 2 }));
  const update = await otherSeesUpdate;
  const updatedVoice = (update.voices as VoiceLike[]).find((v) => v.id === voiceId);
  expect(updatedVoice?.cells).toContainEqual([3, 5, 2]);

  // A late joiner sees the persisted state immediately, not an empty staff.
  const lateCookie = await signUp();
  await joinAsNonOwner(ownerWs, roomId, lateCookie);
  const lateWs = await connect(roomId, lateCookie);
  const sync = await nextMessage(lateWs, (m) => m.type === "composition.sync");
  const syncedVoice = (sync.voices as VoiceLike[]).find((v) => v.id === voiceId);
  expect(syncedVoice?.cells).toContainEqual([3, 5, 2]);

  ownerWs.close();
  otherWs.close();
  lateWs.close();
});

it("ignores a toggle with an out-of-range cell", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const ws = await connect(roomId, cookie);
  await nextMessage(ws, (m) => m.type === "composition.sync");
  const voiceId = await addVoiceAndGetId(ws);

  ws.send(JSON.stringify({ type: "composition.toggle", voiceId, step: 999, pitch: 999, duration: 2 }));
  await expect(nextMessage(ws, (m) => m.type === "composition.update", 300)).rejects.toThrow();

  ws.close();
});

it("ignores a toggle with an invalid duration", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const ws = await connect(roomId, cookie);
  await nextMessage(ws, (m) => m.type === "composition.sync");
  const voiceId = await addVoiceAndGetId(ws);

  ws.send(JSON.stringify({ type: "composition.toggle", voiceId, step: 1, pitch: 1, duration: 99 }));
  await expect(nextMessage(ws, (m) => m.type === "composition.update", 300)).rejects.toThrow();

  ws.close();
});

it("ignores a toggle for a voice id that doesn't belong to the room", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const ws = await connect(roomId, cookie);
  await nextMessage(ws, (m) => m.type === "composition.sync");

  ws.send(JSON.stringify({ type: "composition.toggle", voiceId: "not-a-real-voice", step: 1, pitch: 1, duration: 2 }));
  await expect(nextMessage(ws, (m) => m.type === "composition.update", 300)).rejects.toThrow();

  ws.close();
});

it("adds, renames, and removes a voice", async () => {
  const cookie = await signUp();
  const roomId = await createRoom(cookie);
  const ws = await connect(roomId, cookie);
  await nextMessage(ws, (m) => m.type === "composition.sync");

  const voiceId = await addVoiceAndGetId(ws);

  const renamed = nextMessage(ws, (m) => m.type === "composition.update");
  ws.send(JSON.stringify({ type: "composition.rename-voice", voiceId, name: "Melody" }));
  const renamedState = await renamed;
  expect((renamedState.voices as { id: string; name: string }[]).find((v) => v.id === voiceId)?.name).toBe("Melody");

  const removed = nextMessage(ws, (m) => m.type === "composition.update");
  ws.send(JSON.stringify({ type: "composition.remove-voice", voiceId }));
  const removedState = await removed;
  expect((removedState.voices as { id: string }[]).some((v) => v.id === voiceId)).toBe(false);

  ws.close();
});
