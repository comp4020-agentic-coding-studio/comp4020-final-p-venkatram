import { expect, inject, it } from "vitest";
import { WebSocket } from "ws";

// WebRTC itself (real cameras, real peer connections) isn't something a
// headless check can verify — that's for a person at the crit. What's
// mechanically checkable is the server's half: it relays an SDP/ICE message
// to the right specific peer in the room, tagged with who it came from,
// without touching anyone else in the room.
const baseUrl = inject("baseUrl");
const wsBaseUrl = baseUrl.replace(/^http/, "ws");
const uniqueEmail = () => `signal-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const ROOM_PASSWORD = "correct-horse-battery-room";

interface SignedUpUser {
  id: string;
  cookie: string;
}

async function signUp(displayName: string): Promise<SignedUpUser> {
  const res = await fetch(new URL("/api/signup", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail(), displayName, password: "correct-horse-battery" }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const body = (await res.json()) as { user: { id: string } };
  return { id: body.user.id, cookie };
}

async function createRoom(owner: SignedUpUser): Promise<string> {
  const res = await fetch(new URL("/api/rooms", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ name: "Signaling check", password: ROOM_PASSWORD }),
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

// The room gate means a non-owner can't just open /ws — they must submit the
// password and be admitted by the live owner first.
async function joinAsNonOwner(ownerWs: WebSocket, roomId: string, user: SignedUpUser): Promise<void> {
  const ownerSeesRequest = nextMessage(ownerWs, (m) => m.type === "lobby.request");
  const joinRequest = fetch(new URL(`/api/rooms/${roomId}/join-request`, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: user.cookie },
    body: JSON.stringify({ password: ROOM_PASSWORD }),
  });
  const request = await ownerSeesRequest;
  ownerWs.send(JSON.stringify({ type: "lobby.admit", userId: request.userId }));
  const res = await joinRequest;
  const body = (await res.json()) as { admitted?: boolean };
  if (!body.admitted) throw new Error("expected to be admitted");
}

it("relays a webrtc offer to the right peer, tagged with the sender", async () => {
  const alice = await signUp("Alice Signal");
  const bob = await signUp("Bob Signal");
  const carol = await signUp("Carol Signal"); // in the room too, must NOT receive Alice's message to Bob
  const roomId = await createRoom(alice);

  const aliceWs = await connect(roomId, alice.cookie);
  await nextMessage(aliceWs, (m) => m.type === "presence.sync");
  await joinAsNonOwner(aliceWs, roomId, bob);
  const bobWs = await connect(roomId, bob.cookie);
  await nextMessage(bobWs, (m) => m.type === "presence.sync");
  await joinAsNonOwner(aliceWs, roomId, carol);
  const carolWs = await connect(roomId, carol.cookie);
  await nextMessage(carolWs, (m) => m.type === "presence.sync");

  const carolNeverGetsIt = nextMessage(carolWs, (m) => m.type === "webrtc.offer", 300).then(
    () => {
      throw new Error("carol should never have received alice's offer to bob");
    },
    () => "correctly timed out",
  );

  const bobReceives = nextMessage(bobWs, (m) => m.type === "webrtc.offer");
  aliceWs.send(JSON.stringify({ type: "webrtc.offer", to: bob.id, sdp: { type: "offer", sdp: "v=0..." } }));

  const received = await bobReceives;
  expect(received.from).toBe(alice.id);
  expect((received.sdp as { type: string }).type).toBe("offer");
  await expect(carolNeverGetsIt).resolves.toBe("correctly timed out");

  aliceWs.close();
  bobWs.close();
  carolWs.close();
});
