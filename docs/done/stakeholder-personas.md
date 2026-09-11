# Stakeholder personas

## Problem

Every player met the same six people. Data Dave, Model Monica, Requirements Reuben, Efficiency
Emilia, Automation Alex and Reliability Ruth, in that order, with the same faces every run. The
names were also spelled out in about 250 config strings, so they could not be changed without a
sweep through five JSON files.

## Fix

A stakeholder keeps its `id`, `metric_id`, prose and identity colors. What varies per player is a
**persona**: a name plus the person-level half of the avatar, bundled so the two stay coherent.
Each player is dealt one persona per stakeholder when their session record is created, and keeps it
for the whole game.

Names stay alliterative with the role word and keep the gender of the canonical persona. Data Dave
can become Data Dominic, never Data Steve, and never someone the existing prose would misgender.

## Config

`gameConfig/GameStakeholders.json`:

```json
{
  "id": "data_dave",
  "name": "Data Dave",
  "avatar": { "face": "smile", "emotion": "smile",
              "clothingColor": "0d6efd", "backgroundColor": "d1d4f9" },
  "personas": [
    { "key": "dave", "name": "Data Dave",
      "avatar": { "head": "short1", "accessories": "glasses", "accessoriesProbability": 100,
                  "facialHair": "goatee1", "facialHairProbability": 100,
                  "skinColor": "ffdbb4", "headContrastColor": "2c1b18" } },
    { "key": "dominic", "name": "Data Dominic", "avatar": { ... } }
  ]
}
```

The base `avatar` holds what identifies the *role*: the clothing and background colors the UI reads
as `stakeholder_color`, plus the default expression. The persona holds what identifies the
*person*: head, accessories, facial hair, skin and hair color. The rendered avatar is
`{...base, ...persona}`, so the color coding players learn to recognize never shuffles.

`name` stays as the canonical fallback for anything running without a player session.

## Tokens

Config prose never spells a name out:

```
"{model_monica} mandates 95% accuracy, and {model_monica.first} won't budge."
```

`{id}` renders the full name, `{id.first}` the given name. Challenge descriptions keep their
`#id#` highlight markers, which the UI already resolves against the stakeholder list.

`domain/persona_resolver.py` renders these against a persona map carried in a context variable.
With nothing bound every function is the identity, so tests, config validation and tooling keep
seeing the canonical text.

## Where it is applied

Server-side only, in the factory getters, so the UI and the language model always agree on who is
in the room:

| Getter | What it renders |
|---|---|
| `StakeholderFactory.get_stakeholder` / `get_all_stakeholders` | name, avatar, all prose fields |
| `RequirementFactory.get_requirement*` | requirement descriptions |
| `OfflineIntelArtifactFactory.get_*` | artifact content, wrong descriptions, stakeholder name and role |

`get_stakeholder` also resolves *by* persona name, because a language model only ever hears the
personalized name and hands it back that way.

Text headed to a model rather than the UI is rendered with `resolve_markers=True`, which turns
`#data_dave#` into the plain name.

`OfflineIntelArtifacts.json` no longer stores `stakeholder_name` and `stakeholder_role`. Both are
the stakeholder's, both move with the persona, and two copies could drift apart.

## Persistence

`GameSession.stakeholder_personas` holds `{stakeholder_id: persona_key}`, alongside the existing
`stakeholder_archetypes`. Filled in `get_or_create_game_session`, bound for the connection in the
websocket router.

`StakeholderFactory.choose_personas` seeds `random.Random(f"{player}:{stakeholder_id}")`, one seed
per stakeholder. That makes the draw reproducible if a session record is lost, and lets a
stakeholder added later be back-filled on its own instead of recasting the team mid-game. A stored
key that is no longer in the config is re-drawn.

## Adding a persona

Append to that stakeholder's `personas`. Alliterative with the role word, same gender as the
canonical persona, and an `avatar` covering only the person-level keys. Nothing else to change:
players already mid-game keep the persona they were dealt.

## Schema migrations on startup

The persona column was the first migration that mattered to a running database,
and nothing was applying migrations. `init_db` calls `Base.metadata.create_all`,
which creates missing tables but never alters an existing one, so the column
would simply have been absent.

`infrastructure/database/migrations.py` now runs on startup, before `init_db`,
and branches on where the database starts from:

| State | Action |
|---|---|
| `alembic_version` present | `upgrade head` |
| Empty | `upgrade head`, the chain builds the schema from `0001_initial_schema` |
| Tables but no `alembic_version` | stamp `0001_initial_schema`, then `upgrade head` |

The third case is a schema built by `create_all` before this project used
alembic. `0001` cannot be replayed over it because it creates tables that
already exist, but every revision after `0001` only ALTERs and guards its own
DDL, so replaying from the baseline picks up whatever columns are missing.

Revisions `0002`, `0003` and `8927ffa2e44b` were unguarded and would have failed
that replay: they target `game_data`, which `b2c3d4e5f6a7` renamed and which a
model-built database never had. They are now wrapped in an `IF EXISTS` check, so
they no-op instead. **Keep new revisions replayable the same way**: `IF EXISTS` /
`IF NOT EXISTS` on DDL, and idempotent data migrations.

Set `AUTO_MIGRATE=false` to manage the schema by hand instead.
