from pathlib import Path

import click

from mlops_serious_game.application import LongTermMemoryCreator
from mlops_serious_game.config import settings
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

def main() -> None:
    """CLI command to create long-term memory for stakeholders.

    Args:
        metadata_file: Path to the stakeholders extraction metadata JSON file.
    """
    stakeholders = StakeholderFactory.get_available_stakeholders()

    long_term_memory_creator = LongTermMemoryCreator.build_from_settings()
    long_term_memory_creator(stakeholders)


if __name__ == "__main__":
    main()
