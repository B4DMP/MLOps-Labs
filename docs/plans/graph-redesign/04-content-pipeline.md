# 04 Content Pipeline

Depends: [02](02-intel-taxonomy.md), [03](03-antipatterns-and-selection.md). Tracked in [STATE.md](STATE.md).

The long pole. Precondition driven selection plus the new taxonomy plus deterministic objections means the whole content set is regenerated. If this pipeline is weak, nothing else ships.

## What has to exist per challenge template

```
challenge template   preconditions, on_enter_ops, focus nodes, intro text
requirements         6 to 10 per challenge, tagged with category and subtype
                     Position items carry component_targets
                     Evidence items carry asserts or caps
                     Leverage items carry archetype_hint or relates_to
artifacts            1 per requirement, email / slack / meeting notes / document
objections           per stakeholder per uncovered Position item, see 06
```

Target: 3 to 5 templates per phase, 6 phases. Roughly 25 templates, 200 requirements, 200 artifacts, 300 objection lines.

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
templates      graph + antipatterns + stakeholders -> challenge templates with preconditions
requirements   template + graph slice + conflict  -> requirements with component targets
artifacts      requirement -> artifact prose in stakeholder voice
objections     requirement + stakeholder -> objection lines and response text
```

Each stage writes JSON plus a review CSV. Human review between stages, recorded by flipping ledger rows to `rejected` with a note, which queues them for regeneration with the reviewer comment fed back into the prompt. Nothing is generated at runtime.

## Validation gates (all blocking)

1. **Blind reclassification.** A second model sees only the artifact text and must recover the authored subtype. Mismatch means regenerate. Target 95 percent first pass agreement.
2. **Component reachability.** Every Position item targets a component that exists, at an allowed level, in a node that is in scope for its phase.
3. **Orphan components.** Every component is targeted by at least one Position item somewhere in the game, otherwise it can never be raised.
4. **Story fragments.** Every reachable component and level pair has a fragment.
5. **Fallback challenge.** One per phase.
6. **Objection coverage.** Every Position item has an objection line for its owning stakeholder.
7. **Conflict sanity.** Every challenge template declares a `conflict` with two stakeholders on opposing levels of one component. This formalises the framing conflict the game already writes for each challenge. Without it the objection round has no teeth.
8. **Voice check.** Artifact mentions no stakeholder outside its own scene, no markdown, no dashes.

## Conflict

Conflicts are not a separate file. Each challenge template carries its own `conflict` block ([03](03-antipatterns-and-selection.md)), which is the existing narrative framing conflict written as two opposing component levels. Generation stage 2 takes it as input, so the requirements it writes actually sit on both sides of it. The objection round reads it for Trade and Stonewall.

## Migration

Old `RequirementObjects.json` is not migrated. It is regenerated. Keep the old file at `gameConfig/legacy/` for reference until [06](06-merged-phase.md) is `DONE`, then delete.

## Steps

- [ ] 1. Harness: work item model, input hashing, sqlite ledger, CLI with run, status, validate, diff.
- [ ] 1b. Concurrency, retry, budget cap, clean SIGINT, Opik tagging, dry run.
- [ ] 2. Stage 1 templates, human review. BLOCK until reviewed.
- [ ] 3. Stage 2 requirements, human review. BLOCK until reviewed.
- [ ] 4. Stage 3 artifacts.
- [ ] 5. Stage 4 objections.
- [ ] 6. Stage 5 validation, all eight gates, wired into `make` and CI.
- [ ] 7. Author the `conflict` block on every challenge template, derived from the existing framing conflicts.
- [ ] 8. Full regeneration run, commit content.

## Done when

`make validate-content` passes on a fully regenerated set, a killed run resumes without duplicate work, a prompt edit invalidates only its own items, and a fresh player can be walked through two phases on generated content alone.
