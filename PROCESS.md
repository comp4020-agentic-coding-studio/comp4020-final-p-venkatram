# Process overview

## Stack decision (ADR-style)

**Context.** The brief asks for a deployed, multi-user, real-time, persistent
app on one Fly machine: 256MB RAM, one `/data` volume, no separate database
server (`fly.toml`'s fixed shape). The product itself (`README.md`) needs
accounts, camera/mic collaboration by consent, a shared composition space,
lyrics sync, and recording — a lot of moving parts for a very small box.

**Options considered:**

- *Astro with an SSR adapter (Node), running its own server.* Gets per-request
  rendering for free, but adds a second runtime surface to reason about
  alongside whatever serves the WebSocket and API, and Astro's SSR adapter
  wasn't built with "also host a raw WebSocket on the same port" in mind —
  fighting that felt like fighting the framework for no real benefit, since
  this app's pages don't need per-request server rendering (there's no
  per-request data that changes the HTML shell itself; all of it is fetched
  client-side after load anyway, because auth state has to be checked that
  way regardless — see below).
- *A full framework (Next.js, Remix, SvelteKit) with an API/WS layer bolted
  on.* More machinery than a 256MB single-machine app needs; most of what
  these frameworks buy (routing, data loaders, SSR caching) isn't load-bearing
  here, and their resident memory footprint eats into a budget this app
  can't spare.
- **Astro in static output, plus one hand-written Node process for
  everything dynamic (chosen).** Astro builds to plain HTML/CSS/JS — no
  second server, so the whole 256MB belongs to one process. That process
  (`server/index.ts`, `node:http` + `ws`, no framework) serves the static
  build, the REST API, `/readme/`, and the WebSocket upgrade, all on the one
  port Fly expects. Because Astro's output is static, every page is a shell
  that asks the server who's logged in via `fetch`/`EventSource` after load —
  which was going to be true of *any* choice here, since "is there a session"
  can only be answered by hitting the server regardless of where the HTML
  came from.

**Persistence:** `node:sqlite` at `/data/app.db`, not `better-sqlite3` or a
hosted database. It's built into the Node binary the course already pins
(24.21.0), so the Docker image needs no native-module compiler — a real
constraint on a lean Alpine image — and `/data` is the only storage Fly
promises survives a restart, which a file-based database fits exactly.

**Consequence accepted:** no server-side rendering means no page can
personalise its *first paint* (everyone gets the same static shell; anything
user-specific appears a moment later, after a `fetch`). For a small
collaborative tool where every page already needs a live WebSocket anyway,
that moment is immaterial — it's not a cost worth paying a second runtime for.

## What's built

The foundation ([`7fc353a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/7fc353a)):
the dark (black + neon) / light (pastel) theme system (`src/styles/theme.css`,
toggled and persisted client-side), the Node server skeleton with its SQLite
migration runner, `/readme/` rendered from this file with the site's own
theme CSS inlined (replacing the template's `sed`-based placeholder), and
structured JSON logging to stdout with an in-memory ring buffer behind both an
`/api/activity/stream` SSE endpoint and the `/activity/` page — this last pair
is a deliberate head start on crit 10's logging requirement rather than
something bolted on the week it's due.

Accounts: email/password signup and login, `node:crypto` scrypt password
hashing (so no native dependency the Alpine image would need a compiler for),
and cookie sessions backed by a `sessions` table (`server/auth.ts`,
`server/migrations/0001_users.sql`). Deliberately minimal — no password
reset, no email verification — because the brief doesn't ask for an
account-recovery product, it asks for rooms people can get into. `/rooms/`
is the first page that actually requires a session, via a client-side
`requireSession()` check (`src/lib/session.ts`): Astro's static output means
every page is the same HTML for everyone, so "is someone logged in" is
answered after load, by asking the server, on every page that needs to know.

Real-time rooms, on top of accounts
([`323ea82`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/323ea82)):
one WebSocket per client (`server/ws.ts`), multiplexed by a `type` field, backing a shared
in-memory presence registry (`server/realtime/presence.ts`) that every future
real-time feature (signaling, composition, lyrics transport) will reuse
rather than opening its own connection. `spec/realtime.test.ts` drives two
real signed-up users into a room from two independent WebSocket clients and
asserts the second's join reaches the first within a second — the crit 9 claim,
checked mechanically rather than just demoed live.

## Crit 9: the simultaneous-use decision

**Decision:** presence is ephemeral and room membership is persistent, kept
as two separate things. `room_members` records everyone who's ever joined a
room (so a returning user's `/rooms/` list survives a reconnect or a next-day
visit); the live "here now" list (`presence.ts`'s in-memory registry) only
ever reflects sockets that are actually open right now, rebuilt from scratch
on every connect via `presence.sync`.

**Alternative considered:** derive "who's here" from `room_members` directly
— simpler, one less concept. Rejected: it would make a room look permanently
populated by everyone who ever dropped by, the "ghost users" problem every
real chat app has to engineer around. A teacher glancing at who's in the room
needs that to mean *right now*, not *ever*.

**Cost of the choice made:** two sources of truth to keep straight instead of
one, and presence resets to empty if the process restarts (acceptable — Fly's
`auto_stop_machines` already means a quiet room's connections drop and
reconnect on the next visit anyway).

This decision will grow a second clause once the shared composition space and
lyrics transport land: those need a conflict-handling answer too (two people
editing the same thing at once), which doesn't exist yet to decide about
honestly.

Camera, mic, and "Original Sound", on top of real-time rooms
([`24a264e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/24a264e)):
a consent modal (`src/lib/media-consent.ts`) runs before any `getUserMedia`
call, every time a room is entered — never skipped, never remembered across
visits, per the rule in `CLAUDE.md`. A small WebRTC mesh (`src/lib/webrtc.ts`)
reuses the existing WebSocket as a signaling relay (`server/ws.ts` forwards
SDP/ICE to one named peer, `server/realtime/presence.ts`'s `sendToUser`) —
media itself never touches the server. Someone who declines camera/mic still
gets `recvonly` transceivers, so they can watch and listen without being seen
or heard. "Original Sound" calls `track.applyConstraints` on the live mic
track rather than re-acquiring it, so toggling it needs no renegotiation.

`spec/signaling.test.ts` checks the one part of this a headless test actually
can: the server relays an offer to the *right* peer, tagged with who sent it,
and a third person in the same room never sees it. Real cameras and real
peer connections are a person's judgement at the crit, not a script's.

The shared composition space, on top of camera/WebRTC
([`5dfa103`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/5dfa103)):
a step grid (`shared/grid.ts`, deliberately shared between server and client
so they can't disagree about its shape) using the same pentatonic-degree idea
as crit 4's `audio.ts` — every cell lands on a scale degree, so there's no
wrong note to place. `src/lib/composition-player.ts` adapts that same file's
lookahead-scheduler shape (`LOOKAHEAD_MS`/`SCHEDULE_AHEAD_SEC`, scheduling
ahead of `currentTime` rather than trusting `setInterval`'s timing) for a
shared grid instead of one shape.

This is the moment the crit 9 ADR's other half had to actually get decided:
**the server holds the one authoritative copy of a room's composition
(`server/compositions.ts`); a client sends intent ("toggle this cell"), the
server applies it and broadcasts the result to everyone, sender included.**
No client-side optimistic update, no merge step — there's only ever one
answer to "what does the grid look like," decided in one place. Alternative
considered: client-side optimistic updates reconciled against the server's
broadcast (lower perceived latency on your own edits). Rejected for now — at
small-pod scale the round-trip is already well under a second, and a single
source of truth is a much smaller thing to reason about and debug than a
reconciliation path, which matters more here than shaving the last
milliseconds.

`spec/composition.test.ts` checks the shape of that promise directly: one
person's toggle reaches someone else's open session, and a third person
joining later sees the persisted state rather than an empty grid.

Lyrics upload and the karaoke cursor, on top of the composition space
([`e862927`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/e862927)):
line-level, not word-level — a real LRC upload (`[mm:ss.xx]text` per line,
`shared/lyrics.ts`) gets accurate timing, a plain paste falls back to
evenly-spaced lines rather than being refused, either way there's a cursor.

The transport (play/pause/seek) is leader-driven and deliberately doesn't
trust wall-clock comparison across machines: the server
(`server/realtime/lyrics-transport.ts`) only ever says "position is X right
now, playing or not," and each client anchors that to its own monotonic
clock (`performance.now()`) the instant the message arrives, then derives
the cursor's position locally from there. No NTP-style handshake, because
none is needed — only relative elapsed time matters, never absolute time.
This is also the second clause of the crit 9 decision promised earlier: like
composition, there's no lock on who can press play — whoever acts leads for
that moment, which fits a teaching room where any singer might need to stop
and restart a phrase.

`spec/lyrics.test.ts` checks the parts a script can: real LRC timestamps
parse correctly, a timestamp-free paste still produces sequential lines
instead of being rejected, an upload reaches everyone else in the room, and
one person's play reaches another's open session. Whether the cursor is
actually pleasant to sing along to is for the crit.

Recording, on top of lyrics
([`6766da5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/6766da5)):
entirely client-side, on purpose — a personal recording (`src/lib/recorder.ts`'s
`StreamRecorder`, wrapping `MediaRecorder`) captures your own camera/mic
locally; a group recording mixes your mic with every currently-connected
peer's incoming audio through a `MediaStreamAudioDestinationNode` and records
that. Neither sends anything to the server — it has no spare capacity on a
256MB machine to receive, store, or transcode media, and doesn't need to.
Group recording is audio-only: compositing every video tile onto a canvas to
record a mixed video would be real additional work for a small-group
rehearsal tool where the shared *sound* is the thing worth keeping, so that's
where this pass draws the line. Both recordings end in a local download
(`downloadBlob`); uploading to Google Drive or OneDrive is a stretch goal,
flagged directly in the room UI rather than silently missing.

Real `MediaRecorder`/`AudioContext` behaviour isn't something jsdom can
exercise, so there's no spec test pretending to cover it — like camera and
WebRTC before it, this is a person's judgement at the crit.

## Room UI: sidebar nav and real staff notation

On top of recording
([`855bda7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/855bda7)):
the room page was one long stack of sections; it's now three views
(Collaboration Room, Recording, Composition Space) behind a sidebar, with
lyrics shown beside the Collaboration Room rather than as its own section.

**Decision:** switching views never tears down the WebSocket, the WebRTC
peers, or the local media stream — it's one page with three panels toggled
by `hidden` (`src/lib/room-page.ts`'s `initRoomNav`), not three separate page
loads. Re-establishing any of those connections is expensive, and the whole
point of a room is that they don't drop just because you're reading the
score. A side effect worth naming rather than treating as a bug: a hidden
`<video>` keeps its audio playing, so you still hear the room from the
Recording or Composition panel.

**The composition space is now real staff notation, not a button grid** —
`src/lib/composition-staff.ts` renders an SVG treble staff (noteheads, stems,
flags, ledger lines) with a duration-picker toolbar, Musescore's own
"pick a duration, click where it goes" model, simplified: one staff, no time
signatures, no measures, no multi-voice. This is a direct port, not just
borrowed inspiration — `src/lib/staff-notation.ts` is crit 4's
`notation.ts` (`DEGREE_TABLE`, ledger-line math, note glyphs), which already
solves this exact problem for the same 10-degree pentatonic system
`shared/grid.ts` already shares with it. `Cell` grew from `[step, pitch]` to
`[step, pitch, duration]` — no migration needed, since `compositions.grid` is
a JSON blob and there's no production data yet to migrate. Playback
(`composition-player.ts`) now rings each note for its actual written
duration (crit 4's `DURATION_RELEASE_MULTIPLIERS`) instead of a flat 0.3s.

## Click targets, and a downloadable PDF

On top of the nav/layout restructuring
([`f7e372f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/f7e372f)):
two changes to the composition space.

**Click targets were too thin to use.** Each (step, pitch) target was exactly
`HALF_LINE_SPACING` tall — 8px at the original scale, rendered even smaller
once the CSS further scaled the SVG down to an 11rem display height. That's
well under anything comfortably clickable. Fixed by doubling every geometry
constant (`composition-staff.ts`) and giving the SVG explicit `width`/
`height` attributes matching its viewBox 1:1, so there's no further CSS
scale factor for a target's real on-screen size to shrink into. Targets are
now a genuine 16px tall.

**PDF export** (`src/lib/staff-pdf.ts`, `jspdf` + `svg2pdf.js`): entirely
client-side, for the same reason recording is — the server has no spare
capacity on a 256MB machine for this, and doesn't need any. It builds its
own plain black-on-white SVG rather than reusing the live, theme-colored
one: a print document shouldn't follow the dark/light toggle, and has no
click targets or playhead to carry over. Text in that export SVG is
deliberately plain ASCII ("Treble", "#") rather than the live staff's
Unicode clef/sharp glyphs (𝄞, ♯) — `svg2pdf.js` vectorizes shapes (lines,
ellipses, paths) perfectly, but relies on jsPDF's built-in fonts for text,
which aren't guaranteed to carry those glyphs. The notes themselves (every
pitch and duration) are all drawn as shapes, so nothing about what was
actually composed is lost — only the decorative clef/accidental glyphs get a
plainer stand-in in the printed version.

## Where this leaves the final project

Every feature from the brief has a first version: accounts, consent-gated
camera with "Original Sound," a shared composition space, lyrics with a
karaoke cursor, and personal/group recording — deployed as one Node process
on the course's single Fly machine, real-time by crit 9's definition and
checked by `spec/*.test.ts` wherever a script can actually tell the
difference between working and not. The crit 10 logging requirement has a
head start from the foundation commit (structured events, a live
`/activity/` view) rather than being bolted on the week it's due. What's
left for the weeks ahead: crit 10's own logging additions as more user
actions accrue events worth watching, and the stretch goal (real Drive/
OneDrive OAuth) if time allows before the A3 deadline.

## Landing page: why, how, what — and a hero image

The landing page was a single hero card plus a feature list; it's now three
sections in that order — why WaveForge exists (the latency-honesty argument
`README.md` already makes), how it actually behaves (call-and-response,
consent, Original Sound, server-authoritative state), then what's concretely
there (the feature list, now mentioning the real staff notation and PDF
export that didn't exist when that copy was first written).

The hero uses a photo (Caleb George, via Unsplash — free license, credited
in the page itself) of hands holding instruments overhead, run through
Astro's built-in `astro:assets` `<Image>` rather than hand-rolled resizing:
it needed `sharp` added as an explicit devDependency (it's only an
*optional* dependency of Astro itself, which pnpm's strict linking doesn't
surface to Astro's own `loadSharp` lookup) but in exchange, the 976KB source
JPEG ships as five responsive WebP sizes (4KB–346KB) generated at build
time, `sharp` itself never entering the runtime image. The hero's dark
scrim is fixed regardless of the site's own dark/light toggle — a photo
needs one legible treatment, not two.

Separately: the landing page's only call to action used to be "Create an
account" (plus a "Browse rooms" link that silently redirected an
unauthenticated visitor to `/login/` anyway) — no obvious way for a
returning user to just log in. Replaced with explicit "Create an account" /
"Log in" buttons.

## Renamed to WaveForge

([`46f62eb`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/46f62eb)
also carries this, alongside the hero aspect-ratio fix above — both were
in flight together.) Every "Roundsong" reference across the README, this
file, `CLAUDE.md`, page titles/descriptions, the brand mark, and generated
filenames (recordings, the composition PDF) is now "WaveForge." Cosmetic
only: the product this app is — call-and-response, consent-gated,
latency-honest — is unchanged, and the repo name, Fly app name, and deploy
URL stay `comp4020-final-p-venkatram` / `*.fly.dev`, which the course's CI
and cutoff sweep are fixed to.

## A scope decision worth recording

A reference site was shared (a Wix mockup of a full social platform: member
profiles, DMs, group discussions, a portfolio showcase, "10K+ sessions"
style fabricated stats, Shop and Events pages). That version is explicitly
the shape the final project brief asks *not* to build — general-purpose,
not small or single-purpose — and it would need real resources
(profiles, messaging, discovery) this app's one 256MB machine isn't scoped
for. Decision: keep the room-based tool as the actual submission, and take
only the *visual* energy from that reference — not its feature set.

Concretely, on top of ([`88c241f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/88c241f)):
- **Clarity City** (`public/fonts/`, SIL OFL licensed, VMware's Clarity
  Design System font — self-hosted since it isn't on Google Fonts, with its
  license text kept alongside it as the OFL requires), applied site-wide,
  with bolder heading weights for more visual punch.
- A **stats strip** on the landing page (`server/routes/stats.ts`,
  `src/lib/landing-stats.ts`) borrowing the reference's "three metrics in a
  row" layout pattern, but wired to real, honest aggregate counts (rooms
  created, notes composed, lyric sheets shared) — no fabricated numbers, no
  identifying content (no room names) in a public, no-session endpoint.

## Hero: a fading carousel instead of three stacked sections

On top of ([`4d2ffdd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/4d2ffdd)):
stacking Why/How/What on top of the photo either overflowed the image's own
height or forced the hero much taller than the photo itself — neither
looked right. The headline and "Create an account"/"Log in" buttons now stay
fixed; the explanatory content between them cycles through three slides on a
cross-fade (`src/lib/hero-carousel.ts` toggles `.is-active`, a plain CSS
opacity transition — no animation library), all in the same fixed-height
space. Respects `prefers-reduced-motion` by just not auto-cycling (the first
slide stays put) rather than forcing motion on someone who's asked not to
see it.

Also: the stats strip only reveals itself to a signed-in visitor now
(`landing-stats.ts` checks the session before even requesting `/api/stats`)
— a public vanity metric for anonymous visitors didn't fit this app's own
"small, honest" framing, and every value falls back to `0` rather than ever
rendering the literal string "undefined" if a field were ever missing from
the response.

Two quick follow-ups on top of ([`4371c21`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/4371c21)):
the cross-fade became a "clarify" transition instead — the incoming slide
starts blurred and comes into focus, the outgoing one softens as it leaves
(`filter: blur()` paired with `opacity`, still a plain CSS transition, still
skipped under `prefers-reduced-motion`) — and the whole overlay block moved
from vertically centered to top-aligned within the photo.
