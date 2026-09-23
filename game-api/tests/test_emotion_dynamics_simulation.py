"""Simulation and validation test for stakeholder emotion dynamics under the redesigned pitch & card system.

Validates that:
1. Emotion deltas properly reflect Action Card alignment (Drivers, Trade-offs, Boundaries) modulated by Power and Interest.
2. Positive card alignment produces positive emotion shifts (happiness, enthusiasm, relief).
3. Category-specific misclassification maluses apply realistically upon pitch refutation.
4. All 9 defined emotional states in EmotionValueConfig.json (enthusiastic, relieved, neutral,
   skeptical, frustrated, anxious, angry, apathetic, overwhelmed) can be achieved through realistic scenarios.
5. Dynamics across multiple phases (Phase 0, Phase 1, Phase 2) behave sensibly in context.
"""

from __future__ import annotations

import json
from pathlib import Path
import pytest

from mlops_serious_game.domain.emotion import EmotionValues, apply_emotion_delta
from mlops_serious_game.domain.emotion_factory import EmotionFactory


CONFIG_DIR = (Path(__file__).resolve().parent.parent / "../gameConfig").resolve()


def load_game_progression():
    with open(CONFIG_DIR / "GameProgression.json", "r", encoding="utf-8") as f:
        return json.load(f)


def load_requirements():
    with open(CONFIG_DIR / "RequirementObjects.json", "r", encoding="utf-8") as f:
        return json.load(f)["requirements"]


# ---------------------------------------------------------------------------
# Redesigned Emotion Calculation Engine
# ---------------------------------------------------------------------------

PITCH_SENSITIVITY_WEIGHTS = {
    "trust": 0.25,
    "fairness": 0.28,
    "sense_of_control": 0.25,
    "stress": -0.22,
    "perceived_risk": -0.20,
    "confidence": 0.18,
    "interest": 0.10,
}

BOUNDARY_BREACH_DELTA = {
    "perceived_risk": 0.25,
    "stress": 0.20,
    "trust": -0.20,
    "sense_of_control": -0.15,
}

MISCLASSIFICATION_MALUS = {
    "trade_off_as_driver": {
        "fairness": -0.15,
        "sense_of_control": -0.15,
        "stress": 0.10,
    },
    "driver_as_boundary": {
        "fairness": -0.20,
        "trust": -0.15,
        "stress": 0.15,
    },
    "boundary_as_driver": {
        "perceived_risk": 0.25,
        "stress": 0.20,
        "trust": -0.20,
        "fairness": -0.10,
        "sense_of_control": -0.15,
    },
    "fact_as_stance": {
        "confidence": -0.25,
        "trust": -0.15,
        "stress": 0.05,
    },
    "stance_as_fact": {
        "fairness": -0.15,
        "sense_of_control": -0.20,
    },
}

VETO_MALUS = {
    "boundary_veto": {
        "perceived_risk": 0.35,
        "stress": 0.30,
        "trust": -0.30,
        "sense_of_control": 0.05,
    },
    "low_buyin_stalemate": {
        "fairness": -0.15,
        "stress": 0.15,
        "confidence": -0.20,
        "trust": -0.10,
    },
}

SIMULATION_OUTCOMES = {
    "clean_delivery": {
        "trust": 0.25,
        "confidence": 0.20,
        "stress": -0.20,
        "fairness": 0.15,
        "perceived_risk": -0.15,
    },
    "capped_delivery": {
        "confidence": -0.25,
        "stress": 0.20,
        "trust": -0.15,
        "sense_of_control": -0.15,
    },
    "technical_debt": {
        "perceived_risk": 0.30,
        "stress": 0.25,
        "trust": -0.20,
    },
}


def calculate_demand_alignment(
    stakeholder_reqs: list[dict],
    card_slotted_req_ids: set[str],
    trade_off_fulfilled_branches: dict[str, bool] | None = None,
    card_atoms: set[str] | None = None,
) -> float:
    """Calculates continuous stakeholder positive demand alignment ratio in [-1.0, 1.0] across Drivers and Trade-offs.
    
    Supports non-digital partial fulfillment where intel items are composed of multiple atomic operations.
    """
    trade_off_fulfilled_branches = trade_off_fulfilled_branches or {}
    card_atoms = card_atoms or set()

    stance_reqs = [r for r in stakeholder_reqs if r.get("type") in ("driver", "trade_off")]
    if not stance_reqs:
        return 0.0

    score = 0.0
    for req in stance_reqs:
        r_type = req.get("type")
        r_id = req.get("id")
        atoms = set(req.get("atoms", []))

        if r_type == "driver":
            if atoms:
                f = len(atoms & card_atoms) / len(atoms)
            elif r_id in card_slotted_req_ids:
                f = 1.0
            else:
                f = 0.0
            score += (2.0 * f - 1.0)

        elif r_type == "trade_off":
            branch_x_atoms = set(req.get("branch_x_atoms", []))
            branch_y_atoms = set(req.get("branch_y_atoms", []))

            if branch_x_atoms or branch_y_atoms:
                fx = (len(branch_x_atoms & card_atoms) / len(branch_x_atoms)) if branch_x_atoms else 0.0
                fy = (len(branch_y_atoms & card_atoms) / len(branch_y_atoms)) if branch_y_atoms else 0.0
                f = max(fx, fy)
            elif r_id in card_slotted_req_ids or trade_off_fulfilled_branches.get(r_id, False):
                f = 1.0
            else:
                f = 0.0
            score += (2.0 * f - 1.0)

    return max(-1.0, min(1.0, round(score / len(stance_reqs), 3)))


ROLE_SENSITIVITIES = {
    "reliability_ruth": {"stress": 0.35, "perceived_risk": 0.30},
    "requirements_reuben": {"perceived_risk": 0.35, "fairness": 0.25},
    "model_monica": {"confidence": 0.35, "sense_of_control": 0.30},
    "data_dave": {"sense_of_control": 0.30, "stress": 0.20},
    "efficiency_emilia": {"fairness": 0.35, "trust": 0.25},
    "automation_alex": {"stress": -0.20, "sense_of_control": 0.25},
}

SUBSYSTEM_SENSITIVITIES = {
    "ops": {"stress": 0.30, "perceived_risk": 0.20},
    "deploy": {"stress": -0.20, "sense_of_control": 0.25},
    "model": {"confidence": 0.30, "interest": 0.15},
    "data": {"sense_of_control": 0.25, "stress": 0.15},
}


def calculate_dynamic_weights(
    st_id: str,
    stakeholder_reqs: list[dict],
    room_demands: dict[str, int] | None = None,
    card_slotted_counts: dict[str, int] | None = None,
) -> dict[str, float]:
    """Computes bounded, authentic dimensional sensitivity weights w_k(st, C).
    
    Combines role disposition, technical subsystem domain focus, and procedural equity.
    Clamped in [0.75, 1.50] to prevent compounding runaways and negative death spirals.
    """
    role_mods = ROLE_SENSITIVITIES.get(st_id, {})

    subsystem_mods = {}
    for req in stakeholder_reqs:
        desc = req.get("description", "").lower()
        for sub, boosts in SUBSYSTEM_SENSITIVITIES.items():
            if sub in desc:
                for dim, val in boosts.items():
                    subsystem_mods[dim] = max(subsystem_mods.get(dim, 0.0), val)

    equity_mods = {}
    if room_demands and card_slotted_counts:
        total_demands = sum(room_demands.values())
        total_slots = sum(card_slotted_counts.values())
        if total_demands > 0 and total_slots > 0:
            dem_share = room_demands.get(st_id, 0) / total_demands
            slot_share = card_slotted_counts.get(st_id, 0) / total_slots
            if dem_share > slot_share:
                deficit = dem_share - slot_share
                equity_mods["fairness"] = min(0.35, round(deficit * 1.2, 3))
                equity_mods["trust"] = min(0.25, round(deficit * 0.8, 3))

    dynamic_weights = {}
    for dim, base_w in PITCH_SENSITIVITY_WEIGHTS.items():
        delta_role = role_mods.get(dim, 0.0)
        delta_sub = subsystem_mods.get(dim, 0.0)
        delta_eq = equity_mods.get(dim, 0.0)

        # Bounded modulation in [0.75, 1.50]
        total_mod = 1.0 + delta_role + delta_sub + delta_eq
        clamped_mod = max(0.75, min(1.50, total_mod))
        dynamic_weights[dim] = round(base_w * clamped_mod, 4)

    return dynamic_weights


def calculate_reactivity(power: str | float, interest: str | float) -> float:
    """Computes reactivity multiplier mu in [0.0, 1.0] from power and interest."""
    p_val = 0.8 if power == "high" else (0.3 if power == "low" else float(power))
    i_val = 0.8 if interest == "high" else (0.3 if interest == "low" else float(interest))
    return round(0.5 * p_val + 0.5 * i_val, 3)


def calculate_pitch_deltas(
    alignment: float,
    reactivity: float,
    violated_boundary_count: int = 0,
    weights: dict[str, float] | None = None,
) -> dict[str, float]:
    """Calculates non-uniform dimensional deltas for the 7 emotion dimensions."""
    deltas = {}
    w_vec = weights or PITCH_SENSITIVITY_WEIGHTS
    for dim, weight in w_vec.items():
        deltas[dim] = round(reactivity * alignment * weight, 4)

    # Acute impact of violated boundaries
    if violated_boundary_count > 0:
        for dim, b_val in BOUNDARY_BREACH_DELTA.items():
            deltas[dim] = round(deltas.get(dim, 0.0) + (b_val * violated_boundary_count * reactivity), 4)

    return deltas


def get_initial_emotion_values(interest_level: str = "high") -> EmotionValues:
    """Returns baseline emotion values with interest initialized to baseline."""
    ev = EmotionFactory.create_default_emotion_values(0.5)
    if interest_level == "low":
        ev["interest"] = 0.3
    elif interest_level == "high":
        ev["interest"] = 0.7
    return ev


# ---------------------------------------------------------------------------
# Test Suite
# ---------------------------------------------------------------------------

class TestEmotionDynamicsSimulation:

    @classmethod
    def setup_class(cls):
        EmotionFactory.load_config(CONFIG_DIR / "EmotionValueConfig.json")
        cls.progression = load_game_progression()
        cls.requirements = load_requirements()

    @classmethod
    def stance_reqs_for(cls, stakeholder_id: str) -> list[dict]:
        """One challenge's Drivers and Trade-offs for this stakeholder, as data for the maths below.

        These tests used to name challenge ids 0 and 1, the hand written challenges that no longer
        exist. Generated challenge ids are reassigned whenever the content is regenerated, so the
        fixture picks by who the intel belongs to instead of by a number that moves."""
        by_challenge: dict = {}
        for r in cls.requirements:
            if r.get("stakeholder_id") == stakeholder_id and r.get("type") in ("driver", "trade_off"):
                by_challenge.setdefault(r["challenge_id"], []).append(r)
        for _, reqs in sorted(by_challenge.items()):
            if any(r["type"] == "driver" for r in reqs):
                return reqs
        raise AssertionError(f"no challenge in gameConfig has stance intel for {stakeholder_id}")

    def test_positive_pitch_produces_happiness_and_enthusiasm(self):
        """When a high-interest stakeholder's demands are fully met, they shift to Enthusiastic."""
        # Monica in Phase 0 (power: low, interest: high)
        p0_reqs = self.stance_reqs_for("model_monica")
        # "Fully met" means every demand answered, Trade-offs included: alignment averages over both.
        slotted = {r["id"] for r in p0_reqs}

        align = calculate_demand_alignment(p0_reqs, slotted)
        react = calculate_reactivity(power="low", interest="high")  # 0.5 * 0.3 + 0.5 * 0.8 = 0.55
        deltas = calculate_pitch_deltas(align, react)

        ev = get_initial_emotion_values("high")
        updated_ev = apply_emotion_delta(ev, deltas)

        assert align == 1.0
        assert updated_ev["trust"] > 0.5
        assert updated_ev["stress"] < 0.5
        assert updated_ev["fairness"] > 0.5

        # Simulating clean delivery of the approved card
        final_ev = apply_emotion_delta(updated_ev, SIMULATION_OUTCOMES["clean_delivery"])
        state = EmotionFactory.derive_emotional_state(final_ev)
        assert state in ("enthusiastic", "relieved")

    def test_trade_off_disjunctive_satisfaction(self):
        """Satisfying either branch of a Trade-off satisfies the stakeholder without objection."""
        trade_off_req = {
            "id": "req_tradeoff_test",
            "stakeholder_id": "efficiency_emilia",
            "type": "trade_off",
            "description": "I want cloud auto-scaling, but will accept on-prem cluster optimization.",
        }
        stakeholder_reqs = [trade_off_req]

        # Branch Y satisfied
        align_y = calculate_demand_alignment(
            stakeholder_reqs,
            card_slotted_req_ids=set(),
            trade_off_fulfilled_branches={"req_tradeoff_test": True},
        )
        assert align_y == 1.0

        # Neither satisfied
        align_none = calculate_demand_alignment(
            stakeholder_reqs,
            card_slotted_req_ids=set(),
            trade_off_fulfilled_branches={"req_tradeoff_test": False},
        )
        assert align_none == -1.0

    def test_continuous_partial_fulfillment_over_atomic_operations(self):
        """Verifies that an item composed of multiple atomic operations can be partially fulfilled (non-digital)."""
        multi_atom_driver = {
            "id": "req_multi_atom_pipeline",
            "stakeholder_id": "model_monica",
            "type": "driver",
            "atoms": ["raise_to(model.registry, 3)", "raise_to(model.training, 3)"],
        }
        stakeholder_reqs = [multi_atom_driver]

        # 1. 50% atom coverage (1 of 2 atoms in card): f = 0.5 -> align = 2*0.5 - 1 = 0.0 (neutral)
        align_half = calculate_demand_alignment(
            stakeholder_reqs,
            card_slotted_req_ids=set(),
            card_atoms={"raise_to(model.registry, 3)"},
        )
        assert align_half == 0.0

        # 2. 100% atom coverage (2 of 2 atoms in card): f = 1.0 -> align = +1.0
        align_full = calculate_demand_alignment(
            stakeholder_reqs,
            card_slotted_req_ids=set(),
            card_atoms={"raise_to(model.registry, 3)", "raise_to(model.training, 3)"},
        )
        assert align_full == 1.0

        # 3. 0% atom coverage: f = 0.0 -> align = -1.0
        align_zero = calculate_demand_alignment(
            stakeholder_reqs,
            card_slotted_req_ids=set(),
            card_atoms=set(),
        )
        assert align_zero == -1.0

    def test_neglect_generates_frustration_or_skepticism(self):
        """When an invested stakeholder's drivers are completely ignored, they become frustrated or skeptical."""
        p1_reqs = self.stance_reqs_for("efficiency_emilia")

        # Player slots 0 of Emilia's items
        align = calculate_demand_alignment(p1_reqs, card_slotted_req_ids=set())
        react = calculate_reactivity(power="low", interest="high")
        deltas = calculate_pitch_deltas(align, react)

        ev = get_initial_emotion_values("high")
        updated_ev = apply_emotion_delta(ev, deltas)

        assert align == -1.0
        assert updated_ev["fairness"] <= 0.4
        assert updated_ev["trust"] <= 0.4
        assert updated_ev["sense_of_control"] <= 0.4

        state = EmotionFactory.derive_emotional_state(updated_ev)
        assert state in ("skeptical", "frustrated")

    def test_boundary_violation_triggers_anxiety(self):
        """Violating a red line / boundary causes acute risk and stress, triggering Anxious."""
        p0_emilia_reqs = self.stance_reqs_for("efficiency_emilia")

        # Card violates Emilia's latency constraint (1 boundary breach)
        align = calculate_demand_alignment(p0_emilia_reqs, card_slotted_req_ids=set())
        react = calculate_reactivity(power="high", interest="high")
        deltas = calculate_pitch_deltas(align, react, violated_boundary_count=1)

        ev = get_initial_emotion_values("high")
        updated_ev = apply_emotion_delta(ev, deltas)

        assert updated_ev["perceived_risk"] >= 0.6
        assert updated_ev["stress"] >= 0.6
        assert updated_ev["sense_of_control"] <= 0.4

        # Boundary violation pushes perceived_risk and stress up, sense of control down
        state = EmotionFactory.derive_emotional_state(updated_ev)
        assert state == "anxious"

    def test_achievability_of_all_nine_emotional_states(self):
        """Validates that all 9 emotional states defined in EmotionValueConfig can be produced
        under realistic gameplay scenarios.
        """
        achieved_states = set()

        # 1. Neutral (starting baseline)
        ev_neutral = EmotionFactory.create_default_emotion_values(0.5)
        achieved_states.add(EmotionFactory.derive_emotional_state(ev_neutral))

        # 2. Relieved (low stress, low risk, high trust)
        ev_relieved = apply_emotion_delta(
            ev_neutral,
            {"stress": -0.25, "perceived_risk": -0.25, "trust": 0.25, "fairness": 0.20}
        )
        achieved_states.add(EmotionFactory.derive_emotional_state(ev_relieved))

        # 3. Enthusiastic (high trust, high interest, high confidence, low risk)
        ev_enthusiastic = apply_emotion_delta(
            get_initial_emotion_values("high"),
            {"trust": 0.25, "interest": 0.15, "confidence": 0.20, "perceived_risk": -0.20}
        )
        achieved_states.add(EmotionFactory.derive_emotional_state(ev_enthusiastic))

        # 4. Skeptical (low trust, low fairness, moderate/high interest)
        ev_skeptical = apply_emotion_delta(
            get_initial_emotion_values("high"),
            {"trust": -0.20, "fairness": -0.20, "interest": 0.0}
        )
        achieved_states.add(EmotionFactory.derive_emotional_state(ev_skeptical))

        # 5. Frustrated (high interest, low control, low trust, high stress)
        ev_frustrated = apply_emotion_delta(
            get_initial_emotion_values("high"),
            {"interest": 0.10, "sense_of_control": -0.25, "trust": -0.20, "stress": 0.20}
        )
        achieved_states.add(EmotionFactory.derive_emotional_state(ev_frustrated))

        # 6. Anxious (high risk, high stress, low control)
        ev_anxious = apply_emotion_delta(
            ev_neutral,
            {"perceived_risk": 0.25, "stress": 0.25, "sense_of_control": -0.20}
        )
        achieved_states.add(EmotionFactory.derive_emotional_state(ev_anxious))

        # 7. Angry (low fairness, low trust, high stress) - triggered by aggressive boundary violation + neglect
        ev_angry = apply_emotion_delta(
            ev_neutral,
            {"fairness": -0.30, "trust": -0.30, "stress": 0.25}
        )
        achieved_states.add(EmotionFactory.derive_emotional_state(ev_angry))

        # 8. Overwhelmed (very high stress >= 0.75, very high risk >= 0.70, very low control <= 0.25)
        ev_overwhelmed = apply_emotion_delta(
            ev_neutral,
            {"stress": 0.35, "perceived_risk": 0.30, "sense_of_control": -0.35}
        )
        achieved_states.add(EmotionFactory.derive_emotional_state(ev_overwhelmed))

        # 9. Apathetic (low interest <= 0.3, low control <= 0.3)
        ev_apathetic = apply_emotion_delta(
            get_initial_emotion_values("low"),
            {"interest": -0.10, "sense_of_control": -0.25}
        )
        achieved_states.add(EmotionFactory.derive_emotional_state(ev_apathetic))

        expected_states = {
            "neutral", "relieved", "enthusiastic", "skeptical",
            "frustrated", "anxious", "angry", "overwhelmed", "apathetic"
        }
        assert achieved_states == expected_states, f"Missing states: {expected_states - achieved_states}"

    def test_misclassification_constant_malus_application(self):
        """Pitching an action card with a misclassified item applies specific constant malus and drops mood."""
        ev = get_initial_emotion_values("high")

        # Case 1: Driver as Boundary
        ev_driver_as_boundary = apply_emotion_delta(ev, MISCLASSIFICATION_MALUS["driver_as_boundary"])
        assert ev_driver_as_boundary["fairness"] <= 0.35
        assert ev_driver_as_boundary["stress"] >= 0.65

        # Case 2: Boundary as Driver (dangerous neglect of compliance/safety)
        ev_boundary_as_driver = apply_emotion_delta(ev, MISCLASSIFICATION_MALUS["boundary_as_driver"])
        assert ev_boundary_as_driver["perceived_risk"] >= 0.75
        assert ev_boundary_as_driver["stress"] >= 0.70
        assert ev_boundary_as_driver["sense_of_control"] <= 0.40
        assert EmotionFactory.derive_emotional_state(ev_boundary_as_driver) in ("anxious", "overwhelmed")

    def test_multi_phase_iterative_pitch_lifecycle(self):
        """Simulates an end-to-end multi-round negotiation lifecycle in Phase 1:
        Round 1: Initial draft card leaves Reuben neglected -> Reuben objects and becomes angry/frustrated.
        Round 2: Player amends card addressing Reuben's drivers -> Reuben warms up, emotional state turns positive.
        Round 3: Card commits and simulation delivers cleanly -> Reuben becomes enthusiastic/relieved.
        """
        p1_reuben_reqs = self.stance_reqs_for("requirements_reuben")
        reuben_driver_ids = {r["id"] for r in p1_reuben_reqs}

        ev_reuben_base = get_initial_emotion_values("high")
        react = calculate_reactivity(power="high", interest="high")  # 0.8

        # --- Draft 1: Neglected Draft (0 drivers slotted) ---
        align_r1 = calculate_demand_alignment(p1_reuben_reqs, card_slotted_req_ids=set())
        deltas_r1 = calculate_pitch_deltas(align_r1, react)
        ev_draft1 = apply_emotion_delta(ev_reuben_base, deltas_r1)
        state_r1 = EmotionFactory.derive_emotional_state(ev_draft1)
        assert align_r1 == -1.0
        assert state_r1 in ("angry", "frustrated", "skeptical")

        # --- Draft 2: Amended Card (all Reuben drivers slotted) ---
        align_r2 = calculate_demand_alignment(p1_reuben_reqs, card_slotted_req_ids=reuben_driver_ids)
        deltas_r2 = calculate_pitch_deltas(align_r2, react)
        ev_draft2 = apply_emotion_delta(ev_reuben_base, deltas_r2)
        state_r2 = EmotionFactory.derive_emotional_state(ev_draft2)
        assert align_r2 == 1.0
        assert ev_draft2["trust"] > ev_draft1["trust"]
        assert ev_draft2["fairness"] > ev_draft1["fairness"]
        assert ev_draft2["stress"] < ev_draft1["stress"]
        assert state_r2 in ("enthusiastic", "relieved", "neutral")

        # --- Round 3: Post-Commit Clean Simulation Delivery ---
        ev_sim = apply_emotion_delta(ev_draft2, SIMULATION_OUTCOMES["clean_delivery"])
        state_sim = EmotionFactory.derive_emotional_state(ev_sim)
        assert state_sim in ("enthusiastic", "relieved")
        assert ev_sim["trust"] >= 0.65
        assert ev_sim["stress"] <= 0.40

    def test_positive_negative_balance_over_phases(self):
        """Verifies that positive accommodations and negative frictions balance out in magnitude,
        preventing permanent downward death spirals when players make good compromises.
        """
        ev_base = get_initial_emotion_values("high")
        react = calculate_reactivity(power="high", interest="high")

        # Negative hit from 1 turn of neglect
        neg_deltas = calculate_pitch_deltas(-1.0, react)
        ev_after_neg = apply_emotion_delta(ev_base, neg_deltas)

        # Equal and opposite positive recovery from 1 turn of full accommodation
        pos_deltas = calculate_pitch_deltas(1.0, react)
        ev_after_recovery = apply_emotion_delta(ev_after_neg, pos_deltas)

        # Dimension values should return within 0.05 of original baseline
        for dim in ("trust", "fairness", "sense_of_control", "stress", "perceived_risk"):
            diff = abs(ev_after_recovery[dim] - ev_base[dim])
            assert diff <= 0.05, f"Dimension {dim} drifted excessively: {diff}"

    def test_dynamic_weights_role_and_subsystem_differentiation(self):
        """Verifies that Ruth (Reliability) has higher stress sensitivity on ops items than Monica,
        while Monica has higher confidence sensitivity on model items.
        """
        ruth_ops_req = [{"description": "Maintain ops alerting and rollback pipelines for production uptime."}]
        monica_model_req = [{"description": "Iterate model architecture and evaluation benchmarks."}]

        w_ruth = calculate_dynamic_weights("reliability_ruth", ruth_ops_req)
        w_monica = calculate_dynamic_weights("model_monica", monica_model_req)

        # Ruth's stress sensitivity must be significantly amplified relative to Monica's
        assert abs(w_ruth["stress"]) > abs(w_monica["stress"])
        assert abs(w_ruth["stress"]) >= 0.30

        # Monica's confidence sensitivity must be significantly amplified relative to Ruth's
        assert w_monica["confidence"] > w_ruth["confidence"]
        assert w_monica["confidence"] >= 0.25

    def test_dynamic_weights_procedural_equity(self):
        """Verifies that when Emilia has 50% of room demands but receives 0 slots while Reuben gets 100%,
        her fairness and trust sensitivity multipliers escalate significantly.
        """
        emilia_req = [{"description": "Cloud platform cost optimization."}]
        room_demands = {"efficiency_emilia": 5, "requirements_reuben": 5}
        card_slotted_counts = {"efficiency_emilia": 0, "requirements_reuben": 5}

        w_emilia_unfair = calculate_dynamic_weights(
            "efficiency_emilia", emilia_req, room_demands=room_demands, card_slotted_counts=card_slotted_counts
        )
        w_emilia_fair = calculate_dynamic_weights(
            "efficiency_emilia", emilia_req, room_demands=room_demands, card_slotted_counts={"efficiency_emilia": 2, "requirements_reuben": 2}
        )

        assert w_emilia_unfair["fairness"] > w_emilia_fair["fairness"]
        assert w_emilia_unfair["trust"] > w_emilia_fair["trust"]

    def test_anti_death_spiral_bounded_recovery(self):
        """Validates that even under maximum combined sensitivity modulation (1.50x),
        a player making a good-faith amendment fully restores stakeholder baseline,
        proving that dynamic weights do NOT cause negative death spirals.
        """
        ev_base = get_initial_emotion_values("high")
        react = 0.8  # high power + high interest

        # Maximum modulated sensitivity weights
        max_weights = {dim: round(w * 1.50, 4) for dim, w in PITCH_SENSITIVITY_WEIGHTS.items()}

        # Turn 1: Ignored draft card (align = -1.0)
        neg_deltas = calculate_pitch_deltas(-1.0, react, weights=max_weights)
        ev_neg = apply_emotion_delta(ev_base, neg_deltas)
        assert ev_neg["fairness"] < 0.20
        assert ev_neg["stress"] > 0.70

        # Turn 2: Amended card satisfying all demands (align = +1.0)
        pos_deltas = calculate_pitch_deltas(1.0, react, weights=max_weights)
        ev_recovered = apply_emotion_delta(ev_neg, pos_deltas)

        # Baseline fully recovered; no permanent scarring or runaway drift
        for dim in ("fairness", "trust", "sense_of_control", "stress", "perceived_risk"):
            assert abs(ev_recovered[dim] - ev_base[dim]) < 0.01, f"Runaway drift on {dim}: {ev_recovered[dim]}"


