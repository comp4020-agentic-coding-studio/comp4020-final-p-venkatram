// A room's lyrics "transport" (play/pause/seek position) is leader-driven
// and ephemeral, like presence — whoever presses play becomes the leader for
// that moment, everyone else's cursor follows. Not persisted: a quiet room
// restarting (Fly's auto_stop_machines) just means playback resets to
// paused at 0, which is the right default for a room nobody's in anyway.
//
// Clients never trust wall-clock time against the server's — they anchor to
// their own monotonic clock (performance.now()) the moment they receive a
// transport update, and derive position from elapsed time since then. The
// server's only job is to say "right now, playback is at position X,
// playing or not" — see src/lib/lyrics.ts for the client half.
export interface TransportState {
  playing: boolean;
  positionMs: number;
}

interface InternalState {
  playing: boolean;
  positionMs: number; // position at lastChangedAt
  lastChangedAt: number; // server Date.now() when this state took effect
}

const rooms = new Map<string, InternalState>();

function currentPosition(state: InternalState): number {
  if (!state.playing) return state.positionMs;
  return state.positionMs + (Date.now() - state.lastChangedAt);
}

export function getTransport(roomId: string): TransportState {
  const state = rooms.get(roomId);
  if (!state) return { playing: false, positionMs: 0 };
  return { playing: state.playing, positionMs: currentPosition(state) };
}

export function play(roomId: string): TransportState {
  const state = rooms.get(roomId);
  const positionMs = state ? currentPosition(state) : 0;
  rooms.set(roomId, { playing: true, positionMs, lastChangedAt: Date.now() });
  return { playing: true, positionMs };
}

export function pause(roomId: string): TransportState {
  const state = rooms.get(roomId);
  const positionMs = state ? currentPosition(state) : 0;
  rooms.set(roomId, { playing: false, positionMs, lastChangedAt: Date.now() });
  return { playing: false, positionMs };
}

export function seek(roomId: string, positionMs: number): TransportState {
  const state = rooms.get(roomId);
  const playing = state?.playing ?? false;
  const clamped = Math.max(0, Math.round(positionMs));
  rooms.set(roomId, { playing, positionMs: clamped, lastChangedAt: Date.now() });
  return { playing, positionMs: clamped };
}
