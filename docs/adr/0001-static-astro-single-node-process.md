# ADR 0001: Astro static + one hand-written Node process, SQLite via node:sqlite

**Context.** The brief fixes the shape of the box: one Fly machine, 256MB
RAM, one `/data` volume, no separate database server (`fly.toml`). The
product (`README.md`) needs accounts, consent-gated camera/mic, a shared
composition space, lyrics sync, and recording — a lot of moving parts for a
very small machine.

**Options considered.**

- *Astro with an SSR adapter (Node), running its own server.* Gets
  per-request rendering for free, but adds a second runtime surface to
  reason about alongside whatever serves the WebSocket and API, and Astro's
  SSR adapter wasn't built with "also host a raw WebSocket on the same port"
  in mind. No real benefit here either: this app's pages have no
  per-request data that changes the HTML shell, since auth state can only be
  answered by asking the server regardless of where the HTML came from.
- *A full framework (Next.js, Remix, SvelteKit) with an API/WS layer bolted
  on.* More machinery than a 256MB single-machine app needs; routing, data
  loaders, and SSR caching aren't load-bearing here, and their resident
  memory footprint eats into a budget this app can't spare.
- **Astro in static output, plus one hand-written Node process for
  everything dynamic (chosen).** Astro builds to plain HTML/CSS/JS, so the
  whole 256MB belongs to one process. `server/index.ts` (`node:http` + `ws`,
  no framework) serves the static build, the REST API, `/readme/`, and the
  WebSocket upgrade, all on the one port Fly expects.

**Persistence.** `node:sqlite` at `/data/app.db`, not `better-sqlite3` or a
hosted database: it's built into the Node binary the course already pins, so
the Docker image needs no native-module compiler on a lean Alpine base, and
`/data` is the only storage Fly promises survives a restart — which a
file-based database fits exactly.

**Consequence accepted.** No server-side rendering means no page can
personalise its first paint; everyone gets the same static shell, and
anything user-specific appears a moment later after a `fetch`. For a tool
where every page already needs a live WebSocket anyway, that moment is
immaterial — not a cost worth a second runtime.

A second, larger cost is fault isolation, not capacity: every feature shares
the same process, so a crash or a bad bug in one — say, composition — could
take down karaoke, lyrics, and accounts with it, not just that feature.
A microservices split would give each feature its own failure boundary; that
move is the first thing I'd make if this had to serve more users than one
small machine can hold.

Built on ([`7fc353a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/7fc353a)):
theme system, server skeleton, SQLite migration runner, structured JSON
logging behind an SSE activity stream (a deliberate head start on crit 10's
logging requirement). A real consequence of the one-process choice surfaced
late and got fixed in
([`d00bf7a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/d00bf7a)):
the production Docker build only copied `server/` and `src/` into both
stages, not `shared/`, which several server and client modules import from
— broken until both stages copied it.
