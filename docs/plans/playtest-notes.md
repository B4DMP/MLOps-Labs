# Graph Redesign - Playtest
Note: I did not read any docs before playing.

## UI

### General
- The challenge number is broken in the challenge view (106/6).
- Stakeholder names on the challenge view are also broken.

### Dossier
- The general design of the Performance & Logs tabs looks very AI-generated; we should align it better with the overall design or just restore the old one.
- It is not visually apparent that you can click on the different pipeline stages to view details.
- Similarly, it is not apparent that you can click on pipeline steps to view details.
- The "System" intel tab should be next to the stakeholders' tabs.

### Online Intel Gathering
- Engagement cards are cut off by adjacent components on small screens.
- There is a large blank space on larger screens below the engagement cards.
- The clickable links to the associated intel items do not work anymore in the conversation history.
- There is no visual feedback on why you cannot progress to the pitch when you have not obtained enough intel items yet.
- The stakeholder colors in the "Target Selection" UI are not working.
- Engagement cards should also be draggable.
- There is no visual indication when a hypothesis is refuted.
- How can there be "line crossed", "colder", and "warmer" indicators when I have not even pitched anything?

### Action Card Building
- The stakeholder icons and names for the card slots are placeholders.
- The "Pick Intel" UI also needs some work.

### Pitch Debate
- When stakeholders raise objections, whether the associated intel item is discovered should be visually indicated. If it is, there should be a clickable link to it.
- When a card is blocked, it is not visually clear enough who did it.
- The status indicators like "line crossed" never disappear even if they are addressed. They partly overlap each other and other UI elements.

## Gameplay

### Offline Intel Gathering
- The challenge being an artifact is a good idea.
- There are too many intel items in the first challenge to read through (12). Possibly not all convincer archetypes should be categorizable in the first challenge.
- There seems to be a hardcoded number of 2+1 system artifacts per challenge. But sometimes there just isn't enough information, so multiple artifacts display the same information.
- If I miscategorize a system fact, the miscategorized description is very obviously wrong.
- Trade-Off Intel Artifacts are weirdly framed: "I am willing to drop my request for x. In exchange, I need y." Is x the trade-off, and do we have y hardcoded in the system or is it just a hallucination? This also makes trade-offs very easy to detect.
- How are unconfirmed system intel items confirmed?

### Online Intel Gathering
(- The next dialogue option should only appear after the previous stakeholder has answered so it feels more like a conversation)
(- There should be actual dialogue)
- Manually having to close a conversation that has already ended feels weird.
- When a hypothesis fails, the intel item is marked as "refuted" and I cannot re-tag it. Does that mean I will never be able to use it?
- I played a 1-1 deep dive card on a key stakeholder and had only the "ask generically" or guess a convincer archetype option. Hence I had no chance to obtain any intel items, with no explanation as to why.
- In another challenge, I suddenly had different conversation options like "trial balloon" or "the 1-1". It was not clear why they were available and what they would do.
- If I already categorized a stakeholder's Convincer Archetype in the dossier, why would I guess a different archetype in the conversation options?

### Action Card Building
- Why can I add System Facts as intel items for action cards? What actions do they imply? Wouldn't everything stay the same if I composed an action card out of only facts?
    - I tested it and it actually worked in one challenge xD
- Players should be able to see the actual card that they created and not just the intel items that it was composed of.
- The action card building UI already displays all stakeholder effects; this makes the pitch debate basically obsolete.
- There should be stakeholder filtering in the "Pick Intel" UI.

### Pitch Debate
- (There should also be player messages)
- When I amended an intel item to satisfy Efficiency Evelyn's objection, a "line crossed" sign appeared over Requirements Ryan. This made sense because the amendment was clearly against his interest. However, his buy-in remained at 100% and he did not raise any new objection.
- The buy-in in the stakeholder dossier has different values than the buy-in in the pitch debate after a card was pitched.
- Requirements Ryan had 85% buy-in and a green buy-in bar in the pitch debate, but a "a line of theirs is crossed" status. When a line is crossed, their buy-in should be much lower.
- There was no impact of actions in the pitch debate / online intel gathering on the stakeholders' emotions.
- When I add the missing intel item of the blocking stakeholder, he thanks me but still vetoes my card.
- The "Let Them Have It" option should specify which stakeholder. When I choose it, it should show which action is actually taken. It should also be possible that another stakeholder vetoes it again.
- Similarly, after choosing the "amend" option, it should be clear what was actually amended.
- I should be able to view or freely edit my action card during the pitch debate. When I edit it, the pitch debate should restart.
- I was not able to automate data validation because it was capped at data ingestion's level and I did not have any intel items to increase data ingestion. It is good that the intel item shows "capped at manual", but in this case it should be possible to obtain an intel item about also automating data ingestion as this is inferred by the original intel item.
- In one instance, a stakeholder's response was: "I cannot sign off on improving {target} because the upstream {cause} is still unreliable. My alerting system will just drown in false positives until that foundation is solid."

