# Lordicon animated icons

Reference for the animated (Lordicon) icons used across the UI, and how to add more.

## Logic

- `game-ui/src/components/Results/OnceIcon.tsx` wraps `@lordicon/react`'s `Player`. It plays the
  animation once on mount and settles on its final frame - never looped, per Lordicon's own
  guidance that a looping icon stops delivering its effect. It replays from the start on hover,
  which is Lordicon's recommended trigger for an icon that isn't otherwise animating.
- Icons are self-hosted as Lottie JSON under `game-ui/src/components/Results/icons/*.json`, not
  loaded from Lordicon's CDN at runtime - no external network call, no Lordicon script tag.
- Reserved for one-shot "arrival" moments a player reads (a result reveal, a completed action, a
  card that just appeared) - never for small inline glyphs next to running text, which stay on
  plain `@iconify/react` `Icon`. Kept to a handful of screens on purpose: one per moment, not
  motion everywhere.
- One exception: `BriefingPage.tsx`'s header hero icon plays continuously, driving the truck
  icon's own `loop-cycle` state (see its `nm` markers) on repeat via `onComplete` ->
  `playFromBeginning()` - `@lordicon/react`'s `Player` (`IPlayerOptions`) has no built-in loop
  trigger, unlike the `lord-icon` web component. Not `OnceIcon`, and not the default reveal
  animation looped against Lordicon's advice: `loop-cycle` is the icon's own named
  continuous-motion segment, the one screen meant to feel like ambient motion rather than a
  one-shot arrival.
- Every mapping is a plain `Record<string, object>` from a domain id (grade epilogue "beat" id,
  `ArtifactType` value, correct/incorrect) to an imported icon JSON, e.g. `BEAT_ICON` in
  `ResultsHero.tsx` or `ARTIFACT_TYPE_ICON` in `offline_intel_gathering.tsx`.
- CSS sizes the icon on the wrapping `className` and forces the Player's inner `div` to fill it:
  ```css
  .myIcon { display: inline-flex; width: 1.6rem; height: 1.6rem; }
  .myIcon > div { width: 100% !important; height: 100% !important; }
  ```
- Tests must mock `@lordicon/react` (jsdom can't render the real Lottie player - see
  `AdminResults.test.tsx`, `Results.test.tsx`, `VetoDialog.test.tsx` for the pattern).

## Where they're used

| Screen / component | Moment | Icon(s) |
| --- | --- | --- |
| `ResultsHero.tsx` (grade reveal) | Grade ribbon (always) | `badge-ribbon` |
| `ResultsHero.tsx` | Confetti burst, top grades only (S/A) | `confetti` |
| `ResultsHero.tsx` | Epilogue beat (one per run, `BEAT_ICON`) | `person-protesting` (hostile stakeholder), `warning-triangle` (grudge fired / intel misread), `wrench` (stage broken), `test-tubes` (intel read sharply), `road-barrier` (vetoed often), `hands-applause` (clean run), `avatars-chatting` (room stayed warm), `scale-retro` (default/ordinary run) |
| `offline_intel_gathering.tsx` | Artifact-type badge in the header (`ARTIFACT_TYPE_ICON`, keyed by the backend's `ArtifactType`) | `mail-open-marketing` (email), `messages-engagement-alt` (slack_message), `avatars-chatting` (meeting_notes), `file-policy` (document), `list-rules` (runbook), `magnifier` (dashboard_snapshot), `radio-walkie-talkie` (incident_ticket), `server` (ci_log), `layers` (architecture_note) |
| `offline_intel_gathering.tsx` | "New intel just came in" intro banner (first taggable artifact) | `eye` |
| `offline_intel_gathering.tsx` | "Said this in the open" on-record banner | `microphone` |
| `VetoDialog.tsx` | Header, every veto | `road-barrier` |
| `IntelVerificationDialog.tsx` | Stance verification result | `puzzle-square` (correct), `warning-triangle` (corrected/incorrect) |
| `ac_simulation.tsx` (Rollout Debrief) | Executive Directive Banner hero, one random icon per outcome tone, re-rolled every time the debrief is shown (`OUTCOME_HERO_ICONS`) | `firework`/`shooting-stars`/`confetti`/`disco-ball` (PASS), `wrench`/`warning-triangle`/`alarm` (SOFT_PASS), `ball-bowling`/`no-entry`/`stop` (VETO_BROKEN), `trash-bin`/`road-barrier`/`truck`/`person-protesting` (STALEMATE) |
| `BriefingPage.tsx` | Header hero icon, continuous ambient motion (not `OnceIcon`, self-looped via `onComplete`) - real briefing, the default | `truck` (`state="loop-cycle"`) |
| `BriefingPage.tsx` | Header hero icon, one-shot (`OnceIcon`, no loop) - demo briefing only, passed via `heroIcon={{ icon, loop: false }}` | `honeycombs` |

Only 4 of the 9 `ArtifactType` values (`email`, `slack_message`, `meeting_notes`, `document`) are
ever assigned by the real content pipeline (`content_gen/stages/artifacts.py`'s `ARTIFACT_TYPES`);
the other 5 are mapped anyway since it costs nothing and future-proofs the badge if that list
widens - the artifact-regeneration admin tool (`intel_handler.py`) can already assign any of the 9.

## Full icon list, with source

All icons are from Lordicon's **free** `wired` / `lineal` family:
https://lordicon.com/api/library/icons?family=wired&style=lineal&free=true

That endpoint returns each icon's `name`, `title` and a `key`. The actual Lottie JSON downloads
from `https://cdn.lordicon.com/{key}.json` (no API key or auth needed for free icons).

| File (`Results/icons/`) | Lordicon title | Lordicon key |
| --- | --- | --- |
| `badge-ribbon.json` | Badge Ribbon | `glwzslnh` |
| `confetti.json` | Confetti | `yqgsjpsy` |
| `person-protesting.json` | Protest | `ioukiyyb` |
| `warning-triangle.json` | Warning Triangle | `pilfbsjh` |
| `wrench.json` | Wrench | `fvkvwmsp` |
| `test-tubes.json` | Test Tubes | `gzrvthdo` |
| `road-barrier.json` | Road Barrier | `cvwjmeon` |
| `hands-applause.json` | Applause | `lolvvfsu` |
| `avatars-chatting.json` | Avatars Chatting | `xvmmqwjv` |
| `scale-retro.json` | Scale Retro | `xjsqfzte` |
| `mail-open-marketing.json` | Mail Open Marketing | `gsgbpxjg` |
| `messages-engagement-alt.json` | Messages Engagement | `etzspqzb` |
| `file-policy.json` | File Policy | `yseqjcer` |
| `list-rules.json` | Rules | `ciwxnydt` |
| `magnifier.json` | Magnifier | `iuvnsegf` |
| `radio-walkie-talkie.json` | Walkie-Talkie | `yoakhlrz` |
| `server.json` | Server | `urhdeyyj` |
| `layers.json` | Layers | `wixhsrdu` |
| `eye.json` | Eye | `knitbwfa` |
| `microphone.json` | Microphone | `ckooqaow` |
| `puzzle-square.json` | Puzzle | `upmknvfw` |
| `firework.json` | Firework | `ekuoyiqn` |
| `shooting-stars.json` | Shooting Stars | `lqcwrmzh` |
| `alarm.json` | Alarm Clock | `zjuyeglr` |
| `ball-bowling.json` | Bowling Ball | `ntyifxta` |
| `no-entry.json` | No Entry | `wdbwxkvh` |
| `stop.json` | Stop | `xrggytzr` |
| `trash-bin.json` | Trash Bin | `sxhqklqh` |
| `truck.json` | Truck Delivery | `tpxyzdfc` |
| `disco-ball.json` | Disco Ball | `yaqcbfgd` |
| `honeycombs.json` | Honeycombs | `rjsgdzbc` |

## Adding a new icon

1. Browse https://lordicon.com/icons/wired/lineal for a free icon, or grep the library JSON above
   for a name/keyword.
2. Note its `key`, then fetch the Lottie JSON directly:
   `curl -o game-ui/src/components/Results/icons/<name>.json https://cdn.lordicon.com/<key>.json`
3. Import it and add it to the relevant `Record<string, object>` map (or a new one), following the
   existing per-component pattern above.
4. Size it with the `> div { width/height: 100% !important }` CSS pattern.
5. If the component has tests, mock `@lordicon/react`'s `Player` (see `VetoDialog.test.tsx`).
