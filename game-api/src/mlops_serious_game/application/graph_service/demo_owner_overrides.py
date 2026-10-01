"""Display-only component ownership for the demo phase.

The demo phase borrows the real "data" stage's components to show the graph off, but its own
room is bear_bruce/mohawk_mark, not that stage's real owner (data_dave) - so the owner shown to
the player there is overridden to match who is actually in the room. Gameplay (buy-in,
degradation, replay) still resolves through graph.owner_of untouched: this never leaves the demo
phase's own views, and never touches the real Data Engineering phase that reuses the same stage.
"""

DEMO_OWNER_OVERRIDES = {
    "data.ingestion": "bear_bruce",
    "data.versioning": "bear_bruce",
    "data.labeling": "bear_bruce",
    "data.training_drift_check": "bear_bruce",
    "data.validation": "mohawk_mark",
    "data.feature_store": "mohawk_mark",
}
