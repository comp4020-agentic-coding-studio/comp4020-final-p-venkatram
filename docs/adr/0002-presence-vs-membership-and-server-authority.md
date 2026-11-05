# ADR 0002: Presence is ephemeral, membership is persistent; the server holds the one authoritative copy of shared state

**Context.** Crit 9 asks for a written decision about how the app behaves
with several people in it. Two different questions turned out to hide under
that one prompt: who counts as "in the room right now," and who wins when
two people edit the same shared thing at once.

**Decision 1 — presence vs. membership.** `room_members` records everyone
who's ever joined a room, so a returning user's `/rooms/` list survives a
reconnect or a next-day visit. The live "here now" list
(`server/realtime/presence.ts`'s in-memory registry) only ever reflects
sockets that are actually open right now, rebuilt from scratch on every
connect via `presence.sync`. Alternative considered: derive "who's here"
from `room_members` directly — one less concept, rejected because it makes
a room look permanently populated by everyone who ever dropped by, the
"ghost users" problem every chat app engineers around. Cost accepted: two
sources of truth to keep straight instead of one, and presence resets to
empty on a process restart (acceptable — Fly's `auto_stop_machines` already
means a quiet room's connections drop and reconnect on the next visit
anyway).

**Decision 2 — server-authoritative shared state, no merge step.** The
server holds the one authoritative copy of a room's composition, lyrics
document, and (later) video choice. A client sends intent ("toggle this
cell," "post this comment," "set this video"); the server applies it and
broadcasts the result to everyone, sender included. There is no
client-side optimistic update and no reconciliation path — only ever one
answer to "what does this look like," decided in one place. Alternative
considered: client-side optimistic updates reconciled against the server's
broadcast, for lower perceived latency on your own edits. Rejected: at
small-pod scale the round-trip is already well under a second, and a single
source of truth is a far smaller thing to reason about and debug than a
reconciliation path. The same posture extends to validation: a stale line
index, an out-of-range comment offset, or a forged voice id is silently
ignored rather than trusted, the same way a toggle on an unknown cell is.

**Consequence for collaboration features.** Nothing here needs a lock on
who can act. The composition space, the lyrics comment thread, and the
leader-driven media controls all follow "whoever acts, the server applies
it, everyone sees the same result" — which fits a teaching room where any
participant might need to act without waiting for a turn.

Checked mechanically, not just demoed: `spec/realtime.test.ts` drives two
signed-up users into a room from independent WebSocket clients and asserts
the second's join reaches the first within a second
([`323ea82`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/323ea82));
`spec/composition.test.ts` checks that one person's toggle reaches another's
open session and that a third person joining later sees the persisted state
rather than an empty grid.
