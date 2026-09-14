import json
from pathlib import Path
from mlops_serious_game.domain.exceptions import EngagementCardNotFound
from mlops_serious_game.domain.engagementCard import EngagementCard


class EngagementCardFactory:
    cards: list[EngagementCard] = []

    @classmethod
    def load_cards(cls, card_config: Path) -> None:
        """Loads engagement cards from a JSON configuration file."""
        with card_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.cards.clear()

        for j in data.get("engagement_cards", []):
            card = EngagementCard(
                id=j["id"],
                title=j["title"],
                icon=j["icon"],
                token_cost=j["token_cost"],
                description=j["description"],
                stakeholder_selection_amount=j.get("stakeholder_selection_amount", 1),
                target_type=j.get("target_type", "stakeholder"),
                response_snippet=j.get("response_snippet", ""),
                max_plays_per_phase=j.get("max_plays_per_phase", -1),
                turns=j.get("turns", j.get("intel_reveal_count", 1)),
                allowed_requirement_types=j.get("allowed_requirement_types", []),
            )
            cls.cards.append(card)

    @classmethod
    def get_card(cls, card_id: str) -> EngagementCard:
        """Retrieves an EngagementCard by its ID or title.

        Args:
            card_id (str): Identifier or title of the engagement card.

        Returns:
            EngagementCard: The matching card instance.

        Raises:
            EngagementCardNotFound: If card ID is not found.
        """
        for card in cls.cards:
            if card.id == card_id or card.title == card_id:
                return card
        raise EngagementCardNotFound(card_id)

    @classmethod
    def get_available_cards(cls) -> list[EngagementCard]:
        """Returns all currently loaded engagement cards."""
        return cls.cards
