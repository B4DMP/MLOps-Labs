# Walkthrough: Dialogue and the Event Log

A player-facing tour of what changed in the pitch loop this round (plan 11). Written for someone
playing the game, not reading the code - no file names, no internals. If you want the engineering
detail, see [`docs/plans/graph-redesign/11-dialogue.md`](../plans/graph-redesign/11-dialogue.md).

## The big idea

Every challenge still runs through the same four beats - gather intel, build your case, face the
room, see what happened - but two things are new everywhere: conversations with stakeholders now
play out turn by turn instead of picking a line from a fixed menu, and everything that happens to
your numbers is now written down in one place you can actually read: the **event log**.

## 1. Offline gathering: tag what you find

Nothing changed about how artifacts look, but what you do with them now has weight. Every note you
tag as unconfirmed intel about a stakeholder gets filed into their dossier - and later, when you
talk to that stakeholder directly, you can **confirm** it (you read them right) or **correct** it
(you read them wrong, and now you know the real answer). Both outcomes get logged: a confirmed
guess and a corrected one look different in the event log, so you can tell your reads from your
mistakes at a glance.

## 2. Gather: conversations, not menus

Engagement cards no longer just "reveal an item." Playing one on a stakeholder opens a real
conversation with a fixed number of turns - spend them however you like:

- **Open question** - ask outright, get a verified fact.
- **Test a hypothesis** - stake a guess. Right, and it's confirmed. Wrong, and it's marked
  refuted (with a small trust cost to that stakeholder) - but you get a free re-tag and the
  conversation keeps going, so a wrong guess doesn't waste the whole card.
- **Generic question** - a shorter, softer read: a gist rather than a full fact, still useful.
- **Trial Balloon** - float a possible archetype for them. A hit narrows down what actually moves
  them; a miss still tells you what it *isn't*, ruling out options for next time.
- **The one-on-one** (deep dive cards) - a longer, guided version of the same idea for a single
  target.

When the conversation closes - you run out of turns, or you close it early - whatever you learned
is already sitting in the dossier, tagged Inferred or Refuted so you know how solid it is.

## 3. Build your case: opener lines and sounding people out

Every card you build now opens with a line drawn from its own dominant archetype - what you're
pitching sets the tone before anyone in the room objects to anything.

Before you commit, you can also **sound someone out**: spend a bit of patience with a specific
stakeholder to get a read on where they stand, without committing to anything. It costs you
something (their patience ticks down a little), but it can save you from walking into an objection
you didn't see coming.

## 4. Face the room: Amend, Reframe, and the room is listening

Objections now resolve as a real back-and-forth per stakeholder, not a single roll:

- **Amend** - answer with an intel item that actually speaks to the objection. One line per item
  you offer.
- **Reframe** - pick the archetype you think will land with this stakeholder and make your case
  around it. Three things can happen:
  - **Direct Hit** - it's exactly their archetype. The objection clears, and they warm up.
  - **Partial** - close, but not quite. It still clears, no extra warmth.
  - **Miss** - wrong read entirely. The objection doesn't clear, and it **hardens**: from here on,
    Reframe is off the table for that objection and only Amend can clear it. Reframing wrong
    doesn't just fail quietly, it costs you a path forward.

There's a second cost to a bad Reframe, too: **the room is listening**. Other high-power
stakeholders watching you badly misjudge someone's archetype cool slightly themselves, even
though the objection wasn't theirs. A miss in front of the wrong audience is more expensive than
it looks.

Everything a stakeholder says back to you - agreeing, pushing back, conceding - is voiced in the
moment by the same system, so it reads like a real reply rather than a canned result string.

## 5. Decide, and what the room remembers

Passing, soft-passing, forcing a veto through, or letting the card go all still work as before -
but the emotional and patience state each stakeholder is left in now carries forward visibly, with
a cause you can trace back through the log rather than just a number that moved.

## 6. Simulation and the gate

After you commit, the delta report still shows what you built, what the world did, and where you
stand - and now the event log sits right alongside it, so every graph change, metric move, or
grudge that fires during simulation has a line explaining why. The decision about what challenge
or phase comes next also gets logged as its own line, so "what's next and why" isn't just implied
by the screen changing under you.

## The event log itself

Every screen above writes to the same log, and you reach it the same way everywhere: a small
collapsed panel, filterable by what you care about - people, intel, cards, or the system
underneath - grouped by which beat of the loop it happened in. Nothing shows up in the log that
you couldn't have learned by playing normally: if you haven't talked to someone, the log won't
name them by name either. It's a memory aid for what you already earned, not a hint system.

In the pitch phase specifically, the event log lives next to - but independent of - the
conversation history: two tabs on the side rail, each opens and closes on its own, and you can
have both open side by side if you want the full picture at once.
