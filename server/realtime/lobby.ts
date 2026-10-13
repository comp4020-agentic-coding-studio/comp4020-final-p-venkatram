// Pending "let me in" requests, purely in-process — like presence.ts, this
// is fine because the course's deploy is a single machine, never more than
// one. A pending request only matters while (a) the requester's HTTP
// response is still open waiting for a decision, and (b) a live organizer
// connection might or might not exist right now to make one; a DB row
// couldn't make either of those true by itself, and if the process restarts
// every pending request should simply vanish — exactly how presence already
// behaves on restart.
import { sendToUser } from "./presence.ts";

export interface PendingRequest {
  userId: string;
  displayName: string;
  requestedAt: number;
}

interface InternalEntry extends PendingRequest {
  resolve: (admitted: boolean) => void;
}

const pending = new Map<string, Map<string, InternalEntry>>();

// Resolves once the organizer admits or denies, or after `timeoutMs` elapses
// (default deny — never auto-admit on a timeout). Registering a request also
// pushes it to the organizer's own open room connection, if any — if they're
// not connected right now, the request just queues; there's no auto-admit.
export function addPending(
  roomId: string,
  ownerId: string,
  userId: string,
  displayName: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let room = pending.get(roomId);
    if (!room) {
      room = new Map();
      pending.set(roomId, room);
    }
    const requestedAt = Date.now();
    const timer = setTimeout(() => {
      room?.delete(userId);
      resolve(false);
    }, timeoutMs);
    room.set(userId, {
      userId,
      displayName,
      requestedAt,
      resolve: (admitted) => {
        clearTimeout(timer);
        resolve(admitted);
      },
    });
    sendToUser(roomId, ownerId, { type: "lobby.request", userId, displayName, requestedAt });
  });
}

// A short-lived "you were just admitted" marker, consumed the moment the
// client actually opens its WebSocket (server/ws.ts's upgrade handler) —
// defends against a client that skips the join-request HTTP step and tries
// /ws directly, without reintroducing a second source of truth for "is this
// person in the room" (room_members already answers "have they ever been";
// this only ever answers "were they admitted moments ago").
const admitted = new Map<string, Set<string>>();
// Generous: the client still has a media-consent step (src/lib/media-consent.ts)
// between seeing {admitted: true} and actually opening /ws, and someone
// slow to click through that shouldn't lose their admission.
const ADMITTED_TTL_MS = 5 * 60_000;

function markAdmitted(roomId: string, userId: string): void {
  let set = admitted.get(roomId);
  if (!set) {
    set = new Set();
    admitted.set(roomId, set);
  }
  set.add(userId);
  setTimeout(() => {
    admitted.get(roomId)?.delete(userId);
  }, ADMITTED_TTL_MS);
}

export function consumeAdmitted(roomId: string, userId: string): boolean {
  const set = admitted.get(roomId);
  if (!set?.has(userId)) return false;
  set.delete(userId);
  return true;
}

export function resolvePending(roomId: string, userId: string, wasAdmitted: boolean): boolean {
  const room = pending.get(roomId);
  const entry = room?.get(userId);
  if (!room || !entry) return false;
  room.delete(userId);
  if (room.size === 0) pending.delete(roomId);
  if (wasAdmitted) markAdmitted(roomId, userId);
  entry.resolve(wasAdmitted);
  return true;
}

export function listPending(roomId: string): PendingRequest[] {
  const room = pending.get(roomId);
  if (!room) return [];
  return [...room.values()].map(({ userId, displayName, requestedAt }) => ({ userId, displayName, requestedAt }));
}

export function cancelPending(roomId: string, userId: string): void {
  resolvePending(roomId, userId, false);
}
