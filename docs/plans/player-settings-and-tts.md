# Player settings profile, auto-skip, and text-to-speech

## Problem

Three things have no home today.

1. There is no per-player settings surface at all. Every preference that exists is either
   hardcoded (bubble hold times in `pitch_debate.tsx`, intro pacing in `PowerInterestMatrix.tsx`)
   or a one-off `localStorage` key (`mlops_offline_intel_intro_seen` in
   `offline_intel_gathering.tsx`).
2. `ENABLE_RESET_USER` was added to `game-api/.env.example` but nothing reads it. Players who
   want a clean run have to ask an admin to delete them (`DELETE /api/admin/players/{name}`),
   which also destroys the account.
3. Stakeholder lines are silent. The game already knows exactly when a stakeholder speaks and
   when an intel artifact is first read, so a Web Speech API voice costs no new content.

## Scope

- A settings profile per player, persisted server-side, reachable from anywhere in the game.
- Two behavior toggles: **auto-skip conversations** and **mute text-to-speech**.
- A reset-account action, gated behind `ENABLE_RESET_USER`, confirmed before it fires.
- Text-to-speech on stakeholder speech bubbles and on first view of an intel artifact.
- Per-player voice mapping across four slots (male, female, narrator, player), each with a
  "Hello world" preview.

Out of scope: server-side speech synthesis, narration of chat transcript history, narration of
player-authored text, localisation of voices beyond `en-US`.

## Data model

New table `user_settings`, one row per player.

| column | type | default |
| --- | --- | --- |
| `id` | Integer PK | |
| `user_name` | String(255), unique, indexed | |
| `user_id` | Integer FK to the user table, `ON DELETE CASCADE`, unique, indexed | |
| `auto_skip_conversations` | Boolean | `false` |
| `mute_tts` | Boolean | `false` |
| `voice_male` | String(255), nullable | `null` |
| `voice_female` | String(255), nullable | `null` |
| `voice_narrator` | String(255), nullable | `null` |
| `voice_player` | String(255), nullable | `null` |
| `updated_at` | DateTime | now |

The FK with `ON DELETE CASCADE` matches every other per-player table, and carrying both
`user_name` and `user_id` matches `GameProgression`, `GameChallenge` and the rest. The websocket
only ever knows the username, so reads go through `user_lookup.get_user_id`.

Consequence to be deliberate about: the reset flow deletes and recreates the `User` row, so the
cascade takes the settings with it and a reset player comes back on defaults. That is the literal
reading of "as if freshly registered", and it is what this plan implements. It means the
`localStorage` mirror described under **Settings context** must be cleared as part of the reset,
otherwise stale preferences resurrect on the next load and silently disagree with the server.

Admin-side `remove_player` / `remove_all_players` need no change: the cascade covers them.

`user_settings` is per player, not per campaign. Nothing about it is campaign-scoped today, and
a campaign delete already cascades through `User`.

Add the table name to `config.py` next to the other `POSTGRES_*_TABLE` settings. New Alembic
revision in `game-api/alembic/versions/`, following the naming of the existing ones.

Voices are stored as the raw `SpeechSynthesisVoice.name` string. It is OS-specific and may not
exist on the player's next machine, so every read path treats a missing voice as "fall back to
regex matching" rather than an error.

## Backend

### Settings service

`game-api/src/mlops_serious_game/application/services/user_settings_service.py`:

- `get_settings(user_name) -> dict` returns the row, or the defaults above if none exists. Never
  writes on read.
- `update_settings(user_name, **fields) -> dict` upserts, ignores unknown keys, returns the
  merged result.
- `delete_settings(user_name) -> None` for the admin delete paths.

### Websocket events

The game already talks over the unified websocket (`infrastructure/websocket/router.py`), and
the settings panel lives inside the game shell, so settings ride the same channel rather than
adding REST routes. New handler
`infrastructure/websocket/handlers/settings_handler.py`, registered in `EVENT_REGISTRY`:

| event in | payload | event out |
| --- | --- | --- |
| `settings:get` | `{}` | `settings:data` |
| `settings:update` | any subset of the six fields | `settings:data` |
| `settings:reset_account` | `{"confirm": true}` | `settings:account_reset` or an error |

`settings:data` carries the settings plus `"can_reset_account"`, read from the new
`settings.ENABLE_RESET_USER` flag. The UI renders the reset button off that field alone, so the
flag lives in exactly one place.

Also fold `"settings"` into the `game:init_data` payload in `game_handler.py`, so the first paint
already knows whether to mute. Without it the intro bubbles on the pre-phase dialog can start
speaking before the settings round-trip lands.

### Reset

`config.py`: add `ENABLE_RESET_USER: bool = False` under `--- Feature flags ---`, with the same
"never on in production" note the other two flags carry.

`admin_service.py` gains `reset_player(player_name) -> None`:

1. Read the user's `campaign_key`, `campaign_id` and `user_name`.
2. `_cleanup_and_delete_user(session, user)`, which already deletes every per-player row through
   the cascades plus the LangGraph checkpoint tables.
3. Re-insert a `User` row with the same `user_name`, `campaign_key` and `campaign_id`.

Reusing the existing helper is the point: it is documented as the one place that knows every
per-player table, and a second hand-rolled wipe would drift from it. The new `user_settings` row
goes with the cascade, so the recreated account starts on defaults.

The handler refuses unless `settings.ENABLE_RESET_USER` is true and `payload["confirm"]` is
literally `true`, and emits an error on either. Server-side gating matters because the flag is
the only thing standing between a crafted websocket frame and a wiped account.

After the reset the handler closes with `settings:account_reset`; the UI then reloads into the
fresh account rather than trying to reconcile stale in-memory state.

### Stakeholder voice hint

`gameConfig/GameStakeholders.json` has no gender or voice field, and the ids only imply one
(`data_dave`, `model_monica`, `automation_alex`). Add an optional `voice` field with values
`"male" | "female" | "neutral"` to the stakeholder config, its schema
(`gameConfigSchemas/GameStakeholders.schema.json`) and `domain/stakeholder.py`, defaulting to
`"neutral"`. It already flows to the UI through `get_stakeholders()` in `game:init_data`.

Author it for all six shipped stakeholders rather than guessing from names in the client:
`automation_alex` is exactly the case a name heuristic gets wrong.

### Tests

`game-api/tests/test_user_settings.py`:

- defaults are returned for an unknown user, and no row is written
- update persists and round-trips; partial updates leave other fields alone
- `settings:reset_account` is refused when `ENABLE_RESET_USER` is false (patched the way
  `test_stakeholder_dossier_debug.py` patches its flag)
- refused without `confirm: true`
- after a reset the user exists, is in the same campaign, and has no progression / challenge /
  session / intel / graph-op / event rows
- after a reset `get_settings` returns the defaults, and the old `user_settings` row is gone

Run in the container: `docker compose exec api pytest tests/ -q`.

## Frontend

### Settings context

`game-ui/src/components/SettingsProvider.tsx`, matching the existing `PhaseProvider` /
`MetricProvider` shape: a context holding the settings, `updateSettings(partial)`, and
`canResetAccount`. It subscribes to `settings:data`, seeds from `game:init_data`, and writes
optimistically (flip local state, send `settings:update`, reconcile on the echo). A player
toggling mute mid-sentence should not wait on a round trip.

Mirror the settings into `localStorage` under `mlops_player_settings` and read that as the
initial value. The websocket stays the source of truth; the mirror only avoids one frame of
unmuted audio on reload. Key the mirror by username and clear it on `settings:account_reset` and
on logout, so a reset genuinely lands on defaults.

The provider goes around the whole of `Game.tsx`, outside the `progressionIndex` switch, so it
also covers the questionnaire, briefing and end screens.

### Where the panel is linked

One mount, two entry points, and never two gears on screen at once.

`SettingsPanel` is mounted once in `Game.tsx` alongside `PerformanceDashboard`, driven by an
`isSettingsOpen` state next to the existing `isPerformanceOpen`. The two entry points:

1. **In gameplay (`progressionIndex === 2`): a gear in the dossier header button group**, next to
   Performance and Event log ([StakeholderDossier.tsx:1790](game-ui/src/components/StakeholderDossier.tsx:1790)).
   That header is the game's one persistent chrome, and all three gameplay stages already take an
   `onPerformanceToggle` prop from `Game.tsx`, so `onSettingsToggle` plumbs identically through
   `OfflineIntelGathering`, `PitchDebate` and `AcSimulation`. The gear belongs with its siblings
   rather than floating over the stage.
2. **Everywhere else: a small fixed gear, top right**, rendered by `Game.tsx` only when
   `progressionIndex !== 2`. The questionnaire, briefing and end screens have no dossier header,
   and the briefing is exactly where a player might first want to mute narration.

`Login`, `Register` and `Home` get nothing. Settings are per player and persist server-side, so
there is no account to attach them to before login.

### Settings panel

`game-ui/src/components/SettingsPanel.tsx` plus `.module.css`, rendered through the existing
`HeaderModal` (`closeLabel="settings"`). `HeaderModal` already owns the backdrop, Escape and the
close button.

Sections:

1. **Conversations**: "Auto-skip conversations" toggle, with a one-line description saying it
   hides speech bubbles and their audio, including the stakeholder introductions.
2. **Voice**: "Mute narration" toggle, then four dropdowns, one per voice slot: **male
   stakeholders**, **female stakeholders**, **narrator**, **you**. Each lists every installed
   `en-*` voice from `speechSynthesis.getVoices()`, sorted with `en-US` first, each with a "Hello
   world" preview button that speaks a sample in that voice at that slot's baseline pitch. The
   preview says something slot-appropriate rather than the literal string: the narrator preview
   reads a sentence of artifact-like prose, so the player hears what they are actually choosing.
   Dropdowns are disabled while muted. When no voices have loaded, replace the selects with the
   diagnostic line described under **Browser and OS coverage**.
3. **Account**: only when `canResetAccount`. A destructive-styled "Reset my account" button that
   opens a second-step confirmation inside the panel. It states plainly that all progress, intel,
   conversations and these settings are deleted and cannot be recovered, and requires typing the
   player's own username to enable the final button. A single "are you sure" is too easy to click
   through for something this irreversible.

### Auto-skip

Auto-skip means: no bubble renders, no hold timer runs, no audio plays. The underlying state
change still happens and the line still lands in the chat transcript, so nothing is lost; it is
only not performed.

Three call sites, all of which already funnel their bubbles through one place:

- `pitch_debate.tsx` `processSpeechQueue` ([pitch_debate.tsx:254](game-ui/src/components/pitch_debate.tsx:254)):
  when auto-skip is on, still apply `chatMsg` and the emotion/avatar update, then move to the
  next item on a minimal timeout instead of setting `activeSpeakingState` /
  `activePlayerSpeakingState`. The existing `skipCurrentSpeech` already proves the queue survives
  being drained early. Keep the `isSpeechActive()` contract intact so callers that gate on it do
  not hang.
- `PowerInterestMatrix.tsx` self-introduction bubbles ([PowerInterestMatrix.tsx:645](game-ui/src/components/PowerInterestMatrix.tsx:645)),
  including the round played inside `PrePhaseDialog`: do not start the intro queue at all when
  auto-skip is on. Clicking a chip still replays that one bubble, since that is an explicit
  request and not an auto-played conversation.
- `StakeholderInteractionArea.tsx` chat messages are a transcript, not a timed bubble, so
  auto-skip leaves them alone. It only suppresses their narration.

With auto-skip on, the skip bar in `pitch_debate.tsx` and the intro skip button hide themselves,
because there is nothing left to skip.

### Text-to-speech

`game-ui/src/utils/speech.ts`, a thin module over `window.speechSynthesis`.

`loadVoices(): Promise<SpeechSynthesisVoice[]>` resolves with `getVoices()` if non-empty,
otherwise waits on `speechSynthesis.onvoiceschanged` (Chrome loads voices asynchronously and
returns an empty array on the first call), with a timeout so a browser that never fires it does
not leave a pending promise.

`pickVoice(voices, slot, preferredName?)`: `preferredName` wins when it still resolves to an
installed voice. Otherwise match by regex on `voice.name`, since `SpeechSynthesisVoice` has no
`gender` property. Filter to `voice.lang.startsWith("en")` first and prefer `en-US`.

Note the `alex` collision below: it matches the male regex as a *voice name*, which is unrelated
to the `automation_alex` stakeholder id. Stakeholder gender comes from the config field, never
from the id.

#### Voice slots

Four slots, not two:

| slot | used for | baseline pitch | seeded per speaker |
| --- | --- | --- | --- |
| `male` | stakeholders with `voice: "male"` | `0.95` | yes |
| `female` | stakeholders with `voice: "female"` | `1.1` | yes |
| `narrator` | intel artifacts, and any non-character prose narrated later | `1.0` | no |
| `player` | the player's own speech bubbles in the pitch | `1.0` | no |

Stakeholders with `voice: "neutral"` fall to the narrator voice at pitch `1.0`, seeded, so they
are still distinguishable from each other without being forced into a gender.

Narrator and player are deliberately **not** seeded. They are one speaker each, and a wobbling
pitch on the voice that reads every artifact would just sound unstable. The narrator also reads
at a slightly lower rate (`0.95`) than character speech: artifacts are longer and denser than a
one-line bubble.

This reverses the earlier decision not to narrate player lines. With a dedicated player voice the
player's bubbles in `pitch_debate.tsx` are narrated like anyone else's.

`pitchFor(seed, slot)`: the baseline above, plus, for seeded slots, an offset in `[-0.15, 0.15]`
derived from a hash of the stakeholder id, clamped to `[0, 2]`. Deterministic rather than random,
so a stakeholder sounds the same every time they speak, within a session and across reloads.
That consistency is the whole point of giving them distinct pitches.

`speak(text, { slot, seed, voiceName, onEnd })` returns a cancel function; `cancelSpeech()` stops
everything. Strip markdown and the `{stakeholder_id}` template braces used in `introduction` copy
before speaking, and split long text at sentence boundaries into utterances of roughly 200
characters rather than queuing one long one (see the Chrome cutoff under **Browser and OS
coverage**). Cap total narrated length for an artifact so one long document cannot monopolise the
queue.

Every entry point is a no-op when `mute_tts` is on, when auto-skip suppressed the bubble, or when
`window.speechSynthesis` is undefined.

A `useSpeech()` hook wraps the module against the settings context and cancels on unmount.

#### Browser and OS coverage

The Windows and macOS voice sets are the easy case. Windows 10/11 ships Zira and Jenny (female),
David and Guy (male); macOS ships Samantha and Victoria (female), Alex and Fred (male). Linux and
Firefox both need explicit handling.

**Linux.** Browsers do not ship voices; they proxy `speech-dispatcher`. If it is not installed
there are no voices at all and `getVoices()` stays empty, which is a normal state on a bare
container or a minimal desktop, not an error. When it is installed, what surfaces depends on the
configured output module, and the names usually describe a *language*, not a person:
`espeak-ng` typically appears as entries like "English (America)", sometimes with variant
suffixes; Festival and Flite surface short voice ids such as `slt`, `clb` (female) and `awb`,
`rms`, `bdl`, `kal` (male); RHVoice and Piper add their own named voices. Because the exact list
varies by distribution and by setup, do not try to enumerate it. Instead:

- Add a Linux tier to the regexes: female picks up `/(slt|clb|eva|f[1-5]\b)/i`, male picks up
  `/(awb|rms|bdl|ksp|kal|m[1-5]\b)/i`, on top of the Windows and macOS names.
- When no name in the list matches either regex, which is the common Linux outcome, fall back to
  **one voice differentiated by pitch alone**. The male and female slots resolve to the same
  underlying voice at `0.95` and `1.1`. That degrades gracefully instead of silently giving every
  stakeholder an identical delivery.
- The four dropdowns still list everything installed, so a player on Linux who knows their setup
  can simply pick the right voices by hand. That is the real fix on Linux, and it is the reason
  the dropdowns list all `en-*` voices rather than only regex matches.

**Firefox.** It implements the Web Speech API synthesis side and fires `voiceschanged`, so the
async load path already covers it. Three differences to expect:

- On Windows, Firefox reads SAPI5 voices. The newer OneCore voices that Chrome and Edge expose
  (Jenny, Guy and the other "Microsoft ... Online" entries) may not appear, so a Firefox player
  typically sees a shorter list, often just Zira and David. The regex handles both, and the
  stored `voice_male` / `voice_female` may not resolve when a player switches browsers, which is
  exactly why `pickVoice` treats an unresolvable stored name as "fall back to the regex".
- On Linux, Firefox has the same `speech-dispatcher` dependency as Chrome, with the same empty
  list when it is missing.
- Firefox has no remote/network voices, so the Chrome long-utterance cutoff below does not apply,
  but chunking is harmless there.

**Chrome.** Voices load asynchronously and the first `getVoices()` call returns an empty array,
which `loadVoices()` already handles. Chrome's network-backed voices also stop after roughly 15
seconds of continuous speech, which is why long text is chunked at sentence boundaries rather
than sent as one utterance.

**Safari and iOS.** Voices are available synchronously, but the first utterance must follow a
user gesture. Arm speech on the first click or keydown anywhere in the app and drop, rather than
queue, anything that would have spoken before that. In practice every narration point in this
game already follows a click, so this only matters for a reload straight into a speaking screen.

**Diagnostics in the panel.** When `getVoices()` comes back empty, the voice section replaces the
dropdowns with a plain line naming the likely cause for the platform: on Linux, that
`speech-dispatcher` is not installed; elsewhere, that the browser reports no speech voices. A
player should not be left looking at four empty selects wondering what they broke.

Wiring:

- `pitch_debate.tsx`: speak in `processSpeechQueue` when the bubble is set. Stakeholder lines use
  the speaker's configured slot and are seeded on their id; player lines use the player slot.
  `skipCurrentSpeech` and `clearSpeechTimers` call `cancelSpeech()`.
- `PowerInterestMatrix.tsx`: speak each self-introduction as its bubble opens, cancel when it
  closes or is skipped.
- `StakeholderInteractionArea.tsx` is **not** a separate wiring point after all: its `chatMsgs`
  are the same messages `pitch_debate.tsx`'s speech queue already speaks (its only consumer in
  this codebase), so a second speak-on-arrival call here would double-narrate every line. Left
  untouched.
- Intel artifacts (revised): narrated in the artifact's own author's voice - `slotForStakeholderVoice`
  on the stakeholder's configured gender field, seeded on `stakeholder_id` - rather than always the
  narrator slot. An artifact with no `stakeholder_id` (a System/environment fact) still falls to
  **narrator**. On first view only. The deck is
  [offline_intel_gathering.tsx:788](game-ui/src/components/offline_intel_gathering.tsx:788);
  track spoken artifact keys in a ref keyed the same way the viewer is (`currentArtifactKey`), so
  paging back does not re-narrate. `PerformanceDashboard.tsx` also renders `IntelArtifactViewer`,
  but that is a reference lookup rather than a first reveal, so it stays silent. Narrate
  `content` only, not the surrounding chrome.
- Per-utterance stop: a small button in the offline intel gathering header, next to the artifact
  navigation pills, shown only while the current artifact is actually being read aloud. It cancels
  just that one reading via the same per-call cancel `speak()` returns - separate from the settings
  panel's global `mute_tts` toggle, and it does not prevent later artifacts from narrating.

Bubble hold durations stay as they are. Tying them to speech end would change pacing for everyone
the moment a voice is missing, and the durations are already length-derived.

### Frontend tests

Vitest, alongside the existing `*.test.tsx` files:

- `speech.test.ts`: regex matching picks the expected voice per slot from stubbed Windows, macOS
  and Linux voice lists; a stored `preferredName` wins; an unknown stored name falls back to the
  regex; a list with no gender signal at all resolves male and female to the same voice at
  different pitches; pitch is deterministic per seed and stays within `[0, 2]`; narrator and
  player pitches do not vary by seed; `loadVoices` resolves through `onvoiceschanged` and through
  its timeout; long text chunks at sentence boundaries; everything degrades to a no-op with no
  `speechSynthesis`.
- `SettingsPanel.test.tsx`: the account section is absent when `canResetAccount` is false; the
  final reset button stays disabled until the username is typed; an empty voice list renders the
  diagnostic line instead of four empty selects.

## Config and docs

- `game-api/.env.example`: `ENABLE_RESET_USER` is already there. Reword the comment so it
  describes the player-facing reset in the settings panel, not an admin action.
- `INSTALL_AND_USAGE.md`: note the flag and what the panel exposes.
- No host installs. Backend tests run with `docker compose exec api pytest tests/ -q`, frontend
  tests with `docker compose exec ui npm test`.

## Order of work

1. Migration, model, `config.py` flag and table name.
2. Settings service plus its tests.
3. Websocket handler, `EVENT_REGISTRY`, `game:init_data` field.
4. `reset_player` in `admin_service.py` plus its tests.
5. `voice` field in stakeholder config, schema and domain.
6. `speech.ts` plus its tests, standalone and verifiable before anything calls it.
7. `SettingsProvider`, `SettingsPanel`, the dossier header gear and the fixed gear for the
   non-gameplay screens.
8. Auto-skip at the three call sites.
9. Narration at the four call sites.
10. Docs.

Steps 1 to 5 are backend-only and land independently of 6 to 9.

## Decisions taken

- `user_settings` carries a `user_id` FK with `ON DELETE CASCADE`, so a reset also returns the
  settings to defaults. The `localStorage` mirror is cleared alongside it.
- Auto-skip suppresses the stakeholder introductions as well as in-challenge conversations.
- Stakeholder pitch is deterministic per id, not random per utterance.
- The dropdowns list every installed `en-*` voice, not only regex matches. On Linux that is
  frequently the only way a player gets two distinguishable voices.
- Four voice slots: male, female, narrator, player.

## Open questions

- Should the narrator also read phase briefings and challenge introductions? The slot exists for
  it and the text is already prose rather than dialogue, but this plan wires the narrator only to
  intel artifacts. Adding briefings later is a one-line call site.
- Linux with `speech-dispatcher` present but no gender-distinct voices falls back to one voice at
  two pitches. If that reads as a gimmick in playtesting, the alternative is to drop gender
  differentiation entirely on such setups and let the pitch seed do all the work.
