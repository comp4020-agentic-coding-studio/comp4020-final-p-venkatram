// A small mesh: every peer connects directly to every other peer in the
// room, media never touching the server (server/ws.ts only relays SDP/ICE).
// Deliberately capped to small pods by not being anything fancier (no SFU) —
// consistent with the course's small-group framing and what a 256MB
// signaling server can respectfully fan out.
import type { RoomMessage } from "./room-connection";

// Only `send` is needed here, not the full RoomConnection — lets callers
// construct a RoomMedia before the real connection exists yet (room-page.ts
// wires them up in a cycle: the connection's handlers call into RoomMedia,
// and RoomMedia sends back out over the connection).
export interface SignalSender {
  send: (message: RoomMessage) => void;
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export interface PeerStream {
  userId: string;
  displayName: string;
  stream: MediaStream;
}

export interface RoomMediaEvents {
  onPeerStream?: (peer: PeerStream) => void;
  onPeerLeft?: (userId: string) => void;
}

export class RoomMedia {
  private peers = new Map<string, RTCPeerConnection>();
  private displayNames = new Map<string, string>();
  private localStream: MediaStream | null = null;

  constructor(
    private readonly conn: SignalSender,
    private readonly events: RoomMediaEvents,
  ) {}

  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
  }

  // Called once, when presence.sync tells me who's already in the room: I'm
  // the newcomer, so I initiate. Existing members wait for my offer instead —
  // the one-sided rule that avoids both sides racing to initiate at once.
  async connectToExisting(users: { userId: string; displayName: string }[]): Promise<void> {
    for (const user of users) {
      this.displayNames.set(user.userId, user.displayName);
      await this.initiateOffer(user.userId);
    }
  }

  noteDisplayName(userId: string, displayName: string): void {
    this.displayNames.set(userId, displayName);
  }

  async handleSignal(message: RoomMessage): Promise<void> {
    const from = typeof message.from === "string" ? message.from : undefined;
    if (!from) return;

    if (message.type === "webrtc.offer") {
      const pc = this.getOrCreatePeer(from);
      await pc.setRemoteDescription(new RTCSessionDescription(message.sdp as RTCSessionDescriptionInit));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.conn.send({ type: "webrtc.answer", to: from, sdp: answer });
    } else if (message.type === "webrtc.answer") {
      const pc = this.peers.get(from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(message.sdp as RTCSessionDescriptionInit));
    } else if (message.type === "webrtc.ice" && message.candidate) {
      const pc = this.peers.get(from);
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(message.candidate as RTCIceCandidateInit));
    }
  }

  removePeer(userId: string): void {
    const pc = this.peers.get(userId);
    if (pc) {
      pc.close();
      this.peers.delete(userId);
    }
    this.events.onPeerLeft?.(userId);
  }

  // The "Original Sound" toggle: re-applies constraints on the live mic
  // track rather than re-acquiring it, so it needs no renegotiation — the
  // same track stays attached to every peer connection throughout.
  async setOriginalSound(enabled: boolean): Promise<void> {
    const audioTrack = this.localStream?.getAudioTracks()[0];
    if (!audioTrack) return;
    await audioTrack.applyConstraints({
      echoCancellation: !enabled,
      noiseSuppression: !enabled,
      autoGainControl: !enabled,
    });
  }

  closeAll(): void {
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
  }

  private getOrCreatePeer(userId: string): RTCPeerConnection {
    const existing = this.peers.get(userId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // Always negotiate both m-lines, even with nothing local to send — a
    // viewer who declined camera/mic consent can still watch and listen.
    for (const kind of ["audio", "video"] as const) {
      const track = this.localStream?.getTracks().find((t) => t.kind === kind);
      if (track && this.localStream) pc.addTrack(track, this.localStream);
      else pc.addTransceiver(kind, { direction: "recvonly" });
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) this.conn.send({ type: "webrtc.ice", to: userId, candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      this.events.onPeerStream?.({ userId, displayName: this.displayNames.get(userId) ?? "Someone", stream });
    };
    this.peers.set(userId, pc);
    return pc;
  }

  private async initiateOffer(userId: string): Promise<void> {
    const pc = this.getOrCreatePeer(userId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.conn.send({ type: "webrtc.offer", to: userId, sdp: offer });
  }
}
