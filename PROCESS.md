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

The foundation: the dark (black + neon) / light (pastel) theme system
(`src/styles/theme.css`, toggled and persisted client-side), the Node server
skeleton with its SQLite migration runner, `/readme/` rendered from this file
with the site's own theme CSS inlined (replacing the template's `sed`-based
placeholder), and structured JSON logging to stdout with an in-memory ring
buffer behind both an `/api/activity/stream` SSE endpoint and the `/activity/`
page — this last pair is a deliberate head start on crit 10's logging
requirement rather than something bolted on the week it's due.

## What's next

Accounts (signup/login/sessions), then real-time rooms with WebSocket
presence and the crit 9 decision about simultaneous use, then camera consent
and the "Original Sound" toggle, the shared composition space, lyrics upload
and the karaoke cursor, and recording. Each lands as its own commit; this
file gets rewritten with the next stage's reasoning and cited commits as that
happens, per the brief's instruction to rewrite rather than append.
