# Crit 10 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was getting friends to actually use the app together rather
than trusting my own solo testing. On a real call, video was inconsistent in
a way that looked random from the outside: I could only see myself, one
friend saw a frozen image of herself, two others on phones briefly saw each
other but not me. Nothing in that description pointed at a single bug until I
asked the agent to read the WebRTC and presence code end to end instead of
guessing from the symptom. The real cause was a race: a peer connection was
being created the moment presence reported someone else in the room, before
my own camera/mic permission had even resolved, and if both sides then tried
to add a track at the same instant the attempts collided ("glare"), leaving
one or both stuck half-connected — worse on phones, which resolve permission
prompts slower. The fix was conceptual before it was code: separate what can
happen immediately (joining, seeing who's present, chat/composition) from
what must wait for local media to be settled (actually building or answering
a connection), so no connection is ever negotiated before both sides know
their final track state
([`e70b7af`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-p-venkatram/commit/e70b7af)).
Multi-user, real-time bugs like this don't show up by staring at one browser
tab; they only show up under the exact uncoordinated timing real people
produce, which is why the friend-testing session mattered more than another
pass of code review would have.

## What did this work change about who I want to be as a software developer?

It sharpened the difference between a bug that's wrong code and a bug that's
an unstated assumption — "the other peer is ready" was never written down
anywhere, just implicitly relied on. I want to get better at naming those
assumptions before they fail, not just after a confusing bug report, and at
treating "it works when I test it alone" as worth nothing for anything
concurrent or multi-user. I also noticed I still have two gaps open
honestly rather than papered over (small-screen layout, a friend not finding
the room link on her first try) instead of claiming they're fixed because a
generic instruction was given — that's the standard I want to hold the rest
of this project to, not just this one bug.
