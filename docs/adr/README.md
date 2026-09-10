# Architecture decision records

One file per decision that is expensive to reverse or easy to break by accident.
Named `NNNN-short-title.md`, numbered in order, never renumbered. A superseded
record stays and says what replaced it.

Sections: Status, Context, Decision, Consequences.

| # | Decision |
|---|---|
| [0001](0001-replayable-alembic-migrations.md) | Migrations run on startup and must be replayable |
