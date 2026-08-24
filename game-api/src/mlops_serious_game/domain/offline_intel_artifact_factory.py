from pathlib import Path
import json
from typing import List, Dict, Optional

from mlops_serious_game.domain.offline_intel_artifact import OfflineIntelArtifact
from mlops_serious_game.domain.requirement import ArtifactType


class OfflineIntelArtifactFactory:
    artifacts_by_requirement: Dict[str, OfflineIntelArtifact] = {}

    @classmethod
    def load_artifacts(cls, artifacts_config: Path) -> None:
        """Loads offline intel artifacts from the specified JSON config file."""
        if not artifacts_config.exists():
            cls.artifacts_by_requirement.clear()
            return

        with artifacts_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.artifacts_by_requirement.clear()
        artifacts_list = data.get("artifacts", [])
        for item in artifacts_list:
            req_id = item.get("requirement_id")
            if not req_id:
                continue
            
            # Map artifact type safely
            art_type_str = item.get("artifact_type", ArtifactType.EMAIL.value)
            try:
                art_type = ArtifactType(art_type_str)
            except ValueError:
                art_type = ArtifactType.EMAIL

            artifact = OfflineIntelArtifact(
                id=str(item.get("id", f"art_{req_id}")),
                requirement_id=str(req_id),
                challenge_id=int(item.get("challenge_id", 0)),
                stakeholder_id=str(item.get("stakeholder_id", "")),
                stakeholder_name=str(item.get("stakeholder_name", "")),
                stakeholder_role=str(item.get("stakeholder_role", "")),
                artifact_type=art_type,
                content=str(item.get("content", "")),
                wrong_descriptions=item.get("wrong_descriptions", {})
            )
            cls.artifacts_by_requirement[req_id] = artifact

    @classmethod
    def get_artifact_for_requirement(cls, requirement_id: str) -> Optional[OfflineIntelArtifact]:
        """Gets the pre-generated offline intel artifact for a specific requirement ID."""
        return cls.artifacts_by_requirement.get(requirement_id)

    @classmethod
    def get_artifacts_for_challenge(cls, challenge_id: int) -> List[OfflineIntelArtifact]:
        """Gets all offline intel artifacts belonging to a specific challenge ID."""
        return [art for art in cls.artifacts_by_requirement.values() if art.challenge_id == challenge_id]

    @classmethod
    def get_wrong_description(cls, requirement_id: str, categorized_type: str) -> Optional[str]:
        """Gets the wrong description for a given requirement ID and miscategorized type."""
        artifact = cls.artifacts_by_requirement.get(requirement_id)
        if artifact and artifact.wrong_descriptions:
            return artifact.wrong_descriptions.get(categorized_type)
        return None
