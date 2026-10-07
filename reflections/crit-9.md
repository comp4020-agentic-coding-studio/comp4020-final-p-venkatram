# Crit 9 reflection

## What was the breakthrough that moved the work forward?

The breakthrough came before any code: catching that "turn on Original Sound
in apps like Zoom" couldn't literally mean controlling Zoom from this app, and
stopping to ask what it actually meant instead of guessing. Once that
clarified into "build the same honesty about audio processing into our own
call feature," a second, bigger reframing followed almost for free — real
internet latency makes simultaneous, studio-tight singing across distance
impossible no matter what gets built, so the whole platform should design for
call-and-response instead of pretending otherwise. That one decision shaped
everything downstream: how presence works, why room state is last-writer-wins
rather than locked, what "real-time" is even promising. The real-time layer
itself (WebSocket presence, a room a second person can join and show up in
within milliseconds) was the easy part once that framing was honest.

## What did this work change about who I want to be as a software developer?

Directing an agent on a brief this open made it obvious how much of the job is
catching an ambiguous ask *before* it becomes the wrong feature, not after —
and how much pickier I need to be about scope going in: deciding in advance
that real Google Drive OAuth wasn't going in this pass, rather than discovering
three-quarters of the way through that it was crowding out the parts of the
brief that actually mattered.
