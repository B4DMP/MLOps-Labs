# 12 Delete the dead CME dialogue code

Depends: [11](11-dialogue.md). Tracked in [STATE.md](STATE.md).

Plan 11 replaced the old LangGraph "CME" (conversation/message-exchange) pitch dialogue system
with the event-driven pitch/gather/voicing system (`session.py`, `gather.py`, `voicing.py` /
`voicing_prompts.py`, the event log). This plan is the inventory and order of operations for
actually deleting what that replaced. **Not started** - this document defines the cut, it does
not perform it.

## Why the whole thing is dead, not just the pieces plan 11 named

Plan 11's own "Deleted" section named seven items. Auditing the actual call graph before cutting
anything found the true scope is bigger: the entire old system is reachable only through the
`chat:send_message` websocket event, and **nothing in `game-ui` ever emits `chat:send_message`**
(confirmed by grepping all of `game-ui/src` for any `emit`/`send` of it - zero hits). The frontend
only ever `subscribe`s to `chat:message_received` (`Game.tsx:478`), listening for a message that
can now never arrive. So the LangGraph node graph behind it - `nodes.py`, `chains.py`'s two
player-prompt chains, `prompts.py`'s two player-prompt templates, `state.py`'s `DialogueOption`
plumbing, `chat_handler.py` - is unreachable at runtime, not merely superseded.

Two pieces of that dead system are still *called*, but only for side effects that outlived their
original purpose, and need a decision (see "Open questions") rather than a blind delete:

- `reset_thread(session_id)` (`service.py`) runs on every `game:state_update_request`
  (`router.py:115`), resetting a LangGraph checkpoint thread nothing populates anymore.
- `reset_conversation_state()` (`service.py`) backs the live `POST /reset-memory` REST endpoint
  (`api.py:74-81`).

## Inventory

### 1. `determine_dialogue_options`
- Defined: `game-api/src/mlops_serious_game/application/intel_handler.py:1348-1431`.
- Called from `game_handler.py:230` (`get_dialogue_options`, itself only reached from
  `handle_game_init`'s payload assembly, `game_handler.py:419-425`, gated on
  `last_gamestate_id[2] == 2`) and from `pitch_debate_service/service.py:288-289`
  (`get_response`, the CME turn handler).
- Frontend never reads the result: `Game.tsx:774` writes it into `[, setDialogueOptions]`, a
  setter whose value is never read back anywhere in `Game.tsx`.
- Tested only by the dead-code test `test_facial_expression_mapping.py:100,118,130,150`.
- **Safe to delete** once its two call sites (`game_handler.get_dialogue_options`,
  `service.get_response`) are removed with it.

### 2. `DialogueOption` (do not confuse with the still-live `DialogueOptionSpec`)
- Backend: `pitch_debate_service/state.py:10-30` (the type), plus its use as
  `PitchDebateState.dialogue_options` / `.last_selected_option` (`state.py:83,86`),
  `nodes.py:19,123`, `intel_handler.py:34,1350,1356,1402,1422`, eleven references through
  `service.py`, `game_handler.py:32`, exported from `pitch_debate_service/__init__.py:16,31`.
- Frontend: whole file `game-ui/src/types/DialogueOption.ts` (`DialogueOptionArchetype`,
  `DialogueOption`), imported by `Game.tsx:30` (write-only, as above) and
  `StakeholderInteractionArea.tsx:18,59,77` (props only ever passed `showDialogueOptions={false}`
  - see item 6).
- Tests: `test_pitch_debate_cme.py:10`, `test_facial_expression_mapping.py:4,76,87`, the root
  dev script `stakeholder_cme_test.py`.
- **`objections.DialogueOptionSpec` is a separate, live type** powering Face the room's
  Amend/Reframe options via `dialogue_options_for()` (`session.py:320`, tested in
  `test_pitch_scoring.py::TestDialogueOptionsFor`). Do not touch it - only the name is similar.
- **Safe to delete** on both ends once callers above are removed.

### 3. The `dialogue_options` LangGraph channel
- `state.py:83` (`PitchDebateState.dialogue_options: list[DialogueOption]`).
- Read/written at checkpoint time: `service.py:58,164,292,295`.
- Serialized into `chat:message_received` by `chat_handler.py:392-393,409,435`, and into
  `game:init`'s payload under `"dialogue_options"` by `game_handler.py:420`.
- Frontend: write-only in `Game.tsx:463-465,604-606`, as above.
- **Safe to delete** once `chat:send_message`'s handler chain goes; if any part of
  `chat_handler.py` survives cleanup for another reason, strip the `dialogue_options` key from
  its emitted payload rather than leaving a channel that always sends an empty list.

### 4. `get_checkpoint_dialogue_options` / `save_checkpoint_dialogue_options`
- `service.py:47-70` and `service.py:73-90`.
- Only caller: `game_handler.py:33-34,218,233`. Exported from
  `pitch_debate_service/__init__.py:9,13,26,30`.
- **Safe to delete** - their only call site is item 1's, already dead.

### 5. `corporate_noise_rules`
- Config: `gameConfig/EmotionValueConfig.json:316`, schema
  `gameConfigSchemas/EmotionValueConfig.schema.json:135`.
- Backend: one field read, in `domain/emotion_factory.py:278-279`, inside
  `calculate_emotion_deltas`. That function's only caller is `nodes.py:125`, itself dead.
- **Safe to delete** - config key, schema entry, and the one reader. Don't touch anything else in
  `emotion_factory.py`; its other methods are live and heavily used.

### 6. The old options grid in `StakeholderInteractionArea.tsx`
- The whole `{showDialogueOptions && (...)}` block, lines 386-516, plus the props
  `onSelectDialogueOption` (58, 77), `dialogueOptions` (59), `showDialogueOptions` (68, 87,
  currently defaults `true`), plus the `import type { DialogueOption }` at line 18.
- `StakeholderInteractionArea` is mounted in exactly one place in the shipped UI,
  `pitch_phase.tsx:1601` (now inside the Conversation history tab of the side rail, see plan 11
  step 10 / the event-log side-rail rework), always with `showDialogueOptions={false}`. No other
  caller exists anywhere in `game-ui/src`.
- **Safe to delete** the block and the three dialogue-option props/callback.

### 7. `game-ui/src/types/DialogueOption.ts`
- Only imported by `Game.tsx:30` and `StakeholderInteractionArea.tsx:18`, both dead per above.
- **Safe to delete** the whole file once those two imports are removed.

### 8. `PLAYER_UTTERANCE_*` / `PLAYER_KICKOFF_*` (found this session, not in plan 11's original list)
- Prompts: `prompts.py:3-45` (`PLAYER_UTTERANCE_SYSTEM_PROMPT`, `PLAYER_UTTERANCE_HUMAN_PROMPT`,
  `PLAYER_UTTERANCE_PROMPT`) and `prompts.py:47-71` (`PLAYER_KICKOFF_SYSTEM_PROMPT`,
  `PLAYER_KICKOFF_HUMAN_PROMPT`, `PLAYER_KICKOFF_PROMPT`).
- Chains: `chains.py:89-93` (`get_player_utterance_chain`), `chains.py:96-100`
  (`get_player_kickoff_chain`). Both called only from `nodes.py:14-16,160,216`
  (`player_prompt_node`), itself only reachable via the dead `chat:send_message` path.
  `PLAYER_UTTERANCE_PROMPT` is also re-exported from `pitch_debate_service/__init__.py:6,36`;
  nothing outside the package imports it.
- Superseded by `voicing.py` / `voicing_prompts.py` (`PLAYER_ANSWER_PROMPT`,
  `STAKEHOLDER_REPLY_PROMPT`, `_get_chat_model`), which power the live Face the room voicing
  (plan 11 step 5).
- **Keep** `chains.py` itself and its `get_chat_model`, `get_wrong_intel_chain`,
  `get_intel_artifact_chain` - the latter two are live, called from `intel_handler.py:52,803`.
  Only remove the two player-prompt chains and the six `PLAYER_UTTERANCE_*`/`PLAYER_KICKOFF_*`
  prompt constants.

### Dead-only test files
- `game-api/tests/test_pitch_debate_cme.py` - imports `DialogueOption`, asserts on
  `output_state["dialogue_options"]`. Tests only the dead system; delete alongside it.
- `game-api/tests/test_facial_expression_mapping.py` - imports
  `determine_dialogue_options`/`DialogueOption`. Same.
- **Not dead - do not confuse:** `test_pitch_scoring.py::TestDialogueOptionsFor` tests the live
  `objections.dialogue_options_for`. Keep.

### Dev-only scripts, not part of the app or CI (flagged, not scoped in)
`game-api/stakeholder_cme_test.py` (root-level manual CLI harness, defines its own
`DialogueOption`-consuming code), `game-api/api_live_test.py`,
`game-api/action_card_generation_test.py`, `game-api/notebooks/short_term_memory_in_action.ipynb`,
`game-api/tools/persona_gym/code/utils.py`. None of these run in CI or ship with the app, but they
import the dead system directly and will break once it's gone. Whether to delete, update, or
leave them broken is a scoping call for whoever executes this plan - not a safety concern for the
main deletion.

## Open questions

- **`reset_thread` / `reset_conversation_state`**: both remain live call sites in `service.py`
  (see "Why the whole thing is dead" above) even after every dialogue-producing path is deleted.
  Decide whether phase transitions and `POST /reset-memory` still need to reset a LangGraph
  checkpoint thread at all once nothing writes to it, or whether this is itself dead hygiene from
  the old system that should go too. Whoever executes this plan should re-check call sites first
  - this plan may be stale by then.
- **`chat_handler.py` / `graph.py` / `create_pitch_debate_graph`**: once every node in
  `nodes.py` is unreachable, decide whether to delete `chat_handler.py`'s `handle_chat_message`
  entirely (and its `chat:send_message` registration in `router.py:12,55,117`) or keep a stub for
  some other reason. Nothing in the current UI depends on the answer either way.

## Steps

- [ ] 1. Remove `determine_dialogue_options`, `get_dialogue_options`, `get_checkpoint_dialogue_options`,
      `save_checkpoint_dialogue_options` and their call sites in `game_handler.py` and
      `pitch_debate_service/service.py`.
- [ ] 2. Remove `DialogueOption`/`dialogue_options` from `state.py`, `nodes.py`, `intel_handler.py`,
      `service.py`, `pitch_debate_service/__init__.py`'s exports.
- [ ] 3. Remove `PLAYER_UTTERANCE_*`/`PLAYER_KICKOFF_*` from `prompts.py` and their chains from
      `chains.py`; keep the rest of both files.
- [ ] 4. Remove `corporate_noise_rules` from `EmotionValueConfig.json` and its schema, and the one
      reader in `emotion_factory.py`.
- [ ] 5. Delete the old options grid, its props and callback from `StakeholderInteractionArea.tsx`;
      delete `game-ui/src/types/DialogueOption.ts`; remove the now-dead `dialogueOptions` state
      and import from `Game.tsx`.
- [ ] 6. Resolve the two open questions above (reset hygiene, `chat_handler.py`/`graph.py`
      disposition), then delete or update whatever they land on.
- [ ] 7. Delete `test_pitch_debate_cme.py` and `test_facial_expression_mapping.py`. Leave
      `test_pitch_scoring.py` untouched.
- [ ] 8. Decide the fate of the flagged dev-only scripts (delete, update, or explicitly leave)
      and act on that decision.
- [ ] 9. Full backend test suite green, `tsc -b --noEmit` clean, ESLint clean on touched files.
      Check this plan's steps and 11's step 11 off in [STATE.md](STATE.md).

## Done when

Nothing in the codebase references `determine_dialogue_options`, `DialogueOption` (the dead
type), the `dialogue_options` channel, `corporate_noise_rules`, or the old options grid. The
backend test suite and frontend typecheck/lint are clean. The two open questions above are
resolved, not left dangling.
