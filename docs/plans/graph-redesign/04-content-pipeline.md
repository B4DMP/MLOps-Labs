# 04 Content Pipeline

Depends: [02](02-intel-taxonomy.md), [03](03-patterns-and-selection.md). Tracked in [STATE.md](STATE.md).

The long pole. Precondition driven selection plus the new taxonomy plus deterministic objections means the whole content set is regenerated. If this pipeline is weak, nothing else ships.

## What has to exist per challenge template

```
challenge template   preconditions on patterns, on_enter_ops, stalemate_ops, conflict with type, focus stages, intro
stance items         6 to 10 per challenge: Driver, Boundary, Trade-off, with payloads per 02
fact items           3 to 6 per challenge, on targets in the focus stages
artifacts            1 per item: stakeholder types for stances, technical types for facts
objections           per (stakeholder, target, kind): stance, boundary, price, technical, correction, see 06
```

Target: 3 to 5 templates per phase, 6 phases. Roughly 25 templates, 200 stance items, 120 facts, 320 artifacts, 400 objection lines. Plus one-off: patterns, story fragments for 34 components and ~40 edges.

## Tier 0

v1 ships a **minimal content set first** (D29). It exercises every mechanic once and is verified end to end before the full run. The full set is the same harness with a wider scope, not a different process.

| content | tier 0 |
|---|---|
| phases | 2: Data and Modeling. Tests cross-phase chains, fog carry-over, selection by preconditions |
| templates | 2 per phase plus the fallback. One `soft` conflict, one `hard` conflict |
| stakeholders | 3 per phase, at least one high power |
| per template | every tag at least once (Driver, Boundary, Trade-off, Fact), one technical objection path, one world event, `stalemate_ops` |
| chains | at least one refinement chain crossing the two phases |
| patterns | about 6: 3 anti, 3 design, at least one of each flippable by tier 0 cards |
| graph | full 34 component skeleton, only Data and Modeling need Drivers and fragments |
| fragments | level fallbacks only, for the components tier 0 touches |

Gates run scoped: orphan and fragment gates check only the tier 0 scope, set with `--scope tier0`.

Tier 0 is done when a fresh player plays both phases on it, pass, soft pass, veto and stalemate are each reached in test runs, and the admin view shows no orphans in scope.

## Generation harness

Not a pile of scripts. One progress aware, cancellable, resumable job runner over the LLM API already in use (langchain plus the Opik tracer), living in `game-api/tools/content_gen/`. Can be CLI-based, since it's not part of gameplay. 

### Unit of work

Every generated artefact is one **work item** with a deterministic id and an input hash:

```python
@dataclass
class WorkItem:
    stage: str            # templates | requirements | artifacts | objections
    item_id: str          # ch_data_quality_crisis / req_.../ art_...
    input_hash: str       # sha256 of prompt + inputs + model id + prompt version
    depends_on: list[str]
```

`input_hash` is what makes resume correct. Changing the graph config or a prompt invalidates exactly the items that depend on it, nothing more.

### Ledger

`content_gen/.ledger.sqlite`, one row per work item:

```
item_id | stage | input_hash | status | attempts | tokens_in | tokens_out | cost | model | output_path | error | updated_at
status in: pending | running | done | failed | stale | rejected
```

Rules:
- run start marks items `stale` whose `input_hash` no longer matches, leaves `done` items alone
- `running` rows older than a timeout are reset to `pending` on the next start, so a killed process self heals
- output is written to its file first, ledger row flipped to `done` second. Crash between the two costs one regeneration, never a corrupt set

### CLI

```
python -m content_gen run            --stage artifacts --limit 50
python -m content_gen run            --resume                  # default
python -m content_gen run            --force --only req_data_*
python -m content_gen status                                   # counts per stage, cost so far, eta
python -m content_gen validate
python -m content_gen diff                                     # what a config change would invalidate
```

- SIGINT finishes in flight items, flushes the ledger, exits clean. Rerun continues.
- bounded concurrency with a semaphore, retry with backoff on rate limits, per run token and cost budget that stops the run when hit
- every call tagged in Opik with `item_id` and `input_hash` so a bad batch is traceable
- `--dry-run` prints the plan and the estimated cost without calling anything

### Stages

```
templates      graph + patterns + stakeholders    -> challenge templates with preconditions and conflict
items          template + graph slice + conflict   -> stance items with payloads, fact items
artifacts      item -> artifact prose, stakeholder voice for stances, technical voice for facts
objections     item + stakeholder + kind           -> objection lines
fragments      graph                               -> story fragments per target, level, trigger
```

Each stage writes JSON plus a review CSV. Human review between stages, recorded by flipping ledger rows to `rejected` with a note, which queues them for regeneration with the reviewer comment fed back into the prompt. Nothing is generated at runtime.

## Validation gates (all blocking)

1. **Blind reclassification.** A second model sees only the artifact text and must recover the authored tag (Driver, Boundary, Trade-off, Fact). Mismatch means regenerate. Target 95 percent first pass agreement, expect Driver versus Boundary to fail most.
2. **Target reachability.** Every Driver, Trade-off and Fact targets a component or edge that exists, at an allowed level. Every Boundary predicate parses and references existing targets.
3. **Orphans.** Every component and pipeline edge is targeted by at least one Driver somewhere in the game and appears in at least one pattern.
4. **Story fragments.** Every reachable component level and edge level has a fragment.
5. **Fallback challenge.** One per phase.
6. **Objection coverage.** Every stance item has its objection lines, every component has a technical objection line for its owner.
7. **Conflict sanity.** Every template declares a `conflict`. `soft` requires a matching Trade-off item for the losing side, `hard` a matching Boundary. Formalises the framing conflict the game already writes per challenge.
8. **Voice check.** No stakeholder outside its own scene, no markdown, no dashes. Fact artifacts state no wish, refusal or acceptance.
9. **Graph gate.** Pipeline edges form a DAG, every trigger is allowed on its edge.

## Conflict

Conflicts are not a separate file. Each challenge template carries its own `conflict` block ([03](03-patterns-and-selection.md)), which is the existing narrative framing conflict written as two opposing component levels. Generation stage 2 takes it as input, so the requirements it writes actually sit on both sides of it. The objection round reads it for Trade and Stonewall.

## Migration

Old `RequirementObjects.json` is not migrated. It is regenerated as stance and fact items. Keep the old file at `gameConfig/legacy/` for reference until [06](06-merged-phase.md) is `DONE`, then delete.

## Steps

- [x] 0. Define the tier 0 scope in config, scoped gates (`tools/content_gen/scopes.json`).
- [x] 1. Harness: work item model, input hashing, sqlite ledger, CLI with run, status, review, approve, reject, validate, diff, assemble.
- [x] 1b. Concurrency, retry with the gate errors as feedback, budget cap, clean SIGINT, Opik tagging, dry run.
- [ ] 2. Stage templates, human review. BLOCK until reviewed.
- [ ] 3. Stage items, human review. BLOCK until reviewed.
- [ ] 4. Stage artifacts.
- [ ] 5. Stage objections.
- [ ] 5b. Stage fragments.
- [ ] 6. Validation gates implemented (`content_gen validate`); wiring into `make` and CI still open.
- [ ] 7. Author the `conflict` block on every challenge template, derived from the existing framing conflicts.
- [ ] 8. Tier 0 run, commit, verify end to end. Playtests of 05 to 07 run on it.
- [ ] 9. Full regeneration after the tier 0 playtest, commit content.

## Done when

`make validate-content` passes on a fully regenerated set, a killed run resumes without duplicate work, a prompt edit invalidates only its own items, and a fresh player can be walked through two phases on generated content alone.

## Implementation notes

- Every stage checks its output with the game's own logic before writing it: predicates and ops against the graph, the payload gate, the challenge's world event must visibly damage the focus stage, Facts must be true right after it, the conflict must be answerable (soft) or blocked (hard), the fact of an item never says why.
- Items are written with split wording (fact plus reading, see [../intel-description-split.md](../intel-description-split.md)); wrong-tag variants are readings only.
- Ledger paths are relative to the work dir, so a run inside the container can be reviewed and assembled on the host.
- Assembly marks generated challenges and `gen_` items so re-assembly replaces exactly them, and keeps challenge ids stable in `work/assembly_ids.json`.
- The orphan gate is a warning in tier 0 (`orphans_block: false`) and blocking in the full scope.
