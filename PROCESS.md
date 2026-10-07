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

## What's next

Camera consent and the "Original Sound" toggle, the shared composition
space, lyrics upload and the karaoke cursor, and recording. Each lands as
its own commit; this file gets rewritten with the next stage's reasoning and
cited commits as that happens, per the brief's instruction to rewrite rather
than append.
