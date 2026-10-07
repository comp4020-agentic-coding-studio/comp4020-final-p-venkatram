import { expect, inject, it } from "vitest";
import { WebSocket } from "ws";

// Crit 9's claim, mechanically: "a change one person makes appears in every
// other open session within about a second, with no reload." This drives two
// independent WebSocket clients, as two different signed-up users, into the
// same room and checks presence actually propagates that fast — not just
// that the endpoints exist.
const baseUrl = inject("baseUrl");
const wsBaseUrl = baseUrl.replace(/^http/, "ws");
const uniqueEmail = () => `realtime-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

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

async function createRoom(owner: SignedUpUser, name: string): Promise<string> {
  const res = await fetch(new URL("/api/rooms", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { room: { id: string } };
  return body.room.id;
}

function waitForMessage(ws: WebSocket, predicate: (msg: Record<string, unknown>) => boolean, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms waiting for message`)), timeoutMs);
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      if (predicate(msg)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

function connect(roomId: string, cookie: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws?room=${roomId}`, { headers: { Cookie: cookie } });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

it("propagates presence between two real sessions within ~1s", async () => {
  const alice = await signUp("Alice");
  const bob = await signUp("Bob");
  const roomId = await createRoom(alice, "Realtime check");

  const aliceWs = await connect(roomId, alice.cookie);
  await waitForMessage(aliceWs, (msg) => msg.type === "presence.sync", 1000);

  const bobJoined = waitForMessage(
    aliceWs,
    (msg) => msg.type === "presence.join" && (msg.user as { userId?: string } | undefined)?.userId === bob.id,
    1000, // the crit 9 bar: "within about a second"
  );
  const bobWs = await connect(roomId, bob.cookie);
  const joinMessage = await bobJoined;
  expect(joinMessage.type).toBe("presence.join");

  const aliceLeft = waitForMessage(
    bobWs,
    (msg) => msg.type === "presence.leave" && msg.userId === alice.id,
    1000,
  );
  aliceWs.close();
  await aliceLeft;

  bobWs.close();
});

it("rejects a WebSocket upgrade with no session", async () => {
  const unauthedRoom = "doesnotexist";
  await expect(
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsBaseUrl}/ws?room=${unauthedRoom}`);
      ws.once("open", () => reject(new Error("should not have connected without a session")));
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode));
      ws.once("error", () => resolve(undefined)); // some environments surface this as a socket error instead
    }),
  ).resolves.not.toBe(101);
});
