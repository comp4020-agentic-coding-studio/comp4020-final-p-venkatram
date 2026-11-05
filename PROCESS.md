# Process

## From brief to harness

Collaborating on music via traditional video conferencing tools like Zoom is
often difficult, whether it's writing lyrics, figuring out notes, or
coordinating parts for a choir spread across different countries. Given the
brief's few fixed constraints, I set my own: a genuinely multi-user,
full-stack application — dynamic, not just a static interface, with a
database and APIs that sync state across users, keep the database and UI in
sync, and connect in third-party services like YouTube's player — built on
real sound/music computing APIs (carried over from week 4's spec) as a
single monolith on one machine rather than a microservice architecture.
Once that basic idea was fixed, I built by putting myself in a music
educator's position and asking what I wished the tool could do next —
empathy made it easy to keep finding the next feature worth adding.

The full case for the stack is [ADR 0001](docs/adr/0001-static-astro-single-node-process.md):
one Astro static build plus one hand-written Node process on
`fly.toml`'s single machine, `node:sqlite` at `/data/app.db`. How that
monolith behaves with several people in a room at once —
what counts as "present," and who has the authoritative copy of shared
state — is [ADR 0002](docs/adr/0002-presence-vs-membership-and-server-authority.md).
Why camera, mic, and recordings never touch the server is
[ADR 0003](docs/adr/0003-media-and-storage-stay-off-the-server.md).

## What friend testing actually found

I got friends to test the app with me rather than guessing at what was
broken myself, and the clearest case is the one worth citing: during our
call, the video display was highly inconsistent and unpredictable across
different participants and devices. I could only see myself, one friend saw
only a frozen image of herself for a period, two others on phones could
briefly see each other but not me, and another participant was later
captured live without any issues. I asked the agent to investigate by
reading the relevant code, and it traced the cause to a race condition: a
peer connection was being created as soon as presence reported someone
else in the room, before my own camera/mic permission had resolved — and
if both sides tried to add their track afterward at the same moment, the
two attempts could collide ("WebRTC glare"), leaving one or both sides
stuck half-connected. That matched exactly what I'd seen in testing,
including why phones (slower to resolve permissions) made it worse. The fix
separates what can proceed immediately (joining the room, seeing who's
present, chat/composition) from what must wait for local media to be ready
(actually creating or answering a WebRTC connection), so no connection is
ever built before both sides know their final camera/mic state —
eliminating the race entirely
([`e70b7af`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/e70b7af)).

Two gaps that same testing surfaced are still open, honestly: the layout
still breaks on small screens, and a generic "make it responsive"
instruction doesn't fix it at the level of detail that's actually needed,
so this stays open until I can get more users testing it directly. A
friend also couldn't find the room link on her first attempt and had to try
a few flows before it worked; I've since added a copy-link button and an
on-page instruction banner, but haven't re-tested with her to confirm those
actually fix what she hit.

## Room access, and an AI tool tried and rejected

I modeled room access on Google Meet and Zoom — anyone with the link can
ask to join, but the organizer decides who's admitted — because a rehearsal
room should stay private and under the organizer's control, not open to
whoever has the link
([`5715ced`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/5715ced)).

Separately, I gave Wix's AI WaveForge's actual idea and asked it to
generate requirements and a design from it, but what came back was a full
business platform — member profiles, DMs, group discussions, a storefront,
fabricated usage stats — nothing like the small, single-purpose tool I'd
described. I rejected that prototype's scope and kept building my own
design, taking only some visual inspiration from it.

## Two requests declined

Two feature asks arrived together and were worked through rather than
silently built or dropped: real-time singing detection to drive the lyrics
cursor from the microphone, and a karaoke page fetching requested songs
from YouTube. Singing detection was declined — the only applicable browser
API (Web Speech API) is built for speech, works in one browser engine, and
sends raw microphone audio to a cloud transcription service, a real
departure from this app's consent-and-local-first handling of audio
everywhere else; the existing leader-driven, time-based lyrics cursor (ADR
0002) stays the one mechanism. Fetching and serving YouTube audio was
declined as a Terms of Service violation regardless of implementation; what
shipped instead
([`f2afce9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/f2afce9))
is a Karaoke room view that plays a pasted link through YouTube's own
embedded player, with the server storing only the extracted video id, never
the raw URL or any of its audio.

## Where this stands against the brief

Every feature in the brief has a working version, server-authoritative and
checked by `spec/*.test.ts` wherever a script can tell working from not —
accounts, consent-gated camera with "Original Sound," a shared multi-voice
composition space, lyrics with threaded comments, a room password/lobby
gate, and personal/group recording, deployed as one Node process on the
course's single Fly machine. The real cost of that single process, named
honestly in ADR 0001, is fault isolation: a bad bug in one feature can take
down every other feature sharing the same process, which a microservices
split would fix at the cost of complexity this box doesn't have room for
yet. What's left before the deadline: crit 10's own logging additions, the
two open testing gaps above, and the stretch goal (real Drive/OneDrive
OAuth instead of a pasted link) if time allows.
