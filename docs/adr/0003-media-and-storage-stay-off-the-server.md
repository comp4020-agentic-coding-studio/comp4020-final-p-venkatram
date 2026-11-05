# ADR 0003: Camera/mic media and recordings never touch the server

**Context.** The 256MB machine has no spare capacity to receive, store, or
transcode audio/video, and the product needs real-time camera/mic
collaboration and recording.

**Decision.** WebRTC peer connections are mesh, client-to-client
(`src/lib/webrtc.ts`); the server only ever relays signaling (SDP/ICE)
through the existing WebSocket connection
(`server/realtime/presence.ts`'s `sendToUser`), never media itself.
Recording follows the same rule: `src/lib/recorder.ts`'s `StreamRecorder`
wraps `MediaRecorder` entirely client-side, mixing peer audio locally for a
group recording, and both recording types end in a local download. A
library item that needs to be shared (a recording, an uploaded score) is
either a small text/PDF blob in SQLite (`server/library.ts`) or a file under
`/data` for anything larger (uploaded MusicXML scores) — never a media blob
server-side; a recording's library row is metadata plus an `external_url`
the organizer pastes in after uploading to their own Drive/OneDrive.

**Alternative considered.** A server-mixed or server-recorded room (easier
client code, one canonical recording) — rejected outright given the RAM
budget, and not needed: the product's honesty argument (`README.md`) is
already that this isn't a studio-take tool.

**Consequence.** No cross-device "resume my recording later" and no
server-side transcoding or format normalisation — acceptable for a personal
or small-group rehearsal artifact, not acceptable had this been a published
masters.

**Related:** consent is required before any `getUserMedia` call, every time
a room is entered, never remembered across visits (`CLAUDE.md`,
`src/lib/media-consent.ts`) — a product rule, not a style choice, which
outlasted a mid-project restructuring of when in the page's lifecycle that
consent step runs (consent no longer blocks the room connecting or the
lobby admission queue; it only blocks acquiring tracks).
