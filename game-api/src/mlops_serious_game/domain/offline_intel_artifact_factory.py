from pathlib import Path
import json
from typing import List, Dict, Optional

from mlops_serious_game.domain.offline_intel_artifact import OfflineIntelArtifact
from mlops_serious_game.domain.persona_resolver import personalize, personalize_mapping
from mlops_serious_game.domain.requirement import ArtifactType


class OfflineIntelArtifactFactory:
    artifacts_by_requirement: Dict[str, OfflineIntelArtifact] = {}

    @staticmethod
    def _personalized(artifact: OfflineIntelArtifact) -> OfflineIntelArtifact:
        """Renders name tokens and fills the stakeholder fields from the config.

        Name and role are not stored on the artifact any more: they are the
        stakeholder's, they change with the persona the player drew, and having
        two copies of them meant they could drift apart.
        """
        from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

        stakeholder = None
        if artifact.speaker_id:
            try:
                stakeholder = StakeholderFactory.get_stakeholder(artifact.speaker_id)
            except Exception:
                stakeholder = None

        return artifact.model_copy(
            update={
                "content": personalize(artifact.content),
                "wrong_descriptions": personalize_mapping(artifact.wrong_descriptions),
                "stakeholder_name": stakeholder.name if stakeholder else artifact.stakeholder_name,
                "stakeholder_role": (
                    stakeholder.role_description if stakeholder else artifact.stakeholder_role
                ),
            }
        )

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
                stakeholder_id=item.get("stakeholder_id") or None,
                narrator_id=item.get("narrator_id") or None,
                stakeholder_name=str(item.get("stakeholder_name", "")),
                stakeholder_role=str(item.get("stakeholder_role", "")),
                artifact_type=art_type,
                content=str(item.get("content", "")),
                wrong_descriptions=item.get("wrong_descriptions", {}),
                is_known=item["is_known"],
                humor_archetype=item.get("humor_archetype") or None,
                humor_verdict=item.get("humor_verdict") or None,
                humor_review_reason=item.get("humor_review_reason") or None,
            )
            cls.artifacts_by_requirement[req_id] = artifact

    @classmethod
    def get_artifact_for_requirement(cls, requirement_id: str) -> Optional[OfflineIntelArtifact]:
        """Gets the pre-generated offline intel artifact for a specific requirement ID."""
        artifact = cls.artifacts_by_requirement.get(requirement_id)
        return cls._personalized(artifact) if artifact else None

    @classmethod
    def get_artifacts_for_challenge(cls, challenge_id: int) -> List[OfflineIntelArtifact]:
        """Gets all offline intel artifacts belonging to a specific challenge ID."""
        return [
            cls._personalized(art)
            for art in cls.artifacts_by_requirement.values()
            if art.challenge_id == challenge_id
        ]

    @classmethod
    def get_wrong_description(cls, requirement_id: str, categorized_type: str) -> Optional[str]:
        """Gets the wrong description for a given requirement ID and miscategorized type."""
        artifact = cls.artifacts_by_requirement.get(requirement_id)
        if artifact and artifact.wrong_descriptions:
            wrong = artifact.wrong_descriptions.get(categorized_type)
            return personalize(wrong) if wrong else None
        return None
