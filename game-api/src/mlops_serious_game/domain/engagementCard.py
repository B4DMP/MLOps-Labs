import json
from pathlib import Path
from pydantic import BaseModel, Field


class EngagementCard(BaseModel):
    """A class representing an engagement card action.

    Args:
        id (str): Unique identifier for the engagement card.
        title (str): Display title of the engagement card.
        icon (str): Iconify icon identifier (e.g. 'ph:seal-check-bold').
        token_cost (int): Cost in Attention Tokens to play the card.
        description (str): Description of the card's function and narrative effect.
        stakeholder_selection_amount (int): Number of stakeholders required (-1 for all, 0 for intel target, >0 for exact count).
        target_type (str): Target entity type ('stakeholder' or 'intel').
        response_snippet (str): Default response template/text generated when played.
        max_plays_per_phase (int): Maximum times this card can be played per phase (-1 for unlimited).
        intel_reveal_count (int): Notes per stakeholder the card settles: unconfirmed held notes are
            checked first, the rest of the budget reveals notes not found yet.
        allowed_requirement_types (list[str]): Optional tag filter. Held notes match on the tag the
            player filed, undiscovered ones on their true tag.
    """

    id: str = Field(description="Unique identifier for the engagement card")
    title: str = Field(description="Display title of the engagement card")
    icon: str = Field(description="Iconify icon identifier")
    token_cost: int = Field(description="Cost in Attention Tokens to play")
    description: str = Field(description="Description of the card function")
    stakeholder_selection_amount: int = Field(
        default=1,
        description="Number of stakeholders selectable (-1 for all, 0 for intel, >0 for count)",
    )
    target_type: str = Field(
        default="stakeholder",
        description="Target category ('stakeholder' or 'intel')",
    )
    response_snippet: str = Field(
        default="",
        description="Default response template or snippet",
    )
    max_plays_per_phase: int = Field(
        default=-1,
        description="Maximum allowed plays per phase (-1 for unlimited, >0 for exact play limit)",
    )
    intel_reveal_count: int = Field(
        default=1,
        description="Notes per stakeholder to check (held, unconfirmed) or reveal (not found yet)",
    )
    allowed_requirement_types: list[str] = Field(
        default_factory=list,
        description="Allowed requirement types to reveal (empty for all)",
    )

    def __str__(self) -> str:
        return f"EngagementCard(id={self.id}, title={self.title}, cost={self.token_cost})"

    @classmethod
    def from_json(cls, metadata_file: Path) -> list["EngagementCard"]:
        """Load engagement cards from a JSON configuration file."""
        with open(metadata_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        card_list = data.get("engagement_cards", data)
        return [cls(**card) for card in card_list]
