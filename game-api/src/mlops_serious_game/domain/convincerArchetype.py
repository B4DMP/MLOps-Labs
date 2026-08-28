from typing import Optional
from pydantic import BaseModel, Field


class ConvincerArchetype(BaseModel):
    """Represents a stakeholder convincer archetype profile and persuasion strategy."""

    name: str = Field(default="", description="Name of the convincer archetype (e.g. Technical Excellence)")
    evidence_basis: int = Field(
        default=0,
        ge=0,
        le=5,
        description="Evidence basis: 0 = rational/data-driven -> 5 = relational/trust-driven",
    )
    risk_and_control: int = Field(
        default=0,
        ge=0,
        le=5,
        description="Risk & control tolerance: 0 = autonomy-seeking/risk-tolerant -> 5 = control-seeking/risk-averse",
    )
    value_horizon: int = Field(
        default=0,
        ge=0,
        le=5,
        description="Value horizon: 0 = short-term practical -> 5 = long-term strategic",
    )
    strategy: str = Field(default="", description="Recommended persuasion and communication strategy")
