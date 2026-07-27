from pathlib import Path

import click

from philoagents.application import LongTermMemoryCreator
from philoagents.config import settings
from philoagents.domain.stakeholder import Stakeholder
from philoagents.domain.stakeholder_factory import StakeholderFactory

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
