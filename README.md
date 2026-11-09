# WaveForge

## What good means here

Most real-time collaboration tools treat latency as a bug to hide: predictive
typing, optimistic UI, client-side smoothing over the gap between what you do
and what everyone else sees a moment later. The round-trip between two
ordinary home internet connections is tens to low hundreds of milliseconds,
no client code removes that, and for anything that needs to feel
simultaneous, the gap always wins eventually, the first time two singers
try to actually harmonise live over it.

WaveForge's answer isn't to hide the gap better, it's to build around an
activity the gap doesn't break: call-and-response, not unison. A teacher or
lead voice models a phrase, lyrics scroll past so a learner can follow, and
everyone answers back on camera, in turn or layered once they've heard it,
the way a singing lesson, a round, or a rehearsal section already runs
face-to-face. That's the one idea every shared feature here follows from, not
a workaround bolted on after the fact: the composition space, the lyrics
cursor, and group recordings all exist to support a conversation with a short
delay, not a studio take, and every one of them is pointless alone. The room
is more interesting with other people in it because they're who you're
responding to, not just who's watching.

That idea is enforced where it can be, not just claimed. [CLAUDE.md](CLAUDE.md)'s
audio-honesty rule bans exactly the processing, echo cancellation, noise
suppression, auto-gain, that every mainstream call tool applies by default
and that actively fights two people singing together; Zoom ships its own
"Original Sound for Musicians" toggle for this same reason, "Original Sound"
here is the equivalent, on by choice, never assumed. Consent before any
camera or microphone access is a second rule enforced the same way, checked
fresh every time a room is entered, never remembered from last time. What
stays a judgment call rather than a check: the specific shape of
call-and-response, a leader-driven lyrics cursor rather than, say,
leader-driven audio mixing, is a product decision `spec/` can't verify,
defended here instead of hidden behind a passing test.

This is also why the brief's own smallness fits without feeling shrunk to
size: an app for a teacher and a few students working one piece together is
the whole target, not a limited version of something bigger, and a feature
that doesn't serve call-and-response, real-time singing detection to drive
the lyrics cursor automatically, for instance, was declined for exactly that
reason, not because it was hard to build.

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
