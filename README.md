# Roundsong

## What good means here

Roundsong is a small room for music teaching and rehearsal across distance: a
teacher or lead voice models a phrase, lyrics scroll past so a learner can
follow the words, and everyone answers back on camera, by consent. "Good"
here is not "feels like being in the same room" — that promise breaks the
moment you test it. The round-trip time between two ordinary home internet
connections is tens to low hundreds of milliseconds, and no amount of client
code removes it. A platform that pretends otherwise either lies about its
latency or falls apart the first time two singers try to harmonise live.

So Roundsong is honest about what it can and can't do, and designs for the
shape that already works over a gap that size: call-and-response, not
simultaneous unison. One person leads a phrase; others answer in turn, or
layer a part on top once they've heard it, the way a singing lesson, a round,
or a rehearsal section already runs. The shared composition space, the
lyrics cursor, and group recordings all follow from that — they support a
conversation with a short delay, not a studio take.

Two smaller, specific choices came out of looking at how existing call
software gets in musicians' way. Zoom ships an explicit "Original Sound for
Musicians" toggle because its default audio pipeline — echo cancellation,
noise suppression, automatic gain — is tuned for one voice talking at a time,
and actively fights two people singing together: it ducks, gates, and
flattens exactly the sound a duet needs. Roundsong builds the same idea in
natively, as a toggle on its own call feature, rather than asking anyone to
route through a separate app. And because this is a learning tool, cameras
and microphones never turn on by assumption — every session asks first,
visibly, and can be turned off without losing your place in the room.

This fits the final project brief's own values: small, single-purpose, for
small groups, not a general-purpose conferencing clone. Roundsong doesn't try
to replace Zoom, Discord, or a DAW — it does one thing (a teacher and a few
students working a piece together over distance) and keeps the rest out of
the way.

## Where this came from

- The course's week 5 crit (`comp4020-crit4`, "Polyphon") built a client-side
  Web Audio lookahead scheduler for a solo generative instrument. Its
  scheduling approach is adapted here for the shared composition space,
  though that project was single-user and local-only, and this one is
  multi-user and server-backed.
- Zoom's documented "Original Sound for Musicians" feature, and musicians'
  long-running complaints about default call audio processing, shaped the
  audio-honesty decision above.
- MDN's WebRTC and Web Audio API documentation on connection setup and the
  browser's audio-processing pipeline informed what's actually controllable
  client-side (`echoCancellation`, `noiseSuppression`, `autoGainControl` as
  constraints on a `MediaStreamTrack`) versus what isn't (the network itself).
