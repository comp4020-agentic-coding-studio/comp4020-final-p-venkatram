// One WebSocket per room page, multiplexed by `type` — presence here, WebRTC
// signaling (src/lib/webrtc.ts) and shared-state broadcast (composition,
// lyrics) on the same connection. Mirrors server/ws.ts's dispatch.
export interface PresentUser {
  userId: string;
  displayName: string;
}

export interface RoomMessage {
  type: string;
  [field: string]: unknown;
}

export interface RoomEvents {
  onPresenceSync?: (users: PresentUser[]) => void;
  onPresenceJoin?: (user: PresentUser) => void;
  onPresenceLeave?: (userId: string) => void;
  // Anything whose `type` isn't presence.* — signaling and (later) shared
  // state all flow through here rather than each getting their own callback.
  onMessage?: (message: RoomMessage) => void;
  onClose?: () => void;
}

export interface RoomConnection {
  send: (message: RoomMessage) => void;
  close: () => void;
}

export function connectToRoom(roomId: string, events: RoomEvents): RoomConnection {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws?room=${encodeURIComponent(roomId)}`);

  ws.addEventListener("message", (event: MessageEvent<string>) => {
    let message: RoomMessage;
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
        events.onMessage?.(message);
        break;
    }
  });

  ws.addEventListener("close", () => events.onClose?.());

  return {
    send: (message: RoomMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    close: () => ws.close(),
  };
}
