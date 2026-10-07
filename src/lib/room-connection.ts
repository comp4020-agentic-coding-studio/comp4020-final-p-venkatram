// One WebSocket per room page, multiplexed by `type` — presence today,
// WebRTC signaling and shared-state broadcast (composition, lyrics) land on
// this same connection in later commits. Mirrors server/ws.ts's dispatch.
export interface PresentUser {
  userId: string;
  displayName: string;
}

export interface RoomEvents {
  onPresenceSync?: (users: PresentUser[]) => void;
  onPresenceJoin?: (user: PresentUser) => void;
  onPresenceLeave?: (userId: string) => void;
  onClose?: () => void;
}

export interface RoomConnection {
  close: () => void;
}

export function connectToRoom(roomId: string, events: RoomEvents): RoomConnection {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws?room=${encodeURIComponent(roomId)}`);

  ws.addEventListener("message", (event: MessageEvent<string>) => {
    let message: { type?: string; [key: string]: unknown };
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (message.type) {
      case "presence.sync":
        events.onPresenceSync?.((message.users as PresentUser[] | undefined) ?? []);
        break;
      case "presence.join":
        if (message.user) events.onPresenceJoin?.(message.user as PresentUser);
        break;
      case "presence.leave":
        if (typeof message.userId === "string") events.onPresenceLeave?.(message.userId);
        break;
      default:
        break;
    }
  });

  ws.addEventListener("close", () => events.onClose?.());

  return {
    close: () => ws.close(),
  };
}
