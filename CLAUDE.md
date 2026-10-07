# Roundsong harness

What this app is and why is in `README.md` (read it first) and the [final
project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
This file is the rules I hold myself (or any agent working here) to.

## The constraint that shapes everything

One Fly machine, 256MB RAM, one `/data` volume, no separate database server
(`fly.toml`'s fixed contract — don't change its shape). That's why this app
is a single Node process (`server/index.ts`, plain `node:http` + `ws`, no
framework) serving the Astro static build, the API, `/readme/`, and the
WebSocket all on one port, with SQLite (`node:sqlite` — built into Node,
no native build step) at `/data/app.db` as the only persistence. Don't
introduce a second process, a second port, or an external database: none of
them fit the box this runs in.

## How to work here

- `mise install && pnpm install` once. `pnpm dev` runs the Astro dev server
  and the API server together (proxied so the browser only ever talks to one
  origin, matching production).
- Before trusting `pnpm check` locally: `pnpm build && pnpm start`, then in
  another shell `APP_URL=http://localhost:8080 pnpm check`. That's what CI
  actually gates on (the Dockerfile's image, not the dev server).
- Never commit a red `pnpm check`. If a check fails, read its output before
  changing anything.
- `spec/invariants.test.ts` is fixed — don't delete it. Everything else in
  `spec/` is ours; add a test when it adds real backpressure on a promise
  this app makes, not to hit a count.

## Conventions

- **Migrations**: one numbered `server/migrations/NNNN_description.sql` file
  per schema change, applied once each, in order (`server/db.ts`). Never edit
  a migration that's already been applied in a commit; add a new one.
- **Logging**: anything a user does that matters to the story of "who did
  what, when" gets one `logEvent(name, fields)` call (`server/log.ts`) — that
  line is both the crit 10 activity feed and the first thing to read when
  something's misbehaving. Not every HTTP request needs one; a signup, a
  login, a room join/leave, a recording starting — those do.
- **Consent before media**: no code path acquires the camera or microphone
  without an explicit, visible consent step immediately before it, every
  time a new room is entered. This is a rule about the product, not just a
  style preference — don't relax it for convenience in a demo.
- **Audio honesty**: never apply audio processing (echo cancellation, noise
  suppression, gain control, ducking) that the user hasn't chosen. The
  "Original Sound" toggle exists because defaults like these are exactly what
  breaks singing together; don't reintroduce them somewhere else as a
  "quality" feature.

## Process evidence

`PROCESS.md` is rewritten (not appended) at each crit cutoff, and cites real
commit hashes from this repo — `pnpm check:evidence` checks they resolve.
Write the account there, not here; this file is rules, not narrative.
