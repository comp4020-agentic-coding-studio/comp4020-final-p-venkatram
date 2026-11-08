# Process

## From brief to harness

Collaborating on music via traditional video conferencing tools like Zoom is
often difficult, whether it's writing lyrics, figuring out notes, or
coordinating parts for a choir spread across different countries. Given the
brief's few fixed constraints, I set my own: a genuinely multi-user,
full-stack application, dynamic, not just a static interface, with a
database and APIs that sync state across users, keep the database and UI in
sync, and connect in third-party services like YouTube's player and search
API, built on real sound/music computing APIs (carried over from week 4's
spec) as a single monolith on one machine rather than a microservice
architecture. Once that basic idea was fixed, I built by putting myself in
a music educator's position and asking what I wished the tool could do
next, empathy made it easy to keep finding the next feature worth adding.

The full case for the stack is [ADR 0001](docs/adr/0001-static-astro-single-node-process.md):
one Astro static build plus one hand-written Node process on
`fly.toml`'s single machine, `node:sqlite` at `/data/app.db`. How that
monolith behaves with several people in a room at once, what counts as
"present," and who has the authoritative copy of shared state, is
[ADR 0002](docs/adr/0002-presence-vs-membership-and-server-authority.md).
Why camera, mic, and recordings never touch the server is
[ADR 0003](docs/adr/0003-media-and-storage-stay-off-the-server.md).

## What friend testing actually found

I got friends to test the app with me rather than guessing at what was
broken myself: during our call, video display was highly inconsistent
across devices, traced to a WebRTC peer connection being created before
local media had resolved. The fix separates what can proceed immediately
(joining, presence, chat) from what must wait for local media (actually
negotiating a connection), so no connection is built before both sides
know their final camera/mic state
([`e70b7af`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/e70b7af)).
The layout-on-small-screens gap from that same testing is still open,
honestly, until I can get more users testing it directly.

## The karaoke room grew into a shared queue, not just a shared video

The feedback that drove the biggest change this cycle: a karaoke video
alone isn't a karaoke *room* without seeing each other over it, and one
pasted link isn't a session without a way to queue up what's next. Three
decisions came out of scoping that:

First, "now playing" stays a single value per room (the existing `videos`
table), with a new multi-row `video_queue_items` table as purely "up next";
auto-advance pops the top-ordered item into that same slot rather than
inventing a second notion of what's playing. Net score (upvotes minus
downvotes, ties by when added) orders the queue, and any room member, not
just whoever added a song, can vote or skip, matching this app's existing
no-gatekeeper posture everywhere except owner-only recording-links and
lobby admission.

Second, detecting when a video actually ends needs YouTube's IFrame Player
API, not the plain `<iframe>` embed the original panel used, replacing it
was the largest single rewrite this cycle. Every connected client's player
reports the end independently; the server makes that idempotent by
comparing the reported id against whichever video is currently
authoritative and treating a stale report as a no-op, so two clients
ending within milliseconds of each other can't double-advance the queue.
That idempotency path has its own test, written to simulate two
near-simultaneous reports.

Third, searching YouTube needed a real external API key, which meant a
real decision about where a secret lives on a single Fly machine:
`flyctl secrets set`, read via `process.env`, never in `fly.toml`'s
tracked `[env]` block and never pasted into an agent session, documented
in `CLAUDE.md` so it's not tribal knowledge. Search stays read-only and
un-logged; only what gets added to the queue is.

Webcam tiles moved off the old CSS grid into an always-mounted floating
layer, individually draggable via Pointer Events (the same API
`piano-tool.ts` used for press/release), so a face is never hidden just
because karaoke is the active panel.

## An honest gap: dragging and real-player auto-advance aren't scripted

Everything server-side (queue ordering, voting, idempotent advance, search
auth/error paths) has automated coverage in `spec/`. Two things don't,
deliberately: a dragged tile's position is local-only by design, nothing
for a server-talking test to assert, and a real YouTube player firing an
end-of-video event can't be driven by the JSDOM-based harness `spec/` runs
on. Both were checked by hand with a scripted headless-browser pass
instead of left unverified.

## Two bugs this cycle, both found the same way

A nav z-index collision (opening the hamburger menu on a room page let the
room's own fixed overlays paint over the bottom of the open menu) and a
misaligned "Add to queue" button (a generic form-field margin leaking into
a flex alignment) both looked like one-line fixes from reading the CSS.
Neither was: both needed an actual rendered reproduction and pixel
measurements, not inference from the stylesheet, before I'd trust a fix
([`a118492`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/a118492),
[`bddc18e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/bddc18e)).

## An AI tool tried and rejected, and two requests declined

I gave Wix's AI WaveForge's actual idea and asked it to generate
requirements and a design from it; what came back was a full business
platform, member profiles, DMs, a storefront, fabricated usage stats,
nothing like the small tool described. I rejected that scope and kept
building my own design.

Two feature asks were worked through rather than silently built or dropped:
real-time singing detection to drive the lyrics cursor (declined, the only
applicable browser API sends raw microphone audio to a cloud transcription
service, a departure from this app's consent-and-local-first handling of
audio), and fetching YouTube audio server-side to serve it back (declined
as a Terms of Service violation regardless of implementation). That same
reasoning is why this cycle's search still only returns an id and metadata
for the official embedded player, never fetched content, extending the
existing karaoke decision rather than reopening it
([`f2afce9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/f2afce9)).

## Where this stands against the brief

Every feature in the brief has a working version, server-authoritative and
checked by `spec/*.test.ts` wherever a script can tell working from not:
accounts, consent-gated camera with "Original Sound," a shared multi-voice
composition space, lyrics with threaded comments, a room password/lobby
gate, personal/group recording, and now a karaoke room with a shared
queue, voting, search, and floating draggable video. The Activity page was
removed this cycle, a judgment call that the live-log view wasn't earning
its keep against an increasingly full nav; `logEvent` itself (and
`flyctl logs`) remains crit 10's actual logging requirement and never
depended on that page. The real cost of the single-process architecture,
named honestly in ADR 0001, is fault isolation, unchanged from earlier
cycles and the first thing I'd revisit at a larger scale than this
course's one machine.
